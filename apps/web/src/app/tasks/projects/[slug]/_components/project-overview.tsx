import type {
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
  progress: ProjectProgressSummary;
  comingUp: ProjectComingUpItem<T>[];
  timeSummary: ProjectTimeSummary;
  activities: TaskActivityItem[];
  taskTitles: Map<string, string>;
  archivedTaskCount: number;
  projectIsArchived: boolean;
  returnTo: string;
  deleteHref: string;
  statusError: string | null;
  archiveError: string | null;
};

export function ProjectOverview<T extends ProjectComingUpTask>({
  project,
  goals,
  progress,
  comingUp,
  timeSummary,
  activities,
  taskTitles,
  archivedTaskCount,
  projectIsArchived,
  returnTo,
  deleteHref,
  statusError,
  archiveError,
}: ProjectOverviewProps<T>) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectAboutCard
        project={project}
        goalsCount={goals.length}
        activeTaskCount={progress.totalTaskCount}
        completedTaskCount={progress.completedTaskCount}
        archivedTaskCount={archivedTaskCount}
        projectIsArchived={projectIsArchived}
        returnTo={returnTo}
        deleteHref={deleteHref}
        statusError={statusError}
        archiveError={archiveError}
      />
      <ProjectProgressCard
        projectId={project.id}
        progress={progress}
        archivedTaskCount={archivedTaskCount}
      />
      <ProjectGoalsMilestones goals={goals} />
      <ProjectComingUp items={comingUp} returnTo={returnTo} />
      <ProjectTimeCard summary={timeSummary} archivedTaskCount={archivedTaskCount} />
      <ProjectActivityCard items={activities} taskTitles={taskTitles} />
    </div>
  );
}
