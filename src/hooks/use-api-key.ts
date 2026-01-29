"use client";

import { useState, useEffect, useCallback } from "react";

interface ApiKeyState {
  hasApiKey: boolean;
  loading: boolean;
  showDialog: boolean;
  setShowDialog: (show: boolean) => void;
  checkApiKey: () => Promise<boolean>;
  requireApiKey: () => boolean;
}

export function useApiKey(): ApiKeyState {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);

  const checkApiKey = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/settings");
      if (response.ok) {
        const data = await response.json();
        setHasApiKey(data.hasApiKey);
        return data.hasApiKey;
      }
    } catch (error) {
      console.error("Failed to check API key:", error);
    }
    return false;
  }, []);

  useEffect(() => {
    checkApiKey().finally(() => setLoading(false));
  }, [checkApiKey]);

  // Returns true if API key exists, false and opens dialog if not
  const requireApiKey = useCallback((): boolean => {
    if (hasApiKey) {
      return true;
    }
    setShowDialog(true);
    return false;
  }, [hasApiKey]);

  return {
    hasApiKey,
    loading,
    showDialog,
    setShowDialog,
    checkApiKey,
    requireApiKey,
  };
}
