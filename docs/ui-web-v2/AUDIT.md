# EGA Command OS — Wave 0 Code-Truth Audit

Base SHA: `dca2dceaa3baa72352ef9a6db8c80d29029fc82a` (origin/main @ 2026-08-25)
Branch: `ui/web-v2` · Worktree: `../ui-web` (→ `/home/ubuntu/ui-web`)
Date: 2026-08-25
Scope: WEB ONLY — `apps/web/**` (mobile isolation verified: 0 files under `apps/mobile/**`)

## 1. Governance & Authority

- **Current behavior authority**: executable code in `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`, `packages/**`, plus migrations in `src/db` / `drizzle`.
- **Normative authority**: this mission (EGA Command OS brief) + `AGENTS.md` + `ARCHITECTURE.md` + `docs/agent-context/product-authority.md`.
- Decision: implementation gaps are classified as defects; no silent normalization.

## 2. Route Inventory (authoritative — verified via `find apps/web/src/app -name page.tsx`)

| # | Route | File | Purpose | Auth |
|---|-------|------|---------|------|
| 1 | `/` | `app/page.tsx` | Public marketing/home redirect | public |
| 2 | `/login` | `app/login/page.tsx` | Auth — sign-in | public |
| 3 | `/signup` | `app/signup/page.tsx` | Auth — sign-up | public |
| 4 | `/auth/*` + `/auth-ui` + `/oauth/consent` | `app/auth/**`, `app/auth-ui`, `app/oauth/consent/page.tsx` | Supabase auth callbacks / OAuth | public |
| 5 | `/dashboard` | `app/dashboard/page.tsx` | Operational snapshot (command center) | authenticated |
| 6 | `/today` | `app/today/page.tsx` | Daily execution queue | authenticated |
| 7 | `/tasks` | `app/tasks/page.tsx` | Work inventory (list/board, filters, saved views) | authenticated |
| 8 | `/tasks/projects` | `app/tasks/projects/page.tsx` | Project index | authenticated |
| 9 | `/tasks/projects/new` | `app/tasks/projects/new/page.tsx` | Create project | authenticated |
| 10 | `/tasks/projects/[slug]` | `app/tasks/projects/[slug]/page.tsx` | Project detail | authenticated |
| 11 | `/goals` | `app/goals/page.tsx` | Goals list + creation | authenticated |
| 12 | `/timer` | `app/timer/page.tsx` | Focus sessions (start/stop, history) | authenticated |
| 13 | `/review` | `app/review/page.tsx` | Weekly review reflection | authenticated |
| 14 | `/review/[reviewId]` | `app/review/[reviewId]/page.tsx` | Review detail | authenticated |
| 15 | `/work-analytics` | `app/work-analytics/page.tsx` | Session analytics | authenticated |
| 16 | `/ideas` | `app/ideas/page.tsx` | Capture / triage | authenticated |
| 17 | `/startup` | `app/startup/page.tsx` | Weekly planning ritual | authenticated |
| 18 | `/shutdown` | `app/shutdown/page.tsx` | Shutdown ritual (carry-over, reflection) | authenticated |
| 19 | `/apps` | `app/apps/page.tsx` + `app/apps/[workspace]/page.tsx` | Launcher / workspace surfaces | authenticated |
| 20 | `/help` | `app/help/page.tsx` | Support / workflow docs | authenticated |
| 21 | `/settings/account` | `app/settings/account/page.tsx` | Account + Calendar integration | authenticated |
| 22 | `/search` | `app/search/**` | Server action backing CommandPalette | authenticated |
| 23 | `/api/**` + `/home`, `/error`, `/global-error` | misc | API routes / error boundaries | mixed |

**Observation**: `shell-route-meta.ts` exposes only 13 primary routes (COMMAND_ROUTES + SYSTEM_ROUTES). The full file inventory reveals 5 additional routes (`/tasks/projects/*`, `/review/[reviewId]`, `/apps/[workspace]`, auth, root) — the shell meta is a navigation subset, not the full route map. Route-matrix below covers all 22.

## 3. Shell Architecture

**Current**: Per-page `AppShell` (server component) imported directly in each authenticated `page.tsx`:
- `AppShell` fetches `getSidebarProjects()`, `getSidebarGoals()`, `getWorkspaceShellMetrics()` via `Promise.all`.
- Renders `<Sidebar>`, `<TopBar>`, `<WorkspaceKeyboardShortcuts>`, page header, and children.
- `Sidebar` is a client component wrapping `SidebarNavigation` + `QuickTaskSheet`.
- `TopBar` is client, shows route meta, search trigger, signal cluster, Apps pill, Shortcuts, Messages, Notifications, avatar.
- `CommandPalette` is portal-based, controlled via custom event `ega:open-command-palette` and `Ctrl/Cmd+K` shortcut (preserved in `workspace-keyboard-shortcuts.tsx`).
- Styling: `globals.css` (primary) + `editorial-shell.css` + `editorial-shell-responsive.css` gated behind `[data-workspace-theme="editorial"]`, applied via `data-workspace-theme="editorial"` on `AppShell` root.

**Defect / opportunity**:
- No shared `(workspace)/layout.tsx` — shell re-mounts per navigation (full RSC re-execution). Metrics/projects are re-fetched on every page. No request-memoization beyond ad-hoc `unstable_cache` on some dashboard helpers.
- Shell is NOT persistent across navigations; TopBar/Sidebar remount, losing client state and causing layout flash.
- `workspace-shell.ts` metrics hit Supabase with multiple counts per page (blocked/overdue/dueToday/review) — duplicate when combined with dashboard panels.
- `editorial-shell.css` introduces a second token authority (citrus #ffd400, signal #ff4b2b, cream #f4efe3) conflicting with `globals.css` green tokens (#177b52, #f6f7f2). Token drift is confirmed.

**Server/Client boundary**:
- All `page.tsx` are Server Components except where `use client` islands exist: `CommandPalette`, `Sidebar`, `TopBar`, `ActiveTimerDisplay`, `SessionTimingEditor`, drag/board, filter controls, modals.
- Good: dashboard uses `Suspense` + `PanelErrorBoundary` per panel (preserved pattern).
- Risk: `app/tasks/page.tsx` (750 lines) and `app/today/page.tsx` (363) mix orchestration + heavy JSX. They should be thinned to `page.tsx` (data + header) + `_components/` composition.

## 4. Shared Components

**`components/ui` primitives** (13 files):
`badge.tsx`, `button.tsx`, `card.tsx`, `empty-state.tsx`, `filter-pill.tsx`, `input.tsx`, `pending-submit-button.tsx`, `progress-bar.tsx`, `sheet.tsx`, `skeleton.tsx`, `stat-card.tsx`, `status-badge.tsx`, `tabs.tsx`, `textarea.tsx`.

- Gaps: no `tooltip.tsx`, `popover.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `category-tag.tsx`, `metric.tsx`, `trend-delta.tsx`, `section-header.tsx`, `page-header.tsx` as named in mission. `tooltip/popover/dialog` are needed for Command OS density.
- `button.tsx` maps variants to `btn-instrument` (green glass) — will need gold primary per token authority.
- `card.tsx` uses `ega-glass` — to be remapped to `--ega-surface` + `--ega-border`.

**`components/layout`**:
- Stable: `app-shell.tsx`, `sidebar.tsx`, `sidebar-navigation.tsx`, `top-bar.tsx`, `shell-route-meta.ts`, `command-palette.tsx/.ts`, `workspace-keyboard-shortcuts.tsx`, `sidebar-mobile-drawer.tsx`, `shell-signals.tsx`.
- Duplicated presentation across routes: hero, stat, list-row, timeline styles are route-scoped (e.g., `dashboard.css`, `dashboard-editorial.css`, `globals.css` instrument-table) — need convergence.

**`components/<domain>` reusable**:
`components/tasks/*`, `components/goals/*`, `components/timer/*`, `components/today/*`, `components/review/*`, `components/shutdown/*`, `components/startup/*`, `packages/*` contracts. Service truth lives correctly in `src/lib/services/*`; no UI-owned duplicate domain logic observed, but task filtering logic is split between `lib/task-list.ts`, `lib/task-archive.ts`, and `app/tasks/page.tsx`.

## 5. Data & Service Dependencies

- Canonical services: `task-service.ts`, `timer-service.ts`, `focus-queue-service.ts`, `dashboard-today-adapter.ts`, `work-analytics-*`, `weekly-review-page-service.ts`, `idea-note-service.ts`, `startup-planner-service.ts`, `shutdown-service.ts`, `workspace-search-service.ts`, `auth-service.ts`.
- Dashboard duplicates: `page.tsx` fetches `getActiveTimer()`, `getTodayPlanner()`, `getTimerSummary()`, `getDashboardHealthData()` in parallel; async panels then re-fetch overlapping data via `getHeroPanelData`, `getCommandCenterPanelData`, etc., each internally calling `getTimerSummaryCached()` / `getLatestReviewCached()`. `unstable_cache` is used for `getLatestReview`, `getLinearProject`, `getTimerSummary` — **without user-scoped keys**, risking cross-user leak if cache were shared (currently request-memoized via 60–120s revalidate but still unsafe for auth data). Mission says prefer `React.cache()` request memoization.
- Same duplication between `AppShell` metrics (`getWorkspaceShellMetrics`) and dashboard `workStats` / `todayPlanner`.
- Supabase client via `createClient()` from `@/lib/supabase/server` (server) — correct.

## 6. Dead / Fake Controls

Audited `top-bar.tsx`:
- `Mail` (Messages) button: no href, no handler beyond visual — **dead**.
- `Bell` (Notifications) button: same — **dead** (only visual signal dot).
- `Apps` pill: routes to `/apps` — **functional**.
- `Shortcuts` (Keyboard icon + `?`): opens help sheet via `workspaceShortcutEvents.openHelp` — **functional**.
- Avatar `EG`: static, no dropdown/menu — **decorative/incomplete**.
- `CommandPalette` search trigger: functional but `input` was replaced with button dispatching custom event — correct but missing `aria-controls` wiring.

`sidebar-navigation.tsx`:
- `Hermes` external link: functional.
- Project list: functional, but `getProjectColor` random hash — non-semantic.
- `SidebarLogout`: functional (verified via `logout-actions.ts`).

Recommendation per mission: remove `Messages`/`Notifications` dead buttons; replace avatar with functional user menu.

## 7. Duplicate Presentation

- Two full theming systems active: `globals.css` (glass/green) + `editorial-shell.css` (cream/citrus/black). Both define `--sidebar-width`, `--border`, shadows. `.ega-glass*` and `[data-workspace-theme="editorial"]` overrides conflict; some rules duplicated across both files.
- Dashboard hero: `dashboard.css` + `dashboard-editorial.css` duplicate hero/metrics layout with different tokens.
- `today` / `tasks` / `goals` each define own card/row/table patterns instead of reusing `components/ui`.
- `status-badge` vs `badge` vs `sidebar-badge` — three overlapping status systems.

## 8. Accessibility Gaps

- Positive: `skip-to-main`, `aria-current="page"`, `aria-label` on icon buttons, `role="dialog"` + `aria-modal` on palette, focus trap, `Esc` handling, `aria-activedescendant` on palette.
- Gaps:
  - `TopBar` Messages/Notifications lack accessible name distinction beyond `aria-label` but have no tooltip for sighted ambiguity — needs `Tooltip`.
  - Sidebar collapsed at 760–1180px hides labels without tooltip recovery.
  - `CommandPalette` portal lacks `aria-live` for result count.
  - Tables in `tasks` use `instrument-table` with `tr:hover` but no `scope` on headers.
  - Color-only signals: `projectDot` random colors, urgency via `bg-[var(--signal-error)]` without text alternative in some rows.
  - Missing `reducedMotion="user"` on `motion` consumers (no global `MotionConfig`).

## 9. Responsive Issues

- Verified at breakpoints from file: 1180, 900, 768, 640, 420.
- At 1180px sidebar collapses to 88px icon-only — no tooltip, label loss.
- At 760px sidebar disappears, drawer takes over (good), but TopBar grid collapses to 2 rows causing search to wrap full-width — layout shift.
- Tables remain desktop tables at 390px; `tasks` kanban board collapses to 1 column correctly, but list view tables cause horizontal scroll without prioritization.
- Dashboard hero at editorial uses fixed `min-height: 24rem` + huge `clamp(3rem, 5.5vw, 6.7rem)` title — overflows at 390px (verified `font-size` oversized).
- `shell-search` min-width 18rem causes overflow at 390.

## 10. Performance Risks

- **Shell re-fetch**: Every navigation re-executes `getSidebarProjects` (24 projects + 1000 tasks scan) + `getSidebarGoals` + `getWorkspaceShellMetrics` (4+ counts). No caching.
- **Dashboard waterfall**: `page.tsx` awaits health/timer/planner in serial with panels, then panels re-fetch similar data via `unstable_cache` (60s). Could be coalesced via `React.cache` + `Promise.all`.
- **`unstable_cache` on user data**: `getLatestReviewCached`, `getTimerSummaryCached`, `getLinearProjectCached` share keys across users — must be replaced or keyed by user.
- **Font**: `globals.css` uses `@import` Google Fonts (Instrument Sans + Sora) — blocking, no `next/font`, no preload.
- **Bundle**: `motion@12.42.2` + `lucide-react@^1.8.0` with bare imports (no per-icon chunking beyond tree-shake). Charts in `work-analytics` (`WeekBarChart`, `SessionHeatmap`) are eagerly loaded.
- **TopBar search**: debounce 180ms + server action `searchWorkspaceAction` — correct, but missing abort on stale query.
- **Timer tick**: `ActiveTimerDisplay` isolates 1s tick correctly (small client), but dashboard `TimerSummaryCard` may re-render if parent not memoized.
- **No image optimization issues**: only `logo.svg`.
- **LCP/INP**: huge dashboard hero title + multiple skeletons risk CLS; no `priority` on critical content beyond logo.
- **Charts**: `work-analytics` not lazy-loaded; Recharts-like deps (need inspection) could inflate bundle.

## 11. Risky Refactors

- `(workspace)/layout.tsx` route-group migration: safe IF `AppShell` is lifted and all pages remain under `app/(workspace)/**` preserving URLs. Must preserve `metadata`, `searchParams`, `serverActions`, and `usePathname` semantics. Risk: middleware + auth redirects that check path prefixes; recommend validate against `src/lib/middleware-navigation.test.ts` and `src/lib/services/auth-service.ts`.
- Token migration: must provide compat shims for `var(--signal-*)`, `var(--accent)`, `var(--instrument)` → new `--ega-*` during transition, then remove after callers moved. Do NOT attempt in one giant CSS commit.
- Font migration: `next/font/google` requires touching `layout.tsx` and removing `@import`; verify no FOIT/CLS regression.

## 12. Test Coverage Map

- Layout: `command-palette.test.tsx`, `command-palette-model.test.ts`, `sidebar.test.tsx`, `sidebar-mobile-drawer.test.tsx`, `top-bar.test.tsx`, `shell-signals.test.tsx`, `workspace-keyboard-shortcuts.test.ts`, `editorial-shell.test.ts`, `logout-actions.test.ts`, `sidebar-help-wiring.test.ts`, `sidebar-logout-wiring.test.ts` — good command-palette/shortcut coverage.
- Domain: `focus-queue.test.ts`, `task-list.test.ts`, `goal-health.test.ts`, `manual-worked-time.test.ts`, `quick-task-command-parser.test.ts`, `keyboard-shortcuts.test.ts`, `workspace-search` — solid.
- Dashboard: `dashboard-data.test.ts`, `dashboard-helpers.test.ts`, `focus-panel.test.ts`, `linear-dashboard.test.ts`, `McpComingSoonAnnouncement.test.tsx` — hero/panel logic covered but not visual regression.
- Missing: responsive snapshot tests, a11y `axe` checks, CommandPalette “quick actions”, shell persistence, font-loading perf.
- Validation commands (per `docs/agent-context/testing-and-validation.md`): `npm run web:typecheck`, `npm run web:test`, `npm run web:build`, `npm run typecheck`, `npm run lint`.

## 13. Concluding Defect List (for waves)

1. Consolidate tokens to EGA Command OS authority; remove green/citrus drift.
2. Stall shell: either introduce `(workspace)/layout.tsx` or memoize shell fetches with request cache; remove dead TopBar controls.
3. Improve CommandPalette: add QUICK ACTIONS section, preserve existing behavior, enhance a11y.
4. Dashboard hierarchy redesign per mission spec (Summary Strip, Planner | Focus, Attention | Project | Review) — current dashboard has hero + 7 equal-weight cards.
5. `tasks` page thinning + density pass; `today` execution flow hierarchy fix.
6. Replace `@import` fonts with `next/font`.
7. Remove unsafe `unstable_cache` on user data.
8. Add `MotionConfig reducedMotion="user"` globally.
9. Add Tooltip/Popover/Dialog primitives.
10. Verify mobile isolation continuously.

— Wave 0 audit complete. Proceed to Wave 1.
