import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { Tooltip } from "./tooltip";

describe("Tooltip — retained primitive", () => {
  it("renders trigger and hides content until hover", () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="Helpful tip">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(markup).toContain("Hover me");
    // Content is portal-based and not rendered until open, so static markup should not contain tip
    expect(markup).not.toContain("Helpful tip");
  });

  it("has accessible trigger wrapper", () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="Info">
        <span>Trigger</span>
      </Tooltip>,
    );
    expect(markup).toContain("Trigger");
    expect(markup).toContain('class="inline-flex"');
  });
});
