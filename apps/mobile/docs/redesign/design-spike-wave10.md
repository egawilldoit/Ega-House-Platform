# Design Spike Wave 10 — Archetypes

**Date:** 2026-08-26
**Branch:** `ui/mobile-redesign` `57aa429`

## Archetype A — Work / Tasks

**Stitch IDs:** `internal — tonal Work A vs B` (MCP not connected in this runner; direction derived from research-wave-10 + WAVE-10-PLAN)

**Composition A (chosen):**
- Header: `EXECUTION / Work — Tasks and projects` `Search` `Avatar` in one row (left title, right actions)
- Segment: `[ Tasks | Projects ]` `SegmentedControl` pill thumb 50h
- Search: single `SearchField` 44h `placeholder "Search tasks"` + inline `Filters • 2` trigger (44h, tonal, not card)
- Quick filters: `All Today Overdue Urgent Blocked` pills 44h horizontal, 6 items, selected `primaryContainer` tint
- Counter: one line `8 tasks · 1 urgent` 12 muted, `1 urgent` danger when >0 else hidden, `· 1 blocked` red when >0 else hidden
- List: first `TaskCard` at ~180px (header 90 + segment 50 + search+filters 44 + quick 48 + counter 16 = ~248 but collapsed filters reduces to ~180). `FlatList` `paddingTop 8` `paddingBottom contentBottom`.
- Card: `surface #fff`? actually tonal `surface` with `border hairline` `radius 16` no shadow, `Chip` + due pill, `IconButton 44` overflow, no giant Edit.

**Composition B (rejected):**
- Same but with `Search` + `Filters` + `Count` + `Hint` stacked 4 rows. Rejected: chrome budget 320px, first task below fold.

**Why A works:** Content before chrome, one hero per screen is **list** itself, not metrics. Fits 390×844 first viewport.

## Archetype B — Today

**Stitch ID:** `internal — Today hero`

**Chosen:**
- Hero: `TODAY` eyebrow 11/700 `Today` title 28/900 + `24m` `heroNumber 42 black -1` + `tracked today` `heroLabel 11 uppercase muted` left-aligned, `Planned 3 Doing 1 Blocked 0` meta row 12 muted below, then `1 of 4 completed` 12 + `ProgressBar` 6 track `surfaceMid` fill `primary`/`successMid`. No ring dominant.
- Data: `summary.trackedTodayLabel` hero, `summary.completed/total` secondary. No fake target.
- Sections: reuse Work task DNA, `TodaySectionHeader` 15/800 with count pill, `TodayTaskCard` same tonal, compact empty `No blocked tasks / You're clear.` 64 icon not card.
- Why: Tracked time is primary (24m), completion secondary, first task visible.

## Archetype C — Timer Running / Idle

**Stitch IDs:** `internal — Timer idle + running`

**Idle (chosen):**
- `Focus` header + `FocusQueue` rows `surfaceLow #f3f6fb radius 14` plain rows, no card per candidate, `Pick a task to time` 16/800, `taskRow 44` `surfaceLow` + `checkmark accent` selected, `Start session` primary 54.

**Running (chosen — most expressive but calm):**
- Background `primaryContainer #dbeafe` or `surfaceMid #edf2f8` full tonal, not `Card` white.
- `FOCUS` eyebrow 11, `Task title 18 bold`, `Project 12 upper muted`, `00:24:18` `52 black -1` `maxFontSizeMultiplier 1.6` centered, `RUNNING` dot 10 successMid + label 12 uppercase, `Stop session` `danger 54`.
- No card border/shadow, whitespace 28, fade+scale 180-240.

**Why:** Focus moment via tonal background + scale + space, not decoration. Clock is hero, server authority + tick isolation preserved.

## Quality Gate (before coding)

- **Content visibility:** Work first task ~180px PASS, Today hero + first section ~280px PASS, Timer clock is hero PASS
- **Vertical efficiency:** Work chrome from `380px` → `~248` → `~180` with collapsed filters PASS
- **Semantic color:** Urgent red dot only, blocked red, on_track green, etc. Not rainbow.
- **Brand:** Calm confidence + execution energy, tonal depth not card depth, graphite nav, primary FAB
- **One hero:** Today tracked time, Work list, Timer clock, Goals health+next step
- **Accessibility:** 44 targets, contrast checked, caps only nav/clock
- **Realistic data:** Use `trackedTodayLabel`/`completed/total` from query, no fake ring minimum
- **Navigation consistency:** 4 tabs, header avatar→profile, search→search, `router.setParams` for Work mode

**Chosen direction:** A for Work, hero tracked time for Today, tonal running for Timer. All other screens inherit this system.

