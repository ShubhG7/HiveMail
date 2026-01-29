"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import {
  Inbox,
  Star,
  Clock,
  Send,
  BarChart3,
  MessageSquare,
  Settings,
  Mail,
} from "lucide-react";

interface AppSidebarProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

const mainNav = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/inbox?filter=starred", label: "Starred", icon: Star },
  { href: "/inbox?filter=needsReply", label: "Needs Reply", icon: Clock },
  { href: "/sent", label: "Sent", icon: Send },
];

const toolsNav = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b">
        <Link href="/inbox" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg">Hivemail</span>
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Main Navigation */}
          <nav className="space-y-1">
            {mainNav.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== "/inbox" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={cn(
                      "w-full justify-start",
                      isActive && "bg-primary/10 text-primary"
                    )}
                  >
                    <item.icon className="w-4 h-4 mr-2" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>

          <Separator />

          {/* Categories */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-2">
              Categories
            </h4>
            <nav className="space-y-1">
              {DEFAULT_CATEGORIES.slice(0, -1).map((category) => {
                const href = `/inbox?category=${category.id}`;
                const isActive = pathname + window?.location?.search === href;
                return (
                  <Link key={category.id} href={href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "w-full justify-start",
                        isActive && "bg-primary/10 text-primary"
                      )}
                    >
                      <category.icon className={cn("w-4 h-4 mr-2", category.color)} />
                      {category.name}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>

          <Separator />

          {/* Tools */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-2">
              Tools
            </h4>
            <nav className="space-y-1">
              {toolsNav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      size="sm"
                      className={cn(
                        "w-full justify-start",
                        isActive && "bg-primary/10 text-primary"
                      )}
                    >
                      <item.icon className="w-4 h-4 mr-2" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
