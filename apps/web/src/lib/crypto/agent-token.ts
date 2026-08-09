// Pure crypto functions — zero project imports, zero side effects.
// All dependencies are Node.js built-ins.

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

// ---- Constants ----

const APPLICATION_PREFIX = "ega";
const PURPOSE_PREFIX = "live";
const SEPARATOR = "_";
const PREFIX_BYTES = 8;
const SECRET_BYTES = 24;
const HMAC_ALGORITHM = "sha256";
const HEX64_RE = /^[0-9a-f]{64}$/;
const HEX16_RE = /^[0-9a-f]{16}$/;
const HEX48_RE = /^[0-9a-f]{48}$/;

// ---- Types ----

export type RawToken = {
  raw: string;
  prefix: string;
  secret: string;
};

export type ParsedBearerToken = {
  prefix: string;
  secret: string;
};

/**
 * Generate a new raw agent token.
 * Format: ega_live_<16-hex-prefix>_<48-hex-secret>
 * Hex encoding is used because it contains no '_' or '-' characters,
 * avoiding conflicts with the token format separators.
 */
export function generateRawToken(): RawToken {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  const raw = [APPLICATION_PREFIX, PURPOSE_PREFIX, prefix, secret].join(
    SEPARATOR,
  );

  return { raw, prefix, secret };
}

/**
 * Parse a bearer token from an Authorization header value.
 * Accepts case-insensitive "Bearer " prefix.
 * Validates the token format strictly.
 */
export function parseBearerToken(
  headerValue: string,
): ParsedBearerToken | null {
  const trimmed = headerValue.trim();
  const bearerPrefix = "Bearer ";

  if (trimmed.length <= bearerPrefix.length) return null;

  const scheme = trimmed.slice(0, bearerPrefix.length);
  if (scheme.toLowerCase() !== bearerPrefix.toLowerCase()) return null;

  const token = trimmed.slice(bearerPrefix.length).trim();
  if (!token) return null;

  // Split by separator from the right — the last two segments are prefix and secret
  const lastSep = token.lastIndexOf(SEPARATOR);
  if (lastSep === -1) return null;

  const secret = token.slice(lastSep + 1);
  const beforeSecret = token.slice(0, lastSep);

  const secondLastSep = beforeSecret.lastIndexOf(SEPARATOR);
  if (secondLastSep === -1) return null;

  const prefix = beforeSecret.slice(secondLastSep + 1);
  const appAndPurpose = beforeSecret.slice(0, secondLastSep);

  // Validate application and purpose prefixes
  const expectedPrefix = [APPLICATION_PREFIX, PURPOSE_PREFIX].join(SEPARATOR);
  if (appAndPurpose !== expectedPrefix) return null;

  // Validate hex content
  if (!HEX16_RE.test(prefix)) return null;
  if (!HEX48_RE.test(secret)) return null;

  return { prefix, secret };
}

/**
 * Compute HMAC-SHA256 hash of the hex-encoded secret using the server pepper.
 * Input is the 48-character hex string (UTF-8 bytes), NOT decoded binary.
 * This is the canonical HMAC input representation.
 */
export function hashToken(hexSecret: string, pepper: string): string {
  const hmac = createHmac(HMAC_ALGORITHM, pepper);
  hmac.update(hexSecret);
  return hmac.digest("hex");
}

/**
 * Verify a secret against a stored HMAC hash.
 * Both sides must be 64-character hex strings (32 bytes SHA-256 output).
 * Returns false (does not throw) if the stored hash format is invalid.
 */
export function verifyHash(
  hexSecret: string,
  storedHexDigest: string,
  pepper: string,
): boolean {
  if (!HEX64_RE.test(storedHexDigest)) return false;

  const computedDigest = hashToken(hexSecret, pepper);
  const computedBuf = Buffer.from(computedDigest, "hex");
  const storedBuf = Buffer.from(storedHexDigest, "hex");

  // Both buffers are guaranteed 32 bytes because we validated both lengths
  // computedDigest is always valid hex (our own output)
  // storedHexDigest passed HEX64_RE above
  try {
    return timingSafeEqual(computedBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Validate that a string is exactly 64 hex characters (SHA-256 hex digest).
 */
export function validateHex64(s: string): boolean {
  return HEX64_RE.test(s);
}
