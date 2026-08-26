# Research Wave 10 — Expressive Product Language & Real-Device Hierarchy

**Date:** 2026-08-26
**Worktree:** `.worktrees/ui-mobile` `ui/mobile-redesign` `036f6b7→57aa429`
**Goal:** Answer the 13 research questions before any aesthetic refactoring; define what to adopt vs not copy.

---

## Q1 — How much UI appears before the first actionable task?

**PRODUCT / SOURCE:** Todoist — Today & Board; Things 3 — Today; Linear — Issues list  
**SCREEN / FLOW:** Work list idle  
**PATTERN OBSERVED:** Title + search field (44h) + one horizontal quick-filter strip (44h) + single-line counter `8 tasks` then **first card**. No metric grid, no segmented + search + count + hint stacking. On 390×844, first task top is ~160–190px from top inset.  
**WHY IT WORKS:** Content before chrome: user sees work in one eye movement; filters are secondary and occupy one row, not four.  
**WHAT EGA SHOULD ADOPT:** Remove 4-card metric grid (`TasksListView 310-349`), merge counter into one line (`8 tasks · 1 urgent`), keep quick filters in one scroll row, make advanced filters a single `Filters • 2` trigger (collapsed 44h). Target first task at ~180px.  
**WHAT WE SHOULD NOT COPY:** Todoist's floating `+` inside list (we already have FAB above nav, keep).

---

## Q2 — How do strong productivity apps avoid filter overload?

**PRODUCT:** Todoist Quick Filters + Linear Filters, Refero modal patterns  
**PATTERN:** Quick filters = 5–6 pills covering 80% of use (All/Today/Overdue/Urgent/Blocked). Advanced = sheet or expanded card with segmented controls, opened via `Filters • count`. Quick and advanced are **not duplicated** — urgent in quick equals `priority:urgent` in advanced, but advanced is hidden until tapped.  
**WHY:** Reduces decision fatigue; advanced stays `display:none` until needed.  
**ADOPT:** Keep `TASK_VIEW_PRESETS` 6 pills as quick (they already encode status/priority/due+sort). Make `TaskFilters` collapsed by default to one row (`filter icon + Filters • 2 + chevron`), expand with fade+translate 180ms, not always-mounted card. Deduplicate `Clear` (one place).  
**NOT COPY:** Linear's multi-select filter bar with counts on every pill (too noisy for mobile).

---

## Q3 — Which information remains visible on a task row? What is hidden in overflow/detail?

**PRODUCT:** Things 3, TickTick, Superlist  
**PATTERN:** Row shows `title` (2 lines), `project` (upper 11), `status` dot/chip, `priority` dot, `due` pill, `overflow` chevron. Estimate, full description, recurrence, blocked reason hidden in detail; status change is tap row → detail or long-press sheet, not inline `Edit` button.  
**WHY:** Row answers “What? Where? When? How urgent?” in <1s; secondary goes to sheet/detail.  
**ADOPT:** Keep `TaskCard` chips for status/priority + due pill + project/goal + overflow `IconButton 44`. **Remove giant `Edit` button** (`TaskCard 97-118` full-width `flex:1`). Card tap → detail, overflow → `ActionSheet` (status/priority/due/Open). Hide `estimate` unless relevant (or show as subtle `Xm` only when `>0`).  
**NOT COPY:** Superlist's checkbox that directly cycles `todo→done` without explicit `in_progress` — our `todo→in_progress/done` needs sheet to be explicit per API.

---

## Q4 — How are project progress and task counts shown without duplication?

**PRODUCT:** Notion — Projects, Asana — Portfolio  
**PATTERN:** One numeric label + bar. Either `6 / 7` **or** `86%`, not both. Bar is `surfaceLow` track, fill is `primary`. No second percent next to fraction.  
**WHY:** Two encodings of same ratio double cognitive load.  
**ADOPT:** `ProjectCard` already does `ProgressBar` + `completed/taskCount` fraction (good, keep). **Do not add percent.** `GoalCard` should do same: bar + fraction only. `GoalDetailScreen` currently shows bar + `Math.round(progress)%` + fraction + `Linked tasks (n)` → reduce to bar + fraction, header `Linked tasks (n)` is enough.  
**NOT COPY:** Asana's circular progress inside card header (too heavy for dense list).

---

## Q5 — How is “urgent” made obvious without screaming?

**PRODUCT:** Todoist `P1` red dot + `TickTick` red tag, Linear `Priority` icon tint  
**PATTERN:** Urgent = **small strong signal** on otherwise neutral row: red dot (6px) + `Urgent` chip `danger` `bg #fee2e2 fg #991B1B` (darker accessible) on neutral `surface` row. Zero-urgent rows are muted (no chip). No red card, no red border.  
**WHY:** Color guides attention; large red area screams and creates rainbow soup.  
**ADOPT:** Keep `Chip kind=priority value=urgent` with `danger` but use darker `danger #991B1B` on `dangerBg #fee2e2` (contrast 7.1) for 11px text (currently 3.95 fail). Show `1 urgent` in compact counter only when `>0`, otherwise hide. Use `muted` for 0 counts.  
**NOT COPY:** Neon `highMid #f97316` background for high — keep high as orange dot, not full chip fill.

---

## Q6 — How are zero states deemphasized?

**PRODUCT:** Things 3 empty Today, Linear empty filter  
**PATTERN:** Compact center: icon 36 muted + `No blocked tasks` 15 semibold + `You're clear.` 13 muted, no card, no border, max 80px height. No `Create your first task` giant CTA when filter is `Blocked` (only when `All` empty).  
**WHY:** Zero is calm, not an error; deemphasized avoids card soup.  
**ADOPT:** Replace `TodaySectionEmpty` card-in-card (`Card` wrapping `EmptyState`) with plain `View` 64×64 icon + two lines. Same for `ProjectsListView` empty: no `Card` wrapping when `hasSearch` or filtered view.  
**NOT COPY:** Illustration-heavy empty states (Lottie) — keep 36 icon.

---

## Q7 — How do apps show account/profile without wasting a permanent tab?

**PRODUCT:** Linear — avatar top-right, Todoist — bottom `Browse` → profile, Superlist — command palette  
**PATTERN:** Avatar 32–36 in header right slot opens `Profile` stack screen; no tab. Tab bar stays 4 (Today/Work/Goals/Timer). Profile is low frequency (<1/day).  
**WHY:** Frees tab for primary jobs; header avatar is personal and reachable.  
**ADOPT:** Keep `HeaderActions` avatar → `/(app)/profile` stack, remove duplicate tab (`profile` `href:null` already, but still in `state.routes` length 7). **Fix:** remove `profile` from `tabs/_layout.tsx` entirely; keep only 4 routes so `state.routes.length===4` and `visibleRoutes===state.routes`.  
**NOT COPY:** Bottom sheet profile (Linear) — stack is correct for settings/sign-out.

---

## Q8 — How do timer apps create a strong focus moment?

**PRODUCT:** Forest, Structured, Sunsama Focus, Apple Clock  
**PATTERN:** Running = **tonal background** (`primaryContainer #dbeafe` or `secondaryContainer #ede9fe`) full screen, huge clock `52–64` centered, task title 16–18 above clock, `RUNNING` dot + `Stop` pill 54h below clock, no cards, whitespace 28–32. Idle = queue list, not clock.  
**WHY:** Expressive but calm: color + scale + space, not decoration. Clock is hero, everything else secondary.  
**ADOPT:** `TimerScreenContent` running: replace `Card activeCard` (`surface #fff border #e4e7ec`) with `tonal` `surfaceMid #edf2f8` or `primaryContainer` background, remove border/shadow, keep `TimerClock 52 black -1` as hero, `taskTitle 17 bold centered`, `runningDot 10 successMid`, `Stop timer danger 54h`. Idle `FocusQueue` should be plain rows (no `Card` around each candidate), `surfaceLow` group.  
**NOT COPY:** Forest's gamified tree — keep EGA calm confidence.

---

## Q9 — How do successful apps make bottom navigation expressive without heavy?

**PRODUCT:** Linear — pill nav, Superlist — floating dock, Things — tab bar  
**PATTERN:** Floating dark graphite `rgba(20,20,20,0.85)` pill `height 72 radius 999 shadow y10 r18 0.22` with inner highlight `top1 rgba(255,255,255,0.10)`, 4 equal regions `flex1 gap 3 minHeight44`, active = **blue icon + brighter label + subtle capsule** `background rgba(37,99,235,0.18)` or `rgba(255,255,255,0.10)` behind active item, inactive `rgba(255,255,255,0.60)`. No width change, `opacity/scale/backgroundColor` 160–220ms `withTiming`.  
**WHY:** Expressive via tonal capsule + color, not icon bounce or width shift.  
**ADOPT:** Keep floating dark pill, height 72, margin 24, bottomGap 20, but make active capsule `primaryContainer` tint 18% + blue icon `#2563eb` + label `activeText #fff 800` vs inactive `60%`. Animate `opacity/scale/backgroundColor` 180ms `ReduceMotion.System`. Keep `TAB_LABEL_MAX_FONT_SCALE 1.4`.  
**NOT COPY:** Glassmorphism blur showcase (we already `useRealBlurOnAndroid false`, keep fake).

---

## Q10 — How are long mobile forms grouped without card-inside-card?

**PRODUCT:** Linear Create Issue, Notion New Task  
**PATTERN:** Section heading `12 uppercase 700 muted 1.2` + `16 800 title` + `description 12 subtle` then **fields with spacing 16**, no card, occasional `surfaceLow #f3f6fb radius 14` tonal group for 2–3 related fields, sticky bar `surface #fff borderTop 1 shadow sheet` above keyboard/nav.  
**WHY:** Card-inside-card (`Card` inside `FormSection` `Card`) wastes vertical space and creates shadow soup.  
**ADOPT:** `FormSection` should be `View` with heading + `gap 12`, not `Card`. Use `surfaceLow` tonal group only where useful (Context: project/goal rows). Keep sticky `120` geometry via `useBottomChromeMetrics`.  
**NOT COPY:** Inset grouped iOS style (too heavy).

---

## Q11 — How are loading/refetch states handled without wiping the page?

**PRODUCT:** Linear, Todoist  
**PATTERN:** `placeholderData: prev=>prev` keeps stale list visible, `isFetching` shows `Refreshing… 11 subtle` or `ActivityIndicator` 14 in header, not full-screen spinner. `isPending && !data` → skeleton 3×, `isError && !data` → `FeedbackBanner danger` + `Retry`, `isError && data` → banner + stale list.  
**WHY:** Perceived performance: old usable data stays, no blank flash.  
**ADOPT:** Keep `placeholderData` for lists, but audit where it hides filter switch (e.g., `active→archived` should show stale + `Refreshing…` + keep previous until network, not skeleton). Use `isRefetching` subtle, not spinner. `search.tsx` already `isLoading = isPending` from 3 queries — keep, but add `isFetching` hint.  
**NOT COPY:** Skeleton for every refetch — only for initial.

---

## Q12 — (Bonus from audit) How to avoid arbitrary list tuning?

**PRODUCT:** React Native defaults vs tuned  
**OBSERVED:** Current `initialNumToRender 10 windowSize 5 maxToRenderPerBatch 10 removeClippedSubviews false` is aggressive (default `windowSize 21`). `removeClippedSubviews false` disables Android recycling → O(N) mounts.  
**ADOPT:** For Work/Today/Goals/Projects (medium 50–200 rows, task row height ~110 wraps) use **default** `windowSize` (21) or document why `10` is better via fast fling test. Remove `removeClippedSubviews false` unless transform bug proven. Keep `initialNumToRender 10` reasonable. Test `tap during list rendering` and `fast fling down/up` before committing custom values.  
**NOT COPY:** FlashList (lockfile) — keep FlatList.

---

## Synthesis for EGA House

**What to adopt across all screens:**
- One hero per screen (tracked time, first task, clock, health+next step)
- 4-tab-only nav state (remove hidden routes from `state.routes`)
- Bottom chrome metrics: `NAV_HEIGHT 72, HORIZONTAL_MARGIN 24, BOTTOM_GAP 20, FAB_GAP 16, CONTENT_GAP 16` → `navBottom = max(insets.bottom,12)+20`, `fabBottom = navBottom+72+16`, `contentBottom = fabBottom+16`
- Tonal surfaces `surface #fff, surfaceLow #f3f6fb, surfaceMid #edf2f8, surfaceHigh #e6ecf5` + semantic containers
- Shape: small 8 control 12 card 16 hero 20 sheet 28 pill 999 only for chips/FAB/nav capsule
- Motion: press 110-140 scale 0.985, selection 160-190, transition 190-240, sheet 240-300, `ReduceMotion.System`

**What to reject:**
- Metric 4-card grid, giant Edit, duplicated progress, pill-everything, card-in-card, width/height anim, blur showcase, zero-state cards, filter overload, hook try/catch.

