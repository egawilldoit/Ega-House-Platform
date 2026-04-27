type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function includesTableName(text: string, table: string) {
  const normalizedText = text.toLowerCase();
  const normalizedTable = table.toLowerCase();
  return (
    normalizedText.includes(normalizedTable) ||
    normalizedText.includes(normalizedTable.replace("public.", ""))
  );
}

export function isMissingSupabaseTable(
  error: SupabaseErrorLike | null | undefined,
  table: string,
) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  const diagnostic = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (diagnostic.length === 0) {
    return false;
  }

  const normalized = diagnostic.toLowerCase();
  return (
    normalized.includes("could not find the table") && includesTableName(normalized, table)
  );
}

export function isMissingSupabaseColumn(
  error: SupabaseErrorLike | null | undefined,
  table: string,
  column: string,
) {
  if (!error) {
    return false;
  }

  const diagnostic = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (diagnostic.length === 0) {
    return false;
  }

  const normalized = diagnostic.toLowerCase();
  const referencesTarget =
    includesTableName(normalized, table) && normalized.includes(column.toLowerCase());
  if (!referencesTarget) {
    return false;
  }

  if (error.code === "42703" || error.code === "PGRST204") {
    return true;
  }

  return (
    normalized.includes("does not exist") ||
      normalized.includes("could not find the") ||
      normalized.includes("schema cache")
  );
}

export function isMissingTasksBlockedReasonColumn(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingSupabaseColumn(error, "public.tasks", "blocked_reason");
}

export function isMissingTasksArchivedAtColumn(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingSupabaseColumn(error, "public.tasks", "archived_at");
}

export function isMissingTasksCompletedAtColumn(
  error: SupabaseErrorLike | null | undefined,
) {
  return isMissingSupabaseColumn(error, "public.tasks", "completed_at");
}
