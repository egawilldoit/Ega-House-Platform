import type { NotificationTargetType } from "@ega/contracts";

export type WebNotificationTarget = Readonly<{
  type: NotificationTargetType;
  id: string | null;
}>;

/**
 * Maps a typed semantic notification target to a safe in-app href.
 *
 * The persisted target is never a raw router path. Entity ids are only
 * interpolated after a non-empty check. Targets without a dedicated screen
 * return `null` so the bell popover keeps them in place instead of guessing a
 * route or navigating to a retired notification page.
 */
export function getNotificationTargetHref(
  target: WebNotificationTarget | null,
): string | null {
  if (!target) return null;

  switch (target.type) {
    case "task": {
      const targetId = typeof target.id === "string" ? target.id.trim() : "";
      if (!targetId) return null;
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
      return null;
  }
}
