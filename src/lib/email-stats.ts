import { prisma } from "./db";

export interface EmailStatsData {
  totalThreads: number;
  totalMessages: number;
  unreadThreads: number;
  needsReplyCount: number;
  threadsThisWeek: number;
  threadsThisMonth: number;
  rejectionCount: number;
  offerCount: number;
  categoryBreakdown: Array<{ category: string; count: number }>;
  topSenders: Array<{ email: string; count: number }>;
}

/**
 * Compute email statistics for a user
 */
export async function computeEmailStats(userId: string): Promise<EmailStatsData> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get counts by category
  const categoryStats = await prisma.thread.groupBy({
    by: ["category"],
    where: { userId },
    _count: { id: true },
  });

  // Get counts
  const [
    totalThreads,
    totalMessages,
    threadsThisWeek,
    threadsThisMonth,
    unreadThreads,
    needsReplyCount,
    rejectionThreads,
    offerThreads,
    topSenders,
  ] = await Promise.all([
    prisma.thread.count({ where: { userId } }),
    prisma.message.count({ where: { userId } }),
    prisma.thread.count({ where: { userId, lastMessageAt: { gte: oneWeekAgo } } }),
    prisma.thread.count({ where: { userId, lastMessageAt: { gte: oneMonthAgo } } }),
    prisma.thread.count({ where: { userId, isRead: false } }),
    prisma.thread.count({ where: { userId, needsReply: true } }),
    prisma.thread.count({
      where: {
        userId,
        OR: [
          { subject: { contains: "unfortunately", mode: "insensitive" } },
          { subject: { contains: "regret", mode: "insensitive" } },
          { subject: { contains: "not selected", mode: "insensitive" } },
          { subject: { contains: "unable to proceed", mode: "insensitive" } },
          { subject: { contains: "decided not to", mode: "insensitive" } },
          { subject: { contains: "after careful consideration", mode: "insensitive" } },
          { summary: { contains: "rejection", mode: "insensitive" } },
          { summary: { contains: "rejected", mode: "insensitive" } },
          { summary: { contains: "not moving forward", mode: "insensitive" } },
        ],
      },
    }),
    prisma.thread.count({
      where: {
        userId,
        OR: [
          { subject: { contains: "offer", mode: "insensitive" } },
          { subject: { contains: "congratulations", mode: "insensitive" } },
          { subject: { contains: "pleased to", mode: "insensitive" } },
          { subject: { contains: "accepted", mode: "insensitive" } },
          { subject: { contains: "welcome to", mode: "insensitive" } },
          { summary: { contains: "offer", mode: "insensitive" } },
        ],
      },
    }),
    prisma.message.groupBy({
      by: ["fromAddress"],
      where: { userId },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
  ]);

  return {
    totalThreads,
    totalMessages,
    unreadThreads,
    needsReplyCount,
    threadsThisWeek,
    threadsThisMonth,
    rejectionCount: rejectionThreads,
    offerCount: offerThreads,
    categoryBreakdown: categoryStats.map((c) => ({
      category: c.category || "misc",
      count: c._count.id,
    })),
    topSenders: topSenders.map((s) => ({
      email: s.fromAddress,
      count: s._count.id,
    })),
  };
}

/**
 * Get or compute cached email statistics
 */
export async function getCachedEmailStats(
  userId: string,
  maxAgeMinutes: number = 60
): Promise<EmailStatsData> {
  // Try to get cached stats
  const cached = await prisma.emailStats.findUnique({
    where: { userId },
  });

  // If cache exists and is fresh, return it
  if (cached) {
    const ageMinutes =
      (Date.now() - cached.computedAt.getTime()) / (1000 * 60);
    if (ageMinutes < maxAgeMinutes) {
      return {
        totalThreads: cached.totalThreads,
        totalMessages: cached.totalMessages,
        unreadThreads: cached.unreadThreads,
        needsReplyCount: cached.needsReplyCount,
        threadsThisWeek: cached.threadsThisWeek,
        threadsThisMonth: cached.threadsThisMonth,
        rejectionCount: cached.rejectionCount,
        offerCount: cached.offerCount,
        categoryBreakdown: cached.categoryBreakdown as Array<{
          category: string;
          count: number;
        }>,
        topSenders: cached.topSenders as Array<{ email: string; count: number }>,
      };
    }
  }

  // Compute fresh stats
  const stats = await computeEmailStats(userId);

  // Update or create cache
  await prisma.emailStats.upsert({
    where: { userId },
    create: {
      userId,
      totalThreads: stats.totalThreads,
      totalMessages: stats.totalMessages,
      unreadThreads: stats.unreadThreads,
      needsReplyCount: stats.needsReplyCount,
      threadsThisWeek: stats.threadsThisWeek,
      threadsThisMonth: stats.threadsThisMonth,
      rejectionCount: stats.rejectionCount,
      offerCount: stats.offerCount,
      categoryBreakdown: stats.categoryBreakdown,
      topSenders: stats.topSenders,
    },
    update: {
      totalThreads: stats.totalThreads,
      totalMessages: stats.totalMessages,
      unreadThreads: stats.unreadThreads,
      needsReplyCount: stats.needsReplyCount,
      threadsThisWeek: stats.threadsThisWeek,
      threadsThisMonth: stats.threadsThisMonth,
      rejectionCount: stats.rejectionCount,
      offerCount: stats.offerCount,
      categoryBreakdown: stats.categoryBreakdown,
      topSenders: stats.topSenders,
      computedAt: new Date(),
    },
  });

  return stats;
}

/**
 * Invalidate cached stats for a user (call after email sync)
 */
export async function invalidateEmailStats(userId: string): Promise<void> {
  await prisma.emailStats.deleteMany({
    where: { userId },
  });
}
