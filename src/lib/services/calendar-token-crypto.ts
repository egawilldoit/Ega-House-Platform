import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "v1";
const IV_BYTES = 12;

function getTokenEncryptionSecret() {
  return (
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    (process.env.NODE_ENV === "test" ? "calendar-token-test-key" : null) ||
    null
  );
}

function getEncryptionKey() {
  const secret = getTokenEncryptionSecret();
  if (!secret) {
    throw new Error(
      "Missing CALENDAR_TOKEN_ENCRYPTION_KEY or GOOGLE_CLIENT_SECRET for Calendar token encryption.",
    );
  }

  return createHash("sha256").update(secret).digest();
}

export function isEncryptedCalendarToken(value: string | null | undefined) {
  return Boolean(value?.startsWith(`${TOKEN_PREFIX}:`));
}

export function encryptCalendarToken(token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return normalizedToken;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizedToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptCalendarToken(token: string | null | undefined) {
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    return null;
  }

  if (!isEncryptedCalendarToken(normalizedToken)) {
    return normalizedToken;
  }

  const [, ivValue, tagValue, ciphertextValue] = normalizedToken.split(":");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Calendar token encryption payload is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
