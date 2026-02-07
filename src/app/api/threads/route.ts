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
    const isStarred = searchParams.get("isStarred");
    const label = searchParams.get("label");
    const sent = searchParams.get("sent");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const sortBy = searchParams.get("sortBy") || "lastMessageAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // Build where clause
    let where: any = { userId: session.user.id };
    
    // Filter by Gmail label (e.g., SENT, INBOX, DRAFT)
    if (label) {
      where.labels = { has: label };
    }
    
    // Filter for sent emails: find threads where the user is a participant (sender)
    // Since the initial backfill may not have fetched sent-only messages,
    // we look for threads where the user's email is in the participants list
    if (sent === "true") {
      const userEmail = session.user.email;
      if (userEmail) {
        // Strategy 1: Check messages where user is the sender
        // Strategy 2: Check threads where user is in participants
        const [sentByUser, threadsWithUserAsParticipant] = await Promise.all([
          prisma.message.findMany({
            where: { userId: session.user.id, fromAddress: { contains: userEmail, mode: "insensitive" } },
            select: { gmailThreadId: true },
            distinct: ["gmailThreadId"],
          }),
          prisma.thread.findMany({
            where: { userId: session.user.id, participants: { has: userEmail } },
            select: { gmailThreadId: true },
          }),
        ]);
        
        // Combine both strategies
        const allSentThreadIds = new Set([
          ...sentByUser.map(m => m.gmailThreadId),
          ...threadsWithUserAsParticipant.map(t => t.gmailThreadId),
        ]);

        if (allSentThreadIds.size > 0) {
          where.gmailThreadId = { in: Array.from(allSentThreadIds) };
        } else {
          // No sent messages found — return empty
          where.id = "none";
        }
      }
    }

    // For category filtering, we need to check message.category via gmailThreadId
    // because threads often have "misc" while their messages have the real category
    let gmailThreadIdsWithCategory: string[] = [];
    if (category && category !== "all") {
      // Find gmailThreadIds from messages with this category
      const messagesWithCategory = await prisma.message.findMany({
        where: {
          userId: session.user.id,
          category: category,
        },
        select: {
          gmailThreadId: true,
        },
        distinct: ["gmailThreadId"],
      });
      gmailThreadIdsWithCategory = messagesWithCategory.map((m) => m.gmailThreadId);
      
      // Filter threads by either thread.category OR gmailThreadId from messages
      where.OR = [
        { category: category },
        { gmailThreadId: { in: gmailThreadIdsWithCategory } },
      ];
    }

    if (needsReply === "true") {
      where.needsReply = true;
    }

    if (isStarred === "true") {
      where.isStarred = true;
    }

    if (search) {
      // If we already have an OR clause from category, we need to combine with AND
      const searchCondition = {
        OR: [
        { subject: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
        { participants: { has: search } },
        ],
      };
      
      if (where.OR) {
        // Wrap existing OR in AND with search
        const categoryOr = where.OR;
        delete where.OR;
        where.AND = [
          { OR: categoryOr },
          searchCondition,
        ];
      } else {
        where.OR = searchCondition.OR;
      }
    }

    // Get threads with pagination
    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.thread.count({ where }),
    ]);

    // Fetch latest message for each thread by gmailThreadId (more reliable than FK)
    const threadIds = threads.map((t) => t.gmailThreadId);
    const latestMessages = await prisma.message.findMany({
      where: {
        userId: session.user.id,
        gmailThreadId: { in: threadIds },
      },
      orderBy: { date: "desc" },
      select: {
        gmailThreadId: true,
        id: true,
        snippet: true,
        fromAddress: true,
        fromName: true,
        date: true,
        isRead: true,
        category: true,
      },
    });

    // Group by gmailThreadId and get the latest
    const messagesByThread = new Map<string, typeof latestMessages[0]>();
    for (const msg of latestMessages) {
      if (!messagesByThread.has(msg.gmailThreadId)) {
        messagesByThread.set(msg.gmailThreadId, msg);
      }
    }

    // Build the response with effective categories
    const mappedThreads = threads.map((t) => {
      const latestMessage = messagesByThread.get(t.gmailThreadId);
      // Use message category if thread category is misc and message has a better one
      const effectiveCategory = t.category === "misc" && latestMessage?.category && latestMessage.category !== "misc"
        ? latestMessage.category
        : t.category;
      
      return {
        id: t.id,
        gmailThreadId: t.gmailThreadId,
        subject: t.subject,
        participants: t.participants,
        lastMessageAt: t.lastMessageAt,
        category: effectiveCategory,
        priority: t.priority,
        summaryShort: t.summaryShort,
        needsReply: t.needsReply,
        isRead: t.isRead,
        isStarred: t.isStarred,
        messageCount: t.messageCount,
        latestMessage: latestMessage ? {
          id: latestMessage.id,
          snippet: latestMessage.snippet,
          fromAddress: latestMessage.fromAddress,
          fromName: latestMessage.fromName,
          date: latestMessage.date,
          isRead: latestMessage.isRead,
        } : null,
      };
    });

    // Filter by effectiveCategory if category filter is active
    let filteredThreads = mappedThreads;
    let filteredTotal = total;
    
    if (category && category !== "all") {
      filteredThreads = mappedThreads.filter((t) => t.category === category);
      
      if (filteredThreads.length < mappedThreads.length) {
        const allMatchingThreads = await prisma.thread.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
        });
        
        const allThreadIds = allMatchingThreads.map((t) => t.gmailThreadId);
        const allLatestMessages = await prisma.message.findMany({
          where: {
            userId: session.user.id,
            gmailThreadId: { in: allThreadIds },
          },
          orderBy: { date: "desc" },
          select: {
            gmailThreadId: true,
            category: true,
          },
        });
        
        const allMessagesByThread = new Map<string, typeof allLatestMessages[0]>();
        for (const msg of allLatestMessages) {
          if (!allMessagesByThread.has(msg.gmailThreadId)) {
            allMessagesByThread.set(msg.gmailThreadId, msg);
          }
        }
        
        filteredTotal = allMatchingThreads.filter((t) => {
          const latestMessage = allMessagesByThread.get(t.gmailThreadId);
          const effectiveCategory = t.category === "misc" && latestMessage?.category && latestMessage.category !== "misc"
            ? latestMessage.category
            : t.category;
          return effectiveCategory === category;
        }).length;
      }
    }

    return NextResponse.json({
      threads: filteredThreads,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / limit),
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
