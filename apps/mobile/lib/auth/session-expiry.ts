/**
 * Single canonical session near-expiry policy.
 *
 * Both the auth bootstrap (`auth-context`) and the foreground resume refresh
 * (`lib/lifecycle/resume-refresh`) decide "should we refresh proactively?"
 * from this helper. Keep the 45-second buffer here only — duplicating it
 * lets the two paths disagree on what "near expiry" means.
 */
export const SESSION_REFRESH_BUFFER_SECONDS = 45;

export function isSessionNearExpiry(
  expiresAtSeconds: number,
  nowSeconds: number,
  bufferSeconds: number = SESSION_REFRESH_BUFFER_SECONDS
): boolean {
  return expiresAtSeconds <= nowSeconds + bufferSeconds;
}
