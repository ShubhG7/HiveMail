"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useApiKey } from "@/hooks/use-api-key";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { RichTextEditor } from "@/components/rich-text-editor";
import { cn } from "@/lib/utils";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Send,
  Trash2,
  Sparkles,
  Loader2,
  Paperclip,
  ChevronDown,
  Key,
} from "lucide-react";

interface ComposeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  replyTo?: {
    threadId: string;
    to: string;
    subject: string;
    inReplyTo?: string;
  };
}

type ComposeState = "normal" | "minimized" | "maximized";

export function ComposeOverlay({ isOpen, onClose, replyTo }: ComposeOverlayProps) {
  const { toast } = useToast();
  const { hasApiKey, showDialog, setShowDialog, checkApiKey } = useApiKey();
  
  const [state, setState] = useState<ComposeState>("normal");
  const [to, setTo] = useState(replyTo?.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(replyTo?.subject ? `Re: ${replyTo.subject}` : "");
  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replyTo) {
      setTo(replyTo.to);
      setSubject(replyTo.subject ? `Re: ${replyTo.subject}` : "");
    }
  }, [replyTo]);

  // Note: RichTextEditor handles its own focus, so we don't need to manually focus it

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files]);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast({
        title: "Error",
        description: "Please enter a recipient",
        variant: "destructive",
      });
      return;
    }

    if (!body.trim() && !bodyHtml.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const endpoint = replyTo?.threadId 
        ? `/api/threads/${replyTo.threadId}/reply`
        : "/api/send";
      
      // Convert attachments to base64
      const attachmentData = await Promise.all(
        attachments.map(async (file) => {
          const buffer = await file.arrayBuffer();
          return {
            filename: file.name,
            content: Buffer.from(buffer).toString("base64"),
            contentType: file.type || "application/octet-stream",
          };
        })
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          to: to.split(",").map(e => e.trim()),
          cc: cc ? cc.split(",").map(e => e.trim()) : undefined,
          bcc: bcc ? bcc.split(",").map(e => e.trim()) : undefined,
          subject,
          content: body,
          contentHtml: bodyHtml || undefined,
          attachments: attachmentData.length > 0 ? attachmentData : undefined,
        }),
      });

      if (response.ok) {
        toast({
          title: "Sent!",
          description: "Your message has been sent.",
        });
        handleClose();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to send message",
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
      setSending(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!hasApiKey) {
      setShowDialog(true);
      return;
    }

    if (!replyTo?.threadId) {
      toast({
        title: "Info",
        description: "AI drafts are available when replying to emails",
      });
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch(`/api/threads/${replyTo.threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft" }),
      });

      if (response.ok) {
        const data = await response.json();
        setBody(data.draft);
        toast({
          title: "Draft generated",
          description: "AI draft has been added. Feel free to edit it.",
        });
      } else {
        const data = await response.json();
        if (data.error?.includes("API key")) {
          setShowDialog(true);
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to generate draft",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate draft",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleClose = () => {
    setTo("");
    setCc("");
    setBcc("");
    setSubject("");
    setBody("");
    setBodyHtml("");
    setAttachments([]);
    setShowCcBcc(false);
    setState("normal");
    onClose();
  };

  const handleDiscard = () => {
    if (body.trim() || subject.trim()) {
      if (confirm("Discard this draft?")) {
        handleClose();
      }
    } else {
      handleClose();
    }
  };

  if (!isOpen) return null;

  // Minimized state - just show title bar at bottom
  if (state === "minimized") {
    return (
      <div className="fixed bottom-0 right-6 z-50">
        <div 
          className="w-72 bg-card border rounded-t-lg shadow-lg cursor-pointer"
          onClick={() => setState("normal")}
        >
          <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-t-lg">
            <span className="font-medium text-sm truncate">
              {subject || "New Message"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setState("normal");
                }}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDiscard();
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal or Maximized state
  const isMaximized = state === "maximized";

  return (
    <>
      <ApiKeyDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onSuccess={checkApiKey}
        title="API Key Required"
        description="To use AI draft generation, please add your LLM API key."
      />
      
      <div 
        className={cn(
          "fixed z-50 bg-card border shadow-2xl flex flex-col",
          isMaximized 
            ? "inset-4 rounded-lg" 
            : "bottom-0 right-6 w-[560px] h-[480px] rounded-t-lg"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-t-lg border-b">
          <span className="font-medium text-sm">
            {replyTo ? "Reply" : "New Message"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setState("minimized")}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setState(isMaximized ? "normal" : "maximized")}
            >
              {isMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDiscard}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* To field */}
          <div className="flex items-center border-b px-4 py-2">
            <span className="text-sm text-muted-foreground w-12">To</span>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Recipients"
              className="border-0 shadow-none focus-visible:ring-0 px-2 h-8"
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setShowCcBcc(!showCcBcc)}
            >
              Cc/Bcc
              <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", showCcBcc && "rotate-180")} />
            </Button>
          </div>

          {/* Cc/Bcc fields */}
          {showCcBcc && (
            <>
              <div className="flex items-center border-b px-4 py-2">
                <span className="text-sm text-muted-foreground w-12">Cc</span>
                <Input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Cc recipients"
                  className="border-0 shadow-none focus-visible:ring-0 px-2 h-8"
                />
              </div>
              <div className="flex items-center border-b px-4 py-2">
                <span className="text-sm text-muted-foreground w-12">Bcc</span>
                <Input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="Bcc recipients"
                  className="border-0 shadow-none focus-visible:ring-0 px-2 h-8"
                />
              </div>
            </>
          )}

          {/* Subject field */}
          <div className="flex items-center border-b px-4 py-2">
            <span className="text-sm text-muted-foreground w-12">Subject</span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="border-0 shadow-none focus-visible:ring-0 px-2 h-8"
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <RichTextEditor
              content={bodyHtml || body}
              onChange={(html) => {
                setBodyHtml(html);
                // Extract plain text from HTML for fallback
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = html;
                setBody(tempDiv.textContent || tempDiv.innerText || "");
              }}
              placeholder="Compose your message..."
              className="flex-1 border-0 rounded-none"
            />
            
            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="p-2 border-t bg-muted/30">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 px-2 py-1 bg-background border rounded text-sm"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="truncate max-w-[200px]">{file.name}</span>
                      <span className="text-muted-foreground text-xs">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4"
                        onClick={() => handleRemoveAttachment(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
            <div className="flex items-center gap-2">
              <Button onClick={handleSend} disabled={sending}>
                {sending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send
              </Button>
              
              {replyTo && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateDraft}
                  disabled={generating || !hasApiKey}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : !hasApiKey ? (
                    <Key className="h-4 w-4 mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {!hasApiKey ? "Add API Key" : "AI Draft"}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={handleDiscard}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
