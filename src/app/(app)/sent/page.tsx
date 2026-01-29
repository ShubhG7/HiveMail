"use client";

import { EmptyState } from "@/components/empty-state";
import { Send } from "lucide-react";

export default function SentPage() {
  return (
    <div className="flex items-center justify-center h-full">
      <EmptyState
        title="Sent emails"
        description="Sent emails will appear here when you enable AI replies and send through the app."
        icon={<Send className="w-8 h-8 text-muted-foreground" />}
      />
    </div>
  );
}
