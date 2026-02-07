import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { subDays, startOfDay, endOfDay } from "date-fns";

export async function GET() {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const workerUrl = process.env.WORKER_BASE_URL;

  // Try to get analytics from worker (DuckDB) first
  if (workerUrl) {
    try {
      const response = await fetch(`${workerUrl}/api/analytics/dashboard?userId=${userId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      } else if (response.status === 503) {
        // DuckDB not available, fall through to PostgreSQL
        console.log("DuckDB analytics not available, using PostgreSQL fallback");
      } else {
        console.error(`Worker analytics failed: ${response.status} ${response.statusText}`);
        // Fall through to PostgreSQL
      }
    } catch (error: any) {
      // Worker unavailable or timeout, fall back to PostgreSQL
      console.log("Worker analytics unavailable, using PostgreSQL fallback:", error.message);
    }
  }

  // Fallback to PostgreSQL queries (original implementation)
  try {
    const now = new Date();
    const last7Days = subDays(now, 7);
    const last30Days = subDays(now, 30);

    // Get category counts
    const categoryCounts = await prisma.thread.groupBy({
      by: ["category"],
      where: { userId },
      _count: { category: true },
    });

    // Get needs reply count
    const needsReplyCount = await prisma.thread.count({
      where: { userId, needsReply: true },
    });

    // Get unread count
    const unreadCount = await prisma.thread.count({
      where: { userId, isRead: false },
    });

    // Get starred count
    const starredCount = await prisma.thread.count({
      where: { userId, isStarred: true },
    });

    // Get emails by day for last 7 days
    const emailsByDay = await prisma.$queryRaw`
      SELECT 
        DATE(date) as day,
        COUNT(*) as count
      FROM "Message"
      WHERE "userId" = ${userId}
        AND date >= ${last7Days}
      GROUP BY DATE(date)
      ORDER BY day ASC
    ` as { day: Date; count: bigint }[];

    // Get top senders
    const topSenders = await prisma.message.groupBy({
      by: ["fromAddress"],
      where: {
        userId,
        date: { gte: last30Days },
      },
      _count: { fromAddress: true },
      orderBy: { _count: { fromAddress: "desc" } },
      take: 10,
    });

    // Get upcoming deadlines (tasks with due dates)
    const upcomingDeadlines = await prisma.task.findMany({
      where: {
        userId,
        status: { not: "COMPLETED" },
        dueAt: {
          gte: startOfDay(now),
          lte: endOfDay(subDays(now, -7)), // Next 7 days
        },
      },
      orderBy: { dueAt: "asc" },
      take: 5,
      include: {
        thread: {
          select: { subject: true },
        },
      },
    });

    // Get recent important emails
    const recentImportant = await prisma.thread.findMany({
      where: {
        userId,
        OR: [
          { priority: "HIGH" },
          { priority: "URGENT" },
          { needsReply: true },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: {
        id: true,
        subject: true,
        summaryShort: true,
        category: true,
        priority: true,
        needsReply: true,
        lastMessageAt: true,
        participants: true,
      },
    });

    // Calculate totals
    const totalThreads = await prisma.thread.count({ where: { userId } });
    const totalMessages = await prisma.message.count({ where: { userId } });

    // Category distribution for chart
    const categoryDistribution = categoryCounts.map((c) => ({
      category: c.category,
      count: c._count.category,
    }));

    // 7-day trend
    const trend7Days = emailsByDay.map((d) => ({
      date: d.day,
      count: Number(d.count),
    }));

    return NextResponse.json({
      summary: {
        totalThreads,
        totalMessages,
        unreadCount,
        needsReplyCount,
        starredCount,
      },
      categoryDistribution,
      trend7Days,
      topSenders: topSenders.map((s) => ({
        email: s.fromAddress,
        count: s._count.fromAddress,
      })),
      upcomingDeadlines: upcomingDeadlines.map((d) => ({
        id: d.id,
        title: d.title,
        dueAt: d.dueAt,
        threadSubject: d.thread?.subject,
        priority: d.priority,
      })),
      recentImportant,
    });
  } catch (error) {
    console.error("Failed to get dashboard data:", error);
    return NextResponse.json(
      { error: "Failed to get dashboard data" },
      { status: 500 }
    );
  }
}
