import type { ApplicationErrorCode } from "@ega/application";

/**
 * Transport codes for Money mutations. `CONFLICT` drives the edit form's
 * deliberate-reconciliation path; everything unexpected is `INTERNAL` with
 * the application message preserved alongside.
 */
export type ExpenseMutationErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INTERNAL";

export function mapApplicationCode(
  code: ApplicationErrorCode | undefined,
): ExpenseMutationErrorCode {
  if (code === "validation") return "VALIDATION";
  if (code === "notFound") return "NOT_FOUND";
  if (code === "conflict") return "CONFLICT";
  if (code === "forbidden") return "FORBIDDEN";
  return "INTERNAL";
}
