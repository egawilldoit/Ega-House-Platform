import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain";

vi.mock("./actions", () => ({
  updatePersonalOperationsAction: async () => ({ message: "", ok: false }),
}));

import { PersonalOperationsForm } from "./personal-operations-form";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const ARCHIVED_TASK_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

describe("PersonalOperationsForm job-search reference", () => {
  it("offers task and project optgroups, labels archived tasks, and keeps the scheduled JSON", () => {
    const markup = renderToStaticMarkup(
      <PersonalOperationsForm
        initial={DEFAULT_PERSONAL_OPERATIONS}
        disabled={false}
        referenceOptions={{
          projects: [{ id: PROJECT_ID, name: "Career" }],
          tasks: [
            { id: TASK_ID, title: "Apply to roles", archivedAt: null },
            { id: ARCHIVED_TASK_ID, title: "Old applications", archivedAt: "2026-01-01T00:00:00.000Z" },
          ],
        }}
      />,
    );

    expect(markup).toContain("Job-search work reference");
    expect(markup).toContain('<optgroup label="Tasks">');
    expect(markup).toContain('<optgroup label="Projects">');
    expect(markup).toContain("Old applications (archived)");
    expect(markup).toContain(`task:${TASK_ID}`);
    expect(markup).toContain(`project:${PROJECT_ID}`);
    expect(markup).toContain("jobSearchReference");
  });

  it("keeps a configured reference that is missing from the fetched options", () => {
    const markup = renderToStaticMarkup(
      <PersonalOperationsForm
        initial={{
          ...DEFAULT_PERSONAL_OPERATIONS,
          jobSearchReference: { kind: "task", id: MISSING_TASK_ID },
        }}
        disabled={false}
        referenceOptions={{ projects: [], tasks: [] }}
      />,
    );

    expect(markup).toContain('<optgroup label="Current selection">');
    expect(markup).toContain(`task:${MISSING_TASK_ID}`);
    expect(markup).toContain("not in the current list");
  });
});
