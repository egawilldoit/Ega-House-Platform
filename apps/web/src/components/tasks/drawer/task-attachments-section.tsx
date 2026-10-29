"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Eye,
  FileImage,
  FileText,
  Paperclip,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  ATTACHMENT_ALLOWED_LABEL,
  ATTACHMENT_MAX_FILE_BYTES,
  formatAttachmentSize,
  isPreviewableKind,
  validateAttachmentCandidate,
  type AttachmentKind,
} from "@ega/domain";
import type { TaskAttachmentDto } from "@ega/contracts";

import {
  createAttachmentUploadAction,
  deleteAttachmentAction,
  finalizeAttachmentAction,
  getAttachmentPreviewAction,
} from "@/app/tasks/attachments-actions";
import { AttachmentPreviewDialog } from "@/components/tasks/attachment-preview-dialog";
import { uploadAttachmentToSignedUrl, type AttachmentUploadHandle } from "@/lib/attachment-upload";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { cn } from "@/lib/utils";

type UploadPhase = "uploading" | "verifying" | "error";

type UploadEntry = {
  key: string;
  fileName: string;
  idempotencyKey: string;
  phase: UploadPhase;
  progress: number;
  errorMessage: string | null;
  retryable: boolean;
};

type TaskAttachmentsSectionProps = {
  taskId: string;
  attachments: TaskAttachmentDto[];
  loadError?: string | null;
};

const MAX_LABEL = `${ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024)} MB`;

function kindIcon(kind: AttachmentKind) {
  if (kind === "image") return FileImage;
  return FileText;
}

function statusLabel(attachment: TaskAttachmentDto): string {
  if (attachment.status === "failed") return "Failed";
  if (attachment.status === "pending") return "Not finished";
  return "Ready";
}

/**
 * Task drawer Attachments section.
 *
 * Upload is a three-step bounded workflow: the server issues a ticket for a
 * pending row, the browser PUTs the bytes to the signed URL with real progress,
 * and the server verifies size and content before finalizing. A retry reuses the
 * same idempotency key, so it resolves to the same metadata row.
 */
export function TaskAttachmentsSection({
  taskId,
  attachments,
  loadError = null,
}: TaskAttachmentsSectionProps) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handlesRef = useRef(new Map<string, AttachmentUploadHandle>());
  const filesRef = useRef(new Map<string, File>());
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<TaskAttachmentDto | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    const handles = handlesRef.current;
    return () => {
      for (const handle of handles.values()) handle.abort();
      handles.clear();
    };
  }, []);

  function patchEntry(key: string, patch: Partial<UploadEntry>) {
    setEntries((previous) =>
      previous.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  }

  function removeEntry(key: string) {
    filesRef.current.delete(key);
    setEntries((previous) => previous.filter((entry) => entry.key !== key));
  }

  async function runUpload(entry: UploadEntry, file: File) {
    patchEntry(entry.key, { phase: "uploading", progress: 0, errorMessage: null });

    let attachmentId: string;
    try {
      const ticket = await createAttachmentUploadAction({
        taskId,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        idempotencyKey: entry.idempotencyKey,
      });

      if (!ticket.ok) {
        patchEntry(entry.key, {
          phase: "error",
          errorMessage: ticket.errorMessage,
          retryable: ticket.retryable,
        });
        return;
      }

      attachmentId = ticket.ticket.attachmentId;

      const handle = uploadAttachmentToSignedUrl({
        url: ticket.ticket.uploadUrl,
        file,
        onProgress: (progress) => patchEntry(entry.key, { progress }),
      });
      handlesRef.current.set(entry.key, handle);
      await handle.promise;
      handlesRef.current.delete(entry.key);
    } catch {
      handlesRef.current.delete(entry.key);
      patchEntry(entry.key, {
        phase: "error",
        errorMessage: "The upload did not finish. Check your connection and retry.",
        retryable: true,
      });
      return;
    }

    patchEntry(entry.key, { phase: "verifying", progress: 100 });

    try {
      const finalized = await finalizeAttachmentAction(attachmentId);
      if (!finalized.ok) {
        patchEntry(entry.key, {
          phase: "error",
          errorMessage: finalized.errorMessage,
          retryable: finalized.retryable,
        });
        if (!finalized.retryable) router.refresh();
        return;
      }
      removeEntry(entry.key);
      router.refresh();
    } catch {
      patchEntry(entry.key, {
        phase: "error",
        errorMessage: "The file uploaded, but it could not be verified. Retry to finish it.",
        retryable: true,
      });
    }
  }

  async function queueFiles(files: File[]) {
    if (files.length === 0) return;

    const queued: Array<{ entry: UploadEntry; file: File }> = [];

    for (const file of files) {
      const key = globalThis.crypto.randomUUID();
      const candidate = validateAttachmentCandidate({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!candidate.ok) {
        setEntries((previous) => [
          ...previous,
          {
            key,
            fileName: file.name || "Untitled file",
            idempotencyKey: key,
            phase: "error",
            progress: 0,
            errorMessage: candidate.errorMessage,
            retryable: false,
          },
        ]);
        continue;
      }

      const entry: UploadEntry = {
        key,
        fileName: candidate.candidate.fileName,
        idempotencyKey: globalThis.crypto.randomUUID(),
        phase: "uploading",
        progress: 0,
        errorMessage: null,
        retryable: true,
      };
      queued.push({ entry, file });
      filesRef.current.set(key, file);
    }

    setEntries((previous) => [...previous, ...queued.map((item) => item.entry)]);
    for (const item of queued) {
      await runUpload(item.entry, item.file);
    }
  }

  async function retry(entry: UploadEntry) {
    const file = filesRef.current.get(entry.key);
    if (!file) {
      removeEntry(entry.key);
      router.refresh();
      return;
    }
    await runUpload(entry, file);
  }

  async function handleDelete(attachment: TaskAttachmentDto) {
    setActionError(null);
    setDeletingId(attachment.id);
    try {
      const result = await deleteAttachmentAction(attachment.id);
      if (!result.ok) {
        setActionError(result.errorMessage);
        return;
      }
      if (previewTarget?.id === attachment.id) setPreviewTarget(null);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(attachment: TaskAttachmentDto) {
    setActionError(null);
    setDownloadingId(attachment.id);
    try {
      const result = await getAttachmentPreviewAction(attachment.id, "download");
      if (!result.ok) {
        setActionError(result.errorMessage);
        return;
      }
      const link = document.createElement("a");
      link.href = result.link.url;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      link.click();
    } finally {
      setDownloadingId(null);
    }
  }

  const filesReady = attachments.filter((attachment) => attachment.status === "finalized");
  const filesUnfinished = attachments.length - filesReady.length;
  const uploadsActive = entries.some((entry) => entry.phase !== "error");

  return (
    <section className="mt-4 border-t border-[var(--ega-divider)] pt-3" aria-labelledby={`${inputId}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={`${inputId}-heading`}
          className="glass-label flex items-center gap-1.5 text-[color:var(--ega-text-tertiary)]"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          Attachments
        </h3>
        <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {filesReady.length} {filesReady.length === 1 ? "file" : "files"}
        </span>
      </div>

      {loadError ? (
        <div role="alert" className="feedback-block feedback-block-error mt-2 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" aria-hidden="true" />
          <span className="min-w-0 flex-1">{loadError}</span>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1 text-xs underline"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "mt-2 rounded-[var(--radius-md)] border border-dashed px-3 py-3 transition-colors",
          dragging
            ? "border-[var(--ega-accent)] bg-[color:var(--ega-surface-hover)]"
            : "border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)]",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void queueFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
              Drop files here, or choose them.
            </p>
            <p className="mt-0.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Up to {MAX_LABEL} each · {ATTACHMENT_ALLOWED_LABEL}
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-3 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Choose files
          </button>
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void queueFiles(files);
          }}
        />
      </div>

      <div aria-live="polite" className="mt-2 flex flex-col gap-2">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] px-2.5 py-2"
          >
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                  {entry.fileName}
                </p>
                <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  {entry.phase === "uploading"
                    ? entry.progress > 0
                      ? `Uploading ${entry.progress}%`
                      : "Uploading…"
                    : entry.phase === "verifying"
                      ? "Verifying file…"
                      : entry.errorMessage}
                </p>
                {entry.phase === "uploading" && entry.progress > 0 ? (
                  <ProgressBar
                    value={entry.progress}
                    label={`Uploading ${entry.fileName}`}
                    valueText={`${entry.progress}% of ${entry.fileName}`}
                    variant="cyan"
                    className="mt-1"
                  />
                ) : null}
              </div>
              {entry.phase === "error" ? (
                <div className="flex shrink-0 items-center gap-1">
                  {entry.retryable ? (
                    <button
                      type="button"
                      onClick={() => void retry(entry)}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-2 text-[length:var(--text-meta)] text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.key)}
                    aria-label={`Dismiss ${entry.fileName}`}
                    className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {uploadsActive ? (
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Files are verified on the server before they appear in the list.
          </p>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="feedback-block feedback-block-error mt-2">
          {actionError}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No files attached"
          description={`Attach an image, PDF or text file to this task. Files stay private to your account and open through short-lived links.`}
          className="mt-2"
        />
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {attachments.map((attachment) => {
            const Icon = kindIcon(attachment.kind);
            const previewable = attachment.status === "finalized" && isPreviewableKind(attachment.kind);
            return (
              <li
                key={attachment.id}
                className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--ega-divider)] px-2.5 py-2"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ega-text-secondary)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                    {attachment.fileName}
                  </p>
                  <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                    {statusLabel(attachment)} · {formatAttachmentSize(attachment.sizeBytes)} ·{" "}
                    {formatTimerDateTime(attachment.createdAt)}
                  </p>
                  {attachment.status !== "finalized" ? (
                    <p className="mt-0.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                      {attachment.status === "pending"
                        ? "This upload was started but never finished. Delete it and attach the file again."
                        : "This upload was rejected. Delete it and try a supported file."}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {previewable ? (
                    <button
                      type="button"
                      onClick={() => setPreviewTarget(attachment)}
                      aria-label={`Preview ${attachment.fileName}`}
                      className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                  {attachment.status === "finalized" ? (
                    <button
                      type="button"
                      onClick={() => void handleDownload(attachment)}
                      aria-label={`Download ${attachment.fileName}`}
                      disabled={downloadingId === attachment.id}
                      className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)] disabled:opacity-60"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDelete(attachment)}
                    disabled={deletingId === attachment.id}
                    aria-label={`Delete ${attachment.fileName}`}
                    className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--status-overdue)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)] disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {filesUnfinished > 0 ? (
        <p className="mt-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {filesUnfinished} unfinished {filesUnfinished === 1 ? "upload is" : "uploads are"} not
          counted as attached files.
        </p>
      ) : null}

      <AttachmentPreviewDialog
        key={previewTarget?.id ?? "closed"}
        attachment={
          previewTarget
            ? { id: previewTarget.id, fileName: previewTarget.fileName, kind: previewTarget.kind }
            : null
        }
        onClose={() => setPreviewTarget(null)}
      />
    </section>
  );
}
