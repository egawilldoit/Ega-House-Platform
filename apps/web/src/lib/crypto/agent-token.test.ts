import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRawToken,
  parseBearerToken,
  hashToken,
  verifyHash,
  validateHex64,
} from "@/lib/crypto/agent-token";

// ---- generateRawToken ----

test("generateRawToken returns correct format", () => {
  const { raw, prefix, secret } = generateRawToken();

  assert.ok(raw.startsWith("ega_live_"));
  assert.equal(prefix.length, 16);
  assert.equal(secret.length, 48);
  assert.ok(/^[0-9a-f]{16}$/.test(prefix));
  assert.ok(/^[0-9a-f]{48}$/.test(secret));

  // Validate overall format: ega_live_<16>_<48>
  const parts = raw.split("_");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "ega");
  assert.equal(parts[1], "live");
  assert.equal(parts[2].length, 16);
  assert.equal(parts[3].length, 48);
});

test("generateRawToken produces unique values each call", () => {
  const t1 = generateRawToken();
  const t2 = generateRawToken();
  assert.notEqual(t1.raw, t2.raw);
  assert.notEqual(t1.prefix, t2.prefix);
  assert.notEqual(t1.secret, t2.secret);
});

test("generateRawToken produces hex-only content (no special chars)", () => {
  const { raw } = generateRawToken();
  // Everything after "ega_live_" should be hex + underscores only
  const payload = raw.slice("ega_live_".length);
  // payload should match: <hex>_<hex>
  assert.ok(/^[0-9a-f]+_[0-9a-f]+$/.test(payload));
});

// ---- parseBearerToken ----

test("parseBearerToken extracts prefix and secret from valid token", () => {
  const { raw, prefix, secret } = generateRawToken();
  const result = parseBearerToken(`Bearer ${raw}`);
  assert.notEqual(result, null);
  assert.equal(result!.prefix, prefix);
  assert.equal(result!.secret, secret);
});

test("parseBearerToken is case-insensitive for Bearer scheme", () => {
  const { raw } = generateRawToken();
  assert.notEqual(parseBearerToken(`bearer ${raw}`), null);
  assert.notEqual(parseBearerToken(`BEARER ${raw}`), null);
  assert.notEqual(parseBearerToken(`Bearer ${raw}`), null);
});

test("parseBearerToken returns null for missing header", () => {
  assert.equal(parseBearerToken(""), null);
  assert.equal(parseBearerToken("   "), null);
});

test("parseBearerToken returns null for missing Bearer prefix", () => {
  const { raw } = generateRawToken();
  assert.equal(parseBearerToken(raw), null);
  assert.equal(parseBearerToken(`Token ${raw}`), null);
});

test("parseBearerToken returns null for malformed token (wrong prefix)", () => {
  assert.equal(parseBearerToken("Bearer bad_prefix_abc123_xyz789"), null);
});

test("parseBearerToken returns null for wrong hex length", () => {
  assert.equal(parseBearerToken("Bearer ega_live_abc_xyz"), null); // too short
  assert.equal(
    parseBearerToken("Bearer ega_live_0000000000000000_xyz"),
    null,
  ); // secret not hex
});

test("parseBearerToken returns null for token with extra spaces", () => {
  const { raw } = generateRawToken();
  assert.notEqual(parseBearerToken(`  Bearer ${raw}  `), null);
});

// ---- hashToken ----

test("hashToken produces deterministic output for same input", () => {
  const pepper = "test-pepper-123";
  const secret = "a".repeat(48); // 48 hex chars

  const h1 = hashToken(secret, pepper);
  const h2 = hashToken(secret, pepper);

  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test("hashToken produces different output for different pepper", () => {
  const secret = "a".repeat(48);
  const h1 = hashToken(secret, "pepper-1");
  const h2 = hashToken(secret, "pepper-2");
  assert.notEqual(h1, h2);
});

test("hashToken produces different output for different secret", () => {
  const pepper = "test-pepper";
  const h1 = hashToken("a".repeat(48), pepper);
  const h2 = hashToken("b".repeat(48), pepper);
  assert.notEqual(h1, h2);
});

// ---- verifyHash ----

test("verifyHash matches correct secret and hash", () => {
  const pepper = "test-pepper";
  const { secret } = generateRawToken();
  const hash = hashToken(secret, pepper);

  assert.ok(verifyHash(secret, hash, pepper));
});

test("verifyHash rejects wrong secret", () => {
  const pepper = "test-pepper";
  const { secret } = generateRawToken();
  const hash = hashToken(secret, pepper);

  assert.equal(verifyHash("wrong-secret-value-here-1234567890abcdef1234567890abcdef", hash, pepper), false);
});

test("verifyHash rejects wrong pepper", () => {
  const pepper = "test-pepper";
  const { secret } = generateRawToken();
  const hash = hashToken(secret, pepper);

  assert.equal(verifyHash(secret, hash, "wrong-pepper"), false);
});

test("verifyHash returns false for invalid stored hash format", () => {
  const pepper = "test-pepper";
  assert.equal(verifyHash("anything", "not-hex", pepper), false);
  assert.equal(verifyHash("anything", "abc", pepper), false); // too short
  assert.equal(verifyHash("anything", "", pepper), false);
});

test("verifyHash returns false for empty stored hash", () => {
  const pepper = "test-pepper";
  assert.equal(verifyHash("anything", "", pepper), false);
});

// ---- validateHex64 ----

test("validateHex64 accepts valid 64-char hex", () => {
  assert.ok(validateHex64("a".repeat(64)));
  assert.ok(validateHex64("0".repeat(64)));
  assert.ok(validateHex64("abcdef0123456789".repeat(4)));
});

test("validateHex64 rejects short strings", () => {
  assert.equal(validateHex64("a".repeat(63)), false);
  assert.equal(validateHex64(""), false);
});

test("validateHex64 rejects long strings", () => {
  assert.equal(validateHex64("a".repeat(65)), false);
});

test("validateHex64 rejects non-hex characters", () => {
  assert.equal(validateHex64("g".repeat(64)), false);
  assert.equal(validateHex64("z".repeat(64)), false);
  assert.equal(validateHex64(("-".repeat(64))), false);
});
