import "server-only";

import {
  addSubtaskAction,
  deleteSubtaskAction,
  moveSubtaskAction,
  promoteSubtaskAction,
  renameSubtaskAction,
  toggleSubtaskAction,
} from "@/app/tasks/actions";

/** Server action bundle for the drawer checklist; pages pass it to the client host. */
export const TASK_SUBTASK_ACTIONS = {
  addAction: addSubtaskAction,
  toggleAction: toggleSubtaskAction,
  renameAction: renameSubtaskAction,
  deleteAction: deleteSubtaskAction,
  moveAction: moveSubtaskAction,
  promoteAction: promoteSubtaskAction,
} as const;
