import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

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
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar user={session.user} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader user={session.user} />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
