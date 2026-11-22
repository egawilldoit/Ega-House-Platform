// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-canonical-url", () => ({
  useCanonicalUrl: () => ({
    resolve: (href: string) => `https://www.egawilldoit.online${href}`,
  }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...props }, children),
  };
});

import { CanonicalLink } from "./canonical-link";

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

describe("CanonicalLink", () => {
  it("resolves cross-workspace routes to the canonical root host", async () => {
    await act(async () => {
      root.render(
        <CanonicalLink href="/timer#recent-sessions" aria-label="Open timer history">
          Timer
        </CanonicalLink>,
      );
    });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://www.egawilldoit.online/timer#recent-sessions",
    );
    expect(link?.getAttribute("aria-label")).toBe("Open timer history");
  });
});
