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

/**
 * Data-free fallback for authenticated route `loading.tsx` boundaries.
 *
 * Route `loading.tsx` renders *inside* `(workspace)/layout.tsx`, which owns the
 * single persistent sidebar/top bar. A fallback therefore must never paint a
 * second shell frame: it fills the content column only, so the real chrome
 * stays mounted and usable while the route resolves.
 *
 * It performs no authentication, Supabase, or application-service reads.
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
      data-workspace-route-loading
      aria-busy="true"
      className={cn("app-page-content", className)}
    >
      <header className="app-page-header">
        <div className="app-page-heading">
          {title ? (
            <h1 className="app-page-title">{title}</h1>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
          {description ? (
            <p className="app-page-description">{description}</p>
          ) : (
            <Skeleton className="mt-1 h-4 w-72 max-w-full" />
          )}
        </div>
        {actions ? <div className="app-page-actions">{actions}</div> : null}
      </header>

      <div className={cn("app-content", contentClassName)}>{children}</div>
    </div>
  );
}
