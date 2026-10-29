import "server-only";

import {
  createTaskCommentAction,
  deleteTaskCommentAction,
  toggleTaskCommentReactionAction,
  updateTaskCommentAction,
} from "@/app/tasks/comment-actions";

/** Server action bundle for the drawer comments tab. */
export const TASK_COMMENT_ACTIONS = {
  createAction: createTaskCommentAction,
  updateAction: updateTaskCommentAction,
  deleteAction: deleteTaskCommentAction,
  toggleReactionAction: toggleTaskCommentReactionAction,
} as const;

export type TaskCommentActionBundle = typeof TASK_COMMENT_ACTIONS;
