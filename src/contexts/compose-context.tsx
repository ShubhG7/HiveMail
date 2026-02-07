"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface ReplyTo {
  threadId: string;
  to: string;
  subject: string;
  inReplyTo?: string;
}

interface ComposeContextType {
  isOpen: boolean;
  replyTo: ReplyTo | undefined;
  openCompose: (replyTo?: ReplyTo) => void;
  closeCompose: () => void;
}

const ComposeContext = createContext<ComposeContextType | undefined>(undefined);

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTo | undefined>(undefined);

  const openCompose = (reply?: ReplyTo) => {
    setReplyTo(reply);
    setIsOpen(true);
  };

  const closeCompose = () => {
    setIsOpen(false);
    setReplyTo(undefined);
  };

  return (
    <ComposeContext.Provider value={{ isOpen, replyTo, openCompose, closeCompose }}>
      {children}
    </ComposeContext.Provider>
  );
}

export function useCompose() {
  const context = useContext(ComposeContext);
  if (!context) {
    throw new Error("useCompose must be used within a ComposeProvider");
  }
  return context;
}
