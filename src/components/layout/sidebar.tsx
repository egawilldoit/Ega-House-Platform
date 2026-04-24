"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarCheck2,
  CheckSquare,
  CircleHelp,
  FileText,
  Flag,
  LayoutDashboard,
  Plus,
  Power,
  Rocket,
  Timer,
} from "lucide-react";

import { QuickTaskSheet } from "@/components/tasks/quick-task-sheet";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";
import {
  getSidebarTaskSignalBadge,
  SidebarSignalBadge,
} from "./shell-signals";
import { SidebarLogout } from "./sidebar-logout";

type NavItem = {
  href: `/${string}`;
  label: string;
  icon: ReactNode;
};

const CORE_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard />,
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: <CheckSquare />,
  },
  {
    href: "/today",
    label: "Today",
    icon: <CalendarCheck2 />,
  },
  {
    href: "/goals",
    label: "Goals",
    icon: <Flag />,
  },
  {
    href: "/timer",
    label: "Timer",
    icon: <Timer />,
  },
  {
    href: "/review",
    label: "Review",
    icon: <FileText />,
  },
];

const GENERAL_ITEMS: NavItem[] = [
  {
    href: "/startup",
    label: "Startup",
    icon: <Rocket />,
  },
  {
    href: "/shutdown",
    label: "Shutdown",
    icon: <Power />,
  },
  {
    href: "/help" as `/${string}`,
    label: "Help",
    icon: <CircleHelp />,
  },
];

function isActive(pathname: string, href: `/${string}`) {
  if (href === "/tasks") return pathname === "/tasks" || pathname.startsWith("/tasks/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

const PROJECT_COLORS = [
  "#22c55e", "#06b6d4", "#8b5cf6", "#f59e0b",
  "#ef4444", "#3b82f6", "#ec4899", "#84cc16",
];

function getProjectColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

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

type SidebarProps = {
  projects?: SidebarProject[];
  goals?: SidebarGoal[];
  metrics: WorkspaceShellMetrics;
};

export function Sidebar({ projects = [], goals = [], metrics }: SidebarProps) {
  const currentPath = usePathname();
  const searchParams = useSearchParams();
  const taskBadge = getSidebarTaskSignalBadge(metrics);
  const selectedProjectId = searchParams.get("project");
  const projectPathSlug = currentPath.startsWith("/tasks/projects/")
    ? currentPath.split("/")[3]
    : null;
  const visibleProjects = projects.slice(0, 14);

  return (
    <aside className="ega-sidebar">
      <div className="sidebar-brand">
        <Image
          src="/logo.svg"
          alt="EGA House"
          width={36}
          height={36}
          priority
          className="sidebar-brand-logo"
        />
        <div className="min-w-0">
          <div className="sidebar-brand-title">EGA House</div>
          <div className="sidebar-brand-subtitle">Execution workspace</div>
        </div>
      </div>

      <QuickTaskSheet projects={projects} goals={goals} />

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="sidebar-section">
          <div className="sidebar-section-label">Core</div>
          {CORE_ITEMS.map((item) => {
            const active = isActive(currentPath, item.href);
            const badge =
              item.href === "/tasks"
                ? taskBadge
                : item.href === "/timer" && metrics.hasActiveTimer
                  ? { label: "Live", tone: "active" as const }
                  : item.href === "/review" && metrics.reviewMissing
                    ? { label: "Due", tone: "warn" as const }
                    : null;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("sidebar-link", active && "active")}
              >
                <span className="sidebar-link-icon">{item.icon}</span>
                <span className="min-w-0 truncate">{item.label}</span>
                {badge && (
                  <SidebarSignalBadge label={badge.label} tone={badge.tone} />
                )}
              </Link>
            );
          })}
        </div>

        <div className="sidebar-section sidebar-project-section">
          <div className="sidebar-section-heading">
            <div className="sidebar-section-label">Projects</div>
            <Link
              href="/tasks/projects/new"
              className="sidebar-section-action"
              aria-label="Create new project"
              title="New Project"
            >
              <Plus className="h-3.5 w-3.5" />
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
                    href={`/tasks?project=${project.id}`}
                    aria-current={selected ? "page" : undefined}
                    className={cn("sidebar-link sidebar-project-link", selected && "selected")}
                  >
                    <span
                      className="project-dot"
                      style={{ background: getProjectColor(project.name) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
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
            <Link href="/tasks/projects/new" className="sidebar-project-empty">
              Create first project
            </Link>
          )}

          <Link
            href="/tasks/projects"
            className={cn(
              "sidebar-link sidebar-project-link sidebar-view-all",
              currentPath === "/tasks/projects" && "selected",
            )}
          >
            <span className="sidebar-link-icon">
              <BarChart3 />
            </span>
            <span className="min-w-0 truncate">View all projects</span>
          </Link>
        </div>

        <div className="sidebar-section sidebar-general-section">
          <div className="sidebar-section-label">General</div>

          {GENERAL_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive(currentPath, item.href) ? "page" : undefined}
              className={cn("sidebar-link", isActive(currentPath, item.href) && "active")}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              <span className="min-w-0 truncate">{item.label}</span>
            </Link>
          ))}
          <SidebarLogout />
        </div>
      </nav>
    </aside>
  );
}
