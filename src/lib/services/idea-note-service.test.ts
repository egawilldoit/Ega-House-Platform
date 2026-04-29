import assert from "node:assert/strict";
import test from "node:test";

import {
  createIdeaNote,
  getIdeaInboxNotes,
  normalizeIdeaNoteInput,
} from "./idea-note-service";

type InsertCall = {
  table: string;
  payload: Record<string, unknown>;
};

function createIdeaNotesSupabaseMock(options?: {
  insertError?: boolean;
  rows?: Array<{
    id: string;
    title: string;
    body: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
}) {
  const insertCalls: InsertCall[] = [];
  const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = [];
  const eqCalls: Array<{ column: string; value: string }> = [];
  const rows = options?.rows ?? [
    {
      id: "idea-1",
      title: "Inbox thought",
      body: null,
      status: "inbox",
      created_at: "2026-04-29T12:00:00.000Z",
      updated_at: "2026-04-29T12:00:00.000Z",
    },
  ];

  const supabase = {
    from(table: string) {
      assert.equal(table, "idea_notes");

      return {
        insert(payload: Record<string, unknown>) {
          insertCalls.push({ table, payload });

          return {
            select(columns: string) {
              assert.equal(columns, "id, title, body, status, created_at, updated_at");

              return {
                single: async () => {
                  if (options?.insertError) {
                    return { data: null, error: { message: "insert failed" } };
                  }

                  return {
                    data: {
                      id: "idea-new",
                      title: String(payload.title),
                      body: payload.body as string | null,
                      status: String(payload.status),
                      created_at: "2026-04-29T12:00:00.000Z",
                      updated_at: "2026-04-29T12:00:00.000Z",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        select(columns: string) {
          assert.equal(columns, "id, title, body, status, created_at, updated_at");

          const chain = {
            eq(column: string, value: string) {
              eqCalls.push({ column, value });
              return chain;
            },
            async order(column: string, options: { ascending?: boolean }) {
              orderCalls.push({ column, ascending: options.ascending });
              return { data: rows, error: null };
            },
          };

          return chain;
        },
      };
    },
  };

  return { supabase, insertCalls, eqCalls, orderCalls };
}

test("normalizes idea note input", () => {
  assert.deepEqual(
    normalizeIdeaNoteInput({ title: "  Better review flow  ", body: "  add prompts  " }),
    { title: "Better review flow", body: "add prompts" },
  );
  assert.deepEqual(normalizeIdeaNoteInput({ title: "Title", body: "   " }), {
    title: "Title",
    body: null,
  });
});

test("creating idea note inserts inbox note", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await createIdeaNote(
    { title: "  Improve timer handoff  " },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.status, "inbox");
  assert.deepEqual(mock.insertCalls[0].payload, {
    title: "Improve timer handoff",
    body: null,
    status: "inbox",
  });
  assert.equal("owner_user_id" in mock.insertCalls[0].payload, false);
});

test("creating idea note rejects empty title without insert", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await createIdeaNote(
    { title: "   ", body: "body" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, "Idea title is required.");
  assert.equal(mock.insertCalls.length, 0);
});

test("creating idea note accepts optional body", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await createIdeaNote(
    { title: "Idea", body: "  useful context  " },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.body, "useful context");
  assert.equal(mock.insertCalls[0].payload.body, "useful context");
});

test("listing idea inbox notes filters inbox and orders newest first", async () => {
  const mock = createIdeaNotesSupabaseMock();

  await getIdeaInboxNotes({ supabase: mock.supabase as never });

  assert.deepEqual(mock.eqCalls, [{ column: "status", value: "inbox" }]);
  assert.deepEqual(mock.orderCalls, [{ column: "created_at", ascending: false }]);
});
