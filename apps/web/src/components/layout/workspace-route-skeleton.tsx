import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { WorkspaceSkeletonShell } from "./workspace-skeleton-shell";

/**
 * Data-free skeleton for workspace routes that do not need a bespoke shape.
 * Mirrors the shell geometry and a single content card without reading data.
 */
export function WorkspaceRouteSkeleton({
  title,
  description,
  rows = 4,
}: {
  title: string;
  description?: string;
  rows?: number;
}) {
  return (
    <WorkspaceSkeletonShell title={title} description={description}>
      <Card clip>
        <div className="flex flex-col gap-3 border-b border-[var(--ega-divider)] px-[18px] py-3">
          <Skeleton className="h-5 w-48 max-w-full" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div>
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-[var(--ega-divider)] px-3.5 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-36 max-w-full" />
              </div>
              <Skeleton className="h-7 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </WorkspaceSkeletonShell>
  );
}
