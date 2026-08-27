"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarCheck2,
  CheckSquare,
  CircleHelp,
  FileText,
  Flag,
  Grid2X2,
  LayoutDashboard,
  Lightbulb,
  Plus,
  Power,
  Rocket,
  Settings,
  Timer,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import { useCanonicalUrl } from "@/lib/use-canonical-url";
import {
  getSidebarTaskSignalBadge,
  SidebarSignalBadge,
} from "./shell-signals";
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
};

const ROUTE_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/today": CalendarCheck2,
  "/tasks": CheckSquare,
  "/goals": Flag,
  "/timer": Timer,
  "/review": FileText,
  "/work-analytics": BarChart3,
  "/ideas": Lightbulb,
  "/startup": Rocket,
  "/shutdown": Power,
  "/apps": Grid2X2,
  "/help": CircleHelp,
  "/settings/account": Settings,
};

const PROJECT_COLORS = [
  "#22c55e",
  "#06b6d4",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#84cc16",
] as const;

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
  compact,
  onNavigate,
}: {
  route: ShellRouteMeta;
  pathname: string;
  badge?: { label: string; tone: "active" | "muted" | "warn" | "error" } | null;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const canonicalUrl = useCanonicalUrl();
  const Icon = ROUTE_ICONS[route.href] ?? Grid2X2;
  const active = isActive(pathname, route.href);

  return (
    <Link
      href={canonicalUrl.resolve(route.href)}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? route.label : undefined}
      title={compact ? route.label : undefined}
      className={cn("sidebar-link workspace-nav-link", active && "active")}
      onClick={onNavigate}
    >
      <span className="workspace-nav-index" aria-hidden="true">
        {route.index}
      </span>
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
}: SidebarNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalUrl = useCanonicalUrl();
  const taskBadge = getSidebarTaskSignalBadge(metrics);
  const selectedProjectId = searchParams.get("project");
  const projectPathSlug = pathname.startsWith("/tasks/projects/")
    ? pathname.split("/")[3]
    : null;
  const visibleProjects = projects.slice(0, 14);

  return (
    <nav
      className={cn("sidebar-nav workspace-sidebar-nav", compact && "is-compact")}
      aria-label="Workspace navigation"
    >
      <section className="sidebar-section workspace-nav-section" aria-labelledby="workspace-command-label">
        <div id="workspace-command-label" className="sidebar-section-label">
          Command
        </div>
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
                compact={compact}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>
      </section>

      <section className="sidebar-section sidebar-project-section workspace-nav-section" aria-labelledby="workspace-projects-label">
        <div className="sidebar-section-heading">
          <div id="workspace-projects-label" className="sidebar-section-label">
            Projects
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
                  aria-label={compact ? project.name : undefined}
                  title={project.name}
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
                    <span className="sidebar-project-count">{project.activeTaskCount}</span>
                  ) : project.status !== "active" ? (
                    <span className="sidebar-project-status">{project.status}</span>
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
          className={cn(
            "sidebar-link sidebar-project-link sidebar-view-all",
            pathname === "/tasks/projects" && "selected",
          )}
          onClick={onNavigate}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            <BarChart3 />
          </span>
          <span className="workspace-nav-label">View all projects</span>
        </Link>
      </section>

      <section className="sidebar-section sidebar-general-section workspace-nav-section" aria-labelledby="workspace-system-label">
        <div id="workspace-system-label" className="sidebar-section-label">
          System
        </div>

        {SYSTEM_ROUTES.map((route) => (
          <RouteLink
            key={route.href}
            route={route}
            pathname={pathname}
            compact={compact}
            onNavigate={onNavigate}
          />
        ))}

        <SidebarLogout />
      </section>
    </nav>
  );
}
