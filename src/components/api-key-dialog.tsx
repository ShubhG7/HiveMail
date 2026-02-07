"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Key, Loader2, Sparkles, ExternalLink } from "lucide-react";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  title?: string;
  description?: string;
}

const LLM_PROVIDERS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Google" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Google" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", group: "Google" },
  { value: "openai-gpt-4", label: "OpenAI GPT-4", group: "OpenAI" },
  { value: "openai-gpt-4-turbo", label: "OpenAI GPT-4 Turbo", group: "OpenAI" },
  { value: "openai-gpt-3.5-turbo", label: "OpenAI GPT-3.5 Turbo", group: "OpenAI" },
  { value: "anthropic-claude-3-5-sonnet", label: "Claude 3.5 Sonnet", group: "Anthropic" },
  { value: "anthropic-claude-3-opus", label: "Claude 3 Opus", group: "Anthropic" },
  { value: "anthropic-claude-3-haiku", label: "Claude 3 Haiku", group: "Anthropic" },
  { value: "custom", label: "Custom (OpenAI-compatible)", group: "Other" },
];

export function ApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
  title = "API Key Required",
  description = "To use AI features, please add your LLM API key. Your key is encrypted and stored securely.",
}: ApiKeyDialogProps) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("gemini-2.5-flash");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);

  // Load existing settings when dialog opens
  useEffect(() => {
    if (open) {
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.llmProvider) {
            setProvider(data.llmProvider);
          }
          if (data.llmBaseUrl) {
            setBaseUrl(data.llmBaseUrl);
          }
          if (data.llmModel) {
            setModel(data.llmModel);
          }
          // Don't pre-fill API key for security
          setApiKey("");
        })
        .catch(() => {
          // Ignore errors
        });
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!apiKey.trim()) {
      toast({
        title: "API key required",
        description: "Please enter your API key",
        variant: "destructive",
      });
      return;
    }

    if (provider === "custom" && (!baseUrl.trim() || !model.trim())) {
      toast({
        title: "Configuration required",
        description: "Custom provider requires Base URL and Model name",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmApiKey: apiKey,
          llmProvider: provider,
          ...(provider === "custom" && {
            baseUrl: baseUrl.trim(),
            model: model.trim(),
          }),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save API key");
      }

      toast({
        title: "API key saved",
        description: "Your API key has been saved securely.",
      });

      setApiKey("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save API key. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="provider">LLM Provider</Label>
            <Select value={provider} onValueChange={(value) => { setProvider(value); setBaseUrl(""); setModel(""); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Google", "OpenAI", "Anthropic", "Other"].map((group) => (
                  <div key={group}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {group}
                    </div>
                    {LLM_PROVIDERS.filter((p) => p.group === group).map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider === "custom" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  OpenAI-compatible API endpoint
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model Name</Label>
                <Input
                  id="model"
                  type="text"
                  placeholder="gpt-4"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder={provider.startsWith("gemini") ? "AIza..." : provider.startsWith("openai") ? "sk-..." : provider.startsWith("anthropic") ? "sk-ant-..." : "Enter API key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSubmit();
                }
              }}
            />
          </div>

          {provider.startsWith("gemini") && (
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Sparkles className="w-4 h-4" />
              Get your free API key from Google AI Studio
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {provider.startsWith("openai") && (
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Sparkles className="w-4 h-4" />
              Get your API key from OpenAI
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {provider.startsWith("anthropic") && (
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Sparkles className="w-4 h-4" />
              Get your API key from Anthropic
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !apiKey.trim()}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save API Key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
