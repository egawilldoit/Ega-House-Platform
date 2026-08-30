import type { RepositoryFailure } from "@ega/application";

type SupabaseErrorLike = {
  code?: string;
  constraint?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export type McpOperationIdentity = Readonly<{
  mcpOperationId: string;
  mcpClientId: string;
}>;

export function mcpOperationIdentity(
  input: Readonly<{ mcpOperationId?: string | null; mcpClientId?: string | null }>,
): McpOperationIdentity | null {
  if (!input.mcpOperationId || !input.mcpClientId) return null;
  return {
    mcpOperationId: input.mcpOperationId,
    mcpClientId: input.mcpClientId,
  };
}

/**
 * Recognize one expected domain-fencing collision without turning unrelated
 * unique violations into successful replays.
 */
export function isSupabaseUniqueConstraintViolation(
  error: SupabaseErrorLike | null,
  constraintName: string,
): boolean {
  if (!error || error.code !== "23505") return false;

  return [error.constraint, error.message, error.details, error.hint]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes(constraintName));
}

/**
 * Translate a raw Supabase persistence error into the deliberately small,
 * persistence-independent failure set used by the application layer.
 *
 * A duplicate project slug is reported by PostgREST as SQLSTATE `23505`
 * (unique_violation). The owner+slug unique constraint name is included as a
 * message-level fallback because some PostgREST versions surface the
 * constraint name instead of a structured code.
 */
export function sanitizeSupabaseError(
  error: SupabaseErrorLike | null,
  options: { conflictCode?: string; conflictMessageHint?: string } = {},
): RepositoryFailure {
  const { conflictCode = "23505", conflictMessageHint = "" } = options;

  if (!error) {
    return { code: "unknown" };
  }

  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (code === conflictCode || (conflictMessageHint && message.includes(conflictMessageHint.toLowerCase()))) {
    return { code: "conflict" };
  }

  return { code: "unknown" };
}
