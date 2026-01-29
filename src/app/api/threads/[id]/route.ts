import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getGmailThreadLink } from "@/lib/gmail";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    
    const thread = await prisma.thread.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        messages: {
          orderBy: { date: "asc" },
        },
        tasks: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Mark as read
    if (!thread.isRead) {
      await prisma.thread.update({
        where: { id: thread.id },
        data: { isRead: true },
      });
    }

    // Decrypt message bodies
    const messages = thread.messages.map((m) => ({
      id: m.id,
      gmailMessageId: m.gmailMessageId,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      toAddresses: m.toAddresses,
      ccAddresses: m.ccAddresses,
      date: m.date,
      subject: m.subject,
      snippet: m.snippet,
      bodyText: m.bodyTextEnc ? decrypt(m.bodyTextEnc) : null,
      bodyHtml: m.bodyHtmlEnc ? decrypt(m.bodyHtmlEnc) : null,
      labels: m.labels,
      category: m.category,
      isRead: m.isRead,
      isStarred: m.isStarred,
      hasAttachments: m.hasAttachments,
      attachments: m.attachments,
      extracted: m.extracted,
    }));

    return NextResponse.json({
      id: thread.id,
      gmailThreadId: thread.gmailThreadId,
      subject: thread.subject,
      participants: thread.participants,
      lastMessageAt: thread.lastMessageAt,
      category: thread.category,
      priority: thread.priority,
      summary: thread.summary,
      summaryShort: thread.summaryShort,
      needsReply: thread.needsReply,
      isRead: true,
      isStarred: thread.isStarred,
      labels: thread.labels,
      messageCount: thread.messageCount,
      messages,
      tasks: thread.tasks,
      gmailLink: getGmailThreadLink(thread.gmailThreadId),
    });
  } catch (error) {
    console.error("Failed to get thread:", error);
    return NextResponse.json(
      { error: "Failed to get thread" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const thread = await prisma.thread.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const updateData: any = {};

    if (body.isRead !== undefined) {
      updateData.isRead = body.isRead;
    }
    if (body.isStarred !== undefined) {
      updateData.isStarred = body.isStarred;
    }
    if (body.category !== undefined) {
      updateData.category = body.category;
    }
    if (body.priority !== undefined) {
      updateData.priority = body.priority;
    }
    if (body.needsReply !== undefined) {
      updateData.needsReply = body.needsReply;
    }

    const updated = await prisma.thread.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, thread: updated });
  } catch (error) {
    console.error("Failed to update thread:", error);
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 }
    );
  }
}
