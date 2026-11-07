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

function lowerText(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return "";
  }
}

export function classifyFcmError(input: {
  httpStatus?: number | null;
  fcmCode?: string | null;
  message?: string | null;
  /** Structured FCM `error.details`, searched for explicit token-invalid codes. */
  details?: unknown;
}): FcmErrorClassification {
  const code = (input.fcmCode ?? "").toUpperCase();
  const status = input.httpStatus ?? 0;
  const message = (input.message ?? "").toLowerCase();
  const details = lowerText(input.details);

  // Endpoint invalidation requires specific verified token-invalid evidence.
  // HTTP 404/410, generic NOT_FOUND, or SENDER_ID_MISMATCH alone are not proof.
  const detailTokenInvalid =
    details.includes("unregistered")
    || details.includes("registration_token_not_registered")
    || details.includes("registration-token-not-registered")
    || details.includes("invalid_registration")
    || details.includes("invalid-registration");
  const messageTokenInvalid =
    /registration token[^.]*(not (a )?valid|invalid|not registered|no longer valid|unregistered)/i.test(
      message,
    );
  const tokenText = `${message} ${details}`;
  const invalidArgumentTokenProof =
    code === "INVALID_ARGUMENT"
    && /registration token/i.test(tokenText)
    && /(not (a )?valid|invalid|not registered|no longer valid|unregistered)/i.test(tokenText);

  if (
    code === "UNREGISTERED"
    || code === "REGISTRATION_TOKEN_NOT_REGISTERED"
    || code === "INVALID_REGISTRATION"
    || code.includes("UNREGISTERED")
    || detailTokenInvalid
    || messageTokenInvalid
    || invalidArgumentTokenProof
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
