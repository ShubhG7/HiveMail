/**
 * Analytics utilities for calling worker DuckDB analytics endpoints.
 */

const WORKER_BASE_URL = process.env.NEXT_PUBLIC_WORKER_BASE_URL || process.env.WORKER_BASE_URL;

export interface AnalyticsStats {
  totalThreads: number;
  totalMessages: number;
  unreadThreads: number;
  needsReplyCount: number;
  starredCount: number;
  categoryBreakdown: Record<string, number>;
  topSenders: Array<{ email: string; count: number }>;
  monthlyCounts: Array<{ month: string; count: number }>;
  messagesWithAttachments: number;
  avgSpamScore: number;
}

export interface TemporalAnalytics {
  period: string;
  data: Array<{
    period: string;
    message_count: number;
    thread_count: number;
    unread_count: number;
  }>;
}

export interface SenderAnalytics {
  senders: Array<{
    fromAddress: string;
    message_count: number;
    thread_count: number;
    first_message: string;
    last_message: string;
    avg_spam_score: number;
    messages_with_attachments: number;
  }>;
}

/**
 * Get comprehensive email statistics from worker (DuckDB).
 * Falls back gracefully if worker is unavailable.
 */
export async function getAnalyticsStats(
  userId: string
): Promise<AnalyticsStats | null> {
  if (!WORKER_BASE_URL) {
    return null;
  }

  try {
    const response = await fetch(
      `${WORKER_BASE_URL}/api/analytics/stats?userId=${userId}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error("Failed to get analytics stats:", error);
  }

  return null;
}

/**
 * Get temporal analytics (email counts over time).
 */
export async function getTemporalAnalytics(
  userId: string,
  period: "day" | "week" | "month" = "month",
  startDate?: string,
  endDate?: string
): Promise<TemporalAnalytics | null> {
  if (!WORKER_BASE_URL) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      userId,
      period,
    });
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    const response = await fetch(
      `${WORKER_BASE_URL}/api/analytics/temporal?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error("Failed to get temporal analytics:", error);
  }

  return null;
}

/**
 * Get sender analytics.
 */
export async function getSenderAnalytics(
  userId: string,
  senderEmail?: string,
  limit: number = 50
): Promise<SenderAnalytics | null> {
  if (!WORKER_BASE_URL) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      userId,
      limit: limit.toString(),
    });
    if (senderEmail) params.append("senderEmail", senderEmail);

    const response = await fetch(
      `${WORKER_BASE_URL}/api/analytics/senders?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error("Failed to get sender analytics:", error);
  }

  return null;
}

/**
 * Get optimized dashboard data from worker (DuckDB).
 * This is the fastest way to get all dashboard data.
 */
export async function getDashboardAnalytics(userId: string): Promise<any | null> {
  if (!WORKER_BASE_URL) {
    return null;
  }

  try {
    const response = await fetch(
      `${WORKER_BASE_URL}/api/analytics/dashboard?userId=${userId}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error("Failed to get dashboard analytics:", error);
  }

  return null;
}
