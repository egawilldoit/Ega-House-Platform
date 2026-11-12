export type RepositoryFailure = Readonly<{
  code: "conflict" | "unknown" | "notFound" | "forbidden" | "validation";
}>;

export type RepositoryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RepositoryFailure }>;

export type ApplicationErrorCode =
  | "conflict"
  | "validation"
  | "notFound"
  | "forbidden"
  | "unknown";

export type ApplicationResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{
      ok: false;
      errorMessage: string;
      code?: ApplicationErrorCode;
      /**
       * Stable machine-readable discrimination for callers that must map a
       * specific validation failure (for example an export row-budget refusal)
       * without matching human text.
       */
      reason?: string;
    }>;

export function applicationSuccess<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

export function applicationFailure<T = never>(
  errorMessage: string,
  code?: ApplicationErrorCode,
  reason?: string,
): ApplicationResult<T> {
  if (!code) return { ok: false, errorMessage };
  return reason
    ? { ok: false, errorMessage, code, reason }
    : { ok: false, errorMessage, code };
}
