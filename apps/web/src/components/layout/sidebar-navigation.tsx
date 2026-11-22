"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId } from "react";
import {
  Archive,
  BarChart3,
  Bell,
  CalendarCheck2,
  CheckSquare,
  CircleHelp,
  ExternalLink,
  FileText,
  Flag,
  Folder,
  Grid2X2,
  House,
  Lightbulb,
  Wallet,
  Bot,
  Plus,
  Power,
  Rocket,
  Settings,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { formatDisplayCount, formatDisplayCountLabel } from "@/lib/presentation-format";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { getSidebarTaskSignalBadge, SidebarSignalBadge } from "./shell-signals";
import { SidebarLogout } from "./sidebar-logout";
import { COMMAND_ROUTES, type ShellRouteMeta } from "./shell-route-meta";

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

/**
 * The row's accessible name and tooltip both say what the compact number
 * counts, using the canonical `activeTaskCount` field.
 */
function getProjectAccessibleLabel(project: SidebarProject) {
  if (project.activeTaskCount <= 0) return project.name;
  return `${project.name} — ${formatDisplayCountLabel(project.activeTaskCount, "active task")}`;
}

function SidebarProjectLink({
  project,
  selected,
  href,
  compact = false,
  onNavigate,
}: {
  project: SidebarProject;
  selected: boolean;
  href: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      aria-label={getProjectAccessibleLabel(project)}
      title={compact ? undefined : getProjectAccessibleLabel(project)}
      className={cn("sidebar-link sidebar-project-link", selected && "selected")}
      onClick={onNavigate}
    >
      <span
        className="project-dot"
        style={{ background: getProjectColor(project.name) }}
        aria-hidden="true"
      />
      <span className="workspace-nav-label min-w-0 flex-1 truncate">
        {project.name}
      </span>
      {project.activeTaskCount > 0 ? (
        <span className="sidebar-project-count" aria-hidden="true">
          {formatDisplayCount(project.activeTaskCount)}
        </span>
      ) : null}
    </Link>
  );

  if (!compact) {
    return link;
  }

  return (
    <Tooltip content={getProjectAccessibleLabel(project)} side="right" delayMs={100} className="block w-full">
      {link}
    </Tooltip>
  );
}

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
  "/notifications": Bell,
  "/startup": Rocket,
  "/shutdown": Power,
  "/apps": Grid2X2,
  "/agents": Bot,
  "/help": CircleHelp,
  "/settings/account": Settings,
};

const PROJECT_COLORS = [
  "var(--ega-data-blue)",
  "var(--ega-data-orange)",
  "var(--ega-data-purple)",
  "var(--ega-data-green)",
  "var(--ega-data-yellow)",
  "var(--ega-data-slate)",
] as const;

/** Compact workspace list: a useful subset stays visible, everything stays reachable. */
const VISIBLE_PROJECT_LIMIT = 6;

function getProjectColor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    const charCode = name.codePointAt(index) ?? 0;
    hash = charCode + ((hash << 5) - hash);
  }

  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

function isActive(pathname: string, href: string) {
  if (href === "/tasks") {
    return pathname === "/tasks" || pathname.startsWith("/tasks/");
  }

  if (href === "/settings/account") {
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
  favorites = [],
  projects = [],
  metrics,
  compact = false,
  onNavigate,
  className,
}: SidebarNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalUrl = useCanonicalUrl();
  const taskBadge = getSidebarTaskSignalBadge(metrics);
  const selectedProjectId = searchParams.get("project");
  const projectPathSlug = pathname.startsWith("/tasks/projects/")
    ? pathname.split("/")[3]
    : null;
  const visibleProjects = projects.slice(0, VISIBLE_PROJECT_LIMIT);
  const hiddenProjectCount = Math.max(0, projects.length - visibleProjects.length);
  const areaHeadingPrefix = useId();

  return (
    <nav
      className={cn("sidebar-nav workspace-sidebar-nav", compact && "is-compact", className)}
      aria-label="Workspace navigation"
    >
      <section className="sidebar-section workspace-nav-section" aria-label="Primary">
        <div className="workspace-nav-list">
          {COMMAND_ROUTES.map((route) => {
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
