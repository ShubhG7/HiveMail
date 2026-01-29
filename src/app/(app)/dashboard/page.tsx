"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getCategoryById, DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDate, truncate } from "@/lib/utils";
import {
  Inbox,
  Mail,
  MessageSquare,
  Star,
  Clock,
  AlertCircle,
  TrendingUp,
  Users,
  Loader2,
} from "lucide-react";

interface DashboardData {
  summary: {
    totalThreads: number;
    totalMessages: number;
    unreadCount: number;
    needsReplyCount: number;
    starredCount: number;
  };
  categoryDistribution: Array<{
    category: string;
    count: number;
  }>;
  trend7Days: Array<{
    date: string;
    count: number;
  }>;
  topSenders: Array<{
    email: string;
    count: number;
  }>;
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    dueAt: string;
    threadSubject: string | null;
    priority: string;
  }>;
  recentImportant: Array<{
    id: string;
    subject: string | null;
    summaryShort: string | null;
    category: string;
    priority: string;
    needsReply: boolean;
    lastMessageAt: string;
    participants: string[];
  }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/dashboard");
        if (response.ok) {
          setData(await response.json());
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Failed to load dashboard
      </div>
    );
  }

  const maxCategoryCount = Math.max(...data.categoryDistribution.map((c) => c.count), 1);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Your email overview at a glance</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Total Threads"
            value={data.summary.totalThreads}
            icon={<Inbox className="w-4 h-4" />}
          />
          <StatCard
            title="Total Messages"
            value={data.summary.totalMessages}
            icon={<Mail className="w-4 h-4" />}
          />
          <StatCard
            title="Unread"
            value={data.summary.unreadCount}
            icon={<MessageSquare className="w-4 h-4" />}
            highlight={data.summary.unreadCount > 0}
          />
          <StatCard
            title="Needs Reply"
            value={data.summary.needsReplyCount}
            icon={<Clock className="w-4 h-4" />}
            highlight={data.summary.needsReplyCount > 0}
          />
          <StatCard
            title="Starred"
            value={data.summary.starredCount}
            icon={<Star className="w-4 h-4" />}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Category Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Categories</CardTitle>
              <CardDescription>Email distribution by category</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.categoryDistribution
                .filter((c) => c.count > 0)
                .sort((a, b) => b.count - a.count)
                .slice(0, 8)
                .map((item) => {
                  const category = getCategoryById(item.category);
                  const percentage = (item.count / maxCategoryCount) * 100;
                  return (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <category.icon className={`w-4 h-4 ${category.color}`} />
                          <span>{category.name}</span>
                        </div>
                        <span className="text-muted-foreground">{item.count}</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  );
                })}
            </CardContent>
          </Card>

          {/* Top Senders */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Senders</CardTitle>
              <CardDescription>Most frequent email senders (30 days)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.topSenders.slice(0, 8).map((sender, index) => (
                  <div
                    key={sender.email}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground w-4">
                        {index + 1}
                      </span>
                      <span className="text-sm truncate max-w-[200px]">
                        {sender.email}
                      </span>
                    </div>
                    <Badge variant="secondary">{sender.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Upcoming Deadlines */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Upcoming Deadlines
              </CardTitle>
              <CardDescription>Tasks extracted from your emails</CardDescription>
            </CardHeader>
            <CardContent>
              {data.upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No upcoming deadlines
                </p>
              ) : (
                <div className="space-y-3">
                  {data.upcomingDeadlines.map((deadline) => (
                    <div key={deadline.id} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500 mt-2" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{deadline.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Due: {formatDate(deadline.dueAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Important */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Important Emails
              </CardTitle>
              <CardDescription>High priority and needs reply</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentImportant.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No important emails
                </p>
              ) : (
                <div className="space-y-3">
                  {data.recentImportant.map((email) => {
                    const category = getCategoryById(email.category);
                    return (
                      <Link
                        key={email.id}
                        href={`/inbox?thread=${email.id}`}
                        className="block p-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {email.subject || "(No subject)"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {email.summaryShort || truncate(email.participants.join(", "), 40)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={email.category as any} className="text-xs">
                              {category.name}
                            </Badge>
                            {email.needsReply && (
                              <Clock className="w-3 h-3 text-amber-500" />
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}

function StatCard({
  title,
  value,
  icon,
  highlight,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium">{title}</span>
        </div>
        <p className={`text-2xl font-bold ${highlight ? "text-primary" : ""}`}>
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
