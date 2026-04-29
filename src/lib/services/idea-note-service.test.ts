import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEA_NOTE_TYPES,
  createIdeaNote,
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  normalizeIdeaNoteInput,
} from "./idea-note-service";
import { parseIdeaNoteTags } from "@/lib/idea-note-domain";

type InsertCall = {
  table: string;
  payload: Record<string, unknown>;
};

function createIdeaNotesSupabaseMock(options?: {
  insertError?: boolean;
  projectLookupError?: boolean;
  projectLookupMissing?: boolean;
  rows?: Array<{
    id: string;
    title: string;
    body: string | null;
    status: string;
    type: string;
    project_id: string | null;
    priority: string | null;
    tags: string[];
    created_at: string;
    updated_at: string;
    projects?: { name: string } | null;
  }>;
  projects?: Array<{ id: string; name: string }>;
}) {
  const insertCalls: InsertCall[] = [];
  const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = [];
  const eqCalls: Array<{ column: string; value: string }> = [];
  const projectLookupCalls: string[] = [];
  const rows = options?.rows ?? [
    {
      id: "idea-1",
      title: "Inbox thought",
      body: null,
      status: "inbox",
      type: "idea",
      project_id: null,
      priority: null,
      tags: [],
      created_at: "2026-04-29T12:00:00.000Z",
      updated_at: "2026-04-29T12:00:00.000Z",
      projects: null,
    },
  ];
  const projects = options?.projects ?? [{ id: "11111111-1111-4111-8111-111111111111", name: "Ops" }];

  const supabase = {
    from(table: string) {
      if (table === "projects") {
        return {
          select(columns: string) {
            if (columns === "id") {
              const chain = {
                eq(column: string, value: string) {
                  assert.equal(column, "id");
                  projectLookupCalls.push(value);
                  return chain;
                },
                async maybeSingle() {
                  if (options?.projectLookupError) {
                    return { data: null, error: { message: "project lookup failed" } };
                  }

                  if (options?.projectLookupMissing) {
                    return { data: null, error: null };
                  }

                  return { data: { id: projectLookupCalls[0] }, error: null };
                },
              };

              return chain;
            }

            assert.equal(columns, "id, name");

            return {
              async order(column: string, queryOptions: { ascending?: boolean }) {
                orderCalls.push({ column, ascending: queryOptions.ascending });
                return { data: projects, error: null };
              },
            };
          },
        };
      }

      assert.equal(table, "idea_notes");

      return {
        insert(payload: Record<string, unknown>) {
          insertCalls.push({ table, payload });

          return {
            select(columns: string) {
              assert.equal(
                columns,
                "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
              );

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
                      type: String(payload.type),
                      project_id: payload.project_id as string | null,
                      priority: payload.priority as string | null,
                      tags: payload.tags as string[],
                      created_at: "2026-04-29T12:00:00.000Z",
                      updated_at: "2026-04-29T12:00:00.000Z",
                      projects: null,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        select(columns: string) {
          assert.equal(
            columns,
            "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
          );

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

  return { supabase, insertCalls, eqCalls, orderCalls, projectLookupCalls };
}

test("normalizes idea note input", () => {
  assert.deepEqual(
    normalizeIdeaNoteInput({ title: "  Better review flow  ", body: "  add prompts  " }),
    {
      title: "Better review flow",
      body: "add prompts",
      type: "idea",
      projectId: null,
      priority: null,
      tags: [],
      errorMessage: null,
    },
  );
  assert.deepEqual(normalizeIdeaNoteInput({ title: "Title", body: "   " }), {
    title: "Title",
    body: null,
    type: "idea",
    projectId: null,
    priority: null,
    tags: [],
    errorMessage: null,
  });
});

test("creating idea note inserts inbox note with default metadata", async () => {
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
    type: "idea",
    project_id: null,
    priority: null,
    tags: [],
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

test("creating idea note accepts valid type priority project and tags", async () => {
  const mock = createIdeaNotesSupabaseMock();
  const projectId = "11111111-1111-4111-8111-111111111111";

  const result = await createIdeaNote(
    {
      title: "Idea",
      type: "feature",
      projectId,
      priority: "high",
      tagsInput: "Ops, product, follow-up, ops",
    },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.type, "feature");
  assert.deepEqual(mock.projectLookupCalls, [projectId]);
  assert.deepEqual(mock.insertCalls[0].payload, {
    title: "Idea",
    body: null,
    status: "inbox",
    type: "feature",
    project_id: projectId,
    priority: "high",
    tags: ["ops", "product", "follow-up"],
  });
});

test("creating idea note accepts every valid type", async () => {
  for (const type of IDEA_NOTE_TYPES) {
    const mock = createIdeaNotesSupabaseMock();

    const result = await createIdeaNote(
      { title: "Idea", type },
      { supabase: mock.supabase as never },
    );

    assert.equal(result.errorMessage, null);
    assert.equal(mock.insertCalls[0].payload.type, type);
  }
});

test("creating idea note rejects invalid type priority project and tags without insert", async () => {
  const invalidCases = [
    {
      input: { title: "Idea", type: "task" },
      error: "Type must be one of: idea, feature, bug, improvement, research.",
    },
    {
      input: { title: "Idea", priority: "now" },
      error: "Priority must be one of: low, medium, high, urgent.",
    },
    {
      input: { title: "Idea", projectId: "not-a-uuid" },
      error: "Project is invalid.",
    },
    {
      input: { title: "Idea", tagsInput: "valid, #bad" },
      error: "Tags can only use letters, numbers, spaces, hyphens, and underscores.",
    },
  ];

  for (const invalidCase of invalidCases) {
    const mock = createIdeaNotesSupabaseMock();
    const result = await createIdeaNote(invalidCase.input, {
      supabase: mock.supabase as never,
    });

    assert.equal(result.errorMessage, invalidCase.error);
    assert.equal(mock.insertCalls.length, 0);
  }
});

test("creating idea note rejects unavailable project without insert", async () => {
  const mock = createIdeaNotesSupabaseMock({ projectLookupMissing: true });

  const result = await createIdeaNote(
    { title: "Idea", projectId: "11111111-1111-4111-8111-111111111111" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, "Selected project is unavailable.");
  assert.equal(mock.insertCalls.length, 0);
});

test("tag parser normalizes empty duplicate and blank tags", () => {
  assert.deepEqual(parseIdeaNoteTags(""), []);
  assert.deepEqual(parseIdeaNoteTags("Ops, ops, , Product Team"), ["ops", "product team"]);
});

test("listing idea inbox notes filters inbox and orders newest first", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const notes = await getIdeaInboxNotes({ supabase: mock.supabase as never });

  assert.deepEqual(mock.eqCalls, [{ column: "status", value: "inbox" }]);
  assert.deepEqual(mock.orderCalls, [{ column: "created_at", ascending: false }]);
  assert.deepEqual(notes[0], {
    id: "idea-1",
    title: "Inbox thought",
    body: null,
    status: "inbox",
    type: "idea",
    project_id: null,
    priority: null,
    tags: [],
    created_at: "2026-04-29T12:00:00.000Z",
    updated_at: "2026-04-29T12:00:00.000Z",
    projects: null,
  });
});

test("loading idea project options orders by project name", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const projects = await getIdeaNoteProjectOptions({ supabase: mock.supabase as never });

  assert.deepEqual(projects, [{ id: "11111111-1111-4111-8111-111111111111", name: "Ops" }]);
  assert.deepEqual(mock.orderCalls, [{ column: "name", ascending: true }]);
});
