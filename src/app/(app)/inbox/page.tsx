"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ThreadList } from "@/components/thread-list";
import { ThreadDetail } from "@/components/thread-detail";
import { EmptyState } from "@/components/empty-state";
import { Loader2 } from "lucide-react";

interface Thread {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  participants: string[];
  lastMessageAt: string | null;
  category: string;
  priority: string;
  summaryShort: string | null;
  needsReply: boolean;
  isRead: boolean;
  isStarred: boolean;
  messageCount: number;
  latestMessage: {
    id: string;
    snippet: string | null;
    fromAddress: string;
    fromName: string | null;
    date: string;
    isRead: boolean;
  } | null;
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const filter = searchParams.get("filter");

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      if (filter === "needsReply") params.set("needsReply", "true");
      if (filter === "starred") params.set("isStarred", "true");
      params.set("page", pagination.page.toString());
      params.set("limit", pagination.limit.toString());

      const response = await fetch(`/api/threads?${params}`);
      if (response.ok) {
        const data = await response.json();
        setThreads(data.threads);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Failed to fetch threads:", error);
    } finally {
      setLoading(false);
    }
  }, [category, search, filter, pagination.page, pagination.limit]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const handleThreadSelect = (threadId: string) => {
    setSelectedThreadId(threadId);
    // Mark as read optimistically
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, isRead: true } : t))
    );
  };

  const handleThreadUpdate = (threadId: string, updates: Partial<Thread>) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, ...updates } : t))
    );
  };

  const selectedThread = threads.find((t) => t.id === selectedThreadId);

  if (loading && threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Thread List */}
      <div className="w-96 border-r flex flex-col">
        <ThreadList
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelect={handleThreadSelect}
          onRefresh={fetchThreads}
          loading={loading}
          pagination={pagination}
          onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
          category={category}
          search={search}
          filter={filter}
        />
      </div>

      {/* Thread Detail */}
      <div className="flex-1 overflow-hidden">
        {selectedThread ? (
          <ThreadDetail
            threadId={selectedThread.id}
            onUpdate={(updates) => handleThreadUpdate(selectedThread.id, updates)}
            onClose={() => setSelectedThreadId(null)}
          />
        ) : (
          <EmptyState
            title="Select an email"
            description="Choose an email from the list to read it"
          />
        )}
      </div>
    </div>
  );
}
