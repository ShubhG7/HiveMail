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

    const jobId = await enqueueSyncJob(
      session.user.id,
      syncType === "backfill" ? "BACKFILL" : "INCREMENTAL",
      {
        backfillDays: settings?.backfillDays || 30,
        excludeLabels: settings?.excludeLabels || ["SPAM", "TRASH"],
      }
    );

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
    // Get recent sync jobs
    const jobs = await prisma.syncJob.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Get current sync status
    const runningJob = jobs.find((j) => j.status === "RUNNING" || j.status === "PENDING");
    const lastCompletedJob = jobs.find((j) => j.status === "COMPLETED");

    // Get email counts
    const [threadCount, messageCount] = await Promise.all([
      prisma.thread.count({ where: { userId: session.user.id } }),
      prisma.message.count({ where: { userId: session.user.id } }),
    ]);

    return NextResponse.json({
      isRunning: !!runningJob,
      currentJob: runningJob
        ? {
            id: runningJob.id,
            type: runningJob.jobType,
            status: runningJob.status,
            progress: runningJob.progress,
            totalItems: runningJob.totalItems,
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
