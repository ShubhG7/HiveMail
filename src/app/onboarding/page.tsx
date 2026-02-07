"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Key, Settings2, ArrowRight } from "lucide-react";

const BACKFILL_OPTIONS = [
  { value: "7", label: "Last 7 days", description: "Quick start" },
  { value: "30", label: "Last 30 days", description: "Recommended" },
  { value: "90", label: "Last 90 days", description: "More history" },
  { value: "365", label: "Last year", description: "Full archive" },
];

const EXCLUDE_LABELS = [
  { id: "SPAM", label: "Spam" },
  { id: "TRASH", label: "Trash" },
  { id: "CATEGORY_PROMOTIONS", label: "Promotions" },
  { id: "CATEGORY_SOCIAL", label: "Social" },
];

const LLM_PROVIDERS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", placeholder: "AIza...", link: "https://aistudio.google.com/app/apikey", linkText: "Google AI Studio" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", placeholder: "AIza...", link: "https://aistudio.google.com/app/apikey", linkText: "Google AI Studio" },
  { value: "openai-gpt-4o", label: "OpenAI GPT-4o", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", linkText: "OpenAI Platform" },
  { value: "openai-gpt-4", label: "OpenAI GPT-4", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", linkText: "OpenAI Platform" },
  { value: "openai-gpt-4-turbo", label: "OpenAI GPT-4 Turbo", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", linkText: "OpenAI Platform" },
  { value: "openai-gpt-5.2", label: "OpenAI GPT-5.2", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", linkText: "OpenAI Platform" },
  { value: "openai-gpt-3.5-turbo", label: "OpenAI GPT-3.5 Turbo", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", linkText: "OpenAI Platform" },
  { value: "anthropic-claude-3-5-sonnet", label: "Claude 3.5 Sonnet", placeholder: "sk-ant-...", link: "https://console.anthropic.com/", linkText: "Anthropic Console" },
  { value: "anthropic-claude-3-opus", label: "Claude 3 Opus", placeholder: "sk-ant-...", link: "https://console.anthropic.com/", linkText: "Anthropic Console" },
  { value: "anthropic-claude-3-haiku", label: "Claude 3 Haiku", placeholder: "sk-ant-...", link: "https://console.anthropic.com/", linkText: "Anthropic Console" },
  { value: "custom", label: "Custom (OpenAI-compatible)", placeholder: "Your API key", link: "", linkText: "" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { toast } = useToast();
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checkingSettings, setCheckingSettings] = useState(true);
  
  const [backfillDays, setBackfillDays] = useState("30");
  const [excludeLabels, setExcludeLabels] = useState(["SPAM", "TRASH"]);
  const [llmProvider, setLlmProvider] = useState("gemini-2.5-flash");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [aiReplyEnabled, setAiReplyEnabled] = useState(false);
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);

  // Check for existing settings on mount
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          // If onboarding is already complete, redirect
          if (data.onboardingComplete) {
            router.push("/inbox");
            return;
          }
          
          // Load existing settings if they exist
          if (data.backfillDays) {
            setBackfillDays(data.backfillDays.toString());
          }
          if (data.excludeLabels) {
            setExcludeLabels(data.excludeLabels);
          }
          if (data.llmProvider) {
            setLlmProvider(data.llmProvider);
          }
          if (data.llmBaseUrl) {
            setLlmBaseUrl(data.llmBaseUrl);
          }
          if (data.llmModel) {
            setLlmModel(data.llmModel);
          }
          if (data.aiReplyEnabled !== undefined) {
            setAiReplyEnabled(data.aiReplyEnabled);
          }
          
          // If API key exists, skip step 2
          if (data.hasApiKey) {
            setHasExistingApiKey(true);
            // Skip directly to step 3 if API key exists
            setStep(3);
          }
          
          setCheckingSettings(false);
        })
        .catch(() => {
          setCheckingSettings(false);
        });
    }
  }, [status, session, router]);

  if (status === "loading" || checkingSettings) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    router.push("/auth/signin");
    return null;
  }

  const handleExcludeLabelToggle = (labelId: string) => {
    setExcludeLabels((prev) =>
      prev.includes(labelId)
        ? prev.filter((l) => l !== labelId)
        : [...prev, labelId]
    );
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      // Only update API key if a new one was provided
      const updateData: any = {
        backfillDays: parseInt(backfillDays),
        excludeLabels,
        llmProvider,
        baseUrl: llmProvider === "custom" ? llmBaseUrl : undefined,
        model: llmProvider === "custom" ? llmModel : undefined,
        aiReplyEnabled,
        onboardingComplete: true,
      };
      
      // Only include API key if user provided a new one
      if (llmApiKey && llmApiKey.trim()) {
        updateData.llmApiKey = llmApiKey;
      }
      
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      // Start initial sync
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "backfill" }),
      });

      toast({
        title: "Setup complete!",
        description: "Your emails are being synced in the background.",
      });

      router.push("/inbox");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to complete setup. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-radial py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step 1: Backfill */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <CardTitle>How much email history?</CardTitle>
              <CardDescription>
                Choose how far back to sync your emails. More history means longer initial sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup value={backfillDays} onValueChange={setBackfillDays}>
                {BACKFILL_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center space-x-3">
                    <RadioGroupItem value={option.value} id={option.value} />
                    <Label htmlFor={option.value} className="flex-1 cursor-pointer">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground text-sm ml-2">
                        {option.description}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              <div className="space-y-3">
                <Label>Exclude these labels:</Label>
                {EXCLUDE_LABELS.map((label) => (
                  <div key={label.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={label.id}
                      checked={excludeLabels.includes(label.id)}
                      onCheckedChange={() => handleExcludeLabelToggle(label.id)}
                    />
                    <Label htmlFor={label.id} className="cursor-pointer">
                      {label.label}
                    </Label>
                  </div>
                ))}
              </div>

              <Button onClick={() => setStep(2)} className="w-full">
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: API Key */}
        {step === 2 && (() => {
          const selectedProvider = LLM_PROVIDERS.find(p => p.value === llmProvider) || LLM_PROVIDERS[0];
          const isCustom = llmProvider === "custom";
          
          return (
            <Card>
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Key className="w-5 h-5 text-primary" />
                </div>
                <CardTitle>Add your LLM API key</CardTitle>
                <CardDescription>
                  Choose your AI provider and add your API key. Your key is encrypted and never shared.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="provider">LLM Provider</Label>
                  <Select value={llmProvider} onValueChange={setLlmProvider}>
                    <SelectTrigger id="provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LLM_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Select the AI provider you want to use. You can change this later in Settings.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiKey">
                    {isCustom ? "API Key" : `${selectedProvider.label} API Key`}
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder={selectedProvider.placeholder}
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                  />
                  {selectedProvider.link && (
                    <p className="text-xs text-muted-foreground">
                      Get your API key from{" "}
                      <a
                        href={selectedProvider.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {selectedProvider.linkText}
                      </a>
                    </p>
                  )}
                </div>

                {isCustom && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="baseUrl">API Base URL</Label>
                      <Input
                        id="baseUrl"
                        type="url"
                        placeholder="https://api.example.com/v1"
                        value={llmBaseUrl}
                        onChange={(e) => setLlmBaseUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Your OpenAI-compatible API endpoint URL
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="model">Model Name</Label>
                      <Input
                        id="model"
                        type="text"
                        placeholder="gpt-4"
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        The model name to use with your custom API
                      </p>
                    </div>
                  </>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                    Back
                  </Button>
                  <Button 
                    onClick={() => setStep(3)} 
                    className="flex-1"
                    disabled={!llmApiKey || (isCustom && (!llmBaseUrl || !llmModel))}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
                
                {!hasExistingApiKey && (
                <Button
                  variant="ghost"
                  onClick={() => setStep(3)}
                  className="w-full text-muted-foreground"
                >
                  Skip for now
                </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Step 3: Preferences */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <Settings2 className="w-5 h-5 text-primary" />
              </div>
              <CardTitle>Final preferences</CardTitle>
              <CardDescription>
                Configure additional features. You can always change these later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start space-x-3 p-4 border rounded-lg">
                <Checkbox
                  id="aiReply"
                  checked={aiReplyEnabled}
                  onCheckedChange={(checked) => setAiReplyEnabled(checked as boolean)}
                />
                <div>
                  <Label htmlFor="aiReply" className="cursor-pointer font-medium">
                    Enable AI Reply Drafts
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Allow AI to draft replies for your emails. You&apos;ll always review before sending.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                  Back
                </Button>
                <Button onClick={handleComplete} disabled={loading} className="flex-1">
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    "Complete Setup"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
