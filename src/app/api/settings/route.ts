import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";

export async function GET() {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: session.user.id },
  });

  if (!settings) {
    return NextResponse.json({
      llmProvider: "gemini-2.5-flash",
      redactionMode: "OFF",
      includeLabels: [],
      excludeLabels: ["SPAM", "TRASH"],
      backfillDays: 30,
      timezone: "UTC",
      aiReplyEnabled: false,
      onboardingComplete: false,
      hasApiKey: false,
    });
  }

  return NextResponse.json({
    llmProvider: settings.llmProvider,
    redactionMode: settings.redactionMode,
    includeLabels: settings.includeLabels,
    excludeLabels: settings.excludeLabels,
    backfillDays: settings.backfillDays,
    timezone: settings.timezone,
    aiReplyEnabled: settings.aiReplyEnabled,
    onboardingComplete: settings.onboardingComplete,
    hasApiKey: !!settings.llmApiKeyEnc,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    const updateData: any = {};
    
    if (body.llmProvider) {
      updateData.llmProvider = body.llmProvider;
    }
    if (body.llmApiKey !== undefined) {
      updateData.llmApiKeyEnc = body.llmApiKey ? encrypt(body.llmApiKey) : null;
    }
    if (body.baseUrl !== undefined) {
      updateData.llmBaseUrl = body.baseUrl || null;
    }
    if (body.model !== undefined) {
      updateData.llmModel = body.model || null;
    }
    if (body.redactionMode) {
      updateData.redactionMode = body.redactionMode;
    }
    if (body.includeLabels) {
      updateData.includeLabels = body.includeLabels;
    }
    if (body.excludeLabels) {
      updateData.excludeLabels = body.excludeLabels;
    }
    if (body.backfillDays) {
      updateData.backfillDays = body.backfillDays;
    }
    if (body.timezone) {
      updateData.timezone = body.timezone;
    }
    if (body.aiReplyEnabled !== undefined) {
      updateData.aiReplyEnabled = body.aiReplyEnabled;
    }
    if (body.onboardingComplete !== undefined) {
      updateData.onboardingComplete = body.onboardingComplete;
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId: session.user.id },
      update: updateData,
      create: {
        userId: session.user.id,
        ...updateData,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        llmProvider: settings.llmProvider,
        redactionMode: settings.redactionMode,
        includeLabels: settings.includeLabels,
        excludeLabels: settings.excludeLabels,
        backfillDays: settings.backfillDays,
        timezone: settings.timezone,
        aiReplyEnabled: settings.aiReplyEnabled,
        onboardingComplete: settings.onboardingComplete,
        hasApiKey: !!settings.llmApiKeyEnc,
      },
    });
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Clear only the API key
    await prisma.userSettings.update({
      where: { userId: session.user.id },
      data: { llmApiKeyEnc: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete API key:", error);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 }
    );
  }
}
