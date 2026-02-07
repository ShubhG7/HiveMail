"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { useCompose } from "@/contexts/compose-context";
import { useSidebar } from "@/contexts/sidebar-context";
import {
  Inbox,
  Star,
  Clock,
  Send,
  BarChart3,
  MessageSquare,
  Settings,
  Mail,
  PenSquare,
  PanelLeftClose,
  FolderOpen,
  Wrench,
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
  const { openCompose } = useCompose();
  const { isCollapsed, toggleSidebar } = useSidebar();

  const NavButton = ({ item, isActive, size = "default" }: { 
    item: { href: string; label: string; icon: any }; 
    isActive: boolean;
    size?: "default" | "sm";
  }) => {
    const button = (
      <Button
        variant={isActive ? "secondary" : "ghost"}
        size={size}
        className={cn(
          "w-full justify-start overflow-hidden",
          isActive && "bg-primary/10 text-primary"
        )}
      >
        <item.icon className="w-4 h-4 shrink-0 mr-2" />
        <span className={cn(
          "whitespace-nowrap transition-opacity duration-200",
          isCollapsed ? "opacity-0" : "opacity-100"
        )}>
          {item.label}
        </span>
      </Button>
    );

    if (isCollapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Link href={item.href}>{button}</Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <Link href={item.href}>{button}</Link>;
  };

  const CategoryButton = ({ category, isActive }: { 
    category: typeof DEFAULT_CATEGORIES[0]; 
    isActive: boolean;
  }) => {
    const button = (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "w-full justify-start overflow-hidden",
          isActive && "bg-primary/10 text-primary"
        )}
        style={{ backgroundColor: isActive ? undefined : 'transparent' }}
      >
        <category.icon className={cn("w-4 h-4 shrink-0 mr-2", category.color)} />
        <span className={cn(
          "whitespace-nowrap transition-opacity duration-200",
          isCollapsed ? "opacity-0" : "opacity-100"
        )}>
          {category.name}
        </span>
      </Button>
    );

    if (isCollapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Link href={`/inbox?category=${category.id}`}>{button}</Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {category.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <Link href={`/inbox?category=${category.id}`}>{button}</Link>;
  };

  return (
    <aside 
      className={cn(
        "border-r bg-card flex flex-col transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64"
      )}
      style={{ backgroundColor: 'hsl(var(--card))' }}
    >
      {/* Logo */}
      <div className="h-14 flex items-center border-b px-3 overflow-hidden">
        <Link href="/inbox" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className={cn(
            "font-semibold text-lg whitespace-nowrap transition-opacity duration-200",
            isCollapsed ? "opacity-0" : "opacity-100"
          )}>
            Hivemail
          </span>
        </Link>
      </div>

      {/* Toggle Button - always below logo */}
      <div className="border-b px-3 py-2 overflow-hidden">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start overflow-hidden"
              onClick={toggleSidebar}
            >
              <PanelLeftClose className={cn(
                "w-4 h-4 shrink-0 mr-2 transition-transform duration-300",
                isCollapsed && "rotate-180"
              )} />
              <span className={cn(
                "text-xs text-muted-foreground whitespace-nowrap transition-opacity duration-200",
                isCollapsed ? "opacity-0" : "opacity-100"
              )}>
                Collapse
              </span>
            </Button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          )}
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-3">
          {/* Compose Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              {isCollapsed ? (
                <Button 
                  onClick={() => openCompose()} 
                  className="w-10 h-10 shadow-md"
                  size="icon"
                >
                  <PenSquare className="w-4 h-4" />
                </Button>
              ) : (
                <Button 
                  onClick={() => openCompose()} 
                  className="w-full shadow-md justify-start"
                  size="default"
                >
                  <PenSquare className="w-4 h-4 shrink-0 mr-2" />
                  Compose
                </Button>
              )}
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">Compose</TooltipContent>
            )}
          </Tooltip>

          {/* Main Navigation */}
          <nav className="space-y-1">
            {mainNav.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== "/inbox" && pathname.startsWith(item.href));
              return (
                <NavButton key={item.href} item={item} isActive={isActive} />
              );
            })}
          </nav>

          <Separator />

          {/* Categories */}
          <div>
            <div className="flex items-center h-9 mb-1 px-3 overflow-hidden">
              <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className={cn(
                "text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap transition-opacity duration-200 ml-2",
                isCollapsed ? "opacity-0" : "opacity-100"
              )}>
                Categories
              </span>
            </div>
            <nav className="space-y-1">
              {DEFAULT_CATEGORIES.slice(0, -1).map((category) => {
                const href = `/inbox?category=${category.id}`;
                const isActive = typeof window !== 'undefined' && 
                  pathname + window.location.search === href;
                return (
                  <CategoryButton key={category.id} category={category} isActive={isActive} />
                );
              })}
            </nav>
          </div>

          <Separator />

          {/* Tools */}
          <div>
            <div className="flex items-center h-9 mb-1 px-3 overflow-hidden">
              <Wrench className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className={cn(
                "text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap transition-opacity duration-200 ml-2",
                isCollapsed ? "opacity-0" : "opacity-100"
              )}>
                Tools
              </span>
            </div>
            <nav className="space-y-1">
              {toolsNav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <NavButton key={item.href} item={item} isActive={isActive} size="sm" />
                );
              })}
            </nav>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
