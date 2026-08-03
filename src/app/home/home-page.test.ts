import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/app/page.tsx");
const homePage = read("src/app/home/home-page.tsx");
const data = read("src/app/home/home-data.ts");
const styles = read("src/app/home/home.css");
const motionLayer = read("src/app/home/components/home-motion.tsx");

describe("homepage operational studies", () => {
  it("keeps authentication server-owned", () => {
    expect(page).toContain('redirect("/dashboard")');
    expect(page).toContain("<HomePage />");
  });

  it("renders six stable study anchors", () => {
    for (const id of ["intro", "goals", "planning", "focus", "review", "workspace"]) {
      expect(data).toContain(`id: "${id}"`);
    }

    expect(homePage).toContain("<HeroStudy");
    expect(homePage).toContain("<GoalsStudy");
    expect(homePage).toContain("<PlanningStudy");
    expect(homePage).toContain("<FocusStudy");
    expect(homePage).toContain("<ReviewStudy");
    expect(homePage).toContain("<ConversionStudy");
  });

  it("uses Motion with a reduced-motion path", () => {
    expect(motionLayer).toContain('from "motion/react"');
    expect(motionLayer).toContain("MotionConfig");
    expect(motionLayer).toContain('reducedMotion="user"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps native scrolling authoritative", () => {
    expect(styles).not.toContain("scroll-snap-type: y mandatory");
    expect(homePage).not.toContain("Lenis");
    expect(homePage).not.toContain("gsap");
  });

  it("keeps the approved study environments", () => {
    for (const theme of ["signal", "sea-glass", "terracotta", "citrus", "review", "conversion"]) {
      expect(styles).toContain(`[data-theme="${theme}"]`);
    }
  });
});
