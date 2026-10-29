import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_FILES_PER_TASK,
  ATTACHMENT_PENDING_TTL_MINUTES,
  ATTACHMENT_PREVIEW_URL_TTL_SECONDS,
  ATTACHMENT_PROJECT_PAGE_SIZE,
  ATTACHMENT_RECONCILE_BATCH_SIZE,
  DEFAULT_ATTACHMENT_SORT,
  DEFAULT_ATTACHMENT_TYPE_FILTER,
  escapeLikePattern,
  getAttachmentKind,
  isAttachmentSort,
  isAttachmentTypeFilter,
  normalizeAttachmentSearch,
  validateAttachmentCandidate,
  validateAttachmentContent,
  type AttachmentSort,
  type AttachmentTypeFilter,
} from "@ega/domain";
import type {
  AttachmentDeleteResult,
  AttachmentFinalizeResult,
  AttachmentPreviewResult,
  AttachmentUploadResult,
  ProjectAttachmentDto,
  TaskAttachmentDto,
} from "@ega/contracts";

import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type AttachmentRow = Tables<"task_attachments">;

/** Exposed for tests so the fake client can be typed against the real surface. */
export type AttachmentSupabaseClient = SupabaseServerClient;

const ATTACHMENT_SELECT =
  "id, owner_user_id, task_id, file_name, storage_path, mime_type, size_bytes, status, idempotency_key, upload_expires_at, finalized_at, created_at, updated_at";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type AttachmentListResult = {
  data: TaskAttachmentDto[];
  errorMessage: string | null;
};

export type ProjectAttachmentListResult = {
  data: ProjectAttachmentDto[];
  /** Unfinished uploads are never listed as files, but are named honestly. */
  pendingCount: number;
  failedCount: number;
  errorMessage: string | null;
};

export type AttachmentFilters = {
  kind?: AttachmentTypeFilter;
  query?: string | null;
  sort?: AttachmentSort;
};

function mapAttachment(row: AttachmentRow): TaskAttachmentDto {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: null,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    kind: getAttachmentKind(row.mime_type),
    status:
      row.status === "finalized" || row.status === "failed" ? row.status : "pending",
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}

async function resolve(supabase?: SupabaseServerClient) {
  const client = supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(client);
  return { client, ownerUserId };
}

function failure(errorMessage: string, retryable = false) {
  return { ok: false as const, errorMessage, retryable };
}

function rpcObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function codeMessage(
  code: string,
): { ok: false; errorMessage: string; retryable: boolean } {
  switch (code) {
    case "not_found":
      return {
        ok: false,
        errorMessage: "Task was not found or is no longer available.",
        retryable: false,
      };
    case "task_limit":
      return {
        ok: false,
        errorMessage: `This task already has the maximum of ${ATTACHMENT_MAX_FILES_PER_TASK} files.`,
        retryable: false,
      };
    case "owner_quota":
      return {
        ok: false,
        errorMessage: "Your attachment storage is full. Delete a file to free space.",
        retryable: false,
      };
    case "invalid_size":
      return {
        ok: false,
        errorMessage: `Files must be ${ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`,
        retryable: false,
      };
    case "invalid_type":
      return { ok: false, errorMessage: "That file type is not supported.", retryable: false };
    case "invalid_name":
      return { ok: false, errorMessage: "That file name cannot be used.", retryable: false };
    case "idempotency_conflict":
      return {
        ok: false,
        errorMessage: "This upload no longer matches its original request. Try again.",
        retryable: false,
      };
    case "not_authenticated":
      return { ok: false, errorMessage: "Sign in again to attach files.", retryable: false };
    default:
      return { ok: false, errorMessage: "Unable to start the upload right now.", retryable: true };
  }
}

/** Owner + parent-task scoped metadata for the drawer. */
export async function listTaskAttachments(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<AttachmentListResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId || !isUuid(taskId)) {
    return { data: [], errorMessage: "Task was not found or is no longer available." };
  }

  const { data, error } = await client
    .from("task_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("task_id", taskId)
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });

  if (error) return { data: [], errorMessage: "Unable to load attachments right now." };
  return {
    data: (data ?? []).map((row) => mapAttachment(row as AttachmentRow)),
    errorMessage: null,
  };
}

function normalizeFilters(filters?: AttachmentFilters): {
  kind: AttachmentTypeFilter;
  query: string | null;
  sort: AttachmentSort;
} {
  return {
    kind: isAttachmentTypeFilter(filters?.kind)
      ? filters.kind
      : DEFAULT_ATTACHMENT_TYPE_FILTER,
    query: normalizeAttachmentSearch(filters?.query),
    sort: isAttachmentSort(filters?.sort) ? filters.sort : DEFAULT_ATTACHMENT_SORT,
  };
}

type ProjectAttachmentRow = AttachmentRow & {
  tasks: { title: string | null } | { title: string | null }[] | null;
};

function embeddedTaskTitle(row: ProjectAttachmentRow): string | null {
  const embedded = row.tasks;
  if (!embedded) return null;
  if (Array.isArray(embedded)) return embedded[0]?.title ?? null;
  return embedded.title ?? null;
}

/**
 * Project Files read model.
 *
 * Only finalized rows are files. The embedded `tasks!inner` filter proves the
 * parent project and owner in the same authorized query, so a forged project id
 * cannot list another owner's metadata. Both the file page and the unfinished
 * counts are bounded.
 */
export async function listProjectAttachments(
  projectId: string,
  filters?: AttachmentFilters,
  options?: { supabase?: SupabaseServerClient },
): Promise<ProjectAttachmentListResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) {
    return {
      data: [],
      pendingCount: 0,
      failedCount: 0,
      errorMessage: "Project was not found or is no longer available.",
    };
  }

  if (!isUuid(projectId)) {
    return {
      data: [],
      pendingCount: 0,
      failedCount: 0,
      errorMessage: "Project was not found or is no longer available.",
    };
  }

  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (!project) {
    return {
      data: [],
      pendingCount: 0,
      failedCount: 0,
      errorMessage: "Project was not found or is no longer available.",
    };
  }

  const { kind, query, sort } = normalizeFilters(filters);

  let filesQuery = client
    .from("task_attachments")
    .select(`${ATTACHMENT_SELECT}, tasks!inner(title, project_id, owner_user_id)`)
    .eq("owner_user_id", ownerUserId)
    .eq("status", "finalized")
    .eq("tasks.project_id", projectId)
    .eq("tasks.owner_user_id", ownerUserId)
    .limit(ATTACHMENT_PROJECT_PAGE_SIZE);

  if (kind === "image") filesQuery = filesQuery.like("mime_type", "image/%");
  if (kind === "pdf") filesQuery = filesQuery.eq("mime_type", "application/pdf");
  if (kind === "document") filesQuery = filesQuery.like("mime_type", "text/%");
  if (query) filesQuery = filesQuery.ilike("file_name", `%${escapeLikePattern(query)}%`);

  filesQuery =
    sort === "oldest"
      ? filesQuery.order("created_at", { ascending: true })
      : sort === "name"
        ? filesQuery.order("file_name", { ascending: true })
        : sort === "largest"
          ? filesQuery.order("size_bytes", { ascending: false })
          : filesQuery.order("created_at", { ascending: false });

  const [filesResult, pendingResult, failedResult] = await Promise.all([
    filesQuery,
    client
      .from("task_attachments")
      .select("id, tasks!inner(project_id, owner_user_id)", { count: "exact", head: true })
      .eq("owner_user_id", ownerUserId)
      .eq("status", "pending")
      .eq("tasks.project_id", projectId)
      .eq("tasks.owner_user_id", ownerUserId),
    client
      .from("task_attachments")
      .select("id, tasks!inner(project_id, owner_user_id)", { count: "exact", head: true })
      .eq("owner_user_id", ownerUserId)
      .eq("status", "failed")
      .eq("tasks.project_id", projectId)
      .eq("tasks.owner_user_id", ownerUserId),
  ]);

  if (filesResult.error) {
    return {
      data: [],
      pendingCount: 0,
      failedCount: 0,
      errorMessage: "Unable to load project files right now.",
    };
  }

  return {
    data: ((filesResult.data ?? []) as unknown as ProjectAttachmentRow[]).map((row) => ({
      ...mapAttachment(row),
      taskTitle: embeddedTaskTitle(row),
    })),
    pendingCount: pendingResult.count ?? 0,
    failedCount: failedResult.count ?? 0,
    errorMessage: null,
  };
}

/**
 * Bounded cleanup for abandoned upload tickets. Removes at most
 * ATTACHMENT_RECONCILE_BATCH_SIZE expired pending objects and rows; failures are
 * left for the next pass instead of widening the failure surface of an upload.
 */
async function reconcilePendingUploads(
  client: SupabaseServerClient,
  ownerUserId: string,
): Promise<void> {
  const { data: expired } = await client
    .from("task_attachments")
    .select("id, storage_path")
    .eq("owner_user_id", ownerUserId)
    .eq("status", "pending")
    .lt("upload_expires_at", new Date().toISOString())
    .order("upload_expires_at", { ascending: true })
    .limit(ATTACHMENT_RECONCILE_BATCH_SIZE);

  if (!expired?.length) return;

  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  for (const row of expired) {
    const { error: removeError } = await bucket.remove([row.storage_path]);
    if (removeError) continue;
    await client.rpc("delete_task_attachment", { p_attachment_id: row.id });
  }
}

export async function createAttachmentUpload(
  input: {
    taskId: string;
    fileName: unknown;
    mimeType: unknown;
    sizeBytes: unknown;
    idempotencyKey: string;
  },
  options?: { supabase?: SupabaseServerClient },
): Promise<AttachmentUploadResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return failure("Task was not found or is no longer available.");
  if (!isUuid(input.taskId)) return failure("Task was not found or is no longer available.");
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    return failure("Unable to start the upload right now.", true);
  }

  const candidate = validateAttachmentCandidate({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  if (!candidate.ok) return failure(candidate.errorMessage);

  await reconcilePendingUploads(client, ownerUserId);

  const { data, error } = await client.rpc("create_task_attachment_upload", {
    p_task_id: input.taskId,
    p_file_name: candidate.candidate.fileName,
    p_mime_type: candidate.candidate.mimeType,
    p_size_bytes: candidate.candidate.sizeBytes,
    p_extension: candidate.candidate.extension,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) return failure("Unable to start the upload right now.", true);
  const result = rpcObject(data);
  if (!result || result.ok !== true) {
    return codeMessage(String(result?.code ?? "unknown"));
  }

  const storagePath = String(result.storage_path ?? "");
  const attachmentId = String(result.id ?? "");
  if (!storagePath || !attachmentId) {
    return failure("Unable to start the upload right now.", true);
  }

  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  const ticket = await bucket.createSignedUploadUrl(storagePath, { upsert: true });
  if (ticket.error || !ticket.data?.signedUrl) {
    return failure("Unable to start the upload right now.", true);
  }

  return {
    ok: true,
    ticket: {
      attachmentId,
      uploadUrl: ticket.data.signedUrl,
      expiresAt: new Date(
        Date.now() + ATTACHMENT_PENDING_TTL_MINUTES * 60 * 1000,
      ).toISOString(),
    },
  };
}

async function findAttachment(
  client: SupabaseServerClient,
  ownerUserId: string,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  if (!isUuid(attachmentId)) return null;
  const { data } = await client
    .from("task_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("id", attachmentId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  return (data as AttachmentRow | null) ?? null;
}

async function failAndRemove(
  client: SupabaseServerClient,
  attachment: AttachmentRow,
  errorMessage: string,
): Promise<AttachmentFinalizeResult> {
  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  await bucket.remove([attachment.storage_path]);
  await client.rpc("fail_task_attachment", {
    p_attachment_id: attachment.id,
    p_reason: errorMessage,
  });
  return failure(errorMessage);
}

/**
 * Finalizes a pending upload after re-reading the stored object.
 *
 * The client cannot finalize by itself: metadata writes are revoked, and this
 * function checks the measured size, then sniffs the bytes for an allowed inert
 * signature. This is content validation, not malware scanning.
 */
export async function finalizeAttachment(
  attachmentId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<AttachmentFinalizeResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return failure("Attachment was not found.");

  const attachment = await findAttachment(client, ownerUserId, attachmentId);
  if (!attachment) return failure("Attachment was not found.");
  if (attachment.status === "finalized") {
    return { ok: true, attachment: mapAttachment(attachment) };
  }
  if (attachment.status !== "pending") {
    return failure("This upload failed. Remove it and try again.");
  }

  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  const segments = attachment.storage_path.split("/");
  const objectName = segments.pop() ?? "";
  const folder = segments.join("/");

  const listing = await bucket.list(folder, { limit: 20, search: objectName });
  if (listing.error) return failure("The upload could not be verified. Try again.", true);

  const entry = (listing.data ?? []).find((item) => item.name === objectName);
  if (!entry) {
    return failure("The upload did not finish. Try again.", true);
  }

  const listedSize = Number(
    (entry.metadata as { size?: number | string } | null | undefined)?.size ?? NaN,
  );
  if (Number.isFinite(listedSize) && listedSize !== attachment.size_bytes) {
    return failAndRemove(
      client,
      attachment,
      "The uploaded file did not match the expected size.",
    );
  }

  const download = await bucket.download(attachment.storage_path);
  if (download.error || !download.data) {
    return failure("The upload could not be verified. Try again.", true);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > ATTACHMENT_MAX_FILE_BYTES) {
    return failAndRemove(client, attachment, "The uploaded file is not an accepted size.");
  }
  if (bytes.byteLength !== attachment.size_bytes) {
    return failAndRemove(
      client,
      attachment,
      "The uploaded file did not match the expected size.",
    );
  }

  const content = validateAttachmentContent(bytes, attachment.mime_type);
  if (!content.ok) {
    return failAndRemove(client, attachment, content.errorMessage);
  }

  const { data, error } = await client.rpc("finalize_task_attachment", {
    p_attachment_id: attachment.id,
    p_size_bytes: bytes.byteLength,
  });
  if (error) return failure("Unable to finish the upload right now.", true);

  const result = rpcObject(data);
  if (!result || result.ok !== true) {
    return codeMessage(String(result?.code ?? "unknown"));
  }

  const finalized = await findAttachment(client, ownerUserId, attachmentId);
  if (!finalized) return failure("Attachment was not found.");
  return { ok: true, attachment: mapAttachment(finalized) };
}

/**
 * Deletes the stored object first, then the metadata row. If the object delete
 * fails the row stays addressable so the caller can retry; if the metadata
 * delete fails after the object is gone, a retry removes nothing and completes
 * the row deletion, which is why both steps are idempotent.
 */
export async function deleteAttachment(
  attachmentId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<AttachmentDeleteResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return failure("Attachment was not found.");

  const attachment = await findAttachment(client, ownerUserId, attachmentId);
  if (!attachment) return { ok: true };

  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  const removal = await bucket.remove([attachment.storage_path]);
  if (removal.error) {
    return failure("Unable to delete the stored file right now. Try again.", true);
  }

  const { data, error } = await client.rpc("delete_task_attachment", {
    p_attachment_id: attachment.id,
  });
  if (error) return failure("Unable to delete the attachment right now.", true);

  const result = rpcObject(data);
  if (!result || result.ok !== true) {
    return codeMessage(String(result?.code ?? "unknown"));
  }
  return { ok: true };
}

/**
 * Issues a short-lived signed URL only after an owner-scoped lookup. The URL is
 * returned to the caller and never persisted or logged.
 */
export async function getAttachmentPreviewLink(
  attachmentId: string,
  options?: { supabase?: SupabaseServerClient; download?: boolean },
): Promise<AttachmentPreviewResult> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return failure("Attachment was not found.");

  const attachment = await findAttachment(client, ownerUserId, attachmentId);
  if (!attachment || attachment.status !== "finalized") {
    return failure("Attachment was not found.");
  }

  const bucket = client.storage.from(ATTACHMENT_BUCKET);
  const signed = await bucket.createSignedUrl(
    attachment.storage_path,
    ATTACHMENT_PREVIEW_URL_TTL_SECONDS,
    options?.download ? { download: attachment.file_name } : undefined,
  );
  if (signed.error || !signed.data?.signedUrl) {
    return failure("Unable to open the file right now. Try again.", true);
  }

  return {
    ok: true,
    link: {
      url: signed.data.signedUrl,
      expiresAt: new Date(
        Date.now() + ATTACHMENT_PREVIEW_URL_TTL_SECONDS * 1000,
      ).toISOString(),
      kind: getAttachmentKind(attachment.mime_type),
      fileName: attachment.file_name,
    },
  };
}
