/**
 * Shared state shape for drawer text-field saves.
 *
 * Kept outside the server-action module so client editors (and their tests) do
 * not import the whole action graph just to read the empty state.
 */
export type TaskFieldDraftState = {
  errorMessage: string | null;
  successMessage: string | null;
  /** The value the server accepted, so the editor can reset its dirty baseline. */
  savedValue: string | null;
};

export const EMPTY_TASK_FIELD_DRAFT_STATE: TaskFieldDraftState = {
  errorMessage: null,
  successMessage: null,
  savedValue: null,
};
