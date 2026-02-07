"use client";

import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, RefreshCw, AlertCircle } from "lucide-react";

interface WorkerStatus {
  healthy: boolean;
  timestamp?: string;
  error?: string;
  url?: string;
}

export function WorkerStatus() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const checkWorker = async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/worker/health");
      if (response.ok) {
        const data = await response.json();
        setStatus({
          healthy: data.healthy,
          timestamp: data.timestamp,
          url: data.url,
        });
      } else {
        setStatus({
          healthy: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        });
      }
    } catch (error: any) {
      setStatus({
        healthy: false,
        error: error.message || "Failed to connect to worker",
      });
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    checkWorker();
    // Check every 30 seconds
    const interval = setInterval(checkWorker, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Alert>
        <Loader2 className="w-4 h-4 animate-spin" />
        <AlertDescription>Checking worker status...</AlertDescription>
      </Alert>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <Alert className={status.healthy ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-red-500 bg-red-50 dark:bg-red-950"}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {status.healthy ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
          )}
          <div className="flex-1">
            <AlertDescription className={status.healthy ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">Worker Status:</span>
                <Badge variant={status.healthy ? "default" : "destructive"}>
                  {status.healthy ? "Healthy" : "Unavailable"}
                </Badge>
              </div>
              {status.url && (
                <p className="text-xs mt-1">
                  URL: {status.url}
                </p>
              )}
              {status.timestamp && (
                <p className="text-xs mt-1">
                  Last check: {new Date(status.timestamp).toLocaleTimeString()}
                </p>
              )}
              {status.error && (
                <p className="text-xs mt-1 font-medium">
                  Error: {status.error}
                </p>
              )}
              {!status.healthy && (
                <div className="mt-2 text-xs space-y-1">
                  <p className="font-medium">Troubleshooting:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>Check if worker is running: <code className="bg-muted px-1 rounded">cd worker && python -m uvicorn main:app --reload</code></li>
                    <li>Verify WORKER_BASE_URL in .env.local matches worker URL</li>
                    <li>Check worker logs for errors</li>
                    <li>Ensure worker can connect to database</li>
                  </ul>
                </div>
              )}
            </AlertDescription>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={checkWorker}
          disabled={checking}
          className={status.healthy ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}
        >
          <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </Alert>
  );
}
