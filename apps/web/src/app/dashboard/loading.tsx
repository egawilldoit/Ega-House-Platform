import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoadingPage() {
  return (
    <WorkspaceSkeletonShell
      title="Dashboard"
      description="Redirecting to Today."
    >
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </WorkspaceSkeletonShell>
  );
}
