"use client";

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">{getTitle()}</h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground">
          {pagination.total} {pagination.total === 1 ? "thread" : "threads"}
        </p>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="divide-y">
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
        <div className="p-2 border-t flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ThreadItem({
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
        "w-full p-4 text-left transition-colors hover:bg-muted/50",
        isSelected && "bg-primary/5 border-l-2 border-l-primary",
        !thread.isRead && "bg-primary/5"
      )}
    >
      <div className="flex gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className={cn(category.bgColor, category.color)}>
            {getInitials(sender)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              "font-medium truncate",
              !thread.isRead && "font-semibold"
            )}>
              {sender}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDate(thread.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm truncate",
              !thread.isRead && "font-medium"
            )}>
              {thread.subject || "(No subject)"}
            </span>
            {thread.messageCount > 1 && (
              <span className="text-xs text-muted-foreground shrink-0">
                ({thread.messageCount})
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {thread.summaryShort || thread.latestMessage?.snippet || ""}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={thread.category as any} className="text-xs">
              {category.name}
            </Badge>
            {thread.needsReply && (
              <span className="flex items-center text-xs text-amber-600">
                <Clock className="w-3 h-3 mr-1" />
                Reply needed
              </span>
            )}
            {thread.isStarred && (
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
