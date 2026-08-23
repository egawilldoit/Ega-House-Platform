// ── Forbidden path patterns for the security boundary ──

export const FORBIDDEN_PATH_PATTERNS = [
  { pattern: /^\/proxy(?:\/|$)/i, reason: 'Generic proxy — bypasses security boundary' },
  { pattern: /^\/hermes(?:\/|$)/i, reason: 'Direct Hermes Gateway exposure' },
  { pattern: /^\/shell(?:\/|$)/i, reason: 'Shell execution' },
  { pattern: /^\/exec(?:\/|$)/i, reason: 'Command execution' },
  { pattern: /^\/command(?:\/|$)/i, reason: 'Arbitrary command' },
  { pattern: /^\/arbitrary[-_]url(?:\/|$)/i, reason: 'Arbitrary URL fetch' },
  { pattern: /^\/graphql(?:\/|$)/i, reason: 'GraphQL introspection' },
  { pattern: /^\/debug(?:\/|$)/i, reason: 'Debug endpoints' },
  { pattern: /^\/_internal(?:\/|$)/i, reason: 'Internal-only routes' },
];

export function isPathForbidden(path: string): { forbidden: boolean; reason?: string } {
  for (const entry of FORBIDDEN_PATH_PATTERNS) {
    if (entry.pattern.test(path)) {
      return { forbidden: true, reason: entry.reason };
    }
  }
  return { forbidden: false };
}
