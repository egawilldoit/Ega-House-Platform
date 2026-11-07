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

export function classifyFcmError(input: {
  httpStatus?: number | null;
  fcmCode?: string | null;
  message?: string | null;
}): FcmErrorClassification {
  const code = (input.fcmCode ?? "").toUpperCase();
  const status = input.httpStatus ?? 0;

  // Terminal endpoint failures: the token/registration no longer exists.
  // 404/410 without a code still means the endpoint is gone.
  if (
    status === 404 ||
    status === 410 ||
    code === "UNREGISTERED" ||
    code === "INVALID_ARGUMENT" ||
    code === "SENDER_ID_MISMATCH" ||
    code === "REGISTRATION_TOKEN_NOT_REGISTERED" ||
    code === "INVALID_TOKEN" ||
    code === "NOT_FOUND" ||
    code.includes("UNREGISTERED") ||
    code.includes("INVALID_REGISTRATION") ||
    code.includes("INVALID_TOKEN")
  ) {
    return "invalid_endpoint";
  }

  // Auth/config failures are permanent for this attempt (retrying will not fix
  // a missing/rotated service credential without operator action).
  if (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
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

  // Other 4xx client errors are permanent for this endpoint/payload.
  if (status >= 400 && status < 500) {
    return "permanent";
  }

  // Unknown codes are not safe to retry indefinitely; treat them permanently.
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
