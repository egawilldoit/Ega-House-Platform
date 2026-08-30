# Homepage, Auth, and Scrollytelling Polish — Implementation Evidence

**Date:** 2026-08-03
**Branch:** `feat/homepage-operational-studies`
**Pull request:** `#117`
**Verified scrollytelling implementation head:** `76909066cdc89ee23a0d4ddb592ae8a8cbff4500`

## Delivered scope

The six-study landing page remains structurally unchanged:

1. 00 — Introduction
2. 01 — Goals
3. 02 — Planning
4. 03 — Focus
5. 04 — Review
6. 05 — Workspace

The latest pass fixes presentation, responsive safety, hierarchy, and copy defects without changing authentication behavior, section order, Motion architecture, or the approved palette sequence.

## Authoritative design sources

No root `DESIGN.md` or `docs/DESIGN.md` exists on this branch. The implementation reused:

- global fonts and application tokens from `src/app/globals.css`;
- route-scoped homepage tokens from `src/app/home/home.css`;
- the existing responsive override layer in `src/app/home/home-polish.css`;
- the approved operational-studies design specification.

No new color, font family, animation library, spacing system, or unrelated type scale was added.

## Ten-item audit

| # | Reported issue | Result | Code change |
|---|---|---|---|
| 1 | Section 00 headline clipped above the fold | Confirmed. Viewport-oriented height, vertical centering, and section clipping could hide the top lines. | Yes — copy is top-aligned, the section can grow, and vertical overflow is no longer clipped. |
| 2 | Section 03 `momentum.` split mid-word | Confirmed. Shared heading rules used `overflow-wrap: anywhere`. | Yes — all six headings now use balanced wrapping, normal word breaking, and no automatic hyphenation; Focus also receives a safer width and type endpoint. |
| 3 | Section 03 header action clipped at the right edge | Confirmed as a shared header risk. | Yes — header columns are now `auto minmax(0, 1fr) auto`; brand/action are non-shrinking and non-wrapping with safe inline padding. |
| 4 | Section 03 Active task content truncated | Confirmed as a consequence of fixed viewport composition plus vertical clipping. | Yes — Focus content stays in normal flow and the section grows when the task and timer need more height. |
| 5 | Section 00 EGA mark dominates the hierarchy | Confirmed. | Yes — the existing mark was rescaled and repositioned using existing display-size endpoints. |
| 6 | Large 00/05 numerals float without anchors | Confirmed. | Yes — both are now index lockups docked to a rule and paired with `Introduction` / `Workspace`. |
| 7 | CTA copy differs between Sections 00 and 05 | Confirmed. | Yes — both signup CTAs now read `Create account`; the stale discovery-test expectation was updated. |
| 8 | Focus timer metadata is too small and low contrast | Confirmed. | Yes — metadata uses an existing 0.77rem endpoint with established citrus/cream tokens and stronger contrast. |
| 9 | No intermediate type step | Confirmed. | Yes — the existing kicker is promoted into the intermediate subhead tier using established type endpoints. |
| 10 | Light-to-dark theme consistency | Already deliberate and correct in the approved design. | No palette change. Shared header placement, contrast, and safe-area behavior were tightened across every environment. |

Goals, Planning, and Review did not exhibit every screenshot defect, but they inherit the shared no-mid-word-break and viewport-safety contracts so the same bug class cannot appear there.

## TDD evidence

### Scrollytelling polish RED

Public Signup CI run `30852174223` failed on commit `79a0132f080c481a2e3beec2de06fbedf4598c99` before production changes existed.

The failures were limited to the newly introduced contracts for:

- vertical overflow safety;
- normal word breaking and disabled hyphenation;
- fixed-header safe columns and non-wrapping action;
- anchored 00/05 index lockups;
- canonical account-creation copy;
- explicit 1440px, 1024px, and 390px responsive rules.

### GREEN

Public Signup CI run `30852674777` passed on implementation head `76909066cdc89ee23a0d4ddb592ae8a8cbff4500`.

Successful gates:

- exact dependency installation;
- focused public-surface suite: **9 files, 68 tests passed**;
- complete repository suite: **132 files, 966 tests passed**;
- TypeScript typecheck;
- scoped ESLint execution with **0 errors** and two existing unused-import warnings in `src/app/signup/signup-form.tsx`;
- Next.js production build.

The only intermediate GREEN failure was a stale signup-discovery assertion that still required `Create your account` in the final homepage section. The test was corrected to require exactly two `Create account` occurrences and reject the old landing-page wording.

## MCP workflow status

MCP Integration CI run `30852675710` did not reach typecheck, tests, or build. It stopped at `npm audit --omit=dev --audit-level=high` because the external advisory database now reports vulnerabilities in existing production dependencies:

- `fast-uri` 3.0.0–3.1.4 — high severity, GHSA-7p8r-x3mc-p8w7;
- `hono` below 4.12.34 — moderate severity, GHSA-8j4g-w8fx-2239.

The scrollytelling patch did not modify dependencies or MCP runtime code. Dependency remediation is intentionally excluded from this UI polish scope and should be handled as a separate security update.

## Review status

- PR #117 remains open and unmerged.
- GitHub reports the PR as mergeable.
- The only inline code-quality thread is resolved and outdated.
- No new unresolved review thread was present after the scrollytelling patch.

## Preview status

At verification time, Vercel had not produced a deployment for implementation head `76909066cdc89ee23a0d4ddb592ae8a8cbff4500`. The newest available branch deployment still targeted the earlier documentation head `eb52ee20034101380cb7f4ed24e1885a4777db7f`.

The source and build contracts explicitly cover 1440px, 1024px, and 390px widths, but rendered visual acceptance at those viewports is not claimed without a fresh deployment or local browser run.

## Remaining visual gate

Before merge, inspect a fresh preview of the final runtime at:

- 1440px width: complete initial hero heading, balanced EGA mark, and safe header action;
- 1024px width: stacked section composition and complete Focus task block;
- 390px width: no horizontal overflow, intact heading words, anchored indices, and fully visible CTAs;
- reduced-motion mode and keyboard-only navigation.

No production deployment or merge is authorized by this evidence document.
