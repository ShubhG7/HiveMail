"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Key, AlertCircle, X } from "lucide-react";
import Link from "next/link";

interface ApiKeyStatus {
  hasApiKey: boolean;
  isValid: boolean;
  error?: string;
  errorType?: string;
}

export function ApiKeyBanner() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setStatus({
            hasApiKey: data.hasApiKey || false,
            isValid: data.hasApiKey || false, // We'll enhance this with actual validation
          });
        }
      } catch (error) {
        console.error("Failed to check API key status:", error);
      }
    };

    checkApiKey();
    
    // Check every 5 minutes
    const interval = setInterval(checkApiKey, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't show if dismissed or if API key is valid
  if (dismissed || !status || (status.hasApiKey && status.isValid)) {
    return null;
  }

  // Show warning if no API key
  if (!status.hasApiKey) {
    return (
      <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 mx-0 my-0 rounded-none border-x-0">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <Key className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="text-yellow-800 dark:text-yellow-200">
                API Key Required
              </AlertTitle>
              <AlertDescription className="text-yellow-700 dark:text-yellow-300 mt-1">
                Add your LLM API key in Settings to enable AI features like categorization, summaries, and chat.
              </AlertDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings">
              <Button size="sm" variant="outline" className="border-yellow-600 text-yellow-700 dark:text-yellow-300">
                Add API Key
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="text-yellow-700 dark:text-yellow-300"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  // Show error if API key is invalid
  if (status.hasApiKey && !status.isValid && status.error) {
    return (
      <Alert className="border-red-500 bg-red-50 dark:bg-red-950 mx-0 my-0 rounded-none border-x-0">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="text-red-800 dark:text-red-200">
                API Key Issue
              </AlertTitle>
              <AlertDescription className="text-red-700 dark:text-red-300 mt-1">
                {status.error || "Your API key appears to be invalid. Please check your Settings."}
              </AlertDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings">
              <Button size="sm" variant="outline" className="border-red-600 text-red-700 dark:text-red-300">
                Fix API Key
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="text-red-700 dark:text-red-300"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  return null;
}
