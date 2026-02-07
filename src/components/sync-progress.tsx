"use client";

import { useEffect, useState, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncStatus {
  isRunning: boolean;
  hasOAuthToken?: boolean;
  currentJob: {
    id: string;
    type: string;
    status: string;
    progress: number | null;
    totalItems: number | null;
    createdAt?: string;
    startedAt?: string;
    error?: string | null;
  } | null;
  lastSync: string | null;
  stats: {
    threads: number;
    messages: number;
  };
}

export function SyncProgress() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch("/api/sync", {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      } else if (response.status === 401) {
        // User not authenticated, don't show error
        setSyncStatus(null);
      }
    } catch (error: any) {
      // Silently handle fetch errors (network issues, aborts, etc.)
      // Don't log to console to avoid spam during development
      if (error?.name !== 'AbortError') {
        // Only log non-abort errors in development
        if (process.env.NODE_ENV === 'development') {
          console.debug("Sync status fetch skipped:", error?.message || "Network error");
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    if (!syncStatus) return;

    // Poll every 2 seconds if sync is running, otherwise every 10 seconds
    const pollInterval = syncStatus.isRunning ? 2000 : 10000;
    
    const interval = setInterval(() => {
      fetchSyncStatus();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [syncStatus?.isRunning, fetchSyncStatus]);

  if (loading || !syncStatus) {
    return null;
  }

  // Show error if last job failed
  const failedJob = syncStatus.currentJob?.status === "FAILED";
  if (failedJob && syncStatus.currentJob) {
      return (
        <Alert className="border-red-500 bg-red-50 dark:bg-red-950 mx-0 my-0 mb-0 rounded-none border-x-0">
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <div className="flex-1">
            <AlertDescription className="text-red-800 dark:text-red-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Sync failed
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchSyncStatus}
                  className="text-red-700 dark:text-red-300"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs mt-1">
                {syncStatus.currentJob.error || "Check Settings to retry sync or view error details."}
              </p>
            </AlertDescription>
          </div>
        </div>
      </Alert>
    );
  }

  // Show warning if no OAuth token
  if (!syncStatus.hasOAuthToken) {
    return (
      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950 mx-0 my-0 mb-0 rounded-none border-x-0">
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Not connected to Gmail
                </span>
              </div>
              <p className="text-xs mt-1">
                Please sign in with Google to sync your emails. Go to Settings to connect your account.
              </p>
            </AlertDescription>
          </div>
        </div>
      </Alert>
    );
  }

  // Don't show anything if no sync has ever run
  if (!syncStatus.currentJob && !syncStatus.lastSync) {
    return null;
  }

  // Show progress bar when sync is running or pending
  if (syncStatus.currentJob) {
    const job = syncStatus.currentJob;
    const progress = job.progress ?? 0;
    const total = job.totalItems ?? 0;
    const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
    const jobType = job.type === "BACKFILL" ? "Full Sync" : "Incremental Sync";
    const isPending = job.status === "PENDING";
    const isRunning = job.status === "RUNNING";
    
    // Check if job is stuck (PENDING for more than 30 seconds)
    const jobCreatedAt = job.createdAt ? new Date(job.createdAt).getTime() : Date.now();
    const jobAge = Date.now() - jobCreatedAt;
    const isStuck = isPending && jobAge > 30000;

    if (isStuck) {
      return (
        <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950 mx-0 my-0 mb-0 rounded-none border-x-0">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
            <div className="flex-1">
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">
                    {jobType} is starting...
                  </span>
                  <span className="text-sm">
                    Waiting for worker
                  </span>
                </div>
                <p className="text-xs mt-1">
                  If this persists, check that the worker service is running.
                </p>
              </AlertDescription>
            </div>
          </div>
        </Alert>
      );
    }

    return (
      <Alert className={`${isRunning ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-amber-500 bg-amber-50 dark:bg-amber-950"} mx-0 my-0 mb-0 rounded-none border-x-0`}>
        <div className="flex items-center gap-3">
          <Loader2 className={`w-5 h-5 ${isRunning ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"} animate-spin`} />
          <div className="flex-1">
            <AlertDescription className={isRunning ? "text-blue-800 dark:text-blue-200" : "text-amber-800 dark:text-amber-200"}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">
                  {jobType} {isPending ? "starting..." : "in progress..."}
                </span>
                <span className="text-sm">
                  {total > 0 ? (
                    <>
                      {progress} / {total} emails
                      {percentage > 0 && ` (${percentage}%)`}
                    </>
                  ) : progress > 0 ? (
                    `${progress} emails processed`
                  ) : (
                    "Initializing..."
                  )}
                </span>
              </div>
              {total > 0 && percentage > 0 && (
                <Progress value={percentage} className="h-2" />
              )}
              {total === 0 && progress === 0 && isRunning && (
                <p className="text-xs mt-1">
                  Fetching emails from Gmail...
                </p>
              )}
            </AlertDescription>
          </div>
        </div>
      </Alert>
    );
  }

  // Show last sync status when not running
  if (syncStatus.lastSync) {
    const lastSyncDate = new Date(syncStatus.lastSync);
    const timeAgo = getTimeAgo(lastSyncDate);

    return (
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950 mx-0 my-0 mb-0 rounded-none border-x-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <span className="font-medium">Last synced:</span> {timeAgo}
              {syncStatus.stats.threads > 0 && (
                <span className="ml-2 text-sm">
                  • {syncStatus.stats.threads} threads, {syncStatus.stats.messages} messages
                </span>
              )}
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSyncStatus}
            className="text-green-700 dark:text-green-300"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </Alert>
    );
  }

  return null;
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}
