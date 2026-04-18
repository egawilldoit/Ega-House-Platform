import { toCsvDocument } from "@/lib/csv";
import { getTaskSessionDurationSeconds } from "@/lib/task-session";

type TimerExportRow = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  tasks:
    | {
        title: string | null;
        status: string | null;
        priority: string | null;
        goals: { title: string | null } | null;
        projects: { name: string | null; slug: string | null } | null;
      }
    | null;
};

export function buildTimerExportCsv(rows: TimerExportRow[], nowIso?: string) {
  const resolvedNowIso = nowIso ?? new Date().toISOString();

  return toCsvDocument(
    [
      "session_id",
      "task_id",
      "task_title",
      "task_status",
      "task_priority",
      "goal_title",
      "project_name",
      "project_slug",
      "started_at",
      "ended_at",
      "duration_seconds",
      "created_at",
      "updated_at",
    ],
    rows.map((row) => [
      row.id,
      row.task_id,
      row.tasks?.title ?? "Untitled task",
      row.tasks?.status,
      row.tasks?.priority,
      row.tasks?.goals?.title,
      row.tasks?.projects?.name,
      row.tasks?.projects?.slug,
      row.started_at,
      row.ended_at,
      getTaskSessionDurationSeconds(row, resolvedNowIso),
      row.created_at,
      row.updated_at,
    ]),
  );
}
