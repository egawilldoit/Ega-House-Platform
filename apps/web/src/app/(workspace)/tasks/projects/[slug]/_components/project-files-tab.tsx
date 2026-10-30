"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Eye,
  FileImage,
  FileText,
  FolderOpen,
  RefreshCw,
  Trash2,
} from "lucide-react";

import {
  ATTACHMENT_SORT_VALUES,
  ATTACHMENT_TYPE_FILTER_VALUES,
  formatAttachmentSize,
  isPreviewableKind,
  type AttachmentSort,
  type AttachmentTypeFilter,
} from "@ega/domain";
import type { ProjectAttachmentDto } from "@ega/contracts";

import { deleteAttachmentAction, getAttachmentPreviewAction } from "@/app/(workspace)/tasks/attachments-actions";
import { AttachmentPreviewDialog } from "@/components/tasks/attachment-preview-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { cn } from "@/lib/utils";

type ProjectFilesTabProps = {
  projectSlug: string;
  /** Raw `view` query value so filter submits stay on the same project scope. */
  view: string;
  files: ProjectAttachmentDto[];
  filters: {
    kind: AttachmentTypeFilter;
    query: string | null;
    sort: AttachmentSort;
  };
  pendingCount: number;
  failedCount: number;
  errorMessage: string | null;
};

const TYPE_LABELS: Record<AttachmentTypeFilter, string> = {
  all: "All types",
  image: "Images",
  pdf: "PDFs",
  document: "Documents",
};

const SORT_LABELS: Record<AttachmentSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A–Z",
  largest: "Largest first",
};

/**
 * Project Files.
 *
 * Filters are a native GET form, so search, type and sort work without
 * JavaScript and the URL remains the state owner. Only finalized rows reach
 * this component; unfinished uploads are counted and named, never shown as
 * files.
 */
export function ProjectFilesTab({
  projectSlug,
  view,
  files,
  filters,
  pendingCount,
  failedCount,
  errorMessage,
}: ProjectFilesTabProps) {
  const router = useRouter();
  const [previewTarget, setPreviewTarget] = useState<ProjectAttachmentDto | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const basePath = `/tasks/projects/${projectSlug}`;
  const filtersActive =
    filters.kind !== "all" || Boolean(filters.query) || filters.sort !== "newest";
  const unfinished = pendingCount + failedCount;

  async function handleDelete(file: ProjectAttachmentDto) {
    setActionError(null);
    setDeletingId(file.id);
    try {
      const result = await deleteAttachmentAction(file.id);
      if (!result.ok) {
        setActionError(result.errorMessage);
        return;
      }
      if (previewTarget?.id === file.id) setPreviewTarget(null);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(file: ProjectAttachmentDto) {
    setActionError(null);
    setDownloadingId(file.id);
    try {
      const result = await getAttachmentPreviewAction(file.id, "download");
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

  return (
    <section aria-labelledby="project-files-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="project-files-heading" className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
            Files
          </h2>
          <p className="mt-1 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            {files.length} {files.length === 1 ? "file" : "files"} across this project.
          </p>
        </div>
        {unfinished > 0 ? (
          <p className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {unfinished} unfinished {unfinished === 1 ? "upload is" : "uploads are"} not listed. Open
            the task to retry or delete {unfinished === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </div>

      <form
        method="get"
        action={basePath}
        className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-3"
      >
        <input type="hidden" name="tab" value="files" />
        {view !== "active" ? <input type="hidden" name="view" value={view} /> : null}
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label
            htmlFor="project-file-query"
            className="glass-label text-[color:var(--ega-text-tertiary)]"
          >
            Search files
          </label>
          <input
            id="project-file-query"
            name="fileQuery"
            type="search"
            defaultValue={filters.query ?? ""}
            maxLength={80}
            placeholder="File name"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-file-kind" className="glass-label text-[color:var(--ega-text-tertiary)]">
            Type
          </label>
          <select
            id="project-file-kind"
            name="fileKind"
            defaultValue={filters.kind}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
          >
            {ATTACHMENT_TYPE_FILTER_VALUES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-file-sort" className="glass-label text-[color:var(--ega-text-tertiary)]">
            Sort
          </label>
          <select
            id="project-file-sort"
            name="fileSort"
            defaultValue={filters.sort}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
          >
            {ATTACHMENT_SORT_VALUES.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-3 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
        >
          Apply
        </button>
        {filtersActive ? (
          <Link
            href={`${basePath}?tab=files${view !== "active" ? `&view=${encodeURIComponent(view)}` : ""}`}
            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2 text-xs text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      {errorMessage ? (
        <div role="alert" className="feedback-block feedback-block-error flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" aria-hidden="true" />
          <span className="min-w-0 flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-1 text-xs underline"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {actionError}
        </p>
      ) : null}

      {files.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={filtersActive ? "No files match these filters" : "No files in this project yet"}
          description={
            filtersActive
              ? "Try a different name, type or sort order."
              : "Attach files from a task in this project to see them here."
          }
          action={
            filtersActive ? (
              <Link
                href={`${basePath}?tab=files`}
                className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs"
              >
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((file) => {
            const Icon = file.kind === "image" ? FileImage : FileText;
            const previewable = isPreviewableKind(file.kind);
            return (
              <li
                key={file.id}
                className={cn(
                  "flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--ega-border)]",
                  "bg-[color:var(--ega-surface-subtle)] p-3",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ega-surface-elevated)]">
                    <Icon className="h-4 w-4 text-[color:var(--ega-text-secondary)]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text)]" title={file.fileName}>
                      {file.fileName}
                    </p>
                    <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                      {file.taskTitle ? `${file.taskTitle} · ` : ""}
                      {formatAttachmentSize(file.sizeBytes)} · {formatTimerDateTime(file.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  {previewable ? (
                    <button
                      type="button"
                      onClick={() => setPreviewTarget(file)}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-2 text-[length:var(--text-meta)] text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDownload(file)}
                    disabled={downloadingId === file.id}
                    className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-2 text-[length:var(--text-meta)] text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)] disabled:opacity-60"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(file)}
                    disabled={deletingId === file.id}
                    aria-label={`Delete ${file.fileName}`}
                    className="ml-auto inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--status-overdue)] hover:bg-[var(--ega-surface-hover)] disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Preview and download links are private and expire about a minute after they are issued.
        Deleting a file removes it from storage as well as this list.
      </p>

      <AttachmentPreviewDialog
        key={previewTarget?.id ?? "closed"}
        attachment={
          previewTarget
            ? {
                id: previewTarget.id,
                fileName: previewTarget.fileName,
                kind: previewTarget.kind,
              }
            : null
        }
        onClose={() => setPreviewTarget(null)}
      />
    </section>
  );
}
