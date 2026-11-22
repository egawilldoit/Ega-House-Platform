import type { ValidateTaskInlineUpdateInput } from "./write-policy";

/**
 * Fields the task drawer may patch one at a time.
 *
 * Deliberately narrow: project/goal, recurrence, reminders and scheduling keep
 * their dedicated services because they carry side effects a generic patch must
 * not bypass.
 */
export const TASK_FIELD_PATCH_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "project",
  "startDate",
  "dueDate",
  "plannedDate",
  "estimateMinutes",
  "blockedReason",
] as const;

export type TaskFieldPatchField = (typeof TASK_FIELD_PATCH_FIELDS)[number];

export function isTaskFieldPatchField(value: string): value is TaskFieldPatchField {
  return (TASK_FIELD_PATCH_FIELDS as readonly string[]).includes(value);
}

/** The current values a single-field patch must carry forward unchanged. */
export type TaskFieldPatchCurrent = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  project_id: string;
  start_date: string | null;
  due_date: string | null;
  planned_for_date: string | null;
  estimate_minutes: number | null;
  blocked_reason: string | null;
};

/**
 * Merge one changed field into the task's current values.
 *
 * `validateTaskInlineUpdateInput` requires status/priority/due/estimate/blocked
 * together, so a single-field patch cannot forward only the changed field. The
 * current values come from the server-side row, never from hidden client fields,
 * so an unrelated stale field can never be written back.
 */
export function buildTaskFieldPatchInput(
  taskId: string,
  current: TaskFieldPatchCurrent,
  field: string,
  value: string,
): { errorMessage: null; input: ValidateTaskInlineUpdateInput } | { errorMessage: string } {
  if (!isTaskFieldPatchField(field)) {
    return { errorMessage: "Unsupported task field update." };
  }

  const input: ValidateTaskInlineUpdateInput = {
    taskId,
    // Carried only when the patch targets it: `updateTaskInline` rewrites every
    // field it receives, and a priority/due edit must not touch the title.
    title: field === "title" ? value : undefined,
    // Same rule as the title: only a description edit carries a description, so
    // a status/priority patch can never overwrite text the drawer did not show.
    description: field === "description" ? value : undefined,
    status: current.status,
    priority: current.priority,
    startDate: current.start_date ?? "",
    dueDate: current.due_date ?? "",
    // Carried only for a planned-date patch: `updateTaskInline` writes every
    // field it receives, so unrelated patches must leave the date untouched.
    plannedForDate: field === "plannedDate" ? value : undefined,
    estimateMinutes: current.estimate_minutes,
    blockedReason: current.blocked_reason,
  };

  if (field === "status") input.status = value;
  if (field === "priority") input.priority = value;
  if (field === "project") {
    input.projectId = value;
    // The goal must belong to the selected project. Match the bulk path by
    // clearing it only when the project actually changes.
    if (value !== current.project_id) input.goalId = "";
  }
  if (field === "startDate") input.startDate = value;
  if (field === "dueDate") input.dueDate = value;
  if (field === "plannedDate") input.plannedForDate = value;
  if (field === "estimateMinutes") input.estimateMinutes = value;
  if (field === "blockedReason") input.blockedReason = value;

  return { errorMessage: null, input };
}
