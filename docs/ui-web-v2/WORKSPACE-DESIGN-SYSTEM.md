# Workspace UI System

Living reference for the authenticated **web** product surface. Applied by
`apps/web` after the light-workspace refactor. Visual authority for the refactor
was four approved reference screens (Home, Today, Tasks, Analytics); the tokens
below are the implementation contract.

Behavioural authority stays with the source code and
[`product-authority.md`](../agent-context/product-authority.md). This document
does not change product semantics.

## 1. Principles

1. **Quiet surfaces.** Neutral canvas, elevated panels, 1px borders, whitespace
   over decoration. Light is white-on-neutral; dark is charcoal-on-charcoal,
   never pure black. Shadows only for overlays that float above the page.
2. **Dense but scannable.** 12–16px panel padding, 32–48px rows, tabular
   numerals, small precise labels.
3. **One grammar.** Every screen composes the same page header, section, panel,
   metric, table, and empty-state primitives. No route invents a local system.
4. **Real data only.** If a canonical service cannot supply a number, the screen
   omits the number. No illustrative, invented, or estimated values.

## 2. Tokens

`apps/web/src/styles/tokens.css` is the only token authority. Light values live
in `:root`; the dark palette is a scoped override on
`html[data-theme="dark"]:has([data-workspace-theme="workspace"])`. Keeping the
override on `<html>` lets portalled dialogs, menus, and tooltips inherit the
same values, while `:has()` prevents the dark palette from leaking into the
public marketing and auth surfaces (they own `--home-*` and `--auth-*`).

| Group | Token | Light | Dark |
|---|---|---|---|
| Canvas | `--ega-bg` | `#f2f2f2` | `#101114` |
| Panel | `--ega-surface` | `#ffffff` | `#17181d` |
| Panel subtle | `--ega-surface-subtle` | `#fafafa` | `#1c1e24` |
| Hover | `--ega-surface-hover` | `#f5f5f5` | `#21232a` |
| Selected | `--ega-surface-selected` | `#f0f0f0` | `#262930` |
| Muted | `--ega-surface-muted` | `#ededed` | `#2a2d35` |
| Elevated | `--ega-surface-elevated` | `#ffffff` | `#23262d` |
| Border | `--ega-border` | `#e5e5e5` | `#2c2f37` |
| Border strong | `--ega-border-strong` | `#d6d6d6` | `#3a3e48` |
| Control border | `--ega-control-border` | `#767676` | `#6b7280` |
| Text | `--ega-text` | `#171717` | `#f2f3f5` |
| Text secondary | `--ega-text-secondary` | `#5c5c5c` | `#b4b8c1` |
| Text tertiary | `--ega-text-tertiary` | `#6a6a6a` | `#9196a1` |
| Ink (primary action) | `--ega-ink` | `#171717` | `#f2f3f5` |
| On ink | `--ega-on-ink` | `#ffffff` | `#101114` |

Structural dividers stay quiet (`--ega-border`, `--ega-divider`). Interactive
form controls use `--ega-control-border`, measured at 3:1 against the surfaces
they sit on (WCAG 1.4.11). Status, priority, data, sidebar, focus, overlay,
skeleton, and shadow tokens all have dark overrides in the same block.

Data categories and status semantics are **separate namespaces**:

- Data: `--ega-data-blue|orange|yellow|green|purple|slate` (+ `-soft` tints).
- Status: `--status-healthy|risk|overdue|pending|info` (+ `-bg`, `-border`).

An error is never styled with a chart colour; a chart series is never styled
with a status colour.

Focus: `--ega-focus-outline: 2px solid var(--ega-text)` plus
`--ega-focus-ring` box shadow. Focus styling must never depend on dynamic
accessible text.

## 2a. Theme preference

The authenticated top bar exposes a native disclosure with **Light**, **Dark**,
and **System** choices. `System` is the default when no valid preference is
stored and follows live OS changes. An explicit Light/Dark choice overrides the
OS and persists in `localStorage` (`ega-workspace-theme`). Unavailable or
invalid storage degrades to System/in-memory without blocking the switch.

A dependency-free inline script applies the resolved theme before first paint;
React hydrates against a deterministic `system` server snapshot. The workspace
root uses `color-scheme` so native controls and scrollbars match. Do not add
`next-themes`, per-route theme CSS, or `dark:` utility duplication for this
surface.

## 3. Typography

Instrument Sans (`--font-body`) carries the authenticated product. Sora
(`--font-display`) is retained for the public marketing surface only.

| Role | Size | Weight |
|---|---|---|
| Page title | 28px (`--text-page`) | 600 |
| Section title | 20px (`--text-section`) | 600 |
| Panel title | 16px (`--text-panel-title`) | 600 |
| Metric value | 24px (`--text-metric`) | 600, tabular |
| Body | 14px (`--text-body`) | 400–500 |
| Metadata | 12–13px (`--text-meta`, `--text-meta-lg`) | 400–500 |

Numbers use `tabular-nums`. Uppercase micro-labels use
`--tracking-widest` and are reserved for short labels (≤ 3 words).

## 4. Geometry

- Radius: controls 8px, panels 12px, shell surfaces 16px.
- Sidebar: 264px expanded (240px on 761–1080px), 72px collapsed icon rail.
- Top bar: 56px, transparent on the canvas, no rule.
- Content: `--content-max: 1600px`, gutters 24px (32px ≥ 1536px).
- Panel padding: 18px; panel header divider 1px `--ega-divider`.
- Table rows: 44–52px; dense list rows 40–48px.
- Control heights: 28 / 32 / 36px (`sm` / `md` / `lg`).
- Touch targets ≥ 32px with 8px separation on phone widths.

## 5. Primitives

`apps/web/src/components/ui`:

| Component | Use |
|---|---|
| `Card` (+ `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`) | Default white panel |
| `Metric`, `MetricDelta`, `CompactStat`, `DataLegend` | Metric grammar shared by Home, Today, Analytics, Review |
| `DashboardSection` | Section heading + content grid |
| `Button` | `primary` (ink), `secondary`, `ghost`, `danger` |
| `Badge`, `StatusBadge` | Status/count chips, dot-prefixed, never colour-only |
| `FilterPill` | Toolbar filter trigger |
| `Tabs` | Segmented view switch |
| `EmptyState`, `Skeleton`, `ProgressBar`, `StatCard` | State and support surfaces |
| `Sheet`, `Tooltip` | Overlays |
| `ThemeControl` | Accessible Light / Dark / System switch in the top bar |

Layout helpers in `apps/web/src/styles/workspace.css`:
`.app-shell`, `.app-sidebar`, `.app-topbar`, `.app-page`, `.app-page-header`,
`.app-content`, `.workspace-main-rail-grid`, `.workspace-secondary-rail`,
`.panel`, `.metric`, `.kpi-grid`, `.rows`, `.row`, `.data-table`,
`.workspace-drawer-panel`, and the `tasks-kanban-*` container-query board.

## 6. Chart grammar

Charts are inline SVG with an accessible text or table equivalent.

- Bars: `--ega-data-blue-soft`, active/highlighted `--ega-data-blue`. In dark
  mode the soft tint is a mid-tone, not an inverted pastel.
- Lines: `--ega-data-blue`, 2px, round joins.
- Grid: 1px `--ega-divider`; baseline `--ega-border`.
- Labels: 10px `--ega-text-tertiary`; values in the accompanying metric text.
- No gradient fills, no drop shadows, no 3D, no decorative animation.

## 7. States each screen must handle

Empty, loading (`loading.tsx` + skeletons), error/degraded, long content, zero
metrics, high counts, no-timer/active-timer, unread/no-unread, collapsed
navigation, mobile drawer, keyboard focus, reduced motion, and both Light and
Dark palettes (including System mode).

## 8. Responsiveness

Breakpoints: 420px, 760px (drawer replaces the sidebar), 1080px (compact
sidebar), 1240px (rails stack), 1536px (wider gutters).

Hard requirements: zero document horizontal overflow at 320/390/768/1280/1440+,
tables transform rather than overflow on phones, no hover-only interaction, and
no dynamic-text-driven styling.
