/** Wire shape for a task checklist item (EGA-782). */
export type SubtaskDto = {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubtaskListResponse = {
  ok: true;
  subtasks: SubtaskDto[];
};

export const SUBTASK_TITLE_MAX_LENGTH = 256;
