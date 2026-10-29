"use server";

import type {
  AttachmentDeleteResult,
  AttachmentFinalizeResult,
  AttachmentPreviewResult,
  AttachmentUploadResult,
} from "@ega/contracts";

import {
  createAttachmentUpload,
  deleteAttachment,
  finalizeAttachment,
  getAttachmentPreviewLink,
} from "@/lib/services/attachment-service";

/**
 * Server actions for the attachment workflow.
 *
 * Every action re-derives the owner from the verified session inside the
 * service; the arguments below are untrusted input. Storage and metadata are
 * separate resources, so upload, finalize and delete stay separate steps.
 */
export async function createAttachmentUploadAction(input: {
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  idempotencyKey: string;
}): Promise<AttachmentUploadResult> {
  return createAttachmentUpload({
    taskId: String(input?.taskId ?? ""),
    fileName: input?.fileName,
    mimeType: input?.mimeType,
    sizeBytes: input?.sizeBytes,
    idempotencyKey: String(input?.idempotencyKey ?? ""),
  });
}

export async function finalizeAttachmentAction(
  attachmentId: string,
): Promise<AttachmentFinalizeResult> {
  return finalizeAttachment(String(attachmentId ?? ""));
}

export async function deleteAttachmentAction(
  attachmentId: string,
): Promise<AttachmentDeleteResult> {
  return deleteAttachment(String(attachmentId ?? ""));
}

export async function getAttachmentPreviewAction(
  attachmentId: string,
  mode: "preview" | "download" = "preview",
): Promise<AttachmentPreviewResult> {
  return getAttachmentPreviewLink(String(attachmentId ?? ""), {
    download: mode === "download",
  });
}
