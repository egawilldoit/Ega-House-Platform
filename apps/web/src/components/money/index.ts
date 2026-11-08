/**
 * Team B mutation kit public surface (PO-06B).
 *
 * Self-contained create/edit/soft-delete components plus the integer-safe MAD
 * helpers they share. No page, route, navigation or list coupling: Team A
 * composes these into the Money page with server-wired handlers.
 */
export { ExpenseCreateForm } from "./expense-create-form";
export type {
  ExpenseCreateFormProps,
  ExpenseCreateSubmitInput,
  ExpenseCreateSubmitResult,
} from "./expense-create-form";
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
