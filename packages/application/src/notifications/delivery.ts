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

/** Read only documented typed FCM detail; generic google.rpc details are not token proof. */
function hasFcmTokenInvalidDetail(details: unknown): boolean {
  if (!Array.isArray(details)) return false;
  return details.some((detail) => {
    if (!detail || typeof detail !== "object") return false;
    const record = detail as Record<string, unknown>;
    return (
      record["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
      typeof record.errorCode === "string" &&
      VERIFIED_TOKEN_INVALID_CODES.has(record.errorCode.trim().toLowerCase())
    );
  });
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

  // Precedence matters: transient/auth evidence must win over any token-invalid
  // text. A 503 body that mentions a token is a retryable provider failure, not
  // proof that the endpoint is dead.
  const transient =
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599) ||
    code === "UNAVAILABLE" ||
    code === "INTERNAL" ||
    code === "DEADLINE_EXCEEDED" ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "ABORTED";
  if (transient) return "transient";

  // Auth/config failures: retrying will not fix a missing/rotated credential.
  // SENDER_ID_MISMATCH means the token belongs to another project; do not purge.
  const auth =
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
    code === "SENDER_ID_MISMATCH" ||
    code.includes("AUTH");
  if (auth) return "auth";

  // Endpoint invalidation requires verified token-invalid evidence. Exact
  // structured codes only: UNREGISTERED_PROJECT, UNREGISTERED_APP, or
  // `reason: "app unregistered"` must not match.
  const codeTokenInvalid = VERIFIED_TOKEN_INVALID_CODES.has(code.toLowerCase());
  const detailTokenInvalid = hasFcmTokenInvalidDetail(input.details);
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
