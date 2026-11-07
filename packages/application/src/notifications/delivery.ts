import type { NotificationDeliveryMode, NotificationType } from "@ega/contracts";

export type DeliveryChannelPair = Readonly<{
  push: boolean;
  email: boolean;
}>;

export function resolveDeliveryChannels(args: {
  deliveryMode: NotificationDeliveryMode;
  preferences: Readonly<{ pushEnabled: boolean; emailEnabled: boolean }> | null;
}): DeliveryChannelPair {
  const fallback = { pushEnabled: true, emailEnabled: true };
  const pref = args.preferences ?? fallback;

  const mode = args.deliveryMode;

  const wantsPush = mode === "push" || mode === "both";
  const wantsEmail = mode === "email" || mode === "both";

  return {
    push: wantsPush && pref.pushEnabled,
    email: wantsEmail && pref.emailEnabled,
  };
}

export const MAX_DELIVERY_ATTEMPTS = 5;

export function nextRetryAt(attempt: number, now: Date): string | null {
  if (attempt > MAX_DELIVERY_ATTEMPTS) return null;
  // Exponential backoff: 1m, 2m, 4m, 8m, 16m
  const minutes = Math.pow(2, attempt - 1);
  const ms = minutes * 60 * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

export type FcmErrorClassification = "invalid_endpoint" | "transient" | "permanent" | "auth";

const VERIFIED_TOKEN_INVALID_CODES = new Set([
  "unregistered",
  "registration_token_not_registered",
  "registration-token-not-registered",
  "invalid_registration",
  "invalid-registration",
]);

/** Extract structured errorCode/reason/code values; never substring-match details. */
function collectDetailCodes(details: unknown): string[] {
  const codes: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["errorCode", "error_code", "reason", "code"]) {
        const candidate = record[key];
        if (typeof candidate === "string") codes.push(candidate.trim().toLowerCase());
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === "object") visit(nested, depth + 1);
      }
    }
  };
  visit(details);
  return codes;
}

/**
 * Anchored proof: the registration token itself must be described as invalid.
 * "The registration token is valid; the message payload is invalid." must not
 * match.
 */
const TOKEN_INVALID_MESSAGE_RE =
  /registration token\s+(?:is|was)?\s*(?:not\s+(?:a\s+)?valid|invalid|not\s+registered|no longer valid|unregistered)\b/i;

export function classifyFcmError(input: {
  httpStatus?: number | null;
  fcmCode?: string | null;
  message?: string | null;
  /** Structured FCM `error.details`, searched only by exact structured codes. */
  details?: unknown;
}): FcmErrorClassification {
  const code = (input.fcmCode ?? "").toUpperCase();
  const status = input.httpStatus ?? 0;
  const message = input.message ?? "";

  // Endpoint invalidation requires verified token-invalid evidence. Exact
  // structured codes only: UNREGISTERED_PROJECT, UNREGISTERED_APP, or
  // `reason: "app unregistered"` must not match.
  const codeTokenInvalid = VERIFIED_TOKEN_INVALID_CODES.has(code.toLowerCase());
  const detailTokenInvalid = collectDetailCodes(input.details).some((candidate) =>
    VERIFIED_TOKEN_INVALID_CODES.has(candidate),
  );
  const messageTokenInvalid = TOKEN_INVALID_MESSAGE_RE.test(message);
  const invalidArgumentTokenProof =
    code === "INVALID_ARGUMENT" && (messageTokenInvalid || detailTokenInvalid);

  if (
    codeTokenInvalid ||
    detailTokenInvalid ||
    messageTokenInvalid ||
    invalidArgumentTokenProof
  ) {
    return "invalid_endpoint";
  }

  // Auth/config failures: retrying will not fix a missing/rotated credential.
  // SENDER_ID_MISMATCH means the token belongs to another project; do not purge.
  if (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
    code === "SENDER_ID_MISMATCH" ||
    code.includes("AUTH")
  ) {
    return "auth";
  }

  // Transient: 408, 429, 5xx, UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED,
  // RESOURCE_EXHAUSTED, ABORTED
  if (
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599) ||
    code === "UNAVAILABLE" ||
    code === "INTERNAL" ||
    code === "DEADLINE_EXCEEDED" ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "ABORTED"
  ) {
    return "transient";
  }

  // Other 4xx client errors (bare 404/410, NOT_FOUND, malformed INVALID_ARGUMENT)
  // are permanent/config for this attempt but do not prove the token is stale.
  if (status >= 400 && status < 500) {
    return "permanent";
  }

  // Unknown codes are not safe to retry indefinitely; never deactivate.
  if (code) return "permanent";

  // Network/unknown status: prefer a bounded retry.
  return "transient";
}

export function shouldDeactivateDevice(classification: FcmErrorClassification): boolean {
  return classification === "invalid_endpoint";
}

export function buildPushDataPayload(input: {
  notificationId: string;
  type: NotificationType;
  targetType: string | null;
  targetId: string | null;
}): Record<string, string> {
  const data: Record<string, string> = {
    notificationId: input.notificationId,
    type: input.type,
  };
  if (input.targetType) data.targetType = input.targetType;
  if (input.targetId) data.targetId = input.targetId;
  // Ensure all values are strings for FCM data payload
  return data;
}
