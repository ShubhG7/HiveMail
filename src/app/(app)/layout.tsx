import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { ApiKeyBanner } from "@/components/api-key-banner";
import { SyncProgress } from "@/components/sync-progress";
import { AppLayoutClient } from "@/components/app-layout-client";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  // Check if onboarding is complete
  const settings = await prisma.userSettings.findUnique({
    where: { userId: session.user.id },
  });

  if (!settings?.onboardingComplete) {
    redirect("/onboarding");
  }

  return (
    <AppLayoutClient>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar user={session.user} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader user={session.user} />
          <div className="px-4">
            <ApiKeyBanner />
            <SyncProgress />
          </div>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </AppLayoutClient>
  );
}
