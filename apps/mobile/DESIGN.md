# EGA House Mobile — Design System

> Wave 10.2 canonical spec. Single token authority: `apps/mobile/components/mobile/theme.ts` (`mobileTheme`). Stitch tokens map INTO it. `glassConfig.useRealBlurOnAndroid=false` preserved.

---

## BRAND

### Palette — Core (expressive tonal)
| Role | Token | Value | Usage |
|---|---|---|---|
| Brand | `primary` / `accent` | `#2563eb` | CTAs, links, active nav dot, accent strip start |
| On primary | `onPrimary` | `#ffffff` | Text on primary |
| Brand container | `primaryContainer` / `accentSoft` | `#DBEAFE` | Active chip bg, selected states, hero tonal |
| On container | `onPrimaryContainer` / `accentDark` | `#1d4ed8` | Text on container (5.49 on DBEAFE) |
| Brand mid | `accentMid` | `#93c5fd` | Borders on selected, focus ring |
| Accent bar end | `accentBarEnd` | `#60a5fa` | Right half of top accent strip |
| Secondary (indigo) | `secondary` | `#5b21b6` | Secondary actions, filters |
| Secondary container | `secondaryContainer` | `#EDE9FE` | Secondary bg |
| On secondary container | `onSecondaryContainer` | `#5b21b6` | Text on secondaryContainer (7.57 PASS) |
| Tertiary (amber) | `tertiary` / `warning` | `#b45309` | Tertiary accent |
| Tertiary container | `tertiaryContainer` / `warningContainer` | `#FEF3C7` | Tertiary bg |
| On tertiary container | `onTertiaryContainer` / `onWarningContainer` | `#92400e` | Text on tertiaryContainer (6.37 PASS) |

### Neutrals (surfaces & text) — tonal ladder
| Token | Value | Usage |
|---|---|---|
| `canvas` / `background` | `#F7F8FC` | Page canvas — large neutral, not card |
| `backgroundDeep` | `#E6ECF5` | Segment track = surfaceHigh |
| `surface` / `surfaceElevated` | `#ffffff` | Cards, sheets |
| `surfaceLow` / `surfaceMuted` | `#F3F6FB` | Tonal group (idle rows), low hierarchy |
| `surfaceMid` | `#EDF2F8` | Tonal mid (timer running, subtle cards) |
| `surfaceHigh` | `#E6ECF5` | Tonal high, borders page vs content |
| `border` | `#e4e7ec` | Subtle border |
| `borderStrong` | `#cfd5df` | Strong border |
| `skeleton` | `#e8edf4` | |
| `text` | `#0d1117` | Primary (17.8 on canvas) |
| `textSecondary` | `#374151` | Secondary |
| `textMuted` | `#6b7280` | Muted — AA only on surface/canvas (4.8/4.5), FAIL on tonal |
| `textSubtle` | `#666b71` | Placeholder & muted on tonal — PASS on all surfaces (>=4.53) |
| `placeholder` | `#666b71` | Alias textSubtle |
| `textOnAccent` | `#ffffff` | |

> **Color occupancy:** keep large parts neutral (canvas/surface/surfaceLow). Use accent containers only for active / key actions / hero. Do NOT color every card.

### Semantic
| Token | Value | Container | On Container | Mid |
|---|---|---|---|---|
| `success` | `#166534` (was `#15803d`) | `successBg`/`successContainer` `#dcfce7` | `onSuccessContainer` `#166534` (6.49) | `successMid #86efac` |
| `warning` / `tertiary` | `#b45309` | `warningBg`/`warningContainer` `#fef3c7` | `onWarningContainer` `#92400e` (6.37) | `warningMid #fcd34d` |
| `danger` | `#991b1b` (was `#dc2626` 3.95 FAIL) | `dangerBg`/`dangerContainer` `#fee2e2` | `onDangerContainer` `#991b1b` (6.80) | `dangerMid #fca5a5` |
| `dangerBorder` | `#991b1b` | — | — | — |
| `info` | `#1d4ed8` | `infoBg`/`infoContainer` `#dbeafe` | `onInfoContainer` `#1d4ed8` (5.49) | `infoMid #93c5fd` |
| `blocked` → `danger` | `#991b1b` | `blockedBg`/`blockedContainer` `#fee2e2` | `onBlockedContainer` `#991b1b` | — |
| `slate` / `neutral` | `#475569` | `slateBg`/`neutralBg`/`neutralContainer` `#f1f5f9` | `onNeutralContainer` `#475569` (6.92) | `neutralMid #94a3b8` |
| `high` (orange) | `#c2410c` | `highBg` `#ffedd5` | `onHighContainer` `#c2410c` (4.52) | `highMid #f97316` |
| `low` (green) | `#166534` | `lowBg` `#f0fdf4` | `onLowContainer` `#166534` (6.81) | `lowMid #4ade80` |
| `secondary` | `#5b21b6` | `secondaryContainer` `#ede9fe` | `onSecondaryContainer` `#5b21b6` (7.57) | — |

Contrast all measured via luminance `(L+0.05)/(max)` — see `theme.ts` header and `luminance()`/`contrastRatio()` dev utility. Chip/danger/warning/success/placeholder all >=4.5 for 11px bold.

### Auth (dark, preserved)
`authBackground #0d1117`, `authSurface #161c28`, `authSurfaceMuted rgba(255,255,255,0.07)`, `authBorder rgba(255,255,255,0.12)`, `authBorderSoft rgba(255,255,255,0.08)`, `authTextMuted rgba(255,255,255,0.55)`, `authTextSubtle rgba(255,255,255,0.35)`, `authCircleBlue rgba(37,99,235,0.18)`, `authCirclePurple rgba(124,58,237,0.12)`.

### Nav chrome
`shellBackground rgba(20,20,20,0.85)`, `shellBorder rgba(255,255,255,0.10)`, `active #2563eb`, `activeText #fff`, `inactiveText rgba(255,255,255,0.60)`, `dot #2563eb`.

---

## TYPOGRAPHY

System fonts (no custom download in Wave 0). Weight tokens: `regular 400` · `medium 500` · `semibold 600` · `bold 700` · `extrabold 800` · `black 900`.

| Level | Size | Weight | LineHeight | Tracking | Sample |
|---|---|---|---|---|---|
| Display / Title | 28 | 900 | 34 | -0.8 | Screen titles (Today, Work) |
| Section title | 17–15 | 800 | 22–20 | 0 / -0.2 | Daily momentum, card titles |
| Body | 14 | 500–600 | 20 | 0 | Descriptions, meta |
| Body small | 13 | 600 | 18 | 0 | Card copy |
| Caption | 12–11 | 700–800 | 16 | 0.2–0.4 | Pill labels, stat labels, eyebrow |
| Eyebrow | 11 | 700 | 14 | 1.2 upper | EYEBROW |
| Chip | 11 | 700 | 14 | 0.2 capital | Chip labels |
| Clock (timer) | 52 | 900 | 52 | -1 | Timer readout (fixed format) |

Tab labels: 10/700, active 10/800. Timer clock caps `maxFontSizeMultiplier 1.6` to keep HH:MM:SS on one line; tab labels cap `1.4`; all other text scales uncapped.

---

## SPACING

Scale (4-pt base, Wave 10.2 compact 4/8/12/16/20/24/32):
`xs 4` · `sm 8` · `md 12` (was 14) · `lg 20` · `xl 24` (was 28) · `xxl 32` (was 36)

Layout tokens:
`floatingTabClearance 160` — fallback token; runtime authoritative geometry in `navigation/bottomChrome.ts` (`navBottom = max(bottomInset,12)+20`, `fabBottom = navBottom+72+16`, `contentBottomPadding = fabBottom+16`).
`stickyActionClearance 120` — bottom padding for sticky save bars.
`minTouchTarget 44` — minimum hit-target height/width for every interactive element.

Common compositions:
- Screen `content` horizontal padding `lg (20)`; legacy `pagePadding 16` migrates to `lg`.
- Card internal `md (12)` or `lg (20)` depending on density; `Skeleton` uses `lg`.
- Row gaps `sm (8)`; grouped lists `md (12)` top, `sm (8)` between cards.
- All `paddingHorizontal 12 vs 14` literals now use `spacing.md (12)` token.

---

## RADII

`xs 6` · `sm 10` · `md 14` · `lg 18` · `xl 22`
Semantic: `card 20` (future 16 per H-5, keep 20 until 10.3 primitives) · `control 12` · `pill 999` · `sheet 28` · `navigation pill 999` (same as chip)

Pill/chip 999, segmented track 999, tab item 999, FAB 999, sheet top 28, card 20.

---

## ELEVATION

| Level | Props |
|---|---|
| `card` | `shadowColor #101828` `y1` `radius 7` `opacity 0.04` `elevation 1` |
| `cardHover` | `#1a2540` `y3` `10` `0.08` `3` |
| `control` | `#101828` `y1` `2` `0.05` `1` |
| `fab` | `#2563eb` `y4` `10` `0.22` `5` |
| `sheet` | `#0d1117` `y-4` `24` `0.12` `12` |
| `glass.shadow` | `#000` `y1` `7` `0.045` `1` |
| `nav container` | `#000` `y10` `18` `0.22` `10` |

Glass specifics: `blurIntensity soft 24 / medium 35 / strong 45`, `surface #fff`, `border rgba(208,213,221,0.9)`, `highlight rgba(255,255,255,0.65)`, `fakeBackground #fff`.

> **Shadow occupancy:** shadow only for nav/FAB/sheet; cards use tonal surface or subtle card shadow. Avoid card soup.

---

## SEMANTIC TONES

> Central resolver: `chipTone(kind,value)` / `statusTone(priority|health)` in `theme.ts`. No per-component tone helpers.

### Status — tasks / projects / goals / Today sections
| Value | Bg | Color | Dot | Meaning |
|---|---|---|---|---|
| `todo` / `planned` / `draft` | `#f1f5f9` | `#475569` | `#94a3b8` | Neutral, queued (6.92) |
| `in_progress` | `#fef3c7` | `#92400e` (was `#b45309` 4.51 borderline) | `#f59e0b` | Amber — active work (6.37) |
| `active` | `#dbeafe` | `#1d4ed8` | `#3b82f6` | Blue — live/outcome active (5.49) |
| `paused` | `#fef9c3` | `#92400e` | `#eab308` | Yellow — on hold (6.60) |
| `done` | `#dcfce7` | `#166534` (was `#15803d` 4.57) | `#22c55e` | Green — completed (6.49) |
| `blocked` | `#fee2e2` | `#991b1b` (was `#dc2626` 3.95 FAIL) | `#ef4444` | **Red (danger)** — 6.80 |
| `archived` | `#f1f5f9` | `#475569` (was `#64748b` 4.34 FAIL) | `#94a3b8` | Muted slate (6.92) |

Zero-count muted vs non-zero clear: caller dims danger/warning chips when count==0 (e.g., 60% opacity or slate fallback); spec leaves choice to component but mandates visible contrast between 0 and >0.

### Priority
| Value | Bg | Color | Dot |
|---|---|---|---|
| `low` | `#f0fdf4` | `#166534` | `#4ade80` |
| `medium` | `#fef9c3` | `#92400e` | `#eab308` |
| `high` | `#ffedd5` | `#c2410c` | `#f97316` |
| `urgent` | `#fee2e2` | `#991b1b` (was `#dc2626` FAIL) | `#ef4444` |

### Goal health
| Value | Bg | Color | Dot |
|---|---|---|---|
| `on_track` | `#dcfce7` | `#166534` (was `#15803d`) | `#22c55e` |
| `at_risk` | `#fef9c3` | `#92400e` | `#eab308` |
| `off_track` | `#fee2e2` | `#991b1b` (was `#dc2626`) | `#ef4444` |
| `null` / unset | `#f1f5f9` | `#475569` (was `#64748b` FAIL) | `#94a3b8` (slate) |

### Chip — single primitive
`Chip` props: `kind: 'status'|'priority'|'health'`, `value: string|null`, `toneSource` resolved centrally via `chipTone`. No `StatusChip` / `PriorityChip` siblings. Caller passes semantic value; primitive renders `background/color/dot` triple and optional `dot`.

---

## MOTION

- **Press:** `scale 1 → 0.97 → 1`, spring `tension 120 / friction 7` or timing 100–140ms, `useNativeDriver:true`. Uses `AnimatedPressable` / `reanimated` where available. Disabled when `prefers-reduced-motion`.
- **Selection (segment/thumb):** background/opacity/scale only; no continuous `width/height/margin` animation.
- **Route:** stack `opacity + translateY(4–8)` 200ms ease-out; tabs no route animation (instant, preserve scroll).
- **Sheet:** `translateY` + `opacity`, 260ms spring; backdrop `opacity` 180ms.
- **Progress:** width animates via `transform: scaleX` or timed style update debounced to 16ms; track uses `backgroundDeep` (`surfaceHigh #E6ECF5`), fill `accentMid→successMid` gradient (Today) or tone color.
- **Reduced motion:** `useReducedMotion()` (AccessibilityInfo `reduceMotionChanged`) — skips scale/translate, leaves `opacity` (100ms) and instant selection. `FadeSlide` respects it.

Forbidden: animating `width/height/margin/padding` continuously during interaction.

---

## ACCESSIBILITY

- **Touch:** every interactive target `≥44×44` (`mobileTheme.layout.minTouchTarget`). Hit slop on pills keeps visual small but tappable. Tab items `flex:1 + minHeight 44`.
- **Font scaling:** tab bar labels `maxFontSizeMultiplier 1.4` to keep single-line nav intact; all other surfaces scale **without cap** (legal for Dynamic Type).
- **Contrast:** text `textSubtle #666b71` / `text #0d1117` / `textSecondary #374151` AA-checked ≥4.5:1 on all tonal surfaces (`canvas #F7F8FC`, `surface #fff`, `surfaceLow #F3F6FB`, `surfaceMid #EDF2F8`, `surfaceHigh #E6ECF5`, `neutralContainer #F1F5F9`). `textMuted #6b7280` only on `surface/canvas` (4.8/4.5), otherwise use `textSubtle`. Chip foregrounds: `danger #991b1b` 6.80, `success #166534` 6.49, `warning #92400e` 6.37, `neutral #475569` 6.92, `high #c2410c` 4.52, `info #1d4ed8` 5.49, `secondary #5b21b6` 7.57 all on containers >=4.5. Placeholder uses `textSubtle`. Auth dark uses `rgba(255,255,255,0.55/0.35)` strictly for decorative layers, not primary text.
- **Non-color state:** blocked/done/etc convey via **text label + dot/accent + icon**, never color alone. Focus/selected also adds border/surface change.
- **Screen reader:** `accessibilityRole button`, `accessibilityState selected/disabled/busy`, `accessibilityLabel` on icon-only controls; timer clock announces value via `accessibilityLabel`.
- **Reduced motion:** see MOTION; preference observed via `AccessibilityInfo`.

---

## NAVIGATION

- **4 fixed destinations:** `Today` · `Work` · `Goals` · `Timer` (in that order). Labels `title` prop on `Tabs.Screen`.
- **Work hub:** `work.tsx` with internal segment `Tasks | Projects` (state `mode` via `params.mode` + `router.setParams`), context-aware FAB (Tasks→New Task / Projects→New Project).
- **Compat hidden routes:** stack redirects `/(app)/tasks → work?mode=tasks`, `/(app)/projects → work?mode=projects`; canonical profile only at `/(app)/profile`. Preserve deep links.
- **Header actions:** `HeaderActions` (Search IconButton → `/(app)/search`, Avatar pressable → `/(app)/profile` stack canonical). Avatar initials derived from `useAuth().user.email` (first 2 chars uppercase, fallback `EG`).
- **Safe area:** `SafeAreaView edges=['top']` in `AppScreen`/`MobileScreen`; tab pill positioned `bottom: max(insets.bottom,12)+20` with pill width clipped 280–560 via `useBottomChromeMetrics()`.
- **Content clearance:** every tab's `ScrollView/FlatList/SectionList` `contentContainerStyle.paddingBottom` runtime via `useBottomChromeMetrics()` (`contentBottomPadding`  = FAB screens, `contentBottomPaddingNoFab` = others). `floatingTabClearance 160` kept as fallback.
- **Geometry:** `navigation/bottomChrome.ts` canonical `NAV_HEIGHT 72, HORIZONTAL_MARGIN 24, BOTTOM_GAP 20, FAB_GAP 16, CONTENT_GAP 16`.
- **Typed routes:** `experiments.typedRoutes=true` preserved. Any moved profile route registered in `(app)/_layout` Stack; `tsc --noEmit` must pass.

---

## FORMS

Wave 0 ships header/search affordances only; full `FormField/FormSection` deferred per YAGNI (Waves 6–7).

- **Label:** 12/700 muted, `color textMuted`, 4px above input.
- **Helper:** 12 muted, `textSubtle`, 6px below input.
- **Error:** 12 semibold, `danger #991b1b`, reserved 20px minHeight to avoid layout shift; `feedbackBanner` for form-level errors.
- **Focus:** `border accentMid (#93c5fd)` + outer ring `accentSoft 2` (via shadow); `background #fff`.
- **Disabled:** `opacity 0.48`, `background surfaceMuted` (`surfaceLow #F3F6FB`), `border #e4e7ec`.
- **Loading:** `ActivityIndicator accent` inside button/input affix; button `disabled + busy` state.

Search (Wave 0): `SearchField` (input + left magnifier + right clear 44px), `debounce 250ms`, `autoFocus` on `/search`, `clearButtonMode while-editing` fallback.

---

## Stitch → mobileTheme mapping (authoritative)

| Stitch token | mobileTheme key | Value |
|---|---|---|
| `primary` | `accent` / `primary` | `#2563eb` |
| `onPrimary` | `onPrimary` | `#ffffff` |
| `primaryContainer` | `primaryContainer` / `accentSoft` | `#dbeafe` |
| `onPrimaryContainer` | `onPrimaryContainer` / `accentDark` | `#1d4ed8` |
| `secondary` | `secondary` | `#5b21b6` |
| `secondaryContainer` | `secondaryContainer` | `#ede9fe` |
| `tertiary` | `tertiary` / `warning` | `#b45309` |
| `tertiaryContainer` | `tertiaryContainer` / `warningContainer` | `#fef3c7` |
| `surface` | `surface` | `#fff` |
| `surfaceLow` | `surfaceLow` / `surfaceMuted` | `#f3f6fb` |
| `surfaceMid` | `surfaceMid` | `#edf2f8` |
| `surfaceHigh` / `backgroundDeep` | `surfaceHigh` / `backgroundDeep` | `#e6ecf5` |
| `canvas` | `canvas` / `background` | `#f7f8fc` |
| `border` | `border` | `#e4e7ec` |
| `text-primary` | `text` | `#0d1117` |
| `success` | `success` | `#166534` |
| `successContainer` | `successContainer` | `#dcfce7` |
| `danger` | `danger` | `#991b1b` |
| `dangerContainer` | `dangerContainer` | `#fee2e2` |
| `neutral` | `neutral` | `#475569` |
| `neutralContainer` | `neutralContainer` | `#f1f5f9` |
| `radius-card` | `radius.card` | `20` |
| `shadow-card` | `shadow.card` | above |

New tokens introduced in Wave 10.2 all live under `mobileTheme.colors` / `mobileTheme.spacing` etc — no second export. `luminance()`/`contrastRatio()` dev utility in `theme.ts` for manual verification.

---

## References
- `apps/mobile/components/mobile/theme.ts` — authority (tonal + contrast notes)
- `apps/mobile/components/mobile/ui/` — primitives (10.3 variants plain/tonal/elevated)
- `apps/mobile/components/mobile/motion/` — press/fade/reduced-motion
- `apps/mobile/components/mobile/navigation/bottomChrome.ts` — geometry
- `apps/mobile/docs/redesign/research-wave-0.md` — source evaluations
- `apps/mobile/docs/redesign/research-wave-10.md` — tonal/spacing/occupancy
- `apps/mobile/docs/redesign/NAVIGATION.md` — route structure
