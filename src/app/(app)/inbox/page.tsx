"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ThreadList } from "@/components/thread-list";
import { ThreadDetail } from "@/components/thread-detail";
import { EmptyState } from "@/components/empty-state";
import { Loader2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

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

const MIN_LIST_WIDTH = 240;
const MAX_LIST_WIDTH = 600;
const DEFAULT_LIST_WIDTH = 384;

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
  
  // Resizable panel state
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectingRef = useRef<string | null>(null);

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

  const handleThreadSelect = useCallback((threadId: string) => {
    // Only update if different thread and not already selecting this one
    if (selectedThreadId === threadId || selectingRef.current === threadId) return;
    
    selectingRef.current = threadId;
    setSelectedThreadId(threadId);
    
    // Mark as read optimistically
    setThreads((prev) => {
      const thread = prev.find((t) => t.id === threadId);
      if (thread?.isRead) {
        selectingRef.current = null;
        return prev;
      }
      const updated = prev.map((t) => (t.id === threadId ? { ...t, isRead: true } : t));
      selectingRef.current = null;
      return updated;
    });
  }, [selectedThreadId]);

  const handleThreadUpdate = (threadId: string, updates: Partial<Thread>) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, ...updates } : t))
    );
  };

  // Memoize selected thread to prevent unnecessary re-renders
  const selectedThread = useMemo(() => {
    return threads.find((t) => t.id === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      
      // Clamp to min/max
      const clampedWidth = Math.min(Math.max(newWidth, MIN_LIST_WIDTH), MAX_LIST_WIDTH);
      setListWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  if (loading && threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0" ref={containerRef}>
      {/* Thread List */}
      <div 
        className="flex flex-col shrink-0 min-w-0 overflow-hidden pr-2"
        style={{ width: listWidth, minWidth: MIN_LIST_WIDTH, maxWidth: '100%' }}
      >
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

      {/* Resizable Divider */}
      <div
        className={cn(
          "w-1 bg-border hover:bg-primary/50 cursor-col-resize flex items-center justify-center group transition-colors",
          isResizing && "bg-primary/50"
        )}
        onMouseDown={handleMouseDown}
      >
        <div className={cn(
          "w-4 h-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity",
          isResizing && "opacity-100"
        )}>
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>

      {/* Thread Detail */}
      <div className="flex-1 overflow-hidden min-w-0" style={{ minWidth: '300px' }}>
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
