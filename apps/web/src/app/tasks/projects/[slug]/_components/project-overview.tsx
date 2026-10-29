import type {
  AreaRecord,
  EstimateVsActualAggregate,
  ProjectGoalRecord,
  ProjectProgressSummary,
  ProjectRecord,
} from "@ega/application";

import type { TaskActivityItem } from "@/lib/task-activity";
import type { ProjectComingUpItem, ProjectComingUpTask, ProjectTimeSummary } from "@/lib/project-overview";

import { ProjectAboutCard } from "./project-about-card";
import { ProjectActivityCard } from "./project-activity-card";
import { ProjectComingUp } from "./project-coming-up";
import { ProjectGoalsMilestones } from "./project-goals-milestones";
import { ProjectProgressCard } from "./project-progress-card";
import { ProjectTimeCard } from "./project-time-card";

type ProjectOverviewProps<T extends ProjectComingUpTask> = {
  project: ProjectRecord;
  goals: ProjectGoalRecord[];
  areas: AreaRecord[];
  progress: ProjectProgressSummary;
  comingUp: ProjectComingUpItem<T>[];
  timeSummary: ProjectTimeSummary;
  estimateVsActual: EstimateVsActualAggregate;
  activities: TaskActivityItem[];
  taskTitles: Map<string, string>;
  archivedTaskCount: number;
  projectIsArchived: boolean;
  timezone: string;
  returnTo: string;
  deleteHref: string;
  statusError: string | null;
  archiveError: string | null;
  areaError: string | null;
};

export function ProjectOverview<T extends ProjectComingUpTask>({
  project,
  goals,
  areas,
  progress,
  comingUp,
  timeSummary,
  estimateVsActual,
  activities,
  taskTitles,
  archivedTaskCount,
  projectIsArchived,
  timezone,
  returnTo,
  deleteHref,
  statusError,
  archiveError,
  areaError,
}: ProjectOverviewProps<T>) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectAboutCard
        project={project}
        goalsCount={goals.length}
        areas={areas}
        activeTaskCount={progress.totalTaskCount}
        completedTaskCount={progress.completedTaskCount}
        archivedTaskCount={archivedTaskCount}
        projectIsArchived={projectIsArchived}
        returnTo={returnTo}
        deleteHref={deleteHref}
        statusError={statusError}
        archiveError={archiveError}
        areaError={areaError}
      />
      <ProjectProgressCard
        projectId={project.id}
        progress={progress}
        archivedTaskCount={archivedTaskCount}
      />
      <ProjectGoalsMilestones goals={goals} />
      <ProjectComingUp items={comingUp} returnTo={returnTo} timezone={timezone} />
      <ProjectTimeCard
        summary={timeSummary}
        estimateVsActual={estimateVsActual}
        archivedTaskCount={archivedTaskCount}
      />
      <ProjectActivityCard items={activities} taskTitles={taskTitles} />
    </div>
  );
}
