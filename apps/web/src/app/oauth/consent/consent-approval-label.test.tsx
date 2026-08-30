import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConsentApprovalLabel } from "./consent-approval-label";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ConsentApprovalLabel", () => {
  it("reflects the selected permission profile", async () => {
    await act(async () => {
      root.render(
        <form>
          <input
            type="radio"
            name="permission_profile"
            value="read_only"
            defaultChecked
          />
          <input
            type="radio"
            name="permission_profile"
            value="workspace_manager"
          />
          <button type="submit">
            <ConsentApprovalLabel />
          </button>
        </form>,
      );
    });

    expect(container.textContent).toContain("Approve read-only access");

    const workspaceRadio = container.querySelector<HTMLInputElement>(
      'input[value="workspace_manager"]',
    );
    expect(workspaceRadio).not.toBeNull();

    await act(async () => {
      workspaceRadio!.checked = true;
      workspaceRadio!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Approve workspace management");
    expect(container.textContent).not.toContain("Approve read-only access");
  });
});
