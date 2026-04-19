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

