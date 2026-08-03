# EGA House Homepage Operational Studies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current monolithic public homepage with a six-study editorial experience that preserves authentication and conversion behavior while adding accessible scroll-linked motion.

**Architecture:** Keep `src/app/page.tsx` server-owned for the authenticated redirect, move the public presentation into focused `src/app/home/**` modules, and isolate Motion-driven scroll state inside a narrow client component. Use route-scoped CSS for visual environments and native browser scrolling as the authoritative interaction model.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Motion 12.42.2, Vitest 4, GitHub Actions.

## Global Constraints

- Preserve authenticated redirect to `/dashboard`.
- Preserve login destination `/login?next=%2Fdashboard`.
- Preserve canonical signup destination `https://www.egawilldoit.online/signup`.
- Render exactly six study sections: `intro`, `goals`, `planning`, `focus`, `review`, and `workspace`.
- Use browser-native scrolling; do not add Lenis, GSAP, Three.js, WebGL, video backgrounds, or scroll interception.
- Use Motion as the only animation dependency.
- Honor `prefers-reduced-motion` and keep critical content visible without animation.
- Keep homepage styles route-scoped under `src/app/home/home.css`.
- Keep client boundaries narrow and server-render static content where practical.
- Focused tests, signup-discovery tests, typecheck, scoped lint, and production build must pass.

---

### Task 1: Add failing homepage source contracts

**Files:**
- Create: `src/app/home/home-page.test.ts`
- Modify: `src/app/signup/signup-discovery.test.ts`

**Interfaces:**
- Consumes: repository source files under `src/app/page.tsx` and `src/app/home/**`.
- Produces: regression contracts for redirects, study structure, Motion/reduced-motion wiring, and canonical conversion paths.

- [ ] **Step 1: Write the failing operational-studies contract**

Create `src/app/home/home-page.test.ts` that reads the homepage source files and asserts:

```ts
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
      expect(homePage).toContain(`id={study.id}`);
    }
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
});
```

- [ ] **Step 2: Update signup discovery to read the new public components**

Replace the single `homePage` source read with:

```ts
const homeSources = [
  "src/app/home/sections/hero-study.tsx",
  "src/app/home/sections/conversion-study.tsx",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
```

Keep the existing canonical URL and existing-user assertions against `homeSources`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test -- --run src/app/home/home-page.test.ts src/app/signup/signup-discovery.test.ts
```

Expected: failure because `src/app/home/**` does not exist yet.

- [ ] **Step 4: Commit**

```bash
git add src/app/home/home-page.test.ts src/app/signup/signup-discovery.test.ts
git commit -m "test: define homepage operational studies contract"
```

---

### Task 2: Add Motion dependency and stable study data

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/home/home.types.ts`
- Create: `src/app/home/home-data.ts`

**Interfaces:**
- Consumes: approved six-study design and existing React 19 runtime.
- Produces: `HomeStudy`, `HomeTheme`, `HOME_STUDIES`, `LOGIN_HREF`, and `SIGNUP_HREF`.

- [ ] **Step 1: Add Motion 12.42.2**

Add to `dependencies` in both manifest and lock root:

```json
"motion": "12.42.2"
```

Add lock entries for `motion@12.42.2`, `framer-motion@12.42.2`, `motion-dom@12.42.2`, and `motion-utils@12.39.0` using the npm registry integrity metadata.

- [ ] **Step 2: Define homepage types**

Create `src/app/home/home.types.ts`:

```ts
export type HomeTheme =
  | "signal"
  | "sea-glass"
  | "terracotta"
  | "citrus"
  | "review"
  | "conversion";

export type HomeStudy = {
  id: "intro" | "goals" | "planning" | "focus" | "review" | "workspace";
  index: string;
  discipline: string;
  artDirection: string;
  theme: HomeTheme;
  title: string;
  headline: string;
  description: string;
};
```

- [ ] **Step 3: Define authoritative study data and links**

Create `src/app/home/home-data.ts` exporting:

```ts
import type { HomeStudy } from "./home.types";

export const LOGIN_HREF = "/login?next=%2Fdashboard";
export const SIGNUP_HREF = "https://www.egawilldoit.online/signup";

export const HOME_STUDIES: readonly HomeStudy[] = [
  { id: "intro", index: "00", discipline: "SYSTEM", artDirection: "SIGNAL / CREAM", theme: "signal", title: "Introduction", headline: "One operating system for turning intention into execution.", description: "Goals, tasks, focus sessions, and weekly review stay connected in one operational workspace." },
  { id: "goals", index: "01", discipline: "GOALS", artDirection: "SEA GLASS", theme: "sea-glass", title: "Goals", headline: "Quiet structure. Loud intent.", description: "Turn long-range direction into a visible hierarchy of objectives, milestones, and next actions." },
  { id: "planning", index: "02", discipline: "PLANNING", artDirection: "TERRACOTTA", theme: "terracotta", title: "Planning", headline: "Move the plan into motion without adding noise.", description: "Link operational work to the goals it serves, then make workload, priority, and timing explicit." },
  { id: "focus", index: "03", discipline: "FOCUS", artDirection: "CITRUS BLACK", theme: "citrus", title: "Focus", headline: "Turn attention into momentum.", description: "Run focused sessions against active work while preserving the context that made the task matter." },
  { id: "review", index: "04", discipline: "REVIEW", artDirection: "CREAM / TEAL", theme: "review", title: "Review", headline: "Review the evidence. Correct the system.", description: "Close the loop with completed work, unresolved friction, lessons, and the next correction." },
  { id: "workspace", index: "05", discipline: "WORKSPACE", artDirection: "BLACK SIGNAL", theme: "conversion", title: "Workspace", headline: "Build the week. Run the day. Review the system.", description: "Create your EGA House workspace or return to the operating system you already use." },
] as const;
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/app/home/home.types.ts src/app/home/home-data.ts
git commit -m "feat: add homepage studies model and motion"
```

---

### Task 3: Build shared study structure and motion state

**Files:**
- Create: `src/app/home/components/home-motion.tsx`
- Create: `src/app/home/components/study-header.tsx`
- Create: `src/app/home/components/study-shell.tsx`
- Create: `src/app/home/components/study-label.tsx`
- Create: `src/app/home/components/animated-rule.tsx`
- Create: `src/app/home/components/home-cta.tsx`

**Interfaces:**
- Consumes: `HOME_STUDIES`, `HomeStudy`, `LOGIN_HREF`, `SIGNUP_HREF`.
- Produces: `HomeMotion`, `StudyHeader`, `StudyShell`, `StudyLabel`, `AnimatedRule`, and `HomeCta`.

- [ ] **Step 1: Implement the client motion boundary**

`HomeMotion` must:

```ts
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { MotionConfig, motion, useScroll, useSpring } from "motion/react";
```

It observes `[data-home-study]` sections with `IntersectionObserver`, stores the active study id, exposes it through context, and renders a fixed progress line whose `scaleX` is driven by a spring-smoothed `scrollYProgress`.

- [ ] **Step 2: Implement the sticky header**

The header consumes active-study context and renders brand, active index/title, and `Enter workspace` using `LOGIN_HREF`.

- [ ] **Step 3: Implement semantic shared wrappers**

`StudyShell` renders:

```tsx
<section id={study.id} data-home-study={study.id} data-theme={study.theme} className="home-study">
  <StudyLabel study={study} />
  <div className="home-study__content">{children}</div>
</section>
```

- [ ] **Step 4: Implement shared CTAs and animated rules**

Keep navigation as links and use Motion only for transform/opacity animation. Decorative rules must render meaningful content without requiring animation completion.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/components
git commit -m "feat: add homepage study shell and motion state"
```

---

### Task 4: Build six product studies

**Files:**
- Create: `src/app/home/sections/hero-study.tsx`
- Create: `src/app/home/sections/goals-study.tsx`
- Create: `src/app/home/sections/planning-study.tsx`
- Create: `src/app/home/sections/focus-study.tsx`
- Create: `src/app/home/sections/review-study.tsx`
- Create: `src/app/home/sections/conversion-study.tsx`

**Interfaces:**
- Consumes: shared study components, Motion primitives, and authoritative links.
- Produces: six static, server-renderable section components with narrowly scoped animated descendants.

- [ ] **Step 1: Implement hero study**

Render the oversized EGA signal, approved headline, operational index, login CTA, and signup CTA.

- [ ] **Step 2: Implement goals study**

Render objective → milestone → next-action hierarchy using semantic lists and restrained entry staggering.

- [ ] **Step 3: Implement planning study**

Render a CSS/SVG workload chart, active-task metrics, and one-time bar reveals.

- [ ] **Step 4: Implement focus study**

Render active task, fixed demonstration timer value, concentric focus geometry, and bounded scroll-linked transforms.

- [ ] **Step 5: Implement review study**

Render completed, unresolved, lesson, and correction rows with readable sequence order.

- [ ] **Step 6: Implement conversion study**

Render canonical signup and login actions with the approved final statement and no feature grid after the CTA.

- [ ] **Step 7: Commit**

```bash
git add src/app/home/sections
git commit -m "feat: build six EGA operational studies"
```

---

### Task 5: Compose the page and add route-scoped visual system

**Files:**
- Create: `src/app/home/home-page.tsx`
- Create: `src/app/home/home.css`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: six section components and shared motion/header components.
- Produces: `HomePage()` public composition while leaving authentication resolution in `src/app/page.tsx`.

- [ ] **Step 1: Compose the public page**

`home-page.tsx` imports `./home.css`, renders `HomeMotion`, `StudyHeader`, and the six sections in authoritative order.

- [ ] **Step 2: Reduce `src/app/page.tsx` to server concerns**

Use:

```tsx
import { redirect } from "next/navigation";
import { HomePage } from "./home/home-page";
import { getCurrentUser } from "@/lib/services/auth-service";

export default async function Page() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return <HomePage />;
}
```

- [ ] **Step 3: Add route-scoped tokens and layouts**

`home.css` must define `.home-page`, `.home-study`, six `[data-theme]` environments, sticky header spacing, visible grids/rules, desktop split layouts, mobile stacking, focus states, safe overflow, and `scroll-margin-top`.

- [ ] **Step 4: Add reduced-motion fallbacks**

Include:

```css
@media (prefers-reduced-motion: reduce) {
  .home-page *,
  .home-page *::before,
  .home-page *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Do not hide content in the initial CSS state.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- --run src/app/home/home-page.test.ts src/app/signup/signup-discovery.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/home/home-page.tsx src/app/home/home.css
git commit -m "feat: ship operational studies homepage"
```

---

### Task 6: Extend CI and validate the complete branch

**Files:**
- Modify: `.github/workflows/public-signup-ci.yml`

**Interfaces:**
- Consumes: homepage source and tests.
- Produces: branch and pull-request validation for the full redesign.

- [ ] **Step 1: Extend workflow paths**

Add:

```yaml
- "src/app/home/**"
```

Add `feat/homepage-operational-studies` to push branches.

- [ ] **Step 2: Extend focused tests and lint**

Add `src/app/home/home-page.test.ts` to focused Vitest execution and `src/app/home` to scoped ESLint.

- [ ] **Step 3: Run exact validation**

```bash
npm ci --no-audit --no-fund
npm test -- --run src/app/home/home-page.test.ts src/app/signup/signup-discovery.test.ts
npm run typecheck
npx eslint src/app/page.tsx src/app/home src/app/signup/signup-discovery.test.ts
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Manual quality gate**

Verify desktop and narrow viewport, keyboard navigation, 200% zoom, reduced motion, no horizontal overflow, active-study header updates, native scroll behavior, and both conversion destinations.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/public-signup-ci.yml
git commit -m "ci: validate operational studies homepage"
```
