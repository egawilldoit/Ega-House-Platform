export type WebNotificationTarget = Readonly<{
  type: "task";
  id: string;
}>;

export function getNotificationTargetHref(
  target: WebNotificationTarget | null,
): string {
  const targetId = target?.id.trim();

  if (!targetId) {
    return "/notifications";
  }

  return `/tasks?view=all#task-${encodeURIComponent(targetId)}`;
}
