"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  Bot,
  User,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    threadId?: string;
    messageId?: string;
    snippet: string;
  }>;
  suggestedActions?: Array<{
    type: string;
    label: string;
    params: Record<string, string>;
  }>;
  timestamp: Date;
}

export default function ChatPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          sessionId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.sessionId);

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.answer,
          citations: data.citations,
          suggestedActions: data.suggestedActions,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.error || "Failed to get response",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold">AI Email Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your emails
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {messages.length === 0 ? (
            <WelcomeState onSuggestion={handleSuggestion} />
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your emails..."
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function WelcomeState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  const suggestions = [
    "What emails need my reply?",
    "Show me emails from last week",
    "Find emails about invoices",
    "What are my upcoming deadlines?",
    "Summarize my unread emails",
  ];

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <MessageSquare className="w-8 h-8 text-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">How can I help?</h2>
        <p className="text-muted-foreground max-w-md">
          Ask me anything about your emails. I can search, summarize, and help you
          find important information.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            size="sm"
            onClick={() => onSuggestion(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <Avatar className="w-8 h-8 shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-muted"}>
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
        <Card className={cn("inline-block max-w-[80%]", isUser && "bg-primary text-primary-foreground")}>
          <CardContent className="p-3">
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </CardContent>
        </Card>

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.citations.map((citation, index) => (
              <Link
                key={index}
                href={`/inbox?thread=${citation.threadId}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs hover:bg-muted/80 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                {citation.snippet.slice(0, 30)}...
              </Link>
            ))}
          </div>
        )}

        {/* Suggested Actions */}
        {message.suggestedActions && message.suggestedActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.suggestedActions.map((action, index) => (
              <Link
                key={index}
                href={
                  action.type === "open_thread"
                    ? `/inbox?thread=${action.params.threadId}`
                    : action.type === "filter_search"
                    ? `/inbox?search=${encodeURIComponent(action.params.query || "")}`
                    : "#"
                }
              >
                <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                  {action.label}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
