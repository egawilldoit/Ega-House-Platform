import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/app/page.tsx");
const homePage = read("src/app/home/home-page.tsx");
const data = read("src/app/home/home-data.ts");
const heroStudy = read("src/app/home/sections/hero-study.tsx");
const focusStudy = read("src/app/home/sections/focus-study.tsx");
const conversionStudy = read("src/app/home/sections/conversion-study.tsx");
const styles = [
  read("src/app/home/home.css"),
  read("src/app/home/home-polish.css"),
].join("\n");
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

    expect(homePage).toContain('import "./home-polish.css"');
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

  it("defines presentation safeguards for normal zoom and wide screens", () => {
    expect(styles).toContain("--home-content-max");
    expect(styles).toContain("@media (min-width: 1680px)");
    expect(styles).toContain("@media (max-width: 1180px)");
    expect(styles).toContain("text-wrap: balance");
  });

  it("prevents vertical clipping and mid-word heading breaks", () => {
    expect(styles).toContain("overflow-x: clip");
    expect(styles).toContain("overflow-y: visible");
    expect(styles).toContain("overflow-wrap: normal");
    expect(styles).toContain("word-break: normal");
    expect(styles).toContain("hyphens: none");
    expect(styles).not.toContain("overflow-wrap: anywhere");
    expect(focusStudy).toContain("into momentum.");
  });

  it("keeps the fixed header inside the safe viewport", () => {
    expect(styles).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(styles).toContain("min-width: max-content");
    expect(styles).toContain("white-space: nowrap");
  });

  it("anchors the large intro and workspace indices", () => {
    expect(heroStudy).toContain('className="home-index-lockup home-index-lockup--intro"');
    expect(heroStudy).toContain('className="home-index-lockup__label">Introduction');
    expect(conversionStudy).toContain('className="home-index-lockup home-index-lockup--workspace"');
    expect(conversionStudy).toContain('className="home-index-lockup__label">Workspace');
  });

  it("uses one canonical account-creation CTA", () => {
    expect(heroStudy).toContain("Create account");
    expect(conversionStudy).toContain("Create account");
    expect(conversionStudy).not.toContain("Create your account");
  });

  it("defines explicit target viewport contracts", () => {
    expect(styles).toContain("@media (max-width: 1440px)");
    expect(styles).toContain("@media (max-width: 1024px)");
    expect(styles).toContain("@media (max-width: 390px)");
  });
});
