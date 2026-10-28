import assert from "node:assert/strict";
import test from "node:test";

import { listFavorites, moveFavorite, toggleFavorite } from "./favorite-service";

function stubClient(options: {
  userId?: string | null;
  existingFavorite?: { id: string } | null;
  rows?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  insertError?: { code?: string } | null;
} = {}) {
  const userId = options.userId === undefined ? "owner-1" : options.userId;
  const inserted: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from(table: string) {
      if (table === "favorites") {
        return {
          select() {
            const q = {
              eq() {
                return q;
              },
              order() {
                return q;
              },
              limit() {
                return q;
              },
              async maybeSingle() {
                return { data: options.existingFavorite ?? null, error: null };
              },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve(resolve({ data: options.rows ?? [], error: null }));
              },
            };
            return q;
          },
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return Promise.resolve({ error: options.insertError ?? null });
          },
          delete() {
            const q = {
              eq(column: string, value: string) {
                if (column === "id") deleted.push(value);
                return q;
              },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve(resolve({ error: null }));
              },
            };
            return q;
          },
        };
      }
      return {
        select() {
          const q = {
            in() {
              return q;
            },
            eq() {
              return q;
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve(
                resolve({
                  data: table === "tasks" ? options.tasks ?? [] : options.projects ?? [],
                  error: null,
                }),
              );
            },
          };
          return q;
        },
      };
    },
  };

  return { client, inserted, deleted };
}

test("toggling an existing favourite removes it", async () => {
  const { client, deleted } = stubClient({ existingFavorite: { id: "f1" } });
  const result = await toggleFavorite("task", "t1", { supabase: client as never });
  assert.equal(result.favorited, false);
  assert.deepEqual(deleted, ["f1"]);
});

test("toggling a new favourite inserts once and treats a unique race as success", async () => {
  const { client, inserted } = stubClient({ existingFavorite: null, insertError: { code: "23505" } });
  const result = await toggleFavorite("project", "p1", { supabase: client as never });
  assert.equal(result.errorMessage, null);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.entity_kind, "project");
});

test("an unauthenticated caller cannot favourite anything", async () => {
  const { client, inserted } = stubClient({ userId: null });
  const result = await toggleFavorite("task", "t1", { supabase: client as never });
  assert.equal(result.favorited, false);
  assert.match(result.errorMessage ?? "", /not found/i);
  assert.equal(inserted.length, 0);
});

test("lists hide archived entities without deleting their favourite", async () => {
  const { client } = stubClient({
    rows: [
      { id: "f1", entity_kind: "task", entity_id: "t1", position: 0 },
      { id: "f2", entity_kind: "task", entity_id: "t2", position: 1 },
      { id: "f3", entity_kind: "project", entity_id: "p1", position: 2 },
    ],
    tasks: [
      {
        id: "t1",
        title: "Live task",
        status: "todo",
        archived_at: null,
        projects: { name: "EGA" },
      },
      {
        id: "t2",
        title: "Archived task",
        status: "todo",
        archived_at: "2026-10-01T00:00:00.000Z",
        projects: null,
      },
    ],
    projects: [{ id: "p1", name: "Archived project", slug: "old", status: "archived" }],
  });

  const result = await listFavorites({ supabase: client as never });
  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.items.map((item) => item.entityId), ["t1"]);
});

test("moving an edge favourite is a no-op, not a data loss", async () => {
  const { client } = stubClient({
    rows: [
      { id: "f1", entity_id: "t1", position: 0 },
      { id: "f2", entity_id: "t2", position: 1 },
    ],
  });
  const result = await moveFavorite("task", "t1", "up", { supabase: client as never });
  assert.equal(result.errorMessage, null);
});
