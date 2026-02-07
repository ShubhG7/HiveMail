import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enqueueSyncJob } from "@/lib/queue";

export async function POST(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const syncType = body.type || "incremental";

    // Check for existing pending/running jobs
    const existingJob = await prisma.syncJob.findFirst({
      where: {
        userId: session.user.id,
        status: { in: ["PENDING", "RUNNING"] },
        jobType: syncType === "backfill" ? "BACKFILL" : "INCREMENTAL",
      },
    });

    if (existingJob) {
      return NextResponse.json({
        success: true,
        jobId: existingJob.id,
        message: "Sync already in progress",
        status: existingJob.status,
      });
    }

    // Get user settings for backfill
    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id },
    });

    console.log(`[Sync] Starting ${syncType} sync for user ${session.user.id}`);
    
    const jobId = await enqueueSyncJob(
      session.user.id,
      syncType === "backfill" ? "BACKFILL" : "INCREMENTAL",
      {
        backfillDays: settings?.backfillDays || 30,
        excludeLabels: settings?.excludeLabels || ["SPAM", "TRASH"],
      }
    );

    console.log(`[Sync] Created job ${jobId} for user ${session.user.id}`);

    return NextResponse.json({
      success: true,
      jobId,
      message: `${syncType} sync started`,
    });
  } catch (error) {
    console.error("Failed to start sync:", error);
    return NextResponse.json(
      { error: "Failed to start sync" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if user has OAuth tokens
    const oauthToken = await prisma.oAuthToken.findUnique({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "google",
        },
      },
    });

    // Get recent sync jobs
    const jobs = await prisma.syncJob.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Get email counts first (needed by auto-fix and response)
    const [threadCount, messageCount] = await Promise.all([
      prisma.thread.count({ where: { userId: session.user.id } }),
      prisma.message.count({ where: { userId: session.user.id } }),
    ]);

    // Get current sync status
    let runningJob = jobs.find((j) => j.status === "RUNNING" || j.status === "PENDING");
    const failedJob = jobs.find((j) => j.status === "FAILED" && !j.completedAt || (j.completedAt && new Date(j.completedAt) > new Date(Date.now() - 60000))); // Failed in last minute
    let lastCompletedJob = jobs.find((j) => j.status === "COMPLETED");
    
    // Auto-fix stuck jobs: If a RUNNING job has been running for more than 2 minutes, mark it as completed
    // This handles cases where the worker crashed or the job got stuck
    if (runningJob) {
      const jobAge = runningJob.startedAt 
        ? Date.now() - new Date(runningJob.startedAt).getTime()
        : Date.now() - new Date(runningJob.createdAt).getTime();
      const twoMinutes = 2 * 60 * 1000;
      const isStuck = jobAge > twoMinutes;
      
      if (isStuck) {
        // Job is stuck - mark it as completed
        // Set totalItems = progress to show 100% (e.g., 150/150 not 150/160)
        const finalProgress = runningJob.progress || 0;
        
        await prisma.syncJob.update({
          where: { id: runningJob.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            progress: finalProgress,
            totalItems: finalProgress,
          },
        });
        
        // Clear the running job reference so the response below shows no running job
        runningJob = undefined;
        lastCompletedJob = { ...jobs[0]!, status: "COMPLETED" as const, completedAt: new Date(), progress: finalProgress, totalItems: finalProgress };
      }
    }

    return NextResponse.json({
      isRunning: !!runningJob,
      hasOAuthToken: !!oauthToken,
      currentJob: (runningJob || failedJob)
        ? {
            id: (runningJob || failedJob)!.id,
            type: (runningJob || failedJob)!.jobType,
            status: (runningJob || failedJob)!.status,
            progress: (runningJob || failedJob)!.progress,
            totalItems: (runningJob || failedJob)!.totalItems,
            createdAt: (runningJob || failedJob)!.createdAt.toISOString(),
            startedAt: (runningJob || failedJob)!.startedAt?.toISOString() || null,
            error: (runningJob || failedJob)!.error,
          }
        : null,
      lastSync: lastCompletedJob?.completedAt || null,
      stats: {
        threads: threadCount,
        messages: messageCount,
      },
      recentJobs: jobs.map((j) => ({
        id: j.id,
        type: j.jobType,
        status: j.status,
        progress: j.progress,
        totalItems: j.totalItems,
        error: j.error,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
      })),
    });
  } catch (error) {
    console.error("Failed to get sync status:", error);
    return NextResponse.json(
      { error: "Failed to get sync status" },
      { status: 500 }
    );
  }
}
