// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}));

vi.mock("@/app/(workspace)/tasks/attachments-actions", () => ({
  deleteAttachmentAction: vi.fn(),
  getAttachmentPreviewAction: vi.fn(),
}));

import { deleteAttachmentAction, getAttachmentPreviewAction } from "@/app/(workspace)/tasks/attachments-actions";
import { ProjectFilesTab } from "./project-files-tab";

const FILE = {
  id: "44444444-4444-4444-8444-444444444444",
  taskId: "33333333-3333-4333-8333-333333333333",
  projectId: null,
  fileName: "launch-plan.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  kind: "pdf" as const,
  status: "finalized" as const,
  createdAt: "2026-10-28T10:00:00.000Z",
  finalizedAt: "2026-10-28T10:00:00.000Z",
  taskTitle: "Launch plan",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockClear();
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

function render(
  files: Array<typeof FILE> = [],
  options: {
    filters?: { kind: "all" | "image" | "pdf" | "document"; query: string | null; sort: "newest" | "oldest" | "name" | "largest" };
    pendingCount?: number;
    failedCount?: number;
    errorMessage?: string | null;
  } = {},
) {
  act(() =>
    root.render(
      <ProjectFilesTab
        projectSlug="owner-a-project"
        view="active"
        files={files}
        filters={options.filters ?? { kind: "all", query: null, sort: "newest" }}
        pendingCount={options.pendingCount ?? 0}
        failedCount={options.failedCount ?? 0}
        errorMessage={options.errorMessage ?? null}
      />,
    ),
  );
}

describe("ProjectFilesTab", () => {
  it("renders finalized files with the URL-owned filter form", () => {
    render([FILE]);
    expect(document.body.textContent).toContain("launch-plan.pdf");
    expect(document.body.textContent).toContain("Launch plan");
    expect(document.body.textContent).toContain("1 file across this project");

    const form = container.querySelector<HTMLFormElement>('form[action="/tasks/projects/owner-a-project"]');
    expect(form).not.toBeNull();
    expect(form?.querySelector<HTMLInputElement>('input[name="tab"]')?.value).toBe("files");
    expect(form?.querySelector<HTMLInputElement>('input[name="fileQuery"]')).not.toBeNull();
    expect(form?.querySelector<HTMLSelectElement>('select[name="fileKind"]')?.value).toBe("all");
    expect(form?.querySelector<HTMLSelectElement>('select[name="fileSort"]')?.value).toBe("newest");
  });

  it("shows the empty state and the clear action only when filters are active", () => {
    render();
    expect(document.body.textContent).toContain("No files in this project yet");
    expect(document.body.textContent).not.toContain("Clear filters");

    act(() => root.unmount());
    root = createRoot(container);
    render([], { filters: { kind: "pdf", query: "missing", sort: "name" } });
    expect(document.body.textContent).toContain("No files match these filters");
    expect(document.body.textContent).toContain("Clear filters");
  });

  it("names unfinished uploads without listing them as files", () => {
    render([], { pendingCount: 2, failedCount: 1 });
    expect(document.body.textContent).toContain("3 unfinished uploads are not listed");
    expect(document.body.textContent).toContain("Open the task to retry or delete them");
  });

  it("deletes a file through the action and refreshes the server read model", async () => {
    vi.mocked(deleteAttachmentAction).mockResolvedValue({ ok: true });
    render([FILE]);

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Delete launch-plan.pdf"]')
        ?.click();
      await Promise.resolve();
    });

    expect(deleteAttachmentAction).toHaveBeenCalledWith(FILE.id);
    expect(refresh).toHaveBeenCalled();
  });

  it("previews a PDF with a short-lived signed link", async () => {
    vi.mocked(getAttachmentPreviewAction).mockResolvedValue({
      ok: true,
      link: {
        url: "https://storage.test/object/signed?token=secret",
        expiresAt: new Date().toISOString(),
        kind: "pdf",
        fileName: FILE.fileName,
      },
    });
    render([FILE]);

    await act(async () => {
      const preview = Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Preview"),
      );
      preview?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getAttachmentPreviewAction).toHaveBeenCalledWith(FILE.id, "preview");
    const frame = document.body.querySelector<HTMLIFrameElement>(
      'iframe[title="launch-plan.pdf"]',
    );
    expect(frame?.src).toContain("https://storage.test/object/signed");
  });

  it("renders a retryable error state", () => {
    render([], { errorMessage: "Unable to load project files right now." });
    expect(document.body.textContent).toContain("Unable to load project files right now.");
    expect(document.body.textContent).toContain("Retry");
  });
});
