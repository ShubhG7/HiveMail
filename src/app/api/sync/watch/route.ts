import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGmailClient, watchGmail, stopWatchGmail } from "@/lib/gmail";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body; // "start" or "stop"

    if (action === "stop") {
      // Stop watching
      const gmail = await getGmailClient(session.user.id);
      await stopWatchGmail(gmail);

      // Update database
      await prisma.oAuthToken.update({
        where: {
          userId_provider: {
            userId: session.user.id,
            provider: "google",
          },
        },
        data: {
          watchExpiration: null,
          watchTopic: null,
        },
      });

      return NextResponse.json({ success: true, message: "Watch stopped" });
    }

    // Start watching
    const webhookUrl = process.env.PUBLIC_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "PUBLIC_WEBHOOK_URL not configured" },
        { status: 500 }
      );
    }

    const gmail = await getGmailClient(session.user.id);
    const result = await watchGmail(gmail, webhookUrl);

    // Calculate expiration date (expiration is in milliseconds)
    const expirationDate = new Date(result.expiration);

    // Update database
    await prisma.oAuthToken.update({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "google",
        },
      },
      data: {
        watchExpiration: expirationDate,
        historyId: result.historyId,
      },
    });

    return NextResponse.json({
      success: true,
      expiration: expirationDate.toISOString(),
      historyId: result.historyId,
      message: "Watch started successfully",
    });
  } catch (error: any) {
    console.error("Failed to manage Gmail watch:", error);
    return NextResponse.json(
      {
        error: "Failed to manage Gmail watch",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const oauthToken = await prisma.oAuthToken.findUnique({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "google",
        },
      },
      select: {
        watchExpiration: true,
        watchTopic: true,
        historyId: true,
      },
    });

    if (!oauthToken) {
      return NextResponse.json({ error: "No OAuth token found" }, { status: 404 });
    }

    const isActive =
      oauthToken.watchExpiration &&
      new Date(oauthToken.watchExpiration) > new Date();

    return NextResponse.json({
      isActive,
      expiration: oauthToken.watchExpiration?.toISOString() || null,
      topic: oauthToken.watchTopic || null,
      historyId: oauthToken.historyId || null,
    });
  } catch (error: any) {
    console.error("Failed to get watch status:", error);
    return NextResponse.json(
      { error: "Failed to get watch status" },
      { status: 500 }
    );
  }
}
