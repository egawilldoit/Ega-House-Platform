import { FolderOpenDot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskToken } from "@/lib/task-domain";
import { formatTimerDateTime } from "@/lib/timer-domain";

import type { DashboardData, DashboardProjectStatus } from "../_lib/dashboard-data";

interface ProjectStateCardProps {
  projects: DashboardData["projectStatuses"];
  activeProjectCount: number;
  totalProjectCount: number;
}

function ProjectRow({ project }: { project: DashboardProjectStatus }) {
  return (
    <article className="ega-dashboard-mini-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
          {project.name}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
          Updated {formatTimerDateTime(project.updatedAt)}
        </p>
      </div>
      <StatusBadge status={project.status} label={formatTaskToken(project.status)} />
    </article>
  );
}

export function ProjectStateCard({ projects, activeProjectCount, totalProjectCount }: ProjectStateCardProps) {
  const projectItems = projects.data ?? [];

  return (
    <Card className="ega-glass">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Project State</p>
            <CardTitle className="mt-2 text-xl">Portfolio overview</CardTitle>
            <CardDescription>
              The current balance of active and total project records.
            </CardDescription>
          </div>
          <CardAction>
            <Badge tone="muted">
              {activeProjectCount} active / {totalProjectCount} total
            </Badge>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {projects.error ? (
          <div className="feedback-block feedback-block-error">{projects.error}</div>
        ) : projectItems.length > 0 ? (
          projectItems.slice(0, 5).map((project) => <ProjectRow key={project.id} project={project} />)
        ) : (
          <EmptyState
            icon={FolderOpenDot}
            title="No projects yet"
            description="Project records will appear here once they are created."
            actionLabel="Manage projects"
            actionHref="/tasks/projects"
          />
        )}
      </CardContent>
    </Card>
  );
}
