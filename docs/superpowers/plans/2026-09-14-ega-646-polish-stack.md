# EGA-646 Polish Stack — Implementation Plan

Parent QA ticket: EGA-646 (umbrella, stays open).
Workstream: EGA-647 → 648 → 649 → 650 → 651 → 653 → 654 → 655.

## Verified base

- `origin/main` at session start: `61dacc6d43f95a387c9eda2d80629fdb472898dc`
  (2026-09-14, "Merge pull request #239 from egawilldoit/release/mobile-v1.0.5").
- The EGA-646 readiness audit SHA (`61dacc6d…`) is still the current base; it is
  recorded here as verified current `origin/main`, not assumed.
- Local `main` was clean and equal to `origin/main` before branching.
- Open PRs at start: #182, #174, #133 (draft), #132 — none touch `apps/web`
  polish surfaces. No overlap identified at planning time.

## Worktree

- Single isolated worktree: `.worktrees/ega-646-polish-stack`
- One branch chain only; no per-ticket worktrees.
- Original checkout (`/home/ubuntu/ega-house`) is not modified.
- `.worktrees/` is excluded via `.git/info/exclude`.

## Stack

| # | Ticket | Branch | PR base |
|---|--------|--------|---------|
| 1 | EGA-647 | `stack/ega-647-overdue-counts` | `main` |
| 2 | EGA-648 | `stack/ega-648-responsive-layout` | `stack/ega-647-overdue-counts` |
| 3 | EGA-649 | `stack/ega-649-sidebar-create-task` | `stack/ega-648-responsive-layout` |
| 4 | EGA-650 | `stack/ega-650-compact-task-filters` | `stack/ega-649-sidebar-create-task` |
| 5 | EGA-651 | `stack/ega-651-task-card-progressive-disclosure` | `stack/ega-650-compact-task-filters` |
| 6 | EGA-653 | `stack/ega-653-authenticated-home` | `stack/ega-651-task-card-progressive-disclosure` |
| 7 | EGA-654 | `stack/ega-654-navigation-redesign` | `stack/ega-653-authenticated-home` |
| 8 | EGA-655 | `stack/ega-655-analytics-redesign` | `stack/ega-654-navigation-redesign` |

Each branch is created from the previous branch HEAD. Each PR is opened against
its immediate parent branch, so the diff shows only that ticket's delta.

## Dependencies between tickets

- EGA-647 establishes canonical visible overdue semantics → consumed by EGA-653
  (Home attention counts) and EGA-654 (top-bar signal aggregation).
- EGA-648 establishes responsive geometry → consumed by EGA-650 (filter density)
  and EGA-651 (card density).
- EGA-649 establishes the sidebar Create Task capability → consumed by EGA-654.
- EGA-653 establishes the `/home` route + nav destination → consumed by EGA-654.
- EGA-654 finalizes shell presentation after the above capabilities exist.
- EGA-655 is presentation-only and independent; stacked last to avoid review noise.

## File ownership map

| Area | Canonical owner | Tickets touching it |
|---|---|---|
| Today route/read composition | `apps/web/src/app/today/**` | 647 |
| Shell metrics | `apps/web/src/lib/workspace-shell.ts` | 647, 653, 654 |
| Shell signals | `apps/web/src/components/layout/shell-signals.tsx` | 654 |
| Today summary semantics | `packages/application/src/today/plan.ts` | 647 (preserve, do not change) |
| Responsive geometry | `apps/web/src/app/globals.css`, `apps/web/src/components/layout/editorial-shell-responsive.css` | 648 |
| Timer layout | `apps/web/src/app/timer/_components/TimerPageView.tsx`, `apps/web/src/components/timer/active-timer-display.tsx` | 648 |
| Tasks layout | `apps/web/src/app/tasks/_components/TasksPageView.tsx`, `apps/web/src/components/tasks/task-kanban-card.tsx` | 648, 650, 651 |
| Navigation | `apps/web/src/components/layout/{sidebar,sidebar-navigation,sidebar-mobile-drawer,top-bar,shell-route-meta}.tsx` | 649, 653, 654 |
| Quick task flow | `apps/web/src/components/tasks/quick-task-sheet.tsx`, `apps/web/src/lib/workspace-events.ts` | 649, 653, 654 (reuse only) |
| Task filters | `apps/web/src/components/tasks/task-filter-controls.tsx`, `apps/web/src/lib/task-list.ts`, `apps/web/src/app/tasks/_lib/tasks-page-model.ts` | 650 |
| Task cards | `apps/web/src/components/tasks/inline-task-update-form.tsx`, `apps/web/src/components/tasks/task-reminder-panel.tsx`, `apps/web/src/components/ui/sheet.tsx` | 651 |
| Operator snapshot read model | `packages/application/src/operator/snapshot.ts` | 653 (consume only) |
| Routing/proxy | `apps/web/src/app/page.tsx`, `apps/web/src/proxy.ts`, `apps/web/src/app/home/**` | 653 |
| Analytics | `apps/web/src/app/work-analytics/**`, `apps/web/src/components/review/trend-bar-chart.tsx` | 655 |

## Acceptance-to-evidence mapping (per ticket)

- **EGA-647** — Visible `overdue` on Today uses the canonical shell metric
  (`getWorkspaceShellMetrics().overdueTaskCount`); `TodayPlan.summary.overdueCount`
  keeps selected-lane semantics. Evidence: regression test where selected overdue
  (A) ≠ global overdue (A+B); shell metric and rendered briefing agree. Also align
  the shell day boundary to the canonical Time Context timezone already resolved
  in `workspace-shell.ts`.
- **EGA-648** — Intermediate desktop/tablet widths recompose instead of squeezing:
  timer inner fixed `18rem` rail removed/stacked; Kanban moves to a usable
  intermediate state. Evidence: before/after browser screenshots at the viewport
  matrix; structural component/CSS assertions where a unit test is meaningful.
- **EGA-649** — Sidebar exposes a keyboard-accessible `Create task` that dispatches
  the existing `QUICK_TASK_EVENT` (single QuickTaskSheet). Evidence: sidebar
  interaction test (Create task present, opens canonical sheet, Capture unchanged,
  one owner).
- **EGA-650** — Compact filter toolbar; advanced dimensions behind one disclosure;
  URL/Saved View state preserved. Evidence: URL parse/model tests + chip
  remove/clear-preserves-view tests.
- **EGA-651** — Minimal list card + `More options` Sheet reusing existing server
  actions. Evidence: component tests (no form expanded by default, open/close no
  mutation, blocked-reason behavior, actions available).
- **EGA-653** — Authenticated `/home`; `/` redirects authed users to `/home`;
  public `/` unchanged; canonical Operator/shell data only. Evidence: route/proxy
  tests, model tests, timer-overrides-startHere test.
- **EGA-654** — Collapsible sidebar + restrained motion + simplified top bar;
  consumes 649/653 capabilities. Evidence: nav tests (same destinations collapsed
  vs expanded, icon a11y labels, reduced motion, one active route), visual
  screenshots.
- **EGA-655** — Analytics hierarchy: ≤4 KPIs, one dominant chart, compact weekly,
  one estimate comparison, preserved filters/drilldown. Evidence: component tests
  for KPI mapping/empty states/filters; visual screenshots.

## Targeted tests

- Web unit/component: `apps/web/src/components/**` and `apps/web/src/app/**`
  (`node:test` files run through the vitest `node:test` alias; do not add new files
  to the vitest exclude list).
- Application package semantics (only if pinned/changed): `packages/application`.
- Do not manufacture source-string tests as responsive proof.

## Full validation gates (every PR, from repo root)

```bash
npm run web:typecheck
npm run web:test
npm run lint:changed
npm run web:build
```

Visual/responsive tickets also attempt `npm run web:test:visual` when the
environment supports browser execution; otherwise record
`VISUAL NOT VERIFIED` with the exact blocker.

If ownership/imports change: `npm run check:architecture`, `npm run test:architecture`.
If auth/RLS changes: `npm run ci:security`.

## Scope boundaries

- Expected work is `apps/web/**`; narrow `packages/application/**` only where a
  canonical semantic fix genuinely requires it.
- No DB migration. No new UI/animation/chart dependency. Use `motion/react`
  (`motion@12.42.2`) only.
- Avoid `apps/mobile`, `apps/server`, `packages/data-access`, `packages/contracts`,
  `src/db`, `drizzle/` unless proven necessary.
- No merging. Leave the stack review-ready.
