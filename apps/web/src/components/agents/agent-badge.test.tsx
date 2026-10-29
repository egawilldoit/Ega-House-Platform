// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentBadge } from "./agent-badge";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AgentBadge", () => {
  it("shows initials, display name, declared kind and role", () => {
    act(() =>
      root.render(
        <AgentBadge
          displayName="Codex Worker"
          kind="codex"
          avatarColor="violet"
          role="Implementation"
        />,
      ),
    );

    expect(document.body.textContent).toContain("CW");
    expect(document.body.textContent).toContain("Codex Worker");
    expect(document.body.textContent).toContain("Codex");
    expect(document.body.textContent).toContain("Implementation");
  });

  it("falls back safely for an unknown kind or colour", () => {
    act(() =>
      root.render(
        <AgentBadge displayName="Runner" kind="not-real" avatarColor="#ff0000" showKind={false} />,
      ),
    );

    expect(document.body.textContent).toContain("Runner");
    expect(document.body.textContent).not.toContain("not-real");
    expect(container.querySelector("[data-agent-kind]")?.getAttribute("data-agent-kind")).toBe(
      "custom",
    );
  });
});
