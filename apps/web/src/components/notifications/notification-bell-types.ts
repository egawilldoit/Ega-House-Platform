export type NotificationBellRow = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  targetHref: string | null;
  isUnread: boolean;
};

export type NotificationPageResult =
  | {
      ok: true;
      rows: NotificationBellRow[];
      unreadCount: number;
      nextCursor: string | null;
    }
  | { ok: false; errorMessage: string };

export type NotificationMutationResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export type NotificationOpenResult =
  | { ok: true; href: string | null }
  | { ok: false; errorMessage: string };

export type NotificationReadAllResult =
  | { ok: true; updatedCount: number }
  | { ok: false; errorMessage: string };
