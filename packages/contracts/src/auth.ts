export const AUTH_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "SESSION_EXPIRED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * Platform-neutral identity produced only after an external authentication
 * authority has verified the current user/session/token.
 */
export type AuthenticatedIdentity = Readonly<{
  id: string;
  email: string | null;
}>;

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (
    typeof value === "string" &&
    (AUTH_ERROR_CODES as readonly string[]).includes(value)
  );
}
