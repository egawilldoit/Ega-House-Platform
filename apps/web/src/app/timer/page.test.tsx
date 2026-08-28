import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/app/timer/page.tsx"), "utf8");

describe("Timer — Today control", () => {
  it("Today control navigates to /today via Link", () => {
    expect(page).toContain('href="/today"');
    expect(page).not.toContain('<span className="btn-instrument');
    // Must be Link, not span
    expect(page).toMatch(/import Link from "next\/link"/);
    expect(page).toContain("Today</Link>");
  });

  it("has no dead button-styled span", () => {
    // Should not contain the dead pattern <span className="btn-instrument ...">Today</span>
    expect(page).not.toMatch(/<span[^>]*btn-instrument[^>]*>Today<\/span>/);
  });
});
