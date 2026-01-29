"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, Shield, RefreshCw, Check, ExternalLink, Sparkles, Trash2 } from "lucide-react";

interface Settings {
  llmProvider: string;
  redactionMode: string;
  includeLabels: string[];
  excludeLabels: string[];
  backfillDays: number;
  timezone: string;
  aiReplyEnabled: boolean;
  onboardingComplete: boolean;
  hasApiKey: boolean;
}

const LLM_PROVIDERS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Best price/performance (Recommended)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Higher quality responses" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Budget option" },
];

const REDACTION_MODES = [
  { value: "OFF", label: "Off", description: "No redaction applied" },
  { value: "REDACT_BEFORE_LLM", label: "Redact before LLM", description: "Sensitive data redacted before AI processing" },
  { value: "SUMMARIES_ONLY", label: "Summaries only", description: "Only send metadata, never email bodies" },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settingsRes, syncRes] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/sync"),
        ]);
        
        if (settingsRes.ok) {
          setSettings(await settingsRes.json());
        }
        if (syncRes.ok) {
          setSyncStatus(await syncRes.json());
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const saveSettings = async (updates: Partial<Settings & { llmApiKey?: string }>) => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        toast({
          title: "Settings saved",
          description: "Your settings have been updated.",
        });
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApiKeySubmit = async () => {
    if (!apiKey.trim()) return;
    await saveSettings({ llmApiKey: apiKey });
    setApiKey("");
    setShowApiKeyInput(false);
  };

  const handleRemoveApiKey = async () => {
    try {
      const response = await fetch("/api/settings", {
        method: "DELETE",
      });
      if (response.ok) {
        setSettings((s) => (s ? { ...s, hasApiKey: false } : null));
        toast({
          title: "API key removed",
          description: "Your LLM API key has been deleted.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove API key",
        variant: "destructive",
      });
    }
  };

  const triggerSync = async (type: "incremental" | "backfill") => {
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      
      if (response.ok) {
        toast({
          title: "Sync started",
          description: `${type === "backfill" ? "Full" : "Incremental"} sync has been started.`,
        });
        // Refresh sync status
        const syncRes = await fetch("/api/sync");
        if (syncRes.ok) {
          setSyncStatus(await syncRes.json());
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start sync",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Failed to load settings
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* API Key Section - Prominent */}
      <Card className={!settings.hasApiKey ? "border-amber-300 dark:border-amber-700" : ""}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>LLM API Key</CardTitle>
                <CardDescription>
                  Required for AI features (categorization, summaries, chat)
                </CardDescription>
              </div>
            </div>
            {settings.hasApiKey && (
              <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <Check className="w-3 h-3 mr-1" />
                Configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!settings.hasApiKey && !showApiKeyInput && (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                <Sparkles className="w-4 h-4 inline mr-2" />
                Add your Gemini API key to enable AI-powered email categorization, summaries, and chat.
              </p>
              <Button onClick={() => setShowApiKeyInput(true)}>
                <Key className="w-4 h-4 mr-2" />
                Add API Key
              </Button>
            </div>
          )}

          {(showApiKeyInput || settings.hasApiKey) && (
            <>
              <div className="space-y-2">
                <Label>LLM Provider</Label>
                <Select
                  value={settings.llmProvider}
                  onValueChange={(value) => saveSettings({ llmProvider: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        <div className="flex flex-col">
                          <span>{provider.label}</span>
                          <span className="text-xs text-muted-foreground">{provider.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                {settings.hasApiKey && !showApiKeyInput ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-muted rounded-md border">
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-sm">API key configured securely</span>
                      <span className="text-xs text-muted-foreground">(encrypted)</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowApiKeyInput(true)}>
                      Update
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove API Key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will disable all AI features until you add a new key.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRemoveApiKey} className="bg-destructive text-destructive-foreground">
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Enter your Gemini API key (AIza...)"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApiKeySubmit();
                        }}
                      />
                      <Button onClick={handleApiKeySubmit} disabled={!apiKey.trim() || saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                      </Button>
                      {showApiKeyInput && settings.hasApiKey && (
                        <Button variant="outline" onClick={() => { setShowApiKeyInput(false); setApiKey(""); }}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

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
            </>
          )}
        </CardContent>
      </Card>

      {/* Privacy & Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Privacy & Security
          </CardTitle>
          <CardDescription>
            Control how your email data is processed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Redaction Mode</Label>
            <Select
              value={settings.redactionMode}
              onValueChange={(value) => saveSettings({ redactionMode: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REDACTION_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    <div className="flex flex-col">
                      <span>{mode.label}</span>
                      <span className="text-xs text-muted-foreground">{mode.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls how sensitive data (SSN, credit cards, etc.) is handled before AI processing
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>AI Reply Drafts</Label>
              <p className="text-sm text-muted-foreground">
                Allow AI to generate reply drafts (you always review before sending)
              </p>
            </div>
            <Switch
              checked={settings.aiReplyEnabled}
              onCheckedChange={(checked) => saveSettings({ aiReplyEnabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sync Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Email Sync
          </CardTitle>
          <CardDescription>
            Manage email synchronization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {syncStatus && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                <Badge variant={syncStatus.isRunning ? "default" : "secondary"}>
                  {syncStatus.isRunning ? "Syncing..." : "Idle"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Last Sync</span>
                <span className="text-sm text-muted-foreground">
                  {syncStatus.lastSync
                    ? new Date(syncStatus.lastSync).toLocaleString()
                    : "Never"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Threads</span>
                <span className="text-sm">{syncStatus.stats?.threads?.toLocaleString() || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Messages</span>
                <span className="text-sm">{syncStatus.stats?.messages?.toLocaleString() || 0}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => triggerSync("incremental")}
              disabled={syncStatus?.isRunning}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncStatus?.isRunning ? 'animate-spin' : ''}`} />
              Refresh Now
            </Button>
            <Button
              variant="outline"
              onClick={() => triggerSync("backfill")}
              disabled={syncStatus?.isRunning}
            >
              Full Re-sync
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Backfill Period</Label>
            <Select
              value={settings.backfillDays.toString()}
              onValueChange={(value) => saveSettings({ backfillDays: parseInt(value) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How far back to sync emails on full re-sync
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
