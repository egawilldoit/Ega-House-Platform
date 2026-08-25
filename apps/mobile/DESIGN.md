# EGA House Mobile — Design System

> Wave 0 canonical spec. Single token authority: `apps/mobile/components/mobile/theme.ts` (`mobileTheme`). Stitch tokens map INTO it. `glassConfig.useRealBlurOnAndroid=false` preserved.

---

## BRAND

### Palette — Core
| Role | Token | Value | Usage |
|---|---|---|---|
| Brand | `primary` / `accent` | `#2563eb` | CTAs, links, active nav dot, accent strip start |
| Brand dark | `accentDark` | `#1d4ed8` | Gradient end, pressed states |
| Brand soft | `accentSoft` | `#dbeafe` | Active chip/ pill bg, selected states |
| Brand mid | `accentMid` | `#93c5fd` | Borders on selected, focus ring |
| Accent bar end | `accentBarEnd` | `#60a5fa` | Right half of top accent strip |

### Neutrals (surfaces & text)
| Token | Value |
|---|---|
| `background` | `#f6f7f9` |
| `backgroundDeep` | `#e9edf3` (segment track, skeleton) |
| `surface` / `surfaceElevated` | `#ffffff` |
| `surfaceMuted` | `#f2f4f7` |
| `border` | `#e4e7ec` |
| `borderStrong` | `#cfd5df` |
| `skeleton` | `#e8edf4` |
| `text` | `#0d1117` |
| `textSecondary` | `#374151` |
| `textMuted` | `#6b7280` |
| `textSubtle` | `#666b71` (passes AA on surfaces) |
| `textOnAccent` | `#ffffff` |

### Semantic
| Token | Value | Bg | Mid |
|---|---|---|---|
| `success` | `#15803d` | `successBg #dcfce7` | `successMid #86efac` |
| `warning` (amber) | `#b45309` | `warningBg #fef3c7` | `warningMid #fcd34d` |
| `danger` (red) | `#dc2626` | `dangerBg #fee2e2` | `dangerMid #fca5a5` |
| `info` (blue) | `#1d4ed8` | `infoBg #dbeafe` | `infoMid #93c5fd` |
| `blocked` → `danger` | `#dc2626` | `dangerBg #fee2e2` | — |
| `slate` | `#475569` | `slateBg #f1f5f9` | — |
| `neutral` | `#475569` | `neutralBg #f1f5f9` | `neutralMid #94a3b8` |
| `high` (orange) | `#c2410c` | `highBg #ffedd5` | `highMid #f97316` |
| `low` (green) | `#166534` | `lowBg #f0fdf4` | `lowMid #4ade80` |

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

Scale (4-pt base):
`xs 4` · `sm 8` · `md 14` · `lg 20` · `xl 28` · `xxl 36`

Layout tokens:
`floatingTabClearance 160` — bottom padding for every tab ScrollView/FlatList/SectionList so last row clears floating pill.
`stickyActionClearance 120` — bottom padding for sticky save bars.
`minTouchTarget 44` — minimum hit-target height/width for every interactive element.

Common compositions:
- Screen `content` horizontal padding `lg (20)`; legacy `pagePadding 16` migrates to `lg`.
- Card internal `md (14)` or `lg (20)` depending on density; `Skeleton` uses `lg`.
- Row gaps `sm (8)`; grouped lists `md (14)` top, `sm (8)` between cards.

---

## RADII

`xs 6` · `sm 10` · `md 14` · `lg 18` · `xl 22`
Semantic: `card 20` · `control 12` · `pill 999` · `sheet 28` · `navigation pill 999` (same as chip)

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

---

## SEMANTIC TONES

> Central resolver: `chipTone(kind,value)` / `statusTone(priority|health)` in `theme.ts`. No per-component tone helpers.

### Status — tasks / projects / goals / Today sections
| Value | Bg | Color | Dot | Meaning |
|---|---|---|---|---|
| `todo` / `planned` / `draft` | `#f1f5f9` | `#475569` | `#94a3b8` | Neutral, queued |
| `in_progress` | `#fef3c7` | `#b45309` | `#f59e0b` | Amber — active work |
| `active` | `#dbeafe` | `#1d4ed8` | `#3b82f6` | Blue — live/outcome active |
| `paused` | `#fef9c3` | `#92400e` | `#eab308` | Yellow — on hold |
| `done` | `#dcfce7` | `#15803d` | `#22c55e` | Green — completed |
| `blocked` | `#fee2e2` | `#dc2626` | `#ef4444` | **Red (danger)** — was purple #7c3aed |
| `archived` | `#f1f5f9` | `#64748b` | `#94a3b8` | Muted slate |

Zero-count muted vs non-zero clear: caller dims danger/warning chips when count==0 (e.g., 60% opacity or slate fallback); spec leaves choice to component but mandates visible contrast between 0 and >0.

### Priority
| Value | Bg | Color | Dot |
|---|---|---|---|
| `low` | `#f0fdf4` | `#166534` | `#4ade80` |
| `medium` | `#fef9c3` | `#92400e` | `#eab308` |
| `high` | `#ffedd5` | `#c2410c` | `#f97316` |
| `urgent` | `#fee2e2` | `#dc2626` | `#ef4444` |

### Goal health
| Value | Bg | Color | Dot |
|---|---|---|---|
| `on_track` | `#dcfce7` | `#15803d` | `#22c55e` |
| `at_risk` | `#fef9c3` | `#92400e` | `#eab308` |
| `off_track` | `#fee2e2` | `#dc2626` | `#ef4444` |
| `null` / unset | `#f1f5f9` | `#64748b` | `#94a3b8` (slate) |

### Chip — single primitive
`Chip` props: `kind: 'status'|'priority'|'health'`, `value: string|null`, `toneSource` resolved centrally via `chipTone`. No `StatusChip` / `PriorityChip` siblings. Caller passes semantic value; primitive renders `background/color/dot` triple and optional `dot`.

---

## MOTION

- **Press:** `scale 1 → 0.97 → 1`, spring `tension 120 / friction 7` or timing 100–140ms, `useNativeDriver:true`. Uses `AnimatedPressable` / `reanimated` where available. Disabled when `prefers-reduced-motion`.
- **Selection (segment/thumb):** background/opacity/scale only; no continuous `width/height/margin` animation.
- **Route:** stack `opacity + translateY(4–8)` 200ms ease-out; tabs no route animation (instant, preserve scroll).
- **Sheet:** `translateY` + `opacity`, 260ms spring; backdrop `opacity` 180ms.
- **Progress:** width animates via `transform: scaleX` or timed style update debounced to 16ms; track uses `backgroundDeep`, fill `accentMid→successMid` gradient (Today) or tone color.
- **Reduced motion:** `useReducedMotion()` (AccessibilityInfo `reduceMotionChanged`) — skips scale/translate, leaves `opacity` (100ms) and instant selection. `FadeSlide` respects it.

Forbidden: animating `width/height/margin/padding` continuously during interaction.

---

## ACCESSIBILITY

- **Touch:** every interactive target `≥44×44` (`mobileTheme.layout.minTouchTarget`). Hit slop on pills keeps visual small but tappable. Tab items `flex:1 + minHeight 44`.
- **Font scaling:** tab bar labels `maxFontSizeMultiplier 1.4` to keep single-line nav intact; all other surfaces scale **without cap** (legal for Dynamic Type).
- **Contrast:** text tokens AA-checked ≥4.5:1 on `surface/surfaceMuted/background/backgroundDeep`. Auth dark uses `rgba(255,255,255,0.55/0.35)` strictly for decorative layers, not primary text.
- **Non-color state:** blocked/done/etc convey via **text label + dot/accent + icon**, never color alone. Focus/selected also adds border/surface change.
- **Screen reader:** `accessibilityRole button`, `accessibilityState selected/disabled/busy`, `accessibilityLabel` on icon-only controls; timer clock announces value via `accessibilityLabel`.
- **Reduced motion:** see MOTION; preference observed via `AccessibilityInfo`.

---

## NAVIGATION

- **4 fixed destinations:** `Today` · `Work` · `Goals` · `Timer` (in that order). Labels `title` prop on `Tabs.Screen`.
- **Work hub:** `work.tsx` with internal segment `Tasks | Projects` (state `mode`), context-aware FAB (Tasks→New Task / Projects→New Project).
- **Compat hidden routes:** `tasks.tsx` `projects.tsx` `profile.tsx` remain with `href:null`; bottom bars filter via `descriptors[route.key].options.href === null`. Preserve deep links (programmatic `router.push('/(app)/(tabs)/tasks')` still resolves).
- **Header actions:** `HeaderActions` (Search IconButton → `/(app)/search`, Avatar pressable → `/(app)/profile` stack canonical). Avatar initials derived from `useAuth().user.email` (first 2 chars uppercase, fallback `EG`).
- **Safe area:** `SafeAreaView edges=['top']` in `AppScreen`/`MobileScreen`; tab pill positioned `bottom: max(insets.bottom,12)+20` with pill width clipped 280–560.
- **Content clearance:** every tab's `ScrollView/FlatList/SectionList` `contentContainerStyle.paddingBottom = floatingTabClearance (160)`. Sticky save bars use `120`.
- **Geometry:** pill width fixed per window width; filtered hidden routes guarantee no item-count-dependent layout shift between primary screens.
- **Typed routes:** `experiments.typedRoutes=true` preserved. Any moved profile route registered in `(app)/_layout` Stack; `tsc --noEmit` must pass.

---

## FORMS

Wave 0 ships header/search affordances only; full `FormField/FormSection` deferred per YAGNI (Waves 6–7).

- **Label:** 12/700 muted, `color textMuted`, 4px above input.
- **Helper:** 12 muted, `textSubtle`, 6px below input.
- **Error:** 12 semibold, `danger #dc2626`, reserved 20px minHeight to avoid layout shift; `feedbackBanner` for form-level errors.
- **Focus:** `border accentMid (#93c5fd)` + outer ring `accentSoft 2` (via shadow); `background #fff`.
- **Disabled:** `opacity 0.48`, `background surfaceMuted`, `border #e4e7ec`.
- **Loading:** `ActivityIndicator accent` inside button/input affix; button `disabled + busy` state.

Search (Wave 0): `SearchField` (input + left magnifier + right clear 44px), `debounce 250ms`, `autoFocus` on `/search`, `clearButtonMode while-editing` fallback.

---

## Stitch → mobileTheme mapping (authoritative)

| Stitch token | mobileTheme key | Value |
|---|---|---|
| `primary` | `accent` / `primary` | `#2563eb` |
| `primary-dark` | `accentDark` | `#1d4ed8` |
| `surface` | `surface` | `#fff` |
| `muted` | `surfaceMuted` | `#f2f4f7` |
| `border` | `border` | `#e4e7ec` |
| `text-primary` | `text` | `#0d1117` |
| `radius-card` | `radius.card` | `20` |
| `shadow-card` | `shadow.card` | above |

New tokens introduced in Wave 0 all live under `mobileTheme.colors` / `mobileTheme.radius` etc — no second export.

---

## References
- `apps/mobile/components/mobile/theme.ts` — authority
- `apps/mobile/components/mobile/ui/` — primitives
- `apps/mobile/components/mobile/motion/` — press/fade/reduced-motion
- `apps/mobile/docs/redesign/research-wave-0.md` — source evaluations
- `apps/mobile/docs/redesign/NAVIGATION.md` — route structure
