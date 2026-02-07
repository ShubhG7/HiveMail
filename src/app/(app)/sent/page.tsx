"use client";

import { useState, useEffect, useCallback } from "react";
import { ThreadList } from "@/components/thread-list";
import { ThreadDetail } from "@/components/thread-detail";
import { EmptyState } from "@/components/empty-state";
import { Send } from "lucide-react";

interface Thread {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  summaryShort: string | null;
  category: string;
  isRead: boolean;
  isStarred: boolean;
  needsReply: boolean;
  lastMessageAt: string | null;
  latestMessage: {
    id: string;
    snippet: string | null;
    fromAddress: string;
    fromName: string | null;
    date: string;
    isRead: boolean;
  } | null;
}

export default function SentPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  const fetchSentThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("sent", "true");
      params.set("page", pagination.page.toString());
      params.set("limit", pagination.limit.toString());

      const response = await fetch(`/api/threads?${params}`);
      if (response.ok) {
        const data = await response.json();
        setThreads(data.threads);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Failed to fetch sent threads:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit]);

  useEffect(() => {
    fetchSentThreads();
  }, [fetchSentThreads]);

  const handleThreadSelect = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    setThreads((prev) => {
      const thread = prev.find((t) => t.id === threadId);
      if (thread?.isRead) return prev;
      return prev.map((t) => (t.id === threadId ? { ...t, isRead: true } : t));
    });
  }, []);

  const handleThreadUpdate = (threadId: string, updates: Partial<Thread>) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, ...updates } : t))
    );
  };

  if (!loading && threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <EmptyState
          title="No sent emails"
          description="Emails you've sent will appear here."
          icon={<Send className="w-8 h-8 text-muted-foreground" />}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      {/* Thread List */}
      <div className="w-96 border-r flex-shrink-0 min-w-0 overflow-hidden pr-2">
        <ThreadList
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelect={handleThreadSelect}
          loading={loading}
          pagination={pagination}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
        />
      </div>

      {/* Thread Detail */}
      <div className="flex-1 min-w-0">
        {selectedThreadId ? (
          <ThreadDetail
            threadId={selectedThreadId}
            onUpdate={(updates) => handleThreadUpdate(selectedThreadId, updates)}
            onClose={() => setSelectedThreadId(null)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Send className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Select a sent email</p>
              <p className="text-sm">Choose an email to view its contents</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
