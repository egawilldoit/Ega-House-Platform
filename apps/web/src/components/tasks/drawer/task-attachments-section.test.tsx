// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/tasks/attachments-actions", () => ({
  createAttachmentUploadAction: vi.fn(),
  finalizeAttachmentAction: vi.fn(),
  deleteAttachmentAction: vi.fn(),
  getAttachmentPreviewAction: vi.fn(),
}));

import {
  createAttachmentUploadAction,
  deleteAttachmentAction,
  getAttachmentPreviewAction,
} from "@/app/tasks/attachments-actions";
import type { TaskAttachmentDto } from "@ega/contracts";
import { TaskAttachmentsSection } from "./task-attachments-section";

const TASK_ID = "33333333-3333-4333-8333-333333333333";

const ATTACHMENT = {
  id: "44444444-4444-4444-8444-444444444444",
  taskId: TASK_ID,
  projectId: null,
  fileName: "plan.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  kind: "image" as const,
  status: "finalized" as const,
  createdAt: "2026-10-28T10:00:00.000Z",
  finalizedAt: "2026-10-28T10:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockClear();
  vi.mocked(createAttachmentUploadAction).mockReset();
  vi.mocked(deleteAttachmentAction).mockReset();
  vi.mocked(getAttachmentPreviewAction).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function render(attachments: TaskAttachmentDto[] = [], loadError: string | null = null) {
  act(() =>
    root.render(
      <TaskAttachmentsSection
        taskId={TASK_ID}
        attachments={attachments}
        loadError={loadError}
      />,
    ),
  );
}

describe("TaskAttachmentsSection", () => {
  it("shows the upload limits, empty state and a keyboard-reachable picker", () => {
    render();
    expect(document.body.textContent).toContain("No files attached");
    expect(document.body.textContent).toContain("Up to 10 MB each");
    expect(document.body.textContent).toContain("PNG, JPG, GIF, WebP, PDF, TXT, MD, CSV");

    const choose = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Choose files"),
    );
    expect(choose).toBeDefined();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toContain(".png");
    expect(input?.multiple).toBe(true);
  });

  it("renders finalized, pending and failed files honestly", () => {
    render([
      ATTACHMENT,
      {
        ...ATTACHMENT,
        id: "55555555-5555-4555-8555-555555555555",
        fileName: "notes.md",
        kind: "document",
        mimeType: "text/markdown",
        status: "pending",
        finalizedAt: null,
      },
      {
        ...ATTACHMENT,
        id: "66666666-6666-4666-8666-666666666666",
        fileName: "rejected.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        status: "failed",
        finalizedAt: null,
      },
    ]);

    expect(document.body.textContent).toContain("plan.png");
    expect(document.body.textContent).toContain("notes.md");
    expect(document.body.textContent).toContain("rejected.pdf");
    expect(document.body.textContent).toContain("This upload was started but never finished");
    expect(document.body.textContent).toContain("This upload was rejected");

    expect(document.body.querySelector('[aria-label="Preview plan.png"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Download plan.png"]')).not.toBeNull();
    // A non-previewable type keeps download but not preview.
    expect(document.body.querySelector('[aria-label="Preview notes.md"]')).toBeNull();
  });

  it("deletes through the server action and refreshes the drawer", async () => {
    vi.mocked(deleteAttachmentAction).mockResolvedValue({ ok: true });
    render([ATTACHMENT]);

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Delete plan.png"]')
        ?.click();
      await Promise.resolve();
    });

    expect(deleteAttachmentAction).toHaveBeenCalledWith(ATTACHMENT.id);
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a delete failure without removing the row", async () => {
    vi.mocked(deleteAttachmentAction).mockResolvedValue({
      ok: false,
      errorMessage: "Unable to delete the stored file right now. Try again.",
      retryable: true,
    });
    render([ATTACHMENT]);

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Delete plan.png"]')
        ?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Unable to delete the stored file right now");
    expect(refresh).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("plan.png");
  });

  it("rejects an unsupported file before any upload request", async () => {
    render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["<svg/>"], "payload.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("That file type is not supported.");
    expect(createAttachmentUploadAction).not.toHaveBeenCalled();
  });

  it("previews an image through a signed link and drops it on close", async () => {
    vi.mocked(getAttachmentPreviewAction).mockResolvedValue({
      ok: true,
      link: {
        url: "https://storage.test/object/signed?token=secret",
        expiresAt: new Date().toISOString(),
        kind: "image",
        fileName: "plan.png",
      },
    });
    render([ATTACHMENT]);

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Preview plan.png"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getAttachmentPreviewAction).toHaveBeenCalledWith(ATTACHMENT.id, "preview");
    const image = document.body.querySelector<HTMLImageElement>(
      'img[alt="plan.png"]',
    );
    expect(image?.src).toContain("https://storage.test/object/signed");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Close preview"]')
        ?.click();
      await Promise.resolve();
    });

    expect(document.body.querySelector('img[alt="plan.png"]')).toBeNull();
  });

  it("keeps an explicit error state with a retry path", () => {
    render([], "Unable to load attachments right now.");
    expect(document.body.textContent).toContain("Unable to load attachments right now.");
    const retry = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry"),
    );
    expect(retry).toBeDefined();
  });
});
