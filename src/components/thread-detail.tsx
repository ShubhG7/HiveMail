"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, formatFullDate, getInitials } from "@/lib/utils";
import { getCategoryById } from "@/lib/categories";
import { useToast } from "@/hooks/use-toast";
import { useCompose } from "@/contexts/compose-context";
import {
  Star,
  ExternalLink,
  Reply,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/**
 * Sanitize email HTML to prevent style leakage
 * Removes style tags, inline styles, and other problematic elements
 */
function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  
  // Remove <style> tags and their content
  let sanitized = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Remove inline style attributes
  sanitized = sanitized.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove script tags
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // Remove on* event handlers
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove meta tags that might affect rendering
  sanitized = sanitized.replace(/<meta[^>]*>/gi, '');
  
  return sanitized;
}

interface Message {
  id: string;
  gmailMessageId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  date: string;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  labels: string[];
  category: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  extracted: any;
}

interface ThreadDetailData {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  participants: string[];
  category: string;
  priority: string;
  summary: string | null;
  needsReply: boolean;
  isStarred: boolean;
  messages: Message[];
  tasks: any[];
  gmailLink: string;
}

interface ThreadDetailProps {
  threadId: string;
  onUpdate: (updates: any) => void;
  onClose: () => void;
}

export function ThreadDetail({ threadId, onUpdate, onClose }: ThreadDetailProps) {
  const { toast } = useToast();
  const { openCompose } = useCompose();
  const [thread, setThread] = useState<ThreadDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Reset state immediately when threadId changes
    setThread(null);
    setLoading(true);
    setExpandedMessages(new Set());
    
    let cancelled = false;
    const abortController = new AbortController();
    
    const fetchThread = async () => {
      setLoading(true);
      setThread(null);
      setExpandedMessages(new Set());
      
      try {
        const response = await fetch(`/api/threads/${threadId}`, {
          signal: abortController.signal,
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (cancelled) return;
          
          setThread(data);
          // Expand the last message by default
          if (data.messages.length > 0) {
            setExpandedMessages(new Set([data.messages[data.messages.length - 1].id]));
          }
        }
      } catch (error: any) {
        if (error.name === 'AbortError') return;
        
        console.error("Failed to fetch thread:", error);
        if (!cancelled) {
          toast({
            title: "Error",
            description: "Failed to load email thread",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchThread();
    
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [threadId, toast]);

  const toggleStar = async () => {
    if (!thread) return;
    const newStarred = !thread.isStarred;
    
    try {
      await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStarred: newStarred }),
      });
      setThread({ ...thread, isStarred: newStarred });
      onUpdate({ isStarred: newStarred });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update thread",
        variant: "destructive",
      });
    }
  };

  const handleReply = () => {
    if (!thread) return;
    const lastMessage = thread.messages[thread.messages.length - 1];
    openCompose({
      threadId: thread.id,
      to: lastMessage?.fromAddress || "",
      subject: thread.subject || "",
    });
  };

  const toggleMessageExpand = (messageId: string) => {
    setExpandedMessages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Thread not found
      </div>
    );
  }

  const category = getCategoryById(thread.category);

  return (
    <div className="flex flex-col h-full min-w-0 w-full">
      {/* Header */}
      <div className="p-4 border-b space-y-2 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <h1 className="text-xl font-semibold truncate">
              {thread.subject || "(No subject)"}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant={thread.category as any} className="shrink-0">{category.name}</Badge>
              {thread.needsReply && (
                <Badge variant="outline" className="text-amber-600 border-amber-600 shrink-0">
                  Reply needed
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={toggleStar}>
              <Star
                className={cn(
                  "w-5 h-5",
                  thread.isStarred && "fill-yellow-400 text-yellow-400"
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(thread.gmailLink, "_blank")}
            >
              <ExternalLink className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        {thread.summary && (
          <p className="text-sm text-muted-foreground break-words">
            <span className="font-medium">Summary:</span> {thread.summary}
          </p>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 w-full min-w-0">
        <div className="p-4 space-y-4 min-w-0">
          {thread.messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              isExpanded={expandedMessages.has(message.id)}
              onToggle={() => toggleMessageExpand(message.id)}
              isLast={index === thread.messages.length - 1}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Reply Button */}
      <div className="p-4 border-t">
        <Button onClick={handleReply} className="w-full">
          <Reply className="w-4 h-4 mr-2" />
          Reply
        </Button>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  isExpanded,
  onToggle,
  isLast,
}: {
  message: Message;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const sender = message.fromName || message.fromAddress;

  return (
    <div className={cn("border rounded-lg overflow-hidden min-w-0", isLast && "border-primary/30")}>
      <button
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors overflow-hidden min-w-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="shrink-0">
            <AvatarFallback>{getInitials(sender)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="font-medium truncate min-w-0">{sender}</span>
              <span className="text-sm text-muted-foreground shrink-0 whitespace-nowrap">
                {formatFullDate(message.date)}
              </span>
            </div>
            {!isExpanded && (
              <p className="text-sm text-muted-foreground truncate min-w-0">
                {message.snippet}
              </p>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 flex-shrink-0" />
          )}
        </div>
      </button>

      {isExpanded && (
        <>
          <Separator />
          <div className="p-4 overflow-hidden min-w-0">
            <div className="text-sm text-muted-foreground mb-4 space-y-1 break-words">
              <p className="break-words">
                <span className="font-medium">From:</span> <span className="break-all">{message.fromAddress}</span>
              </p>
              <p className="break-words">
                <span className="font-medium">To:</span>{" "}
                <span className="break-all">{message.toAddresses.join(", ")}</span>
              </p>
              {message.ccAddresses.length > 0 && (
                <p className="break-words">
                  <span className="font-medium">Cc:</span>{" "}
                  <span className="break-all">{message.ccAddresses.join(", ")}</span>
                </p>
              )}
            </div>
            {message.bodyHtml ? (
              <div className="email-body-wrapper" style={{ isolation: 'isolate', contain: 'layout style paint' }}>
                <div
                  className="email-body prose prose-sm max-w-none dark:prose-invert overflow-x-auto break-words min-w-0 [&_*]:max-w-full [&_*]:box-border [&_img]:max-w-full [&_table]:max-w-full [&_table]:w-full [&_table]:table-auto [&_pre]:overflow-x-auto [&_pre]:break-words [&_td]:max-w-0 [&_th]:max-w-0"
                  style={{ 
                    contain: 'layout style paint', 
                    maxWidth: '100%', 
                    overflowX: 'auto',
                    isolation: 'isolate',
                    position: 'relative',
                    zIndex: 0
                  }}
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.bodyHtml) }}
                />
              </div>
            ) : (
              <div className="email-body whitespace-pre-wrap break-words overflow-hidden min-w-0" style={{ maxWidth: '100%' }}>
                {message.bodyText || message.snippet || "No content"}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
