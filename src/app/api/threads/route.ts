import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    
    const category = searchParams.get("category");
    const needsReply = searchParams.get("needsReply");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const sortBy = searchParams.get("sortBy") || "lastMessageAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // Build where clause
    const where: any = { userId: session.user.id };

    if (category && category !== "all") {
      where.category = category;
    }

    if (needsReply === "true") {
      where.needsReply = true;
    }

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
        { participants: { has: search } },
      ];
    }

    // Get threads with pagination
    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          messages: {
            orderBy: { date: "desc" },
            take: 1,
            select: {
              id: true,
              snippet: true,
              fromAddress: true,
              fromName: true,
              date: true,
              isRead: true,
            },
          },
        },
      }),
      prisma.thread.count({ where }),
    ]);

    return NextResponse.json({
      threads: threads.map((t) => ({
        id: t.id,
        gmailThreadId: t.gmailThreadId,
        subject: t.subject,
        participants: t.participants,
        lastMessageAt: t.lastMessageAt,
        category: t.category,
        priority: t.priority,
        summaryShort: t.summaryShort,
        needsReply: t.needsReply,
        isRead: t.isRead,
        isStarred: t.isStarred,
        messageCount: t.messageCount,
        latestMessage: t.messages[0] || null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to get threads:", error);
    return NextResponse.json(
      { error: "Failed to get threads" },
      { status: 500 }
    );
  }
}
