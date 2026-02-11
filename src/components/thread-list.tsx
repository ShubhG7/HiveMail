"use client";

import { memo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, formatDate, getInitials, truncate } from "@/lib/utils";
import { getCategoryById } from "@/lib/categories";
import { Star, Clock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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

interface ThreadListProps {
  threads: Thread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onRefresh: () => void;
  loading: boolean;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  category?: string | null;
  search?: string | null;
  filter?: string | null;
}

export function ThreadList({
  threads,
  selectedThreadId,
  onSelect,
  loading,
  pagination,
  onPageChange,
  category,
  search,
  filter,
}: ThreadListProps) {
  const getTitle = () => {
    if (search) return `Search: "${search}"`;
    if (filter === "needsReply") return "Needs Reply";
    if (filter === "starred") return "Starred";
    if (category) {
      const cat = getCategoryById(category);
      return cat.name;
    }
    return "Inbox";
  };

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h2 className="font-semibold text-lg truncate min-w-0">{getTitle()}</h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {pagination.total} {pagination.total === 1 ? "thread" : "threads"}
        </p>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1 min-w-0">
        <div className="divide-y min-w-0">
          {threads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedThreadId}
              onClick={() => onSelect(thread.id)}
            />
          ))}
          {threads.length === 0 && !loading && (
            <div className="p-8 text-center text-muted-foreground">
              No emails found
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="p-2 border-t flex items-center justify-between gap-2 min-w-0 overflow-hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground truncate min-w-0 text-center">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="shrink-0"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

const ThreadItem = memo(function ThreadItem({
  thread,
  isSelected,
  onClick,
}: {
  thread: Thread;
  isSelected: boolean;
  onClick: () => void;
}) {
  const category = getCategoryById(thread.category);
  const sender = thread.latestMessage?.fromName || thread.latestMessage?.fromAddress || "Unknown";
  
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 text-left transition-colors hover:bg-muted/50 overflow-hidden min-w-0",
        isSelected && "bg-primary/5 border-l-2 border-l-primary",
        !thread.isRead && "bg-primary/5"
      )}
    >
      <div className="flex gap-3 min-w-0">
        <Avatar className="h-10 w-10 shrink-0 flex-shrink-0">
          <AvatarFallback className={cn(category.bgColor, category.color)}>
            {getInitials(sender)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 overflow-hidden space-y-1">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className={cn(
              "font-medium truncate min-w-0",
              !thread.isRead && "font-semibold"
            )}>
              {sender}
            </span>
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap flex-shrink-0">
              {formatDate(thread.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn(
              "text-sm truncate min-w-0",
              !thread.isRead && "font-medium"
            )}>
              {thread.subject || "(No subject)"}
            </span>
            {thread.messageCount > 1 && (
              <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap flex-shrink-0">
                ({thread.messageCount})
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate min-w-0">
            {thread.summaryShort || thread.latestMessage?.snippet || ""}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={thread.category as any} className="text-xs shrink-0">
              {category.name}
            </Badge>
            {thread.needsReply && (
              <span className="flex items-center text-xs text-amber-600 shrink-0 whitespace-nowrap">
                <Clock className="w-3 h-3 mr-1 shrink-0" />
                Reply needed
              </span>
            )}
            {thread.isStarred && (
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0 flex-shrink-0" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}, (prevProps, nextProps) => {
  // Only re-render if selection state or thread data actually changed
  const prevDate = prevProps.thread.lastMessageAt 
    ? new Date(prevProps.thread.lastMessageAt).getTime() 
    : null;
  const nextDate = nextProps.thread.lastMessageAt 
    ? new Date(nextProps.thread.lastMessageAt).getTime() 
    : null;
  
  return (
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.thread.id === nextProps.thread.id &&
    prevProps.thread.isRead === nextProps.thread.isRead &&
    prevProps.thread.isStarred === nextProps.thread.isStarred &&
    prevProps.thread.needsReply === nextProps.thread.needsReply &&
    prevProps.thread.category === nextProps.thread.category &&
    prevProps.thread.subject === nextProps.thread.subject &&
    prevProps.thread.summaryShort === nextProps.thread.summaryShort &&
    prevDate === nextDate &&
    prevProps.thread.latestMessage?.fromName === nextProps.thread.latestMessage?.fromName &&
    prevProps.thread.latestMessage?.fromAddress === nextProps.thread.latestMessage?.fromAddress &&
    prevProps.thread.latestMessage?.snippet === nextProps.thread.latestMessage?.snippet
  );
});
