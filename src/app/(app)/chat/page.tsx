"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { useApiKey } from "@/hooks/use-api-key";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  Bot,
  User,
  ExternalLink,
  MessageSquare,
  Sparkles,
  Key,
  Copy,
  Check,
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
  const { hasApiKey, loading: apiKeyLoading, showDialog, setShowDialog, checkApiKey } = useApiKey();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load conversation history on mount if sessionId exists
  useEffect(() => {
    const loadHistory = async () => {
      if (!hasApiKey) {
        setLoadingHistory(false);
        return;
      }

      // Try to get the most recent session
      try {
        const response = await fetch("/api/chat");
        if (response.ok) {
          const data = await response.json();
          if (data.sessions && data.sessions.length > 0) {
            const latestSession = data.sessions[0];
            setSessionId(latestSession.id);
            
            // Load messages for the latest session
            const sessionResponse = await fetch(`/api/chat?sessionId=${latestSession.id}`);
            if (sessionResponse.ok) {
              const sessionData = await sessionResponse.json();
              if (sessionData.messages) {
                const loadedMessages: ChatMessage[] = sessionData.messages.map((m: any) => ({
                  id: m.id,
                  role: m.role.toLowerCase() as "user" | "assistant",
                  content: m.content,
                  citations: m.citations || [],
                  suggestedActions: m.suggestedActions || [],
                  timestamp: new Date(m.createdAt),
                }));
                setMessages(loadedMessages);
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadHistory();
  }, [hasApiKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    // Check for API key before sending
    if (!hasApiKey) {
      setShowDialog(true);
      return;
    }

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
        
        // Check if it's an API key error
        if (error.error?.includes("API key")) {
          setShowDialog(true);
        } else {
          toast({
            title: "Error",
            description: error.error || "Failed to get response",
            variant: "destructive",
          });
        }
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
    if (!hasApiKey) {
      setShowDialog(true);
      return;
    }
    setInput(suggestion);
  };

  const handleApiKeySuccess = async () => {
    const updated = await checkApiKey();
    if (updated) {
      setShowDialog(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* API Key Dialog */}
      <ApiKeyDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onSuccess={handleApiKeySuccess}
        title="API Key Required"
        description="To use the AI chat feature, please add your Gemini API key. Your key is encrypted and stored securely."
      />

      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
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
          {!apiKeyLoading && !hasApiKey && (
            <Button variant="outline" size="sm" onClick={() => setShowDialog(true)}>
              <Key className="w-4 h-4 mr-2" />
              Add API Key
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <WelcomeState onSuggestion={handleSuggestion} hasApiKey={hasApiKey} onAddKey={() => setShowDialog(true)} />
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
            placeholder={hasApiKey ? "Ask about your emails..." : "Add API key to start chatting..."}
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

function WelcomeState({ 
  onSuggestion, 
  hasApiKey,
  onAddKey 
}: { 
  onSuggestion: (s: string) => void;
  hasApiKey: boolean;
  onAddKey: () => void;
}) {
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

      {!hasApiKey ? (
        <div className="text-center space-y-4">
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <Key className="w-4 h-4 inline mr-2" />
              Add your Gemini API key to start using AI features
            </p>
          </div>
          <Button onClick={onAddKey}>
            <Key className="w-4 h-4 mr-2" />
            Add API Key
          </Button>
        </div>
      ) : (
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
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <Avatar className="w-8 h-8 shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-muted"}>
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
        <div className="relative group">
          <Card className={cn("inline-block max-w-[80%]", isUser && "bg-primary text-primary-foreground")}>
            <CardContent className="p-3">
              {isUser ? (
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="text-sm prose prose-sm max-w-none dark:prose-invert prose-headings:my-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
            </CardContent>
          </Card>
          {!isUser && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          )}
        </div>

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
