import { describe, expect, it } from "vitest";

import { getBacklogClearSearchHref } from "./backlog-search-href";

describe("getBacklogClearSearchHref", () => {
  it("removes q and legacy search", () => {
    expect(getBacklogClearSearchHref({ q: "term", search: "legacy" })).toBe("/backlog");
  });

  it("removes q while preserving view", () => {
    expect(getBacklogClearSearchHref({ q: "term", view: "archived" })).toBe("/backlog?view=archived");
  });

  it("removes legacy search while preserving view", () => {
    expect(getBacklogClearSearchHref({ search: "legacy", view: "archived" })).toBe("/backlog?view=archived");
  });

  it("ignores blank values", () => {
    expect(getBacklogClearSearchHref({ q: "   ", view: "  ", search: "" })).toBe("/backlog");
  });

  it("preserves non-search params", () => {
    expect(getBacklogClearSearchHref({ q: "term", view: "archived", foo: "bar" })).toBe("/backlog?view=archived&foo=bar");
  });
});
