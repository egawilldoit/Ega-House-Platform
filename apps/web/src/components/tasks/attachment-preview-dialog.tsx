"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X } from "lucide-react";

import type { AttachmentKind } from "@ega/domain";
import { getAttachmentPreviewAction } from "@/app/tasks/attachments-actions";

export type AttachmentPreviewTarget = {
  id: string;
  fileName: string;
  kind: AttachmentKind;
};

type AttachmentPreviewDialogProps = {
  attachment: AttachmentPreviewTarget | null;
  onClose: () => void;
};

/**
 * Shared preview surface for the drawer and the project Files tab.
 *
 * The signed URL is requested only when the dialog opens, is never persisted,
 * and is dropped when the dialog closes. Images and PDFs preview inside the
 * dialog; every other type keeps the download path.
 */
export function AttachmentPreviewDialog({ attachment, onClose }: AttachmentPreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(attachment));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attachmentId = attachment?.id ?? null;

  // The parent remounts this dialog per attachment (keyed), so opening a file
  // starts from fresh state without a synchronous state reset in an effect.
  useEffect(() => {
    if (!attachmentId) return;

    let active = true;
    void getAttachmentPreviewAction(attachmentId, "preview").then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.ok) {
        setUrl(result.link.url);
      } else {
        setErrorMessage(result.errorMessage);
      }
    });

    return () => {
      active = false;
    };
  }, [attachmentId]);

  async function refresh() {
    if (!attachmentId) return;
    setLoading(true);
    setErrorMessage(null);
    const result = await getAttachmentPreviewAction(attachmentId, "preview");
    setLoading(false);
    if (result.ok) {
      setUrl(result.link.url);
    } else {
      setErrorMessage(result.errorMessage);
    }
  }

  return (
    <Dialog.Root
      open={attachment !== null}
      onOpenChange={(open) => {
        if (!open) {
          setUrl(null);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--ega-overlay)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)]">
          <div className="flex items-center gap-2 border-b border-[var(--ega-divider)] px-3 py-2">
            <Dialog.Title className="min-w-0 flex-1 truncate text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text)]">
              {attachment?.fileName ?? "Attachment"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close preview"
                className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="border-b border-[var(--ega-divider)] px-3 py-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Private link, expires about a minute after it is issued.
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-auto bg-[color:var(--ega-surface-subtle)] p-3">
            {loading ? (
              <p
                role="status"
                className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]"
              >
                Opening file…
              </p>
            ) : errorMessage ? (
              <div role="alert" className="flex flex-col items-start gap-2">
                <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                  {errorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-3 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh link
                </button>
              </div>
            ) : url && attachment?.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- the image is a short-lived signed URL from a private bucket.
              <img
                src={url}
                alt={attachment.fileName}
                className="mx-auto max-h-[70vh] w-auto max-w-full"
              />
            ) : url && attachment?.kind === "pdf" ? (
              <iframe
                src={url}
                title={attachment.fileName}
                className="h-[70vh] w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-white"
              />
            ) : null}
          </div>
          {url ? (
            <div className="flex items-center justify-between gap-2 border-t border-[var(--ega-divider)] px-3 py-2">
              <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                If the preview stays blank, open the file in a new tab.
              </span>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-3 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
              >
                Open in new tab
              </a>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
