import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { triggerSyncJob } from "@/lib/queue";
import crypto from "crypto";

/**
 * Gmail Watch API webhook endpoint
 * Receives push notifications from Gmail when new emails arrive
 * 
 * Gmail sends POST requests with:
 * - X-Goog-Channel-ID: The channel ID we provided
 * - X-Goog-Channel-Token: The token we provided
 * - X-Goog-Channel-Expiration: When the channel expires
 * - X-Goog-Resource-ID: The resource ID
 * - X-Goog-Resource-State: "sync" (initial) or "exists" (subsequent)
 * - X-Goog-Resource-URI: The resource URI
 * - X-Goog-Message-Number: Message sequence number
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the request is from Gmail (basic verification)
    const channelId = request.headers.get("X-Goog-Channel-ID");
    const resourceState = request.headers.get("X-Goog-Resource-State");
    const messageNumber = request.headers.get("X-Goog-Message-Number");

    console.log("[Gmail Webhook] Received notification", {
      channelId,
      resourceState,
      messageNumber,
    });

    // For initial sync notification, we can ignore it (we'll sync on first watch)
    if (resourceState === "sync") {
      console.log("[Gmail Webhook] Initial sync notification, ignoring");
      return NextResponse.json({ received: true });
    }

    // For "exists" state, we need to find which user this belongs to
    // Gmail doesn't send user info, so we need to match by channel ID or topic
    // For now, we'll trigger sync for all active watches
    // In production, you'd use Pub/Sub topics to route to specific users

    const activeWatches = await prisma.oAuthToken.findMany({
      where: {
        provider: "google",
        watchExpiration: {
          gt: new Date(), // Not expired
        },
      },
      select: {
        userId: true,
        watchTopic: true,
      },
    });

    console.log("[Gmail Webhook] Found active watches", {
      count: activeWatches.length,
    });

    // Trigger incremental sync for each user with active watch
    const syncPromises = activeWatches.map((watch) =>
      triggerSyncJob(watch.userId, "INCREMENTAL", {
        triggeredBy: "webhook",
        channelId,
        messageNumber,
      }).catch((error) => {
        console.error(
          `[Gmail Webhook] Failed to trigger sync for user ${watch.userId}:`,
          error
        );
      })
    );

    await Promise.allSettled(syncPromises);

    return NextResponse.json({
      received: true,
      processed: activeWatches.length,
    });
  } catch (error: any) {
    console.error("[Gmail Webhook] Error processing webhook:", error);
    // Return 200 to prevent Gmail from retrying
    return NextResponse.json(
      { error: "Internal error", received: true },
      { status: 200 }
    );
  }
}

/**
 * GET endpoint for webhook verification
 * Gmail may send GET requests to verify the webhook URL
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("challenge");
  
  if (challenge) {
    // Return the challenge token to verify the webhook
    return NextResponse.json({ challenge });
  }

  return NextResponse.json({ status: "ok" });
}
