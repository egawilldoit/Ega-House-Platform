import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { StartupErrorView } from "./StartupPageView";

describe("StartupErrorView", () => {
  it("renders a single Retry link control", () => {
    const markup = renderToStaticMarkup(React.createElement(StartupErrorView, { actionError: null }));
    expect(markup).toContain("Retry");
    expect(markup).toContain('href="/startup"');
    expect(markup).not.toContain("<button");
  });
});
