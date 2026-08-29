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

  // Invalid/unregistered token
  if (
    code === "UNREGISTERED" ||
    code === "INVALID_ARGUMENT" ||
    code === "SENDER_ID_MISMATCH" ||
    code.includes("UNREGISTERED") ||
    code.includes("INVALID_REGISTRATION")
  ) {
    return "invalid_endpoint";
  }

  // Auth/config failures
  if (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
    code.includes("AUTH")
  ) {
    return "auth";
  }

  // Transient: 429, 5xx, UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "UNAVAILABLE" ||
    code === "INTERNAL" ||
    code === "DEADLINE_EXCEEDED" ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "ABORTED"
  ) {
    return "transient";
  }

  // 4xx client errors that are not invalid token are permanent
  if (status >= 400 && status < 500) {
    return "permanent";
  }

  // Unknown but map codes like NOT_FOUND for token? treat as invalid
  if (code === "NOT_FOUND") return "invalid_endpoint";

  // Fallback: treat as transient for retry if unknown, or permanent?
  // We prefer transient for safety unless explicitly invalid.
  if (code) return "permanent";

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
