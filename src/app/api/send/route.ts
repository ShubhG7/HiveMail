import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGmailClient, sendReply, Attachment } from "@/lib/gmail";
import { detectSensitivePatterns } from "@/lib/llm";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.to || body.to.length === 0) {
      return NextResponse.json(
        { error: "At least one recipient is required" },
        { status: 400 }
      );
    }

    if (!body.subject || body.subject.trim().length === 0) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    if (!body.content || body.content.trim().length === 0) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    // Check for sensitive content
    const sensitiveFlags = detectSensitivePatterns(body.content);
    if (sensitiveFlags.length > 0 && !body.confirmSensitive) {
      return NextResponse.json({
        requireConfirmation: true,
        sensitiveFlags,
        message: "Message contains potentially sensitive information. Please confirm.",
      });
    }

    // Get Gmail client and send
    const gmail = await getGmailClient(session.user.id);

    // Convert attachments from base64 to Buffer
    const attachments: Attachment[] | undefined = body.attachments
      ? body.attachments.map((att: any) => ({
          filename: att.filename,
          content: Buffer.from(att.content, "base64"),
          contentType: att.contentType,
        }))
      : undefined;

    const messageId = await sendReply(gmail, {
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      body: body.content,
      bodyHtml: body.contentHtml,
      attachments,
    });

    return NextResponse.json({
      success: true,
      messageId,
    });
  } catch (error: any) {
    console.error("Failed to send email:", error);
    return NextResponse.json(
      {
        error: "Failed to send email",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
