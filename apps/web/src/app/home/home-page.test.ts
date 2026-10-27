import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/app/page.tsx");
const homePage = read("src/app/home/home-page.tsx");
const data = read("src/app/home/home-data.ts");
const styles = read("src/app/home/home.css");
const layout = read("src/app/layout.tsx");
const hero = read("src/app/home/sections/hero.tsx");
const loop = read("src/app/home/sections/loop.tsx");
const closing = read("src/app/home/sections/closing.tsx");
const header = read("src/app/home/components/site-header.tsx");
const footer = read("src/app/home/components/site-footer.tsx");
const liveBoard = read("src/app/home/components/live-board.tsx");
const revealOnView = read("src/app/home/components/reveal-on-view.tsx");
const heroGrid = read("src/app/home/components/hero-grid.tsx");
const weightRamp = read("src/app/home/components/weight-ramp.tsx");
const surfaces = [homePage, hero, loop, closing, header, footer].join("\n");

describe("public homepage", () => {
  it("keeps authentication server-owned", () => {
    expect(page).toContain('redirect("/home")');
    expect(page).toContain("<HomePage />");
    expect(page).toContain("const user = await getCurrentUser()");
  });

  it("composes the redesigned marketing tree", () => {
    expect(homePage).toContain('import "./home.css"');
    expect(homePage).not.toContain("home-polish.css");
    expect(homePage).toContain("<SiteHeader />");
    expect(homePage).toContain("<Hero />");
    expect(homePage).toContain("<Loop />");
    expect(homePage).toContain("<Closing />");
    expect(homePage).toContain("<SiteFooter />");
    expect(homePage).not.toContain("Study");
    expect(homePage).not.toContain("HomeMotion");
  });

  it("keeps the client boundary to the three interactive pieces", () => {
    for (const source of [liveBoard, revealOnView, heroGrid]) {
      expect(source).toContain('"use client"');
    }

    for (const source of [homePage, hero, loop, closing, header, footer, weightRamp]) {
      expect(source).not.toContain('"use client"');
    }

    expect(liveBoard).toContain('from "motion/react"');
    expect(liveBoard).toContain("useReducedMotion");
    expect(revealOnView).toContain("IntersectionObserver");
    expect(heroGrid).toContain('matchMedia("(hover: hover)")');
    expect(heroGrid).toContain("--home-mx");
    expect(heroGrid).toContain("--home-my");
  });

  it("has a reduced-motion path that ends in the final state", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation: none !important");
    expect(revealOnView).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(revealOnView).toContain('setState("in")');
    expect(liveBoard).toContain("reduceMotion ||");
    expect(heroGrid).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });

  it("arms reveal states on the element that carries the reveal attribute", () => {
    expect(loop).toContain("<RevealOnView");
    expect(closing).toContain("<RevealOnView");
    expect(styles).toContain('[data-reveal="armed"] .home-mini');
    expect(styles).toContain('[data-reveal="armed"].home-close');
    expect(styles).toContain('[data-reveal="in"].home-close');
  });

  it("keeps native scrolling authoritative", () => {
    expect(styles).not.toContain("scroll-snap-type: y mandatory");
    expect(surfaces).not.toContain("Lenis");
    expect(surfaces).not.toContain("gsap");
    expect(styles).toContain("html:has(.home-page)");
    expect(styles).toContain("scroll-behavior: smooth");
  });

  it("uses one canonical account-creation CTA", () => {
    expect(surfaces.match(/Create account/g)).toHaveLength(4);
    expect(surfaces).not.toContain("Create your account");
    expect(surfaces).not.toContain("Sign up");
  });

  it("ramps headline weight through per-word CSS variables", () => {
    expect(weightRamp).toContain('className="home-ramp"');
    expect(weightRamp).toContain('className="home-ramp__word"');
    expect(weightRamp).toContain('"--w": w.weight');
    expect(weightRamp).toContain('"--i": i++');
    expect(styles).toContain("font-weight: var(--w)");
    expect(hero).toContain('{ text: "Turn", weight: 200 }');
    expect(hero).toContain('{ text: "execution.", weight: 800 }');
    expect(closing).toContain('{ text: "Return", weight: 200 }');
    expect(closing).toContain('{ text: "system.", weight: 800 }');
  });

  it("keeps live board display values derived from task state", () => {
    expect(data).toContain("BOARD_TASKS");
    expect(data).toContain("LOOP_STEPS");
    expect(data).toContain("DIRECTION");
    expect(data).not.toContain("HOME_STUDIES");
    expect(liveBoard).toContain("const count = done.filter(Boolean).length");
    expect(liveBoard).toContain("const closed = count === total");
    expect(liveBoard).toContain("18 + pct * 0.72");
    expect(liveBoard).toContain('"All done. Loop closed."');
    expect(liveBoard).toContain('type="checkbox"');
    expect(liveBoard).toContain("aria-live");
    expect(liveBoard).toContain("{ threshold: 0.2 }");
    expect(liveBoard).toContain("900 + (index - 1) * 900");
  });

  it("prevents vertical clipping and mid-word heading breaks", () => {
    expect(styles).toContain("overflow-x: clip");
    expect(styles).toContain("overflow-wrap: normal");
    expect(styles).toContain("word-break: normal");
    expect(styles).toContain("hyphens: none");
    expect(styles).toContain("text-wrap: balance");
    expect(styles).not.toContain("overflow-wrap: anywhere");
    expect(styles).toContain("display: inline-block");
  });

  it("scopes design tokens and layout to the marketing page", () => {
    expect(styles).not.toContain(":root");
    expect(styles).not.toMatch(/(^|\n)body\s*\{/);
    expect(styles).toContain(".home-page {");
    expect(styles).toContain("--home-signal:");
    expect(styles).toContain("--home-citrus:");
    expect(styles).toContain("--home-teal:");
    expect(styles).toContain("padding-top: env(safe-area-inset-top, 0px)");
  });

  it("keeps the dark theme scoped and the display axis variable", () => {
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
    expect(styles).toContain("--home-bg: #0f100d");
    expect(layout).not.toContain("next/font/google");
    expect(layout).toMatch(/sora = localFont\(\{[\s\S]*?weight: "100 800"/);
    expect(layout).toMatch(/instrumentSans = localFont\(\{[\s\S]*?variable: "--font-body-next"/);
  });

  it("defines the design breakpoints", () => {
    expect(styles).toContain("@media (min-width: 960px)");
    expect(styles).toContain("@media (max-width: 860px)");
    expect(styles).toContain("@media (max-width: 520px)");
  });

  it("keeps one scroll-aware nav with staged content motion", () => {
    expect(header).toContain("NavFrame");
    expect(header).toContain("home-top__page-link");
    expect(header).toContain("home-top__inner");
    expect(header).toContain("home-top__actions");
    expect(header).toContain("home-top__login");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain('[data-scrolled="true"]');
    expect(styles).toContain("home-nav-in");
    expect(styles).toContain("home-rise");
    expect(styles).toContain("animation-delay: 0s !important");
    expect(styles).toContain("scroll-margin-top: 5.5rem");
    expect(styles).toContain("@media (max-width: 760px)");
  });
});
