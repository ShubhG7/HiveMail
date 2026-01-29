"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
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

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { toast } = useToast();
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  const [backfillDays, setBackfillDays] = useState("30");
  const [excludeLabels, setExcludeLabels] = useState(["SPAM", "TRASH"]);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [aiReplyEnabled, setAiReplyEnabled] = useState(false);

  if (status === "loading") {
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
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backfillDays: parseInt(backfillDays),
          excludeLabels,
          llmApiKey,
          aiReplyEnabled,
          onboardingComplete: true,
        }),
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
        {step === 2 && (
          <Card>
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <CardTitle>Add your LLM API key</CardTitle>
              <CardDescription>
                Bring your own Gemini API key to enable AI features. Your key is encrypted and never shared.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="apiKey">Gemini API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="AIza..."
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Get your API key from{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    Google AI Studio
                  </a>
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  Back
                </Button>
                <Button onClick={() => setStep(3)} className="flex-1">
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
              
              <Button
                variant="ghost"
                onClick={() => setStep(3)}
                className="w-full text-muted-foreground"
              >
                Skip for now
              </Button>
            </CardContent>
          </Card>
        )}

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
