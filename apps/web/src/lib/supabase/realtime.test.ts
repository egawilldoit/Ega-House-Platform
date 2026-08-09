import assert from "node:assert/strict";
import test from "node:test";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import {
  buildOwnerScopedRealtimeFilter,
  getRealtimePayloadUpdatedAt,
  isOwnerScopedRealtimePayload,
  subscribeToOwnerScopedRealtimeChanges,
} from "./realtime";

type Row = {
  owner_user_id?: string | null;
  updated_at?: string | null;
};

function createPayload(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  overrides: Partial<RealtimePostgresChangesPayload<Row>> = {},
) {
  return {
    commit_timestamp: "2026-04-18T00:00:00.000Z",
    errors: [],
    eventType,
    schema: "public",
    table: "task_sessions",
    new: {},
    old: {},
    ...overrides,
  } as RealtimePostgresChangesPayload<Row>;
}

test("buildOwnerScopedRealtimeFilter scopes events to owner_user_id", () => {
  assert.equal(
    buildOwnerScopedRealtimeFilter("user-1"),
    "owner_user_id=eq.user-1",
  );
});

test("isOwnerScopedRealtimePayload reads owner from new row", () => {
  const payload = createPayload("INSERT", {
    new: { owner_user_id: "user-1" },
  });

  assert.equal(isOwnerScopedRealtimePayload(payload, "user-1"), true);
  assert.equal(isOwnerScopedRealtimePayload(payload, "user-2"), false);
});

test("isOwnerScopedRealtimePayload reads owner from old row for delete events", () => {
  const payload = createPayload("DELETE", {
    old: { owner_user_id: "user-1" },
  });

  assert.equal(isOwnerScopedRealtimePayload(payload, "user-1"), true);
});

test("getRealtimePayloadUpdatedAt resolves from new then old payload rows", () => {
  const newPayload = createPayload("UPDATE", {
    new: { updated_at: "2026-04-18T00:01:00.000Z" },
    old: { updated_at: "2026-04-18T00:00:30.000Z" },
  });

  const oldPayload = createPayload("DELETE", {
    old: { updated_at: "2026-04-18T00:02:00.000Z" },
  });

  assert.equal(
    getRealtimePayloadUpdatedAt(newPayload),
    "2026-04-18T00:01:00.000Z",
  );
  assert.equal(
    getRealtimePayloadUpdatedAt(oldPayload),
    "2026-04-18T00:02:00.000Z",
  );
});

test("subscribeToOwnerScopedRealtimeChanges dispatches only matching owner payloads and unsubscribes channels", () => {
  const handlers: ((payload: RealtimePostgresChangesPayload<Row>) => void)[] = [];
  const removeChannelCalls: unknown[] = [];
  const filters: string[] = [];
  let channelCount = 0;

  const client = {
    channel: () => {
      const channelRef = { channelId: channelCount++ };
      return {
        on: (
          _event: string,
          config: { filter?: string },
          callback: (payload: RealtimePostgresChangesPayload<Row>) => void,
        ) => {
          handlers.push(callback);
          if (config.filter) {
            filters.push(config.filter);
          }
          return {
            subscribe: () => channelRef,
          };
        },
      };
    },
    removeChannel: (channel: unknown) => {
      removeChannelCalls.push(channel);
      return Promise.resolve("ok");
    },
  };

  const received: string[] = [];
  const unsubscribe = subscribeToOwnerScopedRealtimeChanges(client as never, {
    ownerUserId: "user-1",
    tables: ["task_sessions", "tasks"],
    channelPrefix: "dashboard",
    onPayload: (payload) => {
      received.push(payload.eventType);
    },
  });

  assert.equal(handlers.length, 2);
  assert.deepEqual(filters, ["owner_user_id=eq.user-1", "owner_user_id=eq.user-1"]);

  handlers[0](createPayload("INSERT", { new: { owner_user_id: "user-1" } }));
  handlers[1](createPayload("UPDATE", { new: { owner_user_id: "user-2" } }));

  assert.deepEqual(received, ["INSERT"]);

  unsubscribe();
  assert.equal(removeChannelCalls.length, 2);
});
