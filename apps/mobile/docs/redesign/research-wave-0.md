# Research — Wave 0

## Scope
Wave 0 foundation: design tokens, navigation (4-tab), header actions, chip/card primitives. References evaluated as patterns only; no code copied.

---

### Mobbin — Bottom Navigation

| Field | Detail |
|---|---|
| SOURCE | Mobbin — iOS & Android production apps (Linear, Todoist, Sunsama, Structured, Things adjacent) |
| PATTERN | Fixed 4-5 destinations, floating pill (72h) centered with safe-area clearance, pill width 280–560 clipped to viewport minus 24 margins. Active state via dot + label weight (700→800) + icon size bump (21→23), inactive 60% white. Filter hidden routes by `href:null` so compat screens don't alter geometry. |
| WHY | Primary navigation must be spatially stable across screens; geometry cannot shift when pushing hidden compat routes. Pill chrome preserves content clearance (`floatingTabClearance=160`) and avoids competing with keyboard/sheet. |
| ADOPT | Fixed pill silhouette, 4 visible tabs (Today/Work/Goals/Timer), `descriptors[route.key].options.href===null` filter in `GlassBottomTab` & `BottomNavigation`, `maxFontSizeMultiplier=1.4` on labels only, 44px item targets, dot indicator. |
| REJECT | Auto-hiding on scroll (breaks focus parity), dynamic count badges on tab items (reserved for future, not Wave 0), 5+ items that force overflow, animated width shifts on selection. |

### Mobbin — Screen Headers

| Field | Detail |
|---|---|
| SOURCE | Mobbin — task/detail list headers (Linear Inbox, Todoist Today, Apple Reminders) |
| PATTERN | Compact header: eyebrow (11px, accent, uppercase, tracking 1.2), title (28px, 900, tracking -0.8), description (14/20 muted), right header actions (search IconButton 44px + avatar 32–36 circular pressable). Header lives inside SafeArea top, content scrolls beneath pill. |
| WHY | Eyebrow+title establishes day/workspace context without competing with bottom pill. Paired header actions (search → global search, avatar → profile) keep navigation symmetric across all 4 tabs. |
| ADOPT | `ScreenHeader` with optional `eyebrow/title/description` props + `HeaderActions` slot, injected via `MobileScreenHeader` replacement path. Both actions 44px hit-target, avatar pulls from `useAuth().user.email` initials. |
| REJECT | Large collapsing header with parallax (motion cost, a11y complexity), header search field inline (defer to dedicated `/search` stack). |

### Refero — Cards & Lists

| Field | Detail |
|---|---|
| SOURCE | Refero — card systems (Notion mobile, Linear issue cards, Asana list) |
| PATTERN | Card: `surface (#fff)` + `border (#e4e7ec)` + `radius.card (20)` + `shadow.card (y1/7/4%)`, left 3px accent matching status tone, internal 12–20 padding. List container bottom padding = `floatingTabClearance (160)` so last card clears pill. Row gap `sm (8)` consistent across lists. |
| WHY | Single card elevation prevents competing shadows; left accent conveys status without color-only reliance (paired with text label + dot). Uniform clearance guarantees last row remains tappable above pill on all devices. |
| ADOPT | `Card` primitive (`radius.card`, `shadow.card`, optional `accentColor`), `EmptyState` + `Skeleton` keep same outer radii, `FeedbackBanner` for inline errors. Keep `GlassCard` as legacy alias for now; new screens use `Card`. |
| REJECT | Glass-blurred cards in lists (performance, inconsistent on Android with `useRealBlurOnAndroid=false`), full-bleed cards without outer padding. |

### Screenlane — Segmented Controls & Selection Rows

| Field | Detail |
|---|---|
| SOURCE | Screenlane — segmented toggles & settings rows (Apple Settings, Linear filters, Todoist filters) |
| PATTERN | Segmented: pill track (`backgroundDeep #e9edf3` + `radius.pill`) with `padding 3`, active thumb = `surface #fff` + `shadow.control` + `font 800`. Selection via `Pressable` with `minHeight 44`, no width animation — only background/opacity/scale on press. SelectionRow: leading label + trailing check/dot, whole row pressable 44h+. |
| WHY | Segmented is primary Work hub switch (Tasks | Projects) and filter control. Transform/opacity-only motion keeps 60fps without layout thrash; ensures every option meets 44px a11y. |
| ADOPT | `SegmentedControl<T>` normalized (single authority under `ui/`), `SelectionRow` (44h, press scale 100–140ms via `AnimatedPressable`), thumb uses `transform+opacity`. `ReducedMotion` hook disables scale when OS prefers reduced motion. |
| REJECT | Sliding indicator that animates `width/margin` continuously, custom gesture pans for segment change, `ScrollView` with paging for segments. |

### React Native Reusables (RNR) — Component Architecture

| Field | Detail |
|---|---|
| SOURCE | React Native Reusables — shadcn/ui port for RN (https://github.com/mrzachnugent/react-native-reusables), docs + component source |
| PATTERN | Single token authority (light/dark `theme` object), primitives under `components/ui` barrel (`button`, `card`, `badge`→`chip`, `avatar`, `input`), variants via `cva` (class-variance-authority) mapped to Tailwind/nativeWind tokens, no per-component token duplication. `utils/cn` helper, `useColorScheme` boundary, reanimated for press. |
| WHY | Validates single-authority token model (`mobileTheme` only) and barrel `ui/index.ts` approach. Confirms tone resolution should live centrally (chip `kind+value → tokens`) rather than scattered `StatusChip/PriorityChip` helpers. |
| ADOPT | Structure: `apps/mobile/components/mobile/ui/` barrel + `motion/` sibling, `mobileTheme` stays canonical (map Stitch tokens into it), `Chip` with `kind=status|priority|health` + `value` central resolver, `Button`/`IconButton` share base, `AnimatedPressable` (reanimated, 100–140ms, respects reduced motion). Import path `@/components/mobile/ui` + `@/components/mobile/motion`. |
| REJECT | Adopting RNR/nativeWind runtime (needs new deps, breaks `NO new npm dependencies` constraint), copying RNR `cn`/Tailwind setup, per-component `variant` files duplicating theme, creating second `stitchTheme` authority. Keep Expo SDK 54 / RN 0.81.5 / Reanimated 4.1.1 only. |

---

## Cross-reference Decisions (Wave 0)

- **Glass persistence:** `glassConfig.useRealBlurOnAndroid=false` preserved; `GlassBottomTab` keeps fake fallback path, new `BottomNavigation` also respects it for future migration.
- **Motion discipline:** press feedback only via `transform: scale` (100–140ms) + `opacity`; never `width/height/margin` during interaction. Route/sheet use `opacity`+`translateY` under `FadeSlide`, gated by `useReducedMotion`.
- **Tone authority:** one resolver per kind (`chipTone(status|priority|health)` → `{bg,color,dot}`) inside `theme.ts`; `Chip` consumes it, legacy `statusTone/priorityTone` remain as thin aliases for backwards compat.
- **Accessibility:** every interactive target ≥44px (`minTouchTarget`), tab labels cap `maxFontSizeMultiplier=1.4`, other surfaces scale uncapped; non-color state via text label + icon/dot + accent border, not color alone.
- **Validation:** no new deps, no framework migration, mobile-only diff constraint enforced via `git diff --name-only BASE...HEAD | awk '!/^apps\/mobile\//'`.

## Open items for later waves
- Sheet/progress motion curves (Wave 6–7 create flows) — still spec'd in DESIGN.md but primitives ship minimal Wave 0.
- FormField/FormSection primitives deferred (YAGNI Wave 0).
