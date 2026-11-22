/**
 * Owner-visible project/goal scope used to validate a task write before it is
 * persisted. The web adapter fills it from the request-scoped client; the
 * application keeps the relationship rule so every transport rejects the same
 * cross-project goal.
 */
export type TaskScopeSnapshot = {
  projectIds: Set<string>;
  goalsById: Map<string, { id: string; project_id: string }>;
};

export type TaskInsertScopeRow = Readonly<{
  project_id: string;
  goal_id?: string | null;
}>;

export function getTaskInsertScopeError(
  row: TaskInsertScopeRow,
  scope: TaskScopeSnapshot,
) {
  if (!scope.projectIds.has(row.project_id)) {
    return "Selected project is unavailable.";
  }

  if (!row.goal_id) {
    return null;
  }

  const goal = scope.goalsById.get(row.goal_id);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (goal.project_id !== row.project_id) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}
