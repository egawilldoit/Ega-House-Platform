/** Matches the tasks.title varchar(256) column and the MCP task contract. */
export const TASK_TITLE_MAX = 256;
export const TASK_TITLE_LENGTH_ERROR = `Title must be ${TASK_TITLE_MAX} characters or fewer.`;

export function isTaskTitleWithinLimit(title: string) {
  return title.length <= TASK_TITLE_MAX;
}
