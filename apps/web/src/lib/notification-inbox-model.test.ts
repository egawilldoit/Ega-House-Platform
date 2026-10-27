import assert from "node:assert/strict";
import test from "node:test";

import {
  filterNotificationGroups,
  toggleSelection,
  unreadNotificationIds,
  type NotificationInboxGroup,
} from "./notification-inbox-model";

const GROUPS: NotificationInboxGroup[] = [
  {
    key: "today",
    label: "Today",
    rows: [
      {
        id: "n1",
        title: "Unread reminder",
        body: null,
        createdAt: "2026-10-27T08:00:00.000Z",
        createdAtLabel: "09:00",
        targetHref: "/tasks?task=t1",
        isUnread: true,
      },
      {
        id: "n2",
        title: "Read reminder",
        body: null,
        createdAt: "2026-10-27T07:00:00.000Z",
        createdAtLabel: "08:00",
        targetHref: null,
        isUnread: false,
      },
    ],
  },
];

test("views filter unread and read without dropping empty-day headings", () => {
  assert.deepEqual(filterNotificationGroups(GROUPS, "all")[0].rows.map((row) => row.id), [
    "n1",
    "n2",
  ]);
  assert.deepEqual(filterNotificationGroups(GROUPS, "unread")[0].rows.map((row) => row.id), [
    "n1",
  ]);
  assert.deepEqual(filterNotificationGroups(GROUPS, "read")[0].rows.map((row) => row.id), ["n2"]);
});

test("a view with no matching rows drops the group entirely", () => {
  const readOnly: NotificationInboxGroup[] = [
    { ...GROUPS[0], rows: GROUPS[0].rows.filter((row) => !row.isUnread) },
  ];
  assert.deepEqual(filterNotificationGroups(readOnly, "unread"), []);
});

test("unread ids cover every group for bulk selection", () => {
  const second: NotificationInboxGroup = {
    key: "yesterday",
    label: "Yesterday",
    rows: [{ ...GROUPS[0].rows[0], id: "n3" }],
  };
  assert.deepEqual(unreadNotificationIds([...GROUPS, second]), ["n1", "n3"]);
});

test("selection toggles without duplicates and can be cleared", () => {
  let selected: string[] = [];
  selected = toggleSelection(selected, "n1");
  selected = toggleSelection(selected, "n1");
  assert.deepEqual(selected, []);
  selected = [...toggleSelection([], "n1"), ...toggleSelection([], "n2")];
  assert.deepEqual(selected, ["n1", "n2"]);
});
