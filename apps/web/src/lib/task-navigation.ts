/**
 * Canonical deep-link to a Task inside its Project context.
 *
 * Task routes are project-scoped: `/tasks/projects/[slug]#task-[id]` opens the
 * exact Task in its project. When no project slug is known the link falls back
 * to the generic Tasks surface rather than guessing a context.
 */
export function getTaskContextHref(
  taskId: string,
  projectSlug: string | null | undefined,
): string {
  if (!projectSlug) {
    return "/tasks";
  }

  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}
