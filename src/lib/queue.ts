import { prisma } from "./db";
import { generateCorrelationId } from "./utils";

export interface SyncJobPayload {
  userId: string;
  jobType: "BACKFILL" | "INCREMENTAL" | "PROCESS_THREAD" | "PROCESS_MESSAGE";
  correlationId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a sync job in the database and optionally trigger the worker
 */
export async function enqueueSyncJob(
  userId: string,
  jobType: "BACKFILL" | "INCREMENTAL" | "PROCESS_THREAD" | "PROCESS_MESSAGE",
  metadata?: Record<string, unknown>
): Promise<string> {
  const correlationId = generateCorrelationId();

  const job = await prisma.syncJob.create({
    data: {
      userId,
      jobType,
      status: "PENDING",
      metadata: metadata as any,
    },
  });

  // Log the job creation
  await prisma.processingLog.create({
    data: {
      userId,
      jobId: job.id,
      correlationId,
      level: "info",
      message: `Created ${jobType} job`,
      metadata: { jobId: job.id, ...metadata },
    },
  });

  // Trigger worker
  await triggerWorker({
    userId,
    jobType,
    correlationId,
    metadata: { jobId: job.id, ...metadata },
  });

  return job.id;
}

/**
 * Trigger the worker service
 */
async function triggerWorker(payload: SyncJobPayload): Promise<void> {
  const workerUrl = process.env.WORKER_BASE_URL;

  if (!workerUrl) {
    console.warn("WORKER_BASE_URL not set, skipping worker trigger");
    return;
  }

  try {
    // For Cloud Tasks in production
    if (process.env.GCP_PROJECT_ID && process.env.GCP_QUEUE_NAME) {
      await enqueueCloudTask(payload);
    } else {
      // Direct HTTP call for local development
      await fetch(`${workerUrl}/api/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": payload.correlationId,
        },
        body: JSON.stringify(payload),
      });
    }
  } catch (error) {
    console.error("Failed to trigger worker:", error);
    // Don't throw - job is still in DB and can be retried
  }
}

/**
 * Enqueue a Cloud Task (production)
 */
async function enqueueCloudTask(payload: SyncJobPayload): Promise<void> {
  // Dynamic import for optional dependency
  const { CloudTasksClient } = await import("@google-cloud/tasks");

  const client = new CloudTasksClient();
  const project = process.env.GCP_PROJECT_ID!;
  const location = process.env.GCP_LOCATION || "us-central1";
  const queue = process.env.GCP_QUEUE_NAME!;
  const workerUrl = process.env.WORKER_BASE_URL!;

  const parent = client.queuePath(project, location, queue);

  await client.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: `${workerUrl}/api/jobs`,
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": payload.correlationId,
        },
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    },
  });
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED",
  options?: {
    progress?: number;
    totalItems?: number;
    error?: string;
  }
): Promise<void> {
  const updateData: any = { status };

  if (status === "RUNNING") {
    updateData.startedAt = new Date();
  } else if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") {
    updateData.completedAt = new Date();
  }

  if (options?.progress !== undefined) {
    updateData.progress = options.progress;
  }
  if (options?.totalItems !== undefined) {
    updateData.totalItems = options.totalItems;
  }
  if (options?.error) {
    updateData.error = options.error;
  }

  await prisma.syncJob.update({
    where: { id: jobId },
    data: updateData,
  });
}

/**
 * Get pending jobs for a user
 */
export async function getPendingJobs(userId: string) {
  return prisma.syncJob.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get recent jobs for a user
 */
export async function getRecentJobs(userId: string, limit: number = 10) {
  return prisma.syncJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
