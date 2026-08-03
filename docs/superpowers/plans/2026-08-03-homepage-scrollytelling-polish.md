# Homepage Scrollytelling Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten reported landing-page polish defects across studies 00–05 without redesigning the approved concept or introducing new design tokens.

**Architecture:** Keep the current six section components and route-scoped stylesheet split. Add regression contracts to `home-page.test.ts`, make the minimal markup changes needed to anchor the 00/05 numerals and standardize CTA copy, then correct shared layout and typography invariants in `home-polish.css` so all sections inherit the safeguards.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Motion for React, Vitest, GitHub Actions, Vercel previews.

## Global Constraints

- Work only on `feat/homepage-operational-studies`.
- Reuse existing `--home-*` and global tokens; add no new colors, fonts, animation systems, or arbitrary spacing/type scales.
- Preserve six studies, theme sequence, native scrolling, authentication redirect, login URL, and signup URL.
- Canonical signup CTA copy is exactly `Create account`.
- No headline may use `overflow-wrap: anywhere`, `word-break: break-all`, or automatic hyphenation.
- Validate 1440px, 1024px, and 390px width contracts.

---

### Task 1: Add RED regression contracts

**Files:**
- Modify: `src/app/home/home-page.test.ts`

**Interfaces:**
- Consumes: source text from homepage CSS and section modules.
- Produces: regression assertions for copy, wrapping, header safety, anchored indices, overflow, and breakpoints.

- [ ] **Step 1: Extend the source fixtures**

Read `hero-study.tsx`, `focus-study.tsx`, and `conversion-study.tsx` alongside existing CSS fixtures.

- [ ] **Step 2: Add failing assertions**

Assert:

```ts
expect(styles).toContain("overflow-wrap: normal");
expect(styles).toContain("word-break: normal");
expect(styles).toContain("hyphens: none");
expect(styles).not.toContain("overflow-wrap: anywhere");
expect(styles).toContain("overflow-x: clip");
expect(styles).toContain("overflow-y: visible");
expect(styles).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
expect(styles).toContain("white-space: nowrap");
expect(styles).toContain("@media (max-width: 1440px)");
expect(styles).toContain("@media (max-width: 1024px)");
expect(styles).toContain("@media (max-width: 390px)");
expect(heroStudy).toContain('home-index-lockup');
expect(conversionStudy).toContain('home-index-lockup');
expect(heroStudy).toContain("Create account");
expect(conversionStudy).toContain("Create account");
expect(conversionStudy).not.toContain("Create your account");
```

- [ ] **Step 3: Run the focused test and verify RED**

Run the existing Public Signup CI focused test command through a branch commit.

Expected: failure only on the new polish contracts.

- [ ] **Step 4: Commit**

```bash
git add src/app/home/home-page.test.ts
git commit -m "test: define homepage scrollytelling polish contracts"
```

### Task 2: Anchor indices and standardize CTA copy

**Files:**
- Modify: `src/app/home/sections/hero-study.tsx`
- Modify: `src/app/home/sections/conversion-study.tsx`

**Interfaces:**
- Consumes: existing StudyLabel metadata and current decorative signal containers.
- Produces: `.home-index-lockup`, `.home-index-lockup__number`, and `.home-index-lockup__label` markup.

- [ ] **Step 1: Replace the free-floating Section 00 numeral**

Inside `.home-hero__signal`, render:

```tsx
<div className="home-index-lockup home-index-lockup--intro">
  <span className="home-index-lockup__number">00</span>
  <span className="home-index-lockup__label">Introduction</span>
</div>
```

Remove `.home-hero__signal-number` markup.

- [ ] **Step 2: Replace the free-floating Section 05 numeral**

Inside `.home-conversion__signal`, render the same structure with `05` and `Workspace`, retaining `.home-conversion__disc`.

- [ ] **Step 3: Standardize copy**

Change Section 05 `Create your account` to `Create account`. Do not alter other content.

- [ ] **Step 4: Commit**

```bash
git add src/app/home/sections/hero-study.tsx src/app/home/sections/conversion-study.tsx
git commit -m "fix: anchor homepage indices and align CTA copy"
```

### Task 3: Correct shared layout and typography invariants

**Files:**
- Modify: `src/app/home/home-polish.css`

**Interfaces:**
- Consumes: existing homepage classes and token values from `home.css`/`globals.css`.
- Produces: safe viewport, headline, header, index-lockup, and timer-label rules.

- [ ] **Step 1: Stop vertical clipping**

Override `.home-study` with `overflow-x: clip; overflow-y: visible;` and make `.home-study__content` height content-driven while retaining existing minimum-height behavior only where content fits.

- [ ] **Step 2: Correct heading wrapping**

For all seven heading selectors, set:

```css
text-wrap: balance;
overflow-wrap: normal;
word-break: normal;
hyphens: none;
```

Ensure `.home-display__line` has `max-width: 100%` and the same no-split rules.

- [ ] **Step 3: Protect the fixed header**

Set the header grid to `auto minmax(0, 1fr) auto`, use current clamp padding values, constrain status overflow, and apply `min-width: max-content; white-space: nowrap;` to brand/action.

- [ ] **Step 4: Rebalance Section 00**

Top-align `.home-hero__copy`, reduce `.home-hero__signal-word` using existing size endpoints, and position `.home-index-lockup--intro` against the divider.

- [ ] **Step 5: Rebalance Section 03**

Widen the copy fraction, reduce the headline upper endpoint to the existing Review scale, allow the task block to remain in flow, and increase timer metadata using existing `0.77rem`, `0.92rem`, cream, citrus, and signal tokens.

- [ ] **Step 6: Rebalance Section 05**

Dock `.home-index-lockup` to the conversion divider and preserve the disc.

- [ ] **Step 7: Add explicit target breakpoints**

Add `@media (max-width: 1440px)`, `@media (max-width: 1024px)`, and `@media (max-width: 390px)` rules that reduce display scale, stack at 1024px, preserve header safe padding, remove fixed signal minimum heights on narrow screens, and prevent horizontal overflow.

- [ ] **Step 8: Promote intermediate hierarchy**

Increase `.home-kicker` using an existing route/global font-size endpoint and constrain its reading width.

- [ ] **Step 9: Commit**

```bash
git add src/app/home/home-polish.css
git commit -m "fix: polish homepage viewport and type behavior"
```

### Task 4: Verify and report

**Files:**
- Modify: `docs/implementation/2026-08-03-homepage-operational-studies-evidence.md`
- Update: PR #117 description

**Interfaces:**
- Consumes: exact CI output, commit SHA, Vercel deployment metadata, and final source diff.
- Produces: evidence and the requested 10-item change/already-fine report.

- [ ] **Step 1: Run focused suite**

Expected: all homepage/auth focused tests pass.

- [ ] **Step 2: Run full suite**

Expected: zero failed tests.

- [ ] **Step 3: Run TypeScript, scoped ESLint, and production build**

Expected: all commands exit successfully.

- [ ] **Step 4: Confirm MCP Integration CI**

Expected: workflow conclusion `success` on the runtime head.

- [ ] **Step 5: Inspect fresh Vercel preview**

Validate the landing page at 1440px, 1024px, and 390px, including Section 00 initial load, Section 03 headline/task/header/timer, Section 05 index and CTA, and horizontal overflow.

- [ ] **Step 6: Update evidence and PR**

Record the verified implementation SHA, exact test counts, preview URL, and which of the ten items required changes versus were already correct.
