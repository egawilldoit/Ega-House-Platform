import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type WorkspaceSkeletonShellProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
};

const SIDEBAR_ROWS = 7;

/**
 * Data-free authenticated shell frame for route `loading.tsx` boundaries.
 *
 * It mirrors the outer geometry of `WorkspaceShell` (sidebar column, top bar,
 * page header) with static skeleton primitives, and performs no authentication,
 * Supabase, or application-service reads. That lets a fallback paint before any
 * page data resolves instead of waiting on the shell query graph.
 *
 * This is intentionally not the interactive shell: navigation, search, logout
 * and page actions are absent because a fallback must not fetch or become
 * interactive before the route is ready.
 */
export function WorkspaceSkeletonShell({
  children,
  title,
  description,
  actions,
  className,
  contentClassName,
}: WorkspaceSkeletonShellProps) {
  return (
    <div
      data-workspace-theme="workspace"
      className={cn("ega-app-shell app-shell", className)}
      data-collapsed="false"
      aria-busy="true"
    >
      <aside
        className="ega-sidebar app-sidebar workspace-sidebar"
        aria-hidden="true"
        data-collapsed="false"
      >
        <div className="sidebar-brand workspace-sidebar-brand">
          <Skeleton className="sidebar-brand-logo" />
          <div className="workspace-brand-copy">
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-1.5 pt-2">
          {Array.from({ length: SIDEBAR_ROWS }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>

        <div className="mt-1 flex shrink-0 flex-col gap-1.5 border-t border-[var(--ega-border)] px-1.5 pt-2">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      </aside>

      <main className="app-main workspace-main">
        <div className="app-topbar" aria-hidden="true">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-7 w-24" />
        </div>

        <div className="app-page ega-shell-max">
          <header className="app-page-header">
            <div className="app-page-heading">
              {title ? (
                <h1 className="app-page-title">{title}</h1>
              ) : (
                <Skeleton className="h-8 w-48" />
              )}
              {description ? (
                <p className="app-page-description">{description}</p>
              ) : null}
            </div>
            {actions ? <div className="app-page-actions">{actions}</div> : null}
          </header>

          <div className={cn("app-content", contentClassName)}>{children}</div>
        </div>
      </main>
    </div>
  );
}
