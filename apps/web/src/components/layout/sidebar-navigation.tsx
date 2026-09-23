"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
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
  Bot,
  Plus,
  Power,
  Rocket,
  Settings,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { formatDisplayCount } from "@/lib/presentation-format";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import { getSidebarTaskSignalBadge, SidebarSignalBadge } from "./shell-signals";
import { SidebarLogout } from "./sidebar-logout";
import { COMMAND_ROUTES, SYSTEM_ROUTES, type ShellRouteMeta } from "./shell-route-meta";

export type SidebarProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  activeTaskCount: number;
  isPinned: boolean;
};

export type SidebarGoal = {
  id: string;
  title: string;
  project_id: string;
};

type SidebarNavigationProps = {
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
  return `${project.name} — ${formatDisplayCount(project.activeTaskCount)} active tasks`;
}

const ROUTE_ICONS: Record<string, LucideIcon> = {
  "/home": House,
  "/today": CalendarCheck2,
  "/tasks": CheckSquare,
  "/goals": Flag,
  "/timer": Timer,
  "/review": FileText,
  "/work-analytics": BarChart3,
  "/ideas": Lightbulb,
  "/notifications": Bell,
  "/startup": Rocket,
  "/shutdown": Power,
  "/apps": Grid2X2,
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

  return pathname === href || pathname.startsWith(`${href}/`);
}

function RouteLink({
  route,
  pathname,
  badge,
  onNavigate,
}: {
  route: ShellRouteMeta;
  pathname: string;
  badge?: { label: string; tone: "active" | "muted" | "warn" | "error" } | null;
  onNavigate?: () => void;
}) {
  const canonicalUrl = useCanonicalUrl();
  const Icon = ROUTE_ICONS[route.href] ?? Grid2X2;
  const active = isActive(pathname, route.href);

  return (
    <Link
      href={canonicalUrl.resolve(route.href)}
      aria-current={active ? "page" : undefined}
      // Names and tooltips stay available when the sidebar collapses to an icon rail.
      aria-label={route.label}
      title={route.label}
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
}

export function SidebarNavigation({
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
                : route.href === "/timer" && metrics.hasActiveTimer
                  ? { label: "Live", tone: "active" as const }
                  : route.href === "/review" && metrics.reviewMissing
                    ? { label: "Due", tone: "warn" as const }
                    : null;

            return (
              <RouteLink
                key={route.href}
                route={route}
                pathname={pathname}
                badge={badge}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>
      </section>

      <section
        className="sidebar-section sidebar-project-section workspace-nav-section"
        aria-labelledby="workspace-projects-label"
      >
        <div className="sidebar-section-heading">
          <div id="workspace-projects-label" className="sidebar-section-label">
            Workspaces
          </div>
          <Link
            href={canonicalUrl.resolve("/tasks/projects/new")}
            className="sidebar-section-action"
            aria-label="Create new project"
            title="New project"
            onClick={onNavigate}
          >
            <Plus aria-hidden="true" />
          </Link>
        </div>

        {visibleProjects.length > 0 ? (
          <div className="sidebar-project-list">
            {visibleProjects.map((project) => {
              const selected =
                selectedProjectId === project.id || projectPathSlug === project.slug;

              return (
                <Link
                  key={project.id}
                  href={canonicalUrl.resolve(`/tasks?project=${project.id}`)}
                  aria-current={selected ? "page" : undefined}
                  aria-label={getProjectAccessibleLabel(project)}
                  title={getProjectAccessibleLabel(project)}
                  className={cn(
                    "sidebar-link sidebar-project-link",
                    selected && "selected",
                  )}
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
            })}
          </div>
        ) : (
          <Link
            href={canonicalUrl.resolve("/tasks/projects/new")}
            className="sidebar-project-empty"
            onClick={onNavigate}
          >
            Create first project
          </Link>
        )}

        <Link
          href={canonicalUrl.resolve("/tasks/projects")}
          aria-current={pathname === "/tasks/projects" ? "page" : undefined}
          aria-label="View all projects"
          title="View all projects"
          className={cn(
            "sidebar-link sidebar-project-link sidebar-view-all",
            pathname === "/tasks/projects" && "selected",
          )}
          onClick={onNavigate}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            <Folder />
          </span>
          <span className="workspace-nav-label">
            {hiddenProjectCount > 0 ? `All workspaces (${projects.length})` : "All workspaces"}
          </span>
        </Link>
      </section>

      <section
        className="sidebar-section sidebar-general-section workspace-nav-section"
        aria-label="System"
      >
        {SYSTEM_ROUTES.map((route) => (
          <RouteLink
            key={route.href}
            route={route}
            pathname={pathname}
            badge={
              route.href === "/notifications" && metrics.unreadNotificationCount > 0
                ? { label: String(metrics.unreadNotificationCount), tone: "warn" }
                : null
            }
            onNavigate={onNavigate}
          />
        ))}

        <a
          href="https://hermes.egawilldoit.online/"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-link workspace-nav-link"
          aria-label="Hermes"
          title="Hermes"
          onClick={onNavigate}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            <Bot />
          </span>
          <span className="workspace-nav-label">Hermes</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </a>

        <SidebarLogout />
      </section>
    </nav>
  );
}
