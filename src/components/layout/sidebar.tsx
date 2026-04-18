"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    href: "/goals",
    label: "Goals",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    href: "/timer",
    label: "Timer",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 15" />
      </svg>
    ),
  },
  {
    href: "/review",
    label: "Review",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
];

const GENERAL_ITEMS: NavItem[] = [
  {
    href: "/dashboard" as `/${string}`,
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    href: "/help" as `/${string}`,
    label: "Help",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
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
  const taskBadge = getSidebarTaskSignalBadge(metrics);

  return (
    <aside className="ega-sidebar">
      {/* Brand mark */}
      <div className="h-16 flex items-center justify-start gap-3 shrink-0 border-b border-[var(--border)] px-5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "var(--accent)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold text-[color:var(--foreground)]">EGA House</div>
        </div>
      </div>

      <QuickTaskSheet projects={projects} goals={goals} />

      {/* Primary nav */}
      <nav className="flex flex-col items-stretch pt-5 flex-1" aria-label="Main navigation">
        {/* MENU section */}
        <div className="sidebar-section-label">Menu</div>

        {NAV_ITEMS.map((item) => {
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
              <span className="opacity-75">{item.icon}</span>
              {item.label}
              {badge && (
                <SidebarSignalBadge label={badge.label} tone={badge.tone} />
              )}
            </Link>
          );
        })}

        {/* Divider + Projects */}
        {projects.length > 0 && (
          <>
            <div className="mx-5 my-3 border-t border-[var(--border)]" />
            <div className="sidebar-section-label">Projects</div>

            {projects.slice(0, 10).map((project) => (
              <Link
                key={project.id}
                href={`/tasks?project=${project.id}`}
                className="sidebar-link"
              >
                <span
                  className="project-dot"
                  style={{ background: getProjectColor(project.name) }}
                />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* GENERAL section */}
        <div className="mx-5 my-3 border-t border-[var(--border)]" />
        <div className="sidebar-section-label">General</div>

        {GENERAL_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="sidebar-link"
          >
            <span className="opacity-75">{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <SidebarLogout />

        <div className="h-4" />
      </nav>
    </aside>
  );
}
