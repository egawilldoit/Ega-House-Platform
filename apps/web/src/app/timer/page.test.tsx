import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/app/timer/page.tsx"), "utf8");

describe("Timer — Open Today control", () => {
  it("Open Today control navigates to /today via Link", () => {
    expect(page).toContain('href="/today"');
    expect(page).not.toContain('<span className="btn-instrument');
    // Must be Link, not span
    expect(page).toMatch(/import Link from "next\/link"/);
    // Formatting-robust: the control is a real Link whose child text is Open Today.
    expect(page).toMatch(/<Link[\s\S]*?href="\/today"[\s\S]*?>[\s\S]*?Open Today[\s\S]*?<\/Link>/);
    expect(page).toContain("Export CSV");
  });

  it("uses the refined page description", () => {
    expect(page).toContain("Track focused work and review your recent sessions.");
    expect(page).not.toContain("The active session is primary");
  });

  it("has no dead button-styled span", () => {
    // Should not contain the dead pattern <span className="btn-instrument ...">Today</span>
    expect(page).not.toMatch(/<span[^>]*btn-instrument[^>]*>Today<\/span>/);
  });
});
