"use client";

import { ReactNode } from "react";
import { ComposeProvider, useCompose } from "@/contexts/compose-context";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeOverlay } from "@/components/compose-overlay";

function ComposeOverlayWrapper() {
  const { isOpen, replyTo, closeCompose } = useCompose();
  
  return (
    <ComposeOverlay
      isOpen={isOpen}
      onClose={closeCompose}
      replyTo={replyTo}
    />
  );
}

export function AppLayoutClient({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <ComposeProvider>
          {children}
          <ComposeOverlayWrapper />
        </ComposeProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
