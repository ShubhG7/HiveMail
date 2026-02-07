import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getGmailClient, sendReply, Attachment } from "@/lib/gmail";
import { getLLMConfig, generateReplyDraft, detectSensitivePatterns } from "@/lib/llm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const action = body.action; // "draft" or "send"

    const thread = await prisma.thread.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        messages: {
          orderBy: { date: "desc" },
          take: 5,
        },
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (action === "draft") {
      // Generate AI draft
      const llmConfig = await getLLMConfig(session.user.id);
      
      if (!llmConfig) {
        return NextResponse.json(
          { error: "LLM API key not configured" },
          { status: 400 }
        );
      }

      const lastMessage = thread.messages[0];
      const lastMessageBody = lastMessage?.bodyTextEnc
        ? decrypt(lastMessage.bodyTextEnc)
        : lastMessage?.snippet || "";

      const draft = await generateReplyDraft(llmConfig, {
        threadSummary: thread.summary || thread.summaryShort || "",
        lastMessage: {
          from: lastMessage?.fromAddress || "",
          body: lastMessageBody,
        },
        userInstructions: body.instructions,
        userTone: body.tone,
      });

      // Check for sensitive content in draft
      const sensitiveFlags = detectSensitivePatterns(draft);

      return NextResponse.json({
        draft,
        sensitiveFlags,
        warnings: sensitiveFlags.length > 0
          ? ["Draft may contain sensitive information. Please review carefully."]
          : [],
      });
    }

    if (action === "send") {
      // Check user settings
      const settings = await prisma.userSettings.findUnique({
        where: { userId: session.user.id },
      });

      if (!settings?.aiReplyEnabled) {
        return NextResponse.json(
          { error: "AI replies not enabled in settings" },
          { status: 400 }
        );
      }

      // Validate reply content
      if (!body.content || body.content.trim().length === 0) {
        return NextResponse.json(
          { error: "Reply content is required" },
          { status: 400 }
        );
      }

      // Check for sensitive content
      const sensitiveFlags = detectSensitivePatterns(body.content);
      if (sensitiveFlags.length > 0 && !body.confirmSensitive) {
        return NextResponse.json({
          requireConfirmation: true,
          sensitiveFlags,
          message: "Reply contains potentially sensitive information. Please confirm.",
        });
      }

      // Get Gmail client and send
      const gmail = await getGmailClient(session.user.id);
      const lastMessage = thread.messages[0];

      // Convert attachments from base64 to Buffer
      const attachments: Attachment[] | undefined = body.attachments
        ? body.attachments.map((att: any) => ({
            filename: att.filename,
            content: Buffer.from(att.content, "base64"),
            contentType: att.contentType,
          }))
        : undefined;

      const messageId = await sendReply(gmail, {
        threadId: thread.gmailThreadId,
        to: body.to || [lastMessage?.fromAddress],
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject || `Re: ${thread.subject}`,
        body: body.content,
        bodyHtml: body.contentHtml,
        attachments,
        inReplyTo: body.inReplyTo,
        references: body.references,
      });

      return NextResponse.json({
        success: true,
        messageId,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to process reply:", error);
    return NextResponse.json(
      { error: "Failed to process reply" },
      { status: 500 }
    );
  }
}
