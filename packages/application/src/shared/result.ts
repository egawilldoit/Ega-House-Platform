export type RepositoryFailure = Readonly<{
  code: "conflict" | "unknown";
}>;

export type RepositoryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RepositoryFailure }>;

export type ApplicationErrorCode = "conflict" | "validation" | "notFound" | "unknown";

export type ApplicationResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; errorMessage: string; code?: ApplicationErrorCode }>;

export function applicationSuccess<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

export function applicationFailure<T = never>(
  errorMessage: string,
  code?: ApplicationErrorCode,
): ApplicationResult<T> {
  return code ? { ok: false, errorMessage, code } : { ok: false, errorMessage };
}
