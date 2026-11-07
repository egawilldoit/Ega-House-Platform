import type { NotificationTargetType } from "@ega/contracts";

export type WebNotificationTarget = Readonly<{
  type: NotificationTargetType;
  id: string | null;
}>;

/**
 * Maps a typed semantic notification target to a safe in-app href.
 *
 * The persisted target is never a raw router path. Entity ids are only
 * interpolated after a non-empty check, and unknown/unsupported targets fall
 * back to the notification center instead of guessing a route.
 */
export function getNotificationTargetHref(
  target: WebNotificationTarget | null,
): string {
  if (!target) {
    return "/notifications";
  }

  switch (target.type) {
    case "task": {
      const targetId = typeof target.id === "string" ? target.id.trim() : "";
      if (!targetId) return "/notifications";
      return `/tasks?view=all#task-${encodeURIComponent(targetId)}`;
    }
    case "timer":
      return "/timer";
    case "review":
      return "/review";
    case "today":
      return "/today";
    case "routine":
    case "money":
    default:
      // Their dedicated screens/cards do not exist on this baseline yet.
      return "/notifications";
  }
}
