import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function MoneyLoading() {
  return (
    <WorkspaceSkeletonShell title="Money" description="Your personal expense ledger.">
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading expenses…</span>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-[var(--radius-md)]" />
        ))}
      </div>
    </WorkspaceSkeletonShell>
  );
}
