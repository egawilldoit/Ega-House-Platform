/**
 * Team B mutation kit public surface (PO-06B).
 *
 * Self-contained edit/soft-delete components plus the integer-safe MAD helpers
 * they share. The primary Money quick entry owns creation through the shared
 * movement use case; Today still mounts its own quick expense sheet.
 */
export { ExpenseEditForm } from "./expense-edit-form";
export type {
  ExpenseEditFormProps,
  ExpenseEditSubmitResult,
} from "./expense-edit-form";
export { DeleteExpenseControl } from "./delete-expense-control";
export type {
  DeleteExpenseControlProps,
  ExpenseDeleteResult,
} from "./delete-expense-control";
export { useStableIdempotencyKey } from "./use-stable-expense-key";
