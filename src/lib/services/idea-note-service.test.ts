import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEA_NOTE_TYPES,
  MANUAL_IDEA_NOTE_STATUSES,
  archiveIdeaNote,
  createIdeaNote,
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  normalizeIdeaNoteInput,
  restoreIdeaNote,
  updateIdeaNote,
} from "./idea-note-service";
import { parseIdeaNoteTags } from "@/lib/idea-note-domain";

type InsertCall = {
  table: string;
  payload: Record<string, unknown>;
};

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
};

function createIdeaNotesSupabaseMock(options?: {
  insertError?: boolean;
  updateError?: boolean;
  updateMissing?: boolean;
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
  const updateCalls: UpdateCall[] = [];
  const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = [];
  const eqCalls: Array<{ column: string; value: string }> = [];
  const inCalls: Array<{ column: string; values: string[] }> = [];
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
        update(payload: Record<string, unknown>) {
          updateCalls.push({ table, payload });

          const chain = {
            eq(column: string, value: string) {
              eqCalls.push({ column, value });
              return chain;
            },
            select(columns: string) {
              assert.equal(
                columns,
                "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
              );
              return chain;
            },
            async maybeSingle() {
              if (options?.updateError) {
                return { data: null, error: { message: "update failed" } };
              }

              if (options?.updateMissing) {
                return { data: null, error: null };
              }

              return {
                data: {
                  id: eqCalls.find((call) => call.column === "id")?.value ?? "idea-1",
                  title: String(payload.title),
                  body: payload.body as string | null,
                  status: String(payload.status),
                  type: String(payload.type),
                  project_id: payload.project_id as string | null,
                  priority: payload.priority as string | null,
                  tags: payload.tags as string[],
                  created_at: "2026-04-29T12:00:00.000Z",
                  updated_at: String(payload.updated_at),
                  projects: null,
                },
                error: null,
              };
            },
          };

          return chain;
        },
        select(columns: string) {
          assert.equal(
            columns,
            "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
          );

          let filteredRows = rows;
          const chain = {
            eq(column: string, value: string) {
              eqCalls.push({ column, value });
              if (column === "status") {
                filteredRows = rows.filter((row) => row.status === value);
              }
              return chain;
            },
            in(column: string, values: string[]) {
              inCalls.push({ column, values });
              if (column === "status") {
                filteredRows = rows.filter((row) => values.includes(row.status));
              }
              return chain;
            },
            async order(column: string, options: { ascending?: boolean }) {
              orderCalls.push({ column, ascending: options.ascending });
              return { data: filteredRows, error: null };
            },
          };

          return chain;
        },
      };
    },
  };

  return { supabase, insertCalls, updateCalls, eqCalls, inCalls, orderCalls, projectLookupCalls };
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

test("new idea note still defaults to inbox", async () => {
  const mock = createIdeaNotesSupabaseMock();

  await createIdeaNote({ title: "Idea" }, { supabase: mock.supabase as never });

  assert.equal(mock.insertCalls[0].payload.status, "inbox");
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

test("updating idea note edits title and body", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await updateIdeaNote(
    {
      id: "idea-1",
      title: "  Better capture  ",
      body: "  add enough context  ",
      status: "inbox",
    },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.title, "Better capture");
  assert.equal(result.data?.body, "add enough context");
  assert.equal(mock.updateCalls[0].payload.title, "Better capture");
  assert.equal(mock.updateCalls[0].payload.body, "add enough context");
  assert.equal("owner_user_id" in mock.updateCalls[0].payload, false);
});

test("updating idea note edits metadata", async () => {
  const mock = createIdeaNotesSupabaseMock();
  const projectId = "11111111-1111-4111-8111-111111111111";

  const result = await updateIdeaNote(
    {
      id: "idea-1",
      title: "Idea",
      type: "research",
      projectId,
      priority: "urgent",
      tagsInput: "Ops, Research, ops",
      status: "planned",
    },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.projectLookupCalls, [projectId]);
  assert.equal(mock.updateCalls[0].payload.type, "research");
  assert.equal(mock.updateCalls[0].payload.project_id, projectId);
  assert.equal(mock.updateCalls[0].payload.priority, "urgent");
  assert.deepEqual(mock.updateCalls[0].payload.tags, ["ops", "research"]);
});

test("projectless update remains valid", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await updateIdeaNote(
    {
      id: "idea-1",
      title: "Idea",
      projectId: "",
      status: "reviewing",
    },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.updateCalls[0].payload.project_id, null);
  assert.deepEqual(mock.projectLookupCalls, []);
});

test("updating idea note accepts manual statuses", async () => {
  for (const status of MANUAL_IDEA_NOTE_STATUSES) {
    const mock = createIdeaNotesSupabaseMock();

    const result = await updateIdeaNote(
      { id: "idea-1", title: "Idea", status },
      { supabase: mock.supabase as never },
    );

    assert.equal(result.errorMessage, null);
    assert.equal(mock.updateCalls[0].payload.status, status);
  }
});

test("updating idea note rejects converted status", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await updateIdeaNote(
    { id: "idea-1", title: "Idea", status: "converted" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, "Converted is reserved for future conversion workflows.");
  assert.equal(mock.updateCalls.length, 0);
});

test("updating idea note rejects invalid status", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await updateIdeaNote(
    { id: "idea-1", title: "Idea", status: "blocked" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, "Status must be one of: inbox, reviewing, planned, archived.");
  assert.equal(mock.updateCalls.length, 0);
});

test("updating idea note rejects empty title without update", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await updateIdeaNote(
    { id: "idea-1", title: "   ", body: "body", status: "inbox" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, "Idea title is required.");
  assert.equal(mock.updateCalls.length, 0);
});

test("updating idea note uses RLS-safe id-scoped update", async () => {
  const mock = createIdeaNotesSupabaseMock();

  await updateIdeaNote(
    { id: "idea-1", title: "Idea", status: "archived" },
    { supabase: mock.supabase as never },
  );

  assert.deepEqual(mock.eqCalls, [{ column: "id", value: "idea-1" }]);
  assert.equal("owner_user_id" in mock.updateCalls[0].payload, false);
});

test("archive idea note updates status timestamp and uses RLS-safe id scope", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await archiveIdeaNote("idea-1", { supabase: mock.supabase as never });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.status, "archived");
  assert.equal(mock.updateCalls[0].payload.status, "archived");
  assert.equal(typeof mock.updateCalls[0].payload.updated_at, "string");
  assert.ok(Date.parse(String(mock.updateCalls[0].payload.updated_at)));
  assert.deepEqual(mock.eqCalls, [{ column: "id", value: "idea-1" }]);
  assert.equal("owner_user_id" in mock.updateCalls[0].payload, false);
});

test("restore idea note updates status to inbox and timestamp", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const result = await restoreIdeaNote("idea-1", { supabase: mock.supabase as never });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.status, "inbox");
  assert.equal(mock.updateCalls[0].payload.status, "inbox");
  assert.equal(typeof mock.updateCalls[0].payload.updated_at, "string");
  assert.ok(Date.parse(String(mock.updateCalls[0].payload.updated_at)));
  assert.deepEqual(mock.eqCalls, [{ column: "id", value: "idea-1" }]);
});

test("archive and restore reject missing idea id without update", async () => {
  const archiveMock = createIdeaNotesSupabaseMock();
  const restoreMock = createIdeaNotesSupabaseMock();

  const archiveResult = await archiveIdeaNote("   ", { supabase: archiveMock.supabase as never });
  const restoreResult = await restoreIdeaNote(null, { supabase: restoreMock.supabase as never });

  assert.equal(archiveResult.errorMessage, "Idea is required.");
  assert.equal(restoreResult.errorMessage, "Idea is required.");
  assert.equal(archiveMock.updateCalls.length, 0);
  assert.equal(restoreMock.updateCalls.length, 0);
});

test("tag parser normalizes empty duplicate and blank tags", () => {
  assert.deepEqual(parseIdeaNoteTags(""), []);
  assert.deepEqual(parseIdeaNoteTags("Ops, ops, , Product Team"), ["ops", "product team"]);
});

test("default idea list excludes archived and converted notes", async () => {
  const mock = createIdeaNotesSupabaseMock({
    rows: [
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
      {
        id: "idea-2",
        title: "Archived thought",
        body: null,
        status: "archived",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T11:00:00.000Z",
        updated_at: "2026-04-29T11:00:00.000Z",
        projects: null,
      },
      {
        id: "idea-3",
        title: "Converted thought",
        body: null,
        status: "converted",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T10:00:00.000Z",
        updated_at: "2026-04-29T10:00:00.000Z",
        projects: null,
      },
    ],
  });

  const notes = await getIdeaInboxNotes({ supabase: mock.supabase as never });

  assert.deepEqual(mock.inCalls, [{ column: "status", values: ["inbox", "reviewing", "planned"] }]);
  assert.deepEqual(notes.map((note) => note.id), ["idea-1"]);
});

test("archived idea list returns archived notes only", async () => {
  const mock = createIdeaNotesSupabaseMock({
    rows: [
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
      {
        id: "idea-2",
        title: "Archived thought",
        body: null,
        status: "archived",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T11:00:00.000Z",
        updated_at: "2026-04-29T11:00:00.000Z",
        projects: null,
      },
    ],
  });

  const notes = await getIdeaInboxNotes({ supabase: mock.supabase as never, view: "archived" });

  assert.deepEqual(mock.eqCalls, [{ column: "status", value: "archived" }]);
  assert.deepEqual(notes.map((note) => note.id), ["idea-2"]);
});

test("all idea list includes archived but not converted notes", async () => {
  const mock = createIdeaNotesSupabaseMock({
    rows: [
      {
        id: "idea-1",
        title: "Planned thought",
        body: null,
        status: "planned",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T12:00:00.000Z",
        updated_at: "2026-04-29T12:00:00.000Z",
        projects: null,
      },
      {
        id: "idea-2",
        title: "Archived thought",
        body: null,
        status: "archived",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T11:00:00.000Z",
        updated_at: "2026-04-29T11:00:00.000Z",
        projects: null,
      },
      {
        id: "idea-3",
        title: "Converted thought",
        body: null,
        status: "converted",
        type: "idea",
        project_id: null,
        priority: null,
        tags: [],
        created_at: "2026-04-29T10:00:00.000Z",
        updated_at: "2026-04-29T10:00:00.000Z",
        projects: null,
      },
    ],
  });

  const notes = await getIdeaInboxNotes({ supabase: mock.supabase as never, view: "all" });

  assert.deepEqual(mock.inCalls, [
    { column: "status", values: ["inbox", "reviewing", "planned", "archived"] },
  ]);
  assert.deepEqual(notes.map((note) => note.id), ["idea-1", "idea-2"]);
});

test("listing ideas orders newest first", async () => {
  const mock = createIdeaNotesSupabaseMock();

  const notes = await getIdeaInboxNotes({ supabase: mock.supabase as never });

  assert.deepEqual(mock.inCalls, [{ column: "status", values: ["inbox", "reviewing", "planned"] }]);
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
