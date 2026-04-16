import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type NavItem = {
  href: `/${string}`;
  label: string;
  icon: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Ops",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    href: "/goals",
    label: "Goals",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 15" />
      </svg>
    ),
  },
  {
    href: "/review",
    label: "Review",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
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

type SidebarProps = {
  projects?: SidebarProject[];
  currentPath: string;
};

export function Sidebar({ projects = [], currentPath }: SidebarProps) {
  return (
    <aside className="ega-sidebar">
      {/* Brand mark */}
      <div className="h-16 flex items-center justify-center shrink-0 border-b border-[var(--border)]">
        <div
          className="w-7 h-7 rounded-sm flex items-center justify-center"
          style={{ background: "var(--signal-live)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0b0f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col items-stretch py-3 flex-1" aria-label="Main navigation">
        {/* Workspace label */}
        <div className="glass-label text-etch px-3 mb-2">Workspace</div>

        {NAV_ITEMS.map((item) => {
          const active = isActive(currentPath, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("sidebar-link", active && "active")}
            >
              <span className="opacity-80">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {/* Divider */}
        {projects.length > 0 && (
          <>
            <div className="mx-3 my-3 border-t border-[var(--border)]" />
            <div className="glass-label text-etch px-3 mb-2">Projects</div>

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
                <span className="truncate w-full text-center">{project.name}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* Bottom watch load / footer */}
      <div className="border-t border-[var(--border)] py-3 px-2 shrink-0">
        <div className="glass-label text-etch text-center mb-1">Watch load</div>
        <div className="progress-flat rounded-none">
          <div className="progress-flat-fill" style={{ width: "30%", background: "var(--signal-live)" }} />
        </div>
      </div>
    </aside>
  );
}
