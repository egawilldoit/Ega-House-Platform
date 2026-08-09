export type RepositoryFailure = Readonly<{
  code: "conflict" | "unknown";
}>;

export type RepositoryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RepositoryFailure }>;

export type ApplicationResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; errorMessage: string }>;

export function applicationSuccess<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

export function applicationFailure<T = never>(errorMessage: string): ApplicationResult<T> {
  return { ok: false, errorMessage };
}
