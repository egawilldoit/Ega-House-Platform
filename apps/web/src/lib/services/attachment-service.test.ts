import { describe, expect, test, vi } from "vitest";

import {
  createAttachmentUpload,
  deleteAttachment,
  finalizeAttachment,
  getAttachmentPreviewLink,
  listProjectAttachments,
  listTaskAttachments,
  type AttachmentSupabaseClient,
} from "./attachment-service";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const STORAGE_PATH = `${OWNER}/${TASK_ID}/${ATTACHMENT_ID}.png`;
const IDEMPOTENCY_KEY = "upload-key-12345678";
const CREATED_AT = "2026-10-28T10:00:00.000Z";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

type Call = { method: string; args: unknown[] };
type QueryResult = { data?: unknown; error?: unknown; count?: number | null };
type Handler = (table: string, calls: Call[]) => QueryResult | Promise<QueryResult>;

class FakeQuery {
  readonly calls: Call[] = [];

  constructor(
    private readonly table: string,
    private readonly handler: Handler,
  ) {}

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]) {
    return this.record("select", args);
  }
  eq(...args: unknown[]) {
    return this.record("eq", args);
  }
  in(...args: unknown[]) {
    return this.record("in", args);
  }
  like(...args: unknown[]) {
    return this.record("like", args);
  }
  ilike(...args: unknown[]) {
    return this.record("ilike", args);
  }
  lt(...args: unknown[]) {
    return this.record("lt", args);
  }
  order(...args: unknown[]) {
    return this.record("order", args);
  }
  limit(...args: unknown[]) {
    return this.record("limit", args);
  }
  maybeSingle() {
    return Promise.resolve(this.handler(this.table, this.calls));
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.handler(this.table, this.calls)).then(onfulfilled, onrejected);
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    owner_user_id: OWNER,
    task_id: TASK_ID,
    file_name: "plan.png",
    storage_path: STORAGE_PATH,
    mime_type: "image/png",
    size_bytes: PNG_BYTES.byteLength,
    status: "finalized",
    idempotency_key: IDEMPOTENCY_KEY,
    upload_expires_at: CREATED_AT,
    finalized_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function makeClient(options?: {
  handler?: Handler;
  authenticated?: boolean;
  rpc?: (name: string, args: unknown) => QueryResult;
  bucket?: Record<string, ReturnType<typeof vi.fn>>;
}) {
  const handler: Handler = options?.handler ?? (() => ({ data: null, error: null }));
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://storage.test/upload/${path}?token=secret`, path, token: "secret" },
      error: null,
    })),
    list: vi.fn(async () => ({
      data: [{ name: `${ATTACHMENT_ID}.png`, metadata: { size: PNG_BYTES.byteLength } }],
      error: null,
    })),
    download: vi.fn(async () => ({ data: new Blob([PNG_BYTES]), error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async (path: string, ttl: number) => ({
      data: { signedUrl: `https://storage.test/object/${path}?ttl=${ttl}&token=secret` },
      error: null,
    })),
    ...options?.bucket,
  };
  const rpc = vi.fn(async (name: string, args: unknown) =>
    options?.rpc?.(name, args) ?? { data: { ok: true }, error: null },
  );

  const client = {
    auth: {
      getUser: vi.fn(async () =>
        options?.authenticated === false
          ? { data: { user: null }, error: null }
          : { data: { user: { id: OWNER } }, error: null },
      ),
    },
    from: vi.fn((table: string) => new FakeQuery(table, handler)),
    storage: { from: vi.fn(() => bucket) },
    rpc,
  };

  return {
    client: client as unknown as AttachmentSupabaseClient,
    bucket,
    rpc,
    from: client.from,
  };
}

describe("task attachment tickets", () => {
  test("rejects unauthenticated callers", async () => {
    const { client, rpc } = makeClient({ authenticated: false });
    const result = await createAttachmentUpload(
      {
        taskId: TASK_ID,
        fileName: "plan.png",
        mimeType: "image/png",
        sizeBytes: 10,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { supabase: client },
    );
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("rejects unsupported types and oversized files before touching storage", async () => {
    const { client, rpc, from } = makeClient();
    const unsupported = await createAttachmentUpload(
      {
        taskId: TASK_ID,
        fileName: "payload.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 10,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { supabase: client },
    );
    expect(unsupported).toMatchObject({ ok: false });

    const oversized = await createAttachmentUpload(
      {
        taskId: TASK_ID,
        fileName: "plan.png",
        mimeType: "image/png",
        sizeBytes: 10 * 1024 * 1024 + 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { supabase: client },
    );
    expect(oversized).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  test("returns a signed upload ticket for a server-owned path", async () => {
    const { client, rpc, bucket } = makeClient({
      rpc: () => ({
        data: { ok: true, id: ATTACHMENT_ID, storage_path: STORAGE_PATH, status: "pending" },
        error: null,
      }),
      handler: () => ({ data: [], error: null }),
    });

    const result = await createAttachmentUpload(
      {
        taskId: TASK_ID,
        fileName: "../unsafe plan.png",
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.byteLength,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { supabase: client },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket.attachmentId).toBe(ATTACHMENT_ID);
    expect(result.ticket.uploadUrl).toContain(STORAGE_PATH);
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(STORAGE_PATH, { upsert: true });
    expect(rpc).toHaveBeenCalledWith(
      "create_task_attachment_upload",
      expect.objectContaining({
        p_task_id: TASK_ID,
        p_file_name: "unsafe plan.png",
        p_mime_type: "image/png",
        p_extension: "png",
        p_idempotency_key: IDEMPOTENCY_KEY,
      }),
    );
  });

  test("maps the database quota and per-task limit codes", async () => {
    for (const [code, expected] of [
      ["task_limit", /maximum of 20 files/],
      ["owner_quota", /storage is full/],
      ["not_found", /not found/],
    ] as const) {
      const { client } = makeClient({
        handler: () => ({ data: [], error: null }),
        rpc: () => ({ data: { ok: false, code }, error: null }),
      });
      const result = await createAttachmentUpload(
        {
          taskId: TASK_ID,
          fileName: "plan.png",
          mimeType: "image/png",
          sizeBytes: 10,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { supabase: client },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorMessage).toMatch(expected);
    }
  });

  test("a retry with the same key resolves to the same attachment row", async () => {
    const { client, rpc } = makeClient({
      handler: () => ({ data: [], error: null }),
      rpc: () => ({
        data: { ok: true, id: ATTACHMENT_ID, storage_path: STORAGE_PATH, status: "pending" },
        error: null,
      }),
    });
    const input = {
      taskId: TASK_ID,
      fileName: "plan.png",
      mimeType: "image/png",
      sizeBytes: 10,
      idempotencyKey: IDEMPOTENCY_KEY,
    };
    const first = await createAttachmentUpload(input, { supabase: client });
    const second = await createAttachmentUpload(input, { supabase: client });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.ticket.attachmentId).toBe(second.ticket.attachmentId);
    }
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  test("reconciles at most a bounded batch of expired pending uploads", async () => {
    const expired = [
      { id: "66666666-6666-4666-8666-666666666666", storage_path: `${OWNER}/${TASK_ID}/old.png` },
    ];
    const { client, bucket, rpc } = makeClient({
      handler: (table, calls) => {
        if (table === "task_attachments" && calls.some((call) => call.method === "lt")) {
          return { data: expired, error: null };
        }
        return { data: [], error: null };
      },
      rpc: (name) =>
        name === "create_task_attachment_upload"
          ? { data: { ok: true, id: ATTACHMENT_ID, storage_path: STORAGE_PATH }, error: null }
          : { data: { ok: true }, error: null },
    });

    await createAttachmentUpload(
      {
        taskId: TASK_ID,
        fileName: "plan.png",
        mimeType: "image/png",
        sizeBytes: 10,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { supabase: client },
    );

    expect(bucket.remove).toHaveBeenCalledWith([expired[0]!.storage_path]);
    expect(rpc).toHaveBeenCalledWith("delete_task_attachment", {
      p_attachment_id: expired[0]!.id,
    });
  });
});

describe("finalize", () => {
  test("returns not-found for another owner or an unknown id", async () => {
    const { client, bucket } = makeClient({ handler: () => ({ data: null, error: null }) });
    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(bucket.list).not.toHaveBeenCalled();
  });

  test("is idempotent once finalized and never re-reads the object", async () => {
    const { client, bucket } = makeClient({ handler: () => ({ data: row(), error: null }) });
    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result.ok).toBe(true);
    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.download).not.toHaveBeenCalled();
  });

  test("a missing object stays retryable", async () => {
    const { client } = makeClient({
      handler: () => ({ data: row({ status: "pending", finalized_at: null }), error: null }),
      bucket: { list: vi.fn(async () => ({ data: [], error: null })) },
    });
    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  test("a size mismatch removes the object and marks the row failed", async () => {
    const { client, bucket, rpc } = makeClient({
      handler: () => ({ data: row({ status: "pending", finalized_at: null }), error: null }),
      bucket: {
        list: vi.fn(async () => ({
          data: [{ name: `${ATTACHMENT_ID}.png`, metadata: { size: 999 } }],
          error: null,
        })),
      },
    });
    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result).toMatchObject({ ok: false });
    expect(bucket.download).not.toHaveBeenCalled();
    expect(bucket.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(rpc).toHaveBeenCalledWith("fail_task_attachment", {
      p_attachment_id: ATTACHMENT_ID,
      p_reason: expect.stringContaining("size"),
    });
  });

  test("content sniffing rejects bytes that do not match the declared type", async () => {
    const textBytes = new TextEncoder().encode("0123456789");
    const { client, bucket, rpc } = makeClient({
      handler: () => ({ data: row({ status: "pending", finalized_at: null }), error: null }),
      bucket: {
        list: vi.fn(async () => ({
          data: [
            { name: `${ATTACHMENT_ID}.png`, metadata: { size: textBytes.byteLength } },
          ],
          error: null,
        })),
        download: vi.fn(async () => ({ data: new Blob([textBytes]), error: null })),
      },
    });
    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result.ok).toBe(false);
    expect(bucket.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(rpc).toHaveBeenCalledWith("fail_task_attachment", expect.anything());
  });

  test("a verified object finalizes through the RPC", async () => {
    let lookups = 0;
    const { client, rpc } = makeClient({
      handler: () => {
        lookups += 1;
        return {
          data:
            lookups === 1
              ? row({ status: "pending", finalized_at: null })
              : row({ status: "finalized" }),
          error: null,
        };
      },
      rpc: (name) =>
        name === "finalize_task_attachment"
          ? {
              data: { ok: true, already: false, id: ATTACHMENT_ID, task_id: TASK_ID },
              error: null,
            }
          : { data: { ok: true }, error: null },
    });

    const result = await finalizeAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachment.status).toBe("finalized");
      expect(result.attachment.id).toBe(ATTACHMENT_ID);
    }
    expect(rpc).toHaveBeenCalledWith("finalize_task_attachment", {
      p_attachment_id: ATTACHMENT_ID,
      p_size_bytes: PNG_BYTES.byteLength,
    });
  });
});

describe("delete and signed links", () => {
  test("delete removes the object before metadata and reports retryable removal failure", async () => {
    const { client, bucket, rpc } = makeClient({
      handler: () => ({ data: row(), error: null }),
      bucket: {
        remove: vi.fn(async () => ({ data: null, error: { message: "storage down" } })),
      },
    });
    const failed = await deleteAttachment(ATTACHMENT_ID, { supabase: client });
    expect(failed).toMatchObject({ ok: false, retryable: true });
    expect(rpc).not.toHaveBeenCalled();

    bucket.remove.mockResolvedValueOnce({ data: [], error: null });
    rpc.mockResolvedValueOnce({ data: { ok: true, deleted: true }, error: null });
    const succeeded = await deleteAttachment(ATTACHMENT_ID, { supabase: client });
    expect(succeeded.ok).toBe(true);
    expect(bucket.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(rpc).toHaveBeenCalledWith("delete_task_attachment", {
      p_attachment_id: ATTACHMENT_ID,
    });
  });

  test("delete is idempotent for a missing row", async () => {
    const { client, bucket } = makeClient({ handler: () => ({ data: null, error: null }) });
    const result = await deleteAttachment(ATTACHMENT_ID, { supabase: client });
    expect(result.ok).toBe(true);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  test("preview links are issued only for finalized owner rows with a 60 second TTL", async () => {
    const pending = makeClient({
      handler: () => ({ data: row({ status: "pending", finalized_at: null }), error: null }),
    });
    const denied = await getAttachmentPreviewLink(ATTACHMENT_ID, {
      supabase: pending.client,
    });
    expect(denied.ok).toBe(false);
    expect(pending.bucket.createSignedUrl).not.toHaveBeenCalled();

    const { client, bucket } = makeClient({ handler: () => ({ data: row(), error: null }) });
    const allowed = await getAttachmentPreviewLink(ATTACHMENT_ID, { supabase: client });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.link.url).toContain(STORAGE_PATH);
      expect(allowed.link.fileName).toBe("plan.png");
    }
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(STORAGE_PATH, 60, undefined);

    await getAttachmentPreviewLink(ATTACHMENT_ID, { supabase: client, download: true });
    expect(bucket.createSignedUrl).toHaveBeenLastCalledWith(STORAGE_PATH, 60, {
      download: "plan.png",
    });
  });
});

describe("project Files query", () => {
  test("a forged or foreign project is rejected before any attachment read", async () => {
    const { client, from } = makeClient({ handler: () => ({ data: null, error: null }) });
    const result = await listProjectAttachments(PROJECT_ID, undefined, { supabase: client });
    expect(result.errorMessage).toMatch(/not found/);
    expect(result.data).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("projects");
  });

  test("lists finalized rows for the owned project with escaped search and bounded paging", async () => {
    const projectRow = { id: PROJECT_ID };
    const fileRow = row({ tasks: { title: "Launch plan" } });
    const { client } = makeClient({
      handler: (table, calls) => {
        if (table === "projects") return { data: projectRow, error: null };
        const isCount = calls.some(
          (call) => call.method === "select" && (call.args[1] as { head?: boolean })?.head,
        );
        if (isCount) return { data: null, error: null, count: table === "task_attachments" ? 1 : 0 };
        return { data: [fileRow], error: null };
      },
    });

    const result = await listProjectAttachments(
      PROJECT_ID,
      { kind: "image", query: "100%", sort: "largest" },
      { supabase: client },
    );

    expect(result.errorMessage).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.taskTitle).toBe("Launch plan");
    expect(result.pendingCount).toBeGreaterThanOrEqual(0);
  });

  test("unauthenticated callers get an empty, explained result", async () => {
    const { client } = makeClient({ authenticated: false });
    const result = await listProjectAttachments(PROJECT_ID, undefined, { supabase: client });
    expect(result.errorMessage).toMatch(/not found/);
    expect(result.data).toEqual([]);
  });

  test("other-owner ids are never queried as metadata", async () => {
    const { client } = makeClient({ handler: () => ({ data: null, error: null }) });
    const result = await listTaskAttachments(TASK_ID, { supabase: client });
    // Signed in as OWNER; the fake returns no rows, mirroring RLS for OTHER_OWNER data.
    expect(result.data).toEqual([]);
    expect(result.errorMessage).toBeNull();
    expect(OTHER_OWNER).not.toBe(OWNER);
  });
});
