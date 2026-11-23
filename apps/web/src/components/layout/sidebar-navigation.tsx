"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BarChart3,
  CalendarCheck2,
  CheckSquare,
  FileText,
  Flag,
  Grid2X2,
  House,
  Lightbulb,
  Wallet,
  Power,
  Rocket,
  Settings,
  Timer,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { getSidebarTaskSignalBadge, SidebarSignalBadge } from "./shell-signals";
import { SidebarLogout } from "./sidebar-logout";
import { SIDEBAR_ROUTES, type ShellRouteMeta } from "./shell-route-meta";

export type SidebarProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  activeTaskCount: number;
  isPinned: boolean;
  areaId?: string | null;
  areaName?: string | null;
  areaColor?: string | null;
  areaIcon?: string | null;
};

export type SidebarGoal = {
  id: string;
  title: string;
  project_id: string;
};

export type SidebarFavorite = {
  id: string;
  label: string;
  href: `/${string}`;
  kind: "project" | "task";
};

type SidebarNavigationProps = {
  favorites?: SidebarFavorite[];
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
  compact?: boolean;
  onNavigate?: () => void;
  className?: string;
};

const ROUTE_ICONS: Record<string, LucideIcon> = {
  "/home": House,
  "/today": CalendarCheck2,
  "/tasks": CheckSquare,
  "/goals": Flag,
  "/timer": Timer,
  "/review": FileText,
  "/work-analytics": BarChart3,
  "/money": Wallet,
  "/backlog": Lightbulb,
  "/archive": Archive,
  "/startup": Rocket,
  "/shutdown": Power,
  "/apps": Grid2X2,
  "/settings": Settings,
};

function isActive(pathname: string, href: string) {
  if (href === "/tasks") {
    return pathname === "/tasks" || pathname.startsWith("/tasks/");
  }

  if (href === "/settings") {
    return pathname === "/settings" || pathname.startsWith("/settings/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function RouteLink({
  route,
  pathname,
  badge,
  compact = false,
  onNavigate,
}: {
  route: ShellRouteMeta;
  pathname: string;
  badge?: { label: string; tone: "active" | "muted" | "warn" | "error" } | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const canonicalUrl = useCanonicalUrl();
  const Icon = ROUTE_ICONS[route.href] ?? Grid2X2;
  const active = isActive(pathname, route.href);

  const link = (
    <Link
      href={canonicalUrl.resolve(route.href)}
      aria-current={active ? "page" : undefined}
      // Names and tooltips stay available when the sidebar collapses to an icon rail.
      aria-label={route.label}
      title={compact ? undefined : route.label}
      className={cn("sidebar-link workspace-nav-link", active && "active")}
      onClick={onNavigate}
    >
      <span className="sidebar-link-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="workspace-nav-label">{route.label}</span>
      {badge ? <SidebarSignalBadge label={badge.label} tone={badge.tone} /> : null}
    </Link>
  );

  if (!compact) {
    return link;
  }

  return (
    <Tooltip content={route.label} side="right" delayMs={100} className="block w-full">
      {link}
    </Tooltip>
  );
}

export function SidebarNavigation({
  metrics,
  compact = false,
  onNavigate,
  className,
}: SidebarNavigationProps) {
  const pathname = usePathname();
  const taskBadge = getSidebarTaskSignalBadge(metrics);

  return (
    <nav
      className={cn("sidebar-nav workspace-sidebar-nav", compact && "is-compact", className)}
      aria-label="Workspace navigation"
    >
      <section className="sidebar-section workspace-nav-section" aria-label="Primary">
        <div className="workspace-nav-list">
          {SIDEBAR_ROUTES.map((route) => {
            const badge =
              route.href === "/tasks"
                ? taskBadge
                : route.href === "/review" && metrics.reviewMissing
                    ? { label: "Due", tone: "warn" as const }
                    : null;

            return (
              <RouteLink
                key={route.href}
                route={route}
                pathname={pathname}
                badge={badge}
                compact={compact}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>
      </section>



      <div className="sidebar-section workspace-nav-section" aria-label="Account">
        <SidebarLogout />
      </div>
    </nav>
  );
}
