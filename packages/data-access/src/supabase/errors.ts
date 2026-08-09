import type { RepositoryFailure } from "@ega/application";

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

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
