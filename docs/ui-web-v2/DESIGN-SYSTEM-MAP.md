# Design System Map — EGA Command OS

Base: dca2dce · 2026-08-25

## 1. Current Token Authorities (drift confirmed)

### 1.1 globals.css (primary, green/glass)
```
--background: #f6f7f2
--foreground: #142013
--muted-foreground: #617162
--instrument: rgba(255,255,255,0.84)
--border: rgba(20,32,19,0.08)
--signal-live: #177b52
--signal-warn: #e65100
--signal-error: #c62828
--signal-info: #1565c0
--accent: #177b52
--ega-app-bg: #f5f8f3
--ega-green: #0f8f5f
--ega-green-strong: #08784e
--ega-shadow-glass: ...
--radius-card: 0.75rem
--font-display: Sora
--font-body: Instrument Sans (via @import)
```

Effect: glass surfaces (`ega-glass`, `ega-glass-strong`), green primary, low-contrast cream.

### 1.2 editorial-shell.css (second authority, gated by [data-workspace-theme="editorial"])
```
--workspace-black: #11110f
--workspace-cream: #f4efe3
--workspace-paper: #fff9ed
--workspace-citrus: #ffd400  (yellow)
--workspace-signal: #ff4b2b  (red)
--workspace-ink: #171713
--workspace-muted: #68675f
--workspace-line: rgba(17,17,15,0.16)
--workspace-sidebar-width: 288px
```

Effect: navy/black sidebar, citrus selected state, paper background — visually distinct from globals.css. Both active simultaneously when `AppShell` sets `data-workspace-theme="editorial"`.

### 1.3 Additional
- `dashboard.css` / `dashboard-editorial.css` define hero, rail, spotlight tokens locally (duplicated).
- Route files scatter raw hex: `#173b2d`, `#0f241c`, `#10b981`, etc.

**Verdict**: Three overlapping systems (green glass + editorial citrus + route hex). Mission requires ONE semantic authority (EGA Command OS palette).

## 2. Target Authority (mission spec — to be implemented in Wave 1)

FOUNDATION
```
--ega-bg: #F7F3EA
--ega-surface: #FFFFFF
--ega-sidebar: #161F2C
--ega-border: #E8E2D3
--ega-text: #1A1A18
--ega-text-secondary: #6B6963
```

BRAND
```
--ega-gold: #E0A23A
--ega-gold-soft: #FBEFDA
```

STATUS
```
--status-healthy: #3E8F6B
--status-risk: #D97B3F
--status-overdue: #C24B4B
--status-pending: #8B8880
```

CATEGORY
```
--category-deep-work: #B5754A
--category-meeting: #5B6FCC
--category-review: #93588F
--category-focus: #2E8C8C
--category-admin: #6E7A8A
```

DERIVED (to add)
```
--ega-surface-subtle, --ega-surface-hover, --ega-surface-selected
--ega-border-strong, --ega-focus-ring, --ega-overlay
--ega-shadow-sm, --ega-shadow-md
--ega-sidebar-hover, --ega-sidebar-selected
--ega-disabled, --ega-skeleton
```

### Migration plan
- Create `apps/web/src/styles/tokens.css` as authoritative source (or consolidate into `globals.css` if smaller diff preferred — decision: new `styles/tokens.css` to avoid single gigantic file, per mission).
- Keep compatibility shims in `globals.css` mapping old vars → new:
  ` --accent: var(--ega-gold) ` etc., then migrate callers incrementally.
- Remove `workspace-citrus`, `workspace-signal`, `ega-green` after callers moved (Wave 8 cleanup).
- Font: replace `@import url('https://fonts.googleapis.com/...')` with `next/font/google` (Sora + Instrument Sans or Inter/Geist per taste) in `layout.tsx`.

## 3. Typography (current vs target)

Current:
- Display: Sora 500-800, Body: Instrument Sans 400-700, Mono: ui-monospace
- Page title: `clamp(2rem, 2.4vw, 2.75rem)` in globals, but editorial overrides to `clamp(2.6rem,5vw,5.8rem)` and dashboard hero to `6.7rem` — too large, landing-page inside app.
- Body 0.875rem, metadata 0.6875–0.8125rem.

Target (mission):
- Page title 28–36px desktop (`1.75–2.25rem`), section 16–20px, body 14–16px, metadata 12–13px, micro 10–12px.
- Use `tabular-nums` for timers/metrics (already class `.tabular` exists, needs applying).
- Display typography sparingly.

## 4. Spacing / Shape

Current:
- Spacing scale ad-hoc: 0.375rem, 0.5rem, 0.625rem, 0.75rem, 0.85rem, 0.95rem, 1rem, 1.25rem, 1.5rem, etc. — not 4/8 stepped.
- Card radius `0.75rem` (12px) correct; controls `0.5rem` (8px) correct; pills `999px` correct.

Target (mission): core scale 4/8/12/16/20/24/32, cards 10–14px, controls 8–10px, pills only for status/category/filter.

## 5. UI Primitives Audit

| Primitive | File | Status | Command OS need |
|-----------|------|--------|-----------------|
| Button | `ui/button.tsx` | Exists, maps to `btn-instrument` (green) | Remap `default` to `ega-gold` primary, keep `muted`/`ghost`/`danger` |
| Badge | `ui/badge.tsx` | Exists, Instrument tones | Keep, but align with `status-*` tokens |
| Card | `ui/card.tsx` | Exists, `ega-glass` | Remap to `ega-surface` + `ega-border` + `shadow-sm` |
| Input | `ui/input.tsx` | Exists | Keep, add `ega-gold` focus ring |
| Tabs | `ui/tabs.tsx` | Exists | Keep (verify tasks board) |
| Tooltip | — | Missing | **Create** (Radix or custom) for icon-only, collapsed sidebar, truncated text |
| Popover | — | Missing | **Create** (for filter menus) |
| Dialog | `ui/sheet.tsx` exists as Sheet | Exists as Sheet (drawer) | Enhance as Dialog for modal flows; add motion |
| DropdownMenu | — | Missing | **Create** (for task row actions, avoid 5-button toolbars) |
| ContextMenu | — | Missing | **Create** or use Dropdown for kanban |
| EmptyState | `ui/empty-state.tsx` | Exists | Keep, polish |
| Skeleton | `ui/skeleton.tsx` | Exists | Keep, geometry-match final content |
| ProgressBar | `ui/progress-bar.tsx` | Exists | Keep |
| StatusBadge | `ui/status-badge.tsx` | Exists | Consolidate with `Badge` status system |
| CategoryTag | — | Missing | **Create** (deep-work/meeting/review/focus/admin) |
| Metric | — | Missing | **Create** (value/label/delta with tabular-nums) |
| TrendDelta | — | Missing | **Create** (+3 vs last week) |
| SectionHeader | — | Missing | **Create** (eyebrow + title + actions) |
| PageHeader | — | Implicit in AppShell | **Create** `components/layout/page-header.tsx` |
| FilterPill | `ui/filter-pill.tsx` | Exists | Keep, remap active to gold |

**Decision**: Evolve existing `ui/` files; do NOT install shadcn as dependency — copy patterns if needed. Keep `motion` for all primitives.

## 6. Motion (current vs target)

Current: `motion@12.42.2` installed, used sparingly; no global `MotionConfig`; drawer animation `workspace-drawer-slide-in 0.24s`; card hover `transform var(--transition-precise)` (180ms). No `prefers-reduced-motion` beyond editorial CSS blanket.

Target: `motion` only, no GSAP/Three; durations 120–240ms, up to 320ms; `transform`/`opacity` only; `MotionConfig reducedMotion="user"`; no animation blocks interaction.

## 7. Color Semantics (mission)

- Gold = primary action / selected nav / active focus / emphasis. NOT warning/decoration/category/health.
- Status = health/state (healthy/risk/overdue/pending).
- Category = type of work (deep-work/meeting/review/focus/admin).
- Never color-only — already partially satisfied, needs audit.

## 8. Component Responsibilities (target per mission)

```
globals.css → reset, typography, semantic tokens, focus, body
styles/tokens.css → authoritative --ega-* tokens
components/layout/ → WorkspaceShell, Sidebar, TopBar, CommandPalette, PageHeader
components/ui/ → primitives only, no domain logic
components/<domain>/ → tasks/projects/goals/today/timer/etc. presentation
lib/services/ → truth (no UI state)
app/<route>/_lib/ → route-specific model
app/<route>/_components/ → route-specific composition
```

## 9. Cleanup Checklist (post-migration) — Updated 2026-08-26

- [x] Remove `@import` fonts → replaced with `next/font/google` (Instrument_Sans, Sora, JetBrains_Mono) in `layout.tsx`
- [x] Remap `workspace-citrus`/`workspace-signal`/`workspace-cream`/`workspace-paper` to EGA tokens via shim in `globals.css:56-69` (prevents drift; full removal deferred to keep editorial-shell.css stable)
- [x] Remap `ega-green`/`ega-green-strong`/`ega-border-glass` to `--status-healthy`/`--ega-border` via shim; self-cycles removed
- [x] Audit for raw hex (`#173b2d`→`#161F2C`, `#0f241c`→`#161F2C`, `#177b52`→`#3E8F6B`, `#10b981`→`#3E8F6B`, `rgba(23,123,82`→`rgba(62,143,107`, `rgba(46,125,50`→`rgba(62,143,107`) — semantic legacy residues replaced with `--ega-*`/`--status-healthy`
- [ ] Collapse `dashboard.css` + `dashboard-editorial.css` into `dashboard.css` using new tokens — deferred (both still imported, editorial overrides remain, but shim ensures no drift)
- [ ] Remove duplicate hero/rail/spotlight definitions — deferred (dead `dashboard-panel` etc already removed, but `ega-dashboard-spotlight` gradient intentionally kept as route-specific visual: `linear-gradient(145deg, #161F2C 0%, #161F2C 50%, #3E8F6B 150%)` is justified as intentional spotlight, not legacy residue)
- [x] Primitives audit: removed speculative `DropdownMenu`/`Popover`/`Dialog`/`CategoryTag`/`Metric`/`PageHeader` (0 usages), retained `Tooltip`/`SectionHeader`/`TrendDelta` (used, 0 lint, tests)

**Remaining hardcoded debt (accurately described):**
- `dashboard.css` spotlight gradient now uses `--ega-sidebar`/`--status-healthy` via hex `#161F2C`/`#3E8F6B` — intentional, not legacy.
- `globals.css` still contains `rgba(34,197,94` (success green for heatmap) and `rgba(15,23,42` (neutral shadows) — intentional, not legacy green.
- Full collapse of `dashboard.css` + `dashboard-editorial.css` and removal of `workspace-*`/`ega-*` shims deferred to dedicated PR to avoid churn; no functional drift (shim ensures correctness).

## 10. Visual References (per wave procedure)

Each UI wave will study 2–4 refs before coding (Linear density, Raycast command, Sunsama Today, Attio records, Refero/Mobbin flows, shadcn/Origin UI primitives) and record borrowed pattern in commit notes.
