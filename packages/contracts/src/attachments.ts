import type {
  AttachmentKind,
  AttachmentSort,
  AttachmentTypeFilter,
} from "@ega/domain";

export type { AttachmentKind, AttachmentSort, AttachmentTypeFilter };

/**
 * Wire shape for one task attachment (EGA-802).
 *
 * The storage path is server-owned and never part of the rendered DTO; clients
 * address an attachment by id and receive a short-lived URL on demand.
 */
export type TaskAttachmentDto = {
  id: string;
  taskId: string;
  projectId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  status: "pending" | "finalized" | "failed";
  createdAt: string;
  finalizedAt: string | null;
};

/** A project Files row carries the task it belongs to for grouping. */
export type ProjectAttachmentDto = TaskAttachmentDto & { taskTitle: string | null };

export type AttachmentUploadTicket = {
  attachmentId: string;
  uploadUrl: string;
  /** Expiry of the upload ticket, not of a preview link. */
  expiresAt: string;
};

export type AttachmentPreviewLink = {
  url: string;
  /** Short-lived signed URL expiry, documented at 60 seconds. */
  expiresAt: string;
  kind: AttachmentKind;
  fileName: string;
};

export type AttachmentFailure = {
  ok: false;
  errorMessage: string;
  /** True when the same request may be retried without duplicating a row. */
  retryable: boolean;
};

export type AttachmentUploadResult = { ok: true; ticket: AttachmentUploadTicket } | AttachmentFailure;
export type AttachmentFinalizeResult = { ok: true; attachment: TaskAttachmentDto } | AttachmentFailure;
export type AttachmentDeleteResult = { ok: true } | AttachmentFailure;
export type AttachmentPreviewResult = { ok: true; link: AttachmentPreviewLink } | AttachmentFailure;
