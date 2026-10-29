/** Pure view and selection rules for the notifications inbox. */

export type NotificationInboxRow = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  createdAtLabel: string;
  targetHref: string | null;
  isUnread: boolean;
};

export type NotificationInboxGroup = {
  key: string;
  label: string;
  rows: NotificationInboxRow[];
};

export type NotificationInboxView = "all" | "unread" | "read";

export function filterNotificationGroups(
  groups: NotificationInboxGroup[],
  view: NotificationInboxView,
): NotificationInboxGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows:
        view === "all"
          ? group.rows
          : group.rows.filter((row) => (view === "unread" ? row.isUnread : !row.isUnread)),
    }))
    .filter((group) => group.rows.length > 0);
}

export function unreadNotificationIds(groups: NotificationInboxGroup[]): string[] {
  return groups.flatMap((group) => group.rows.filter((row) => row.isUnread).map((row) => row.id));
}

export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}
