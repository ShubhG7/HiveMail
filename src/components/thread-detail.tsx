"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatFullDate, getInitials } from "@/lib/utils";
import { getCategoryById } from "@/lib/categories";
import { useToast } from "@/hooks/use-toast";
import {
  Star,
  ExternalLink,
  Reply,
  Loader2,
  X,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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
  const [thread, setThread] = useState<ThreadDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);

  useEffect(() => {
    const fetchThread = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/threads/${threadId}`);
        if (response.ok) {
          const data = await response.json();
          setThread(data);
          // Expand the last message by default
          if (data.messages.length > 0) {
            setExpandedMessages(new Set([data.messages[data.messages.length - 1].id]));
          }
        }
      } catch (error) {
        console.error("Failed to fetch thread:", error);
        toast({
          title: "Error",
          description: "Failed to load email thread",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchThread();
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

  const generateDraft = async () => {
    setDraftLoading(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft" }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setReplyContent(data.draft);
        if (data.warnings?.length) {
          toast({
            title: "Warning",
            description: data.warnings[0],
            variant: "destructive",
          });
        }
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.error || "Failed to generate draft",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate draft",
        variant: "destructive",
      });
    } finally {
      setDraftLoading(false);
    }
  };

  const sendReply = async () => {
    if (!replyContent.trim()) return;
    
    setSendLoading(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          content: replyContent,
        }),
      });
      
      if (response.ok) {
        toast({
          title: "Reply sent",
          description: "Your reply has been sent successfully.",
        });
        setReplyOpen(false);
        setReplyContent("");
      } else {
        const data = await response.json();
        if (data.requireConfirmation) {
          // Handle sensitive content confirmation
          if (confirm("This reply may contain sensitive information. Send anyway?")) {
            await fetch(`/api/threads/${threadId}/reply`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "send",
                content: replyContent,
                confirmSensitive: true,
              }),
            });
            toast({
              title: "Reply sent",
              description: "Your reply has been sent successfully.",
            });
            setReplyOpen(false);
            setReplyContent("");
          }
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to send reply",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send reply",
        variant: "destructive",
      });
    } finally {
      setSendLoading(false);
    }
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">
              {thread.subject || "(No subject)"}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={thread.category as any}>{category.name}</Badge>
              {thread.needsReply && (
                <Badge variant="outline" className="text-amber-600 border-amber-600">
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
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Summary:</span> {thread.summary}
          </p>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
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
        <Button onClick={() => setReplyOpen(true)} className="w-full">
          <Reply className="w-4 h-4 mr-2" />
          Reply
        </Button>
      </div>

      {/* Reply Dialog */}
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reply to thread</DialogTitle>
            <DialogDescription>
              Compose your reply or use AI to generate a draft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Write your reply..."
              rows={10}
              className="resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={generateDraft}
              disabled={draftLoading}
            >
              {draftLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Generate Draft
            </Button>
            <Button onClick={sendReply} disabled={sendLoading || !replyContent.trim()}>
              {sendLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                "Send Reply"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className={cn("border rounded-lg", isLast && "border-primary/30")}>
      <button
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{getInitials(sender)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-medium truncate">{sender}</span>
              <span className="text-sm text-muted-foreground shrink-0">
                {formatFullDate(message.date)}
              </span>
            </div>
            {!isExpanded && (
              <p className="text-sm text-muted-foreground truncate">
                {message.snippet}
              </p>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
          )}
        </div>
      </button>

      {isExpanded && (
        <>
          <Separator />
          <div className="p-4">
            <div className="text-sm text-muted-foreground mb-4 space-y-1">
              <p>
                <span className="font-medium">From:</span> {message.fromAddress}
              </p>
              <p>
                <span className="font-medium">To:</span>{" "}
                {message.toAddresses.join(", ")}
              </p>
              {message.ccAddresses.length > 0 && (
                <p>
                  <span className="font-medium">Cc:</span>{" "}
                  {message.ccAddresses.join(", ")}
                </p>
              )}
            </div>
            <div className="email-body whitespace-pre-wrap">
              {message.bodyText || message.snippet || "No content"}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
