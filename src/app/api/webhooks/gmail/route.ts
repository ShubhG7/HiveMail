import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Gmail Watch API Webhook Handler
 * 
 * This endpoint receives push notifications from Google Cloud Pub/Sub
 * when new emails arrive or changes occur in a user's Gmail inbox.
 * 
 * Flow:
 * 1. Gmail detects a change (new email, label change, etc.)
 * 2. Gmail pushes notification to Cloud Pub/Sub
 * 3. Pub/Sub sends HTTP POST to this webhook
 * 4. We decode the notification and trigger an incremental sync
 * 
 * Setup required:
 * 1. Create a Pub/Sub topic: gmail-push-notifications
 * 2. Create a subscription pointing to this webhook URL
 * 3. Call users.watch() to register the user for push notifications
 */

interface PubSubMessage {
  message: {
    data: string; // Base64 encoded JSON
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: PubSubMessage = await request.json();
    
    console.log("[Gmail Webhook] Received push notification", {
      messageId: body.message.messageId,
      subscription: body.subscription,
    });

    // Decode the base64 message data
    const messageData = Buffer.from(body.message.data, "base64").toString("utf-8");
    const notification: GmailPushNotification = JSON.parse(messageData);

    console.log("[Gmail Webhook] Decoded notification", {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId,
    });

    // Find the user by email
    const user = await prisma.user.findUnique({
      where: { email: notification.emailAddress },
      include: {
        oauthTokens: {
          where: { provider: "google" },
        },
      },
    });

    if (!user) {
      console.warn("[Gmail Webhook] User not found for email", {
        email: notification.emailAddress,
      });
      // Return 200 to acknowledge receipt (Pub/Sub will retry on non-2xx)
      return NextResponse.json({ status: "user_not_found" });
    }

    if (!user.oauthTokens.length) {
      console.warn("[Gmail Webhook] No OAuth token for user", {
        userId: user.id,
      });
      return NextResponse.json({ status: "no_oauth_token" });
    }

    // Check if we already have a pending/running sync job
    const existingJob = await prisma.syncJob.findFirst({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });

    if (existingJob) {
      console.log("[Gmail Webhook] Sync job already in progress", {
        userId: user.id,
        jobId: existingJob.id,
      });
      return NextResponse.json({ status: "sync_in_progress" });
    }

    // Create an incremental sync job
    const job = await prisma.syncJob.create({
      data: {
        userId: user.id,
        jobType: "INCREMENTAL",
        status: "PENDING",
        metadata: {
          triggeredBy: "gmail_push",
          historyId: notification.historyId,
          messageId: body.message.messageId,
        },
      },
    });

    console.log("[Gmail Webhook] Created sync job", {
      userId: user.id,
      jobId: job.id,
    });

    // Trigger the worker to process the job
    const workerUrl = process.env.WORKER_BASE_URL || "http://localhost:8000";
    const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    try {
      const response = await fetch(`${workerUrl}/api/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": correlationId,
        },
        body: JSON.stringify({
          userId: user.id,
          jobType: "INCREMENTAL",
          correlationId,
          metadata: {
            jobId: job.id,
            historyId: notification.historyId,
          },
        }),
      });

      if (!response.ok) {
        console.error("[Gmail Webhook] Worker request failed", {
          status: response.status,
          statusText: response.statusText,
        });
      } else {
        console.log("[Gmail Webhook] Worker triggered successfully", {
          jobId: job.id,
        });
      }
    } catch (workerError: any) {
      console.error("[Gmail Webhook] Failed to trigger worker", {
        error: workerError.message,
      });
      // Don't fail the webhook - the job is created and can be retried
    }

    return NextResponse.json({ 
      status: "ok",
      jobId: job.id,
    });

  } catch (error: any) {
    console.error("[Gmail Webhook] Error processing notification", {
      error: error.message,
      stack: error.stack,
    });
    
    // Return 200 to prevent Pub/Sub from retrying
    // (we don't want to process malformed messages repeatedly)
    return NextResponse.json({ 
      status: "error",
      message: error.message,
    });
  }
}

// Acknowledge GET requests (used for subscription verification)
export async function GET() {
  return NextResponse.json({ 
    status: "ok",
    service: "gmail-webhook",
    timestamp: new Date().toISOString(),
  });
}
