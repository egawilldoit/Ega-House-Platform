# Mobile SDK 54 → 57 Migration Plan (TASK 10 — PLAN ONLY)

Status: PLAN ONLY — this PR changes documentation only; zero dependency, lockfile, or code changes.
Author: EXPO-SDK57-ARCHITECT
Base: origin/main `f29a6ef7de0c052df491c46145555b046a19998c`
Scope: `apps/mobile` plus the monorepo pins/gates it drags. Execution is out of scope here.

**Verdict up front: GO (execute soon), estimated complexity L.** SDK 57 is the current public
stable SDK and our best target; see §14 for the full recommendation and §10 for ranked risks.

> **Does SDK 57 exist publicly today (August 23, 2026)? YES.**
> Expo SDK 57 was released June 30, 2026 ([expo.dev/changelog/sdk-57](https://expo.dev/changelog/sdk-57))
> and [docs.expo.dev/versions/latest](https://docs.expo.dev/versions/latest/) serves
> "Reference (v57.0.0)". It ships React Native 0.86 / React 19.2.3 and is described by Expo as a
> small, focused release exploring a faster cadence of non-breaking upgrades. This plan targets
> SDK 57 directly through the real intermediate stops (55, 56) that the breaking changes make
> unavoidable. No "wait for 57" hedge exists or is needed.

**Source discipline**: every material external claim below cites its official source —
[docs.expo.dev/versions/latest](https://docs.expo.dev/versions/latest/) (SDK↔RN/React/Node/OS tables),
the SDK 55/56/57 changelogs ([sdk-55](https://expo.dev/changelog/sdk-55),
[sdk-56](https://expo.dev/changelog/sdk-56), [sdk-57](https://expo.dev/changelog/sdk-57)),
`bundledNativeModules.json` from the official `expo/expo` branches `sdk-55`, `sdk-56`, `sdk-57`,
and expo/expo issues #47435/#46519. Repo claims cite `file:line` at base SHA. All were verified
August 23, 2026.

---

## 1. SDK54 CURRENT STATE (repo truth)

All versions verified from `apps/mobile/package.json`, root `package.json`,
`package-lock.json` resolutions, and `apps/mobile/app.json` at base SHA `f29a6ef`.

### Runtime dependencies (`apps/mobile/package.json:16-47`)

| Package | Current pin |
| --- | --- |
| expo | `~54.0.37` |
| react / react-dom | `19.1.0` |
| react-native | `0.81.5` |
| expo-router | `~6.0.23` |
| @expo/metro-runtime | `~6.1.2` |
| @expo/vector-icons | `^15.0.3` |
| @react-native-community/datetimepicker | `8.4.4` |
| @react-navigation/native / bottom-tabs | `^7.1.8` / `^7.4.0` |
| @tanstack/react-query | `^5.100.1` |
| expo-blur | `~15.0.8` |
| expo-constants | `~18.0.14` |
| expo-font | `~14.0.11` |
| expo-linear-gradient | `~15.0.8` |
| expo-linking | `~8.0.12` |
| expo-secure-store | `~15.0.7` |
| expo-splash-screen | `~31.0.13` |
| expo-status-bar | `~3.0.9` |
| expo-web-browser | `~15.0.11` |
| lucide-react-native | `^1.14.0` |
| react-native-reanimated | `~4.1.1` |
| react-native-safe-area-context | `~5.6.0` |
| react-native-screens | `~4.16.0` |
| react-native-svg | `15.12.1` |
| react-native-web | `~0.21.0` |
| react-native-worklets | `0.5.1` |
| @ega/api-client / contracts / domain | workspace `0.1.0` |

Dev (`apps/mobile/package.json:48-58`): `babel-preset-expo ~54.0.12`, `jest-expo ~54.0.18`,
`jest ^29.7.0`, `react-test-renderer 19.1.0`, `@types/react ~19.1.0`, `typescript ~5.9.2`,
`expo-doctor ^1.16.0`. Root `package.json:74-75` devDependencies also pin hoisted tooling:
`expo ~54.0.37`, `expo-router ~6.0.23`; the lock resolves expo-router once, hoisted at root as
**6.0.24** (`package-lock.json` `node_modules/expo-router`).

**Not installed** (matters in later sections): expo-notifications, expo-updates,
expo-file-system, expo-haptics, AsyncStorage, react-native-gesture-handler, expo-dev-client.

### App configuration (`apps/mobile/app.json`)

- `"newArchEnabled": true` (line 10) → **New Architecture already enabled.** We are NOT a
  legacy-architecture app; the biggest historical migration hurdle is already behind us.
- `scheme: "mobile"`, portrait, `userInterfaceStyle automatic`, typed routes on
  (`experiments.typedRoutes`, line 48-50).
- Android (lines 19-27): `edgeToEdgeEnabled: true`, `predictiveBackGestureEnabled: false`,
  package `com.ega_house.mobile`, adaptive icon.
- Lines 28-37: legacy **`androidStatusBar`** block (barStyle/backgroundColor/translucent) and
  **`androidNavigationBar`** block — both flagged deprecated by SDK 55 (§4.3).
- iOS: tablet support only; no custom entitlements/capabilities.
- Plugins (lines 43-47): `expo-router`, `@react-native-community/datetimepicker`,
  `expo-web-browser` — all string-form, no options.
- `extra.eas.projectId` present (lines 51-56); no `updates` block (no EAS Update usage);
  **no `eas.json` anywhere in the repo** — APK builds run locally or via the manual GitHub
  workflow (§6).

### Native workflow

Continuous Native Generation. `apps/mobile/android/**` exists only as ignored prebuild output
(`git check-ignore apps/mobile/android` confirms); CI hygiene proves generated native dirs stay
untracked. Every native build starts from config via `npm run mobile:prebuild:android`.

---

## 2. TARGET STATE

**Target = Expo SDK 57 (current stable), reached through SDK 55 → 56 → 57 stops.**

Official requirements ([docs.expo.dev/versions/latest](https://docs.expo.dev/versions/latest/)
tables; changelog dates from each SDK's changelog post):

| Dimension | SDK 54 (today) | SDK 55 (2026-02-25) | SDK 56 (2026-05-21) | SDK 57 (2026-06-30) |
| --- | --- | --- | --- | --- |
| react-native | 0.81.x | 0.83.10 | 0.85.3 | **0.86.2** (`expo@≥57.0.9`) |
| react / react-dom | 19.1.0 | 19.2.0 | 19.2.3 | **19.2.3** |
| New Architecture | default on, can disable | **mandatory**; `newArchEnabled` removed | mandatory | mandatory |
| Hermes | classic default engine | v1 opt-in | v1 default (**memory regression**, §4.4) | v1; regression fixed in `expo@57.0.9` |
| Min Node.js | 20.19.x | ^20.19.4 / ^22.13.0 / ^24.3.0 / ^25.0.0 | ≥20.19.4 (RN 0.85 floor) | **22.13.x** |
| iOS min / Xcode | 15.1 / 16.1+ | 15.1 / 26+ (EAS image 26.2) | **16.4 / 26.4+** | 16.4 / 26.4+ |
| Android | API 36, Android 7+ | same; edge-to-edge mandatory | same | same (compile/target 36); RN 0.86 e2e fixes |
| TypeScript in templates/--fix | 5.x | 5.x | **6.0.3 offered via `--fix`** (opt-out: `expo.install.exclude`) | 6.x |

Environment fit:

- Local nvm Node **v22.23.2** ✓ (satisfies every stop; SDK 57's 22.13 floor included).
- CI `unified-platform-validation.yml` uses `actions/setup-node@v6` with `node-version: 22` ✓.
- **No `eas.json` exists**, so "profiles without an explicit image default to Xcode 26.4"
  (SDK 56 changelog) is informational for us; native builds happen via
  `.github/workflows/mobile-apk-manual.yml` (ubuntu-latest, Java 17, prebuild + Gradle) or
  locally. Verify the runner's Android SDK/JDK still satisfies the regenerated Gradle templates
  at each stop.
- **Expo Go is not distributed on either app store for SDK 55/56/57** (App Store approval
  pending per Expo; sdk-55 and sdk-56 changelogs). Device testing must go through dev-client/APK
  builds — which matches our ladder reality anyway (§9).
- Cadence outlook (SDK 57 changelog, "Exploring a new Expo SDK release cadence"): after this
  migration, expect smaller, more frequent optional bumps between significant releases.
- **Support-window pressure**: per the SDK 57 changelog, SDK releases live ~1 year and
  "SDK 54 (September 2025) will receive critical fixes until the next SDK release (September or
  October 2026)". SDK 54 leaves support imminently — this migration should not idle long.

---

## 3. PACKAGE DELTA TABLE (current → SDK 57 required)

Required versions verified against official `bundledNativeModules.json` on branches `sdk-55`,
`sdk-56`, `sdk-57` of `expo/expo` (all three fetched August 23, 2026). Intermediate columns are
the landing zones of the ladder (§11); the operative command at every stop resolves them
automatically: `npx expo install expo@^<NN>.0.0 --fix`, then `npx expo-doctor@latest`.

| Package | Current (54) | SDK 55 | SDK 56 | SDK 57 target | Note |
| --- | --- | --- | --- | --- | --- |
| expo | ~54.0.37 | ~55.0.x | ~56.0.x | **^57.0.9** | Floor `>=57.0.9` mandatory (Hermes V1 fix, §4.4) |
| react-native | 0.81.5 | 0.83.10 | 0.85.3 | **0.86.2** | exact pin |
| react / react-dom (mobile) | 19.1.0 | 19.2.0 | 19.2.3 | **19.2.3** | web shares hoisted React today (§8 coupling) |
| expo-router | ~6.0.23 | ~55.0.18 | ~56.2.19 | **~57.0.15** | unified versioning starts at SDK 55 (sdk-55 changelog) |
| @expo/metro-runtime | ~6.1.2 | ~55.0.12 | ~56.0.20 | **~57.0.12** | |
| @expo/vector-icons | ^15.0.3 | ^15.0.2 | ^15.0.2 | **^15.0.2** | no longer transitive of expo since 56 (§4.7); keep explicit |
| @react-navigation/native | ^7.1.8 | keep | **remove** | **remove** | router forked from React Navigation at 56 (§4.2) |
| @react-navigation/bottom-tabs | ^7.4.0 | keep | **replace/remove** | **remove** | codemod migrates tabs (§4.2) |
| @react-native-community/datetimepicker | 8.4.4 | 8.6.0 | **9.1.0** | **9.1.0** | v9 major lands at 56; break audited §4.6 |
| expo-blur | ~15.0.8 | ~55.0.17 | ~56.0.4 | **~57.0.2** | Android blur API shift at 55 (§4.5) |
| expo-constants | ~18.0.14 | ~55.0.17 | ~56.0.24 | **~57.0.13** | |
| expo-font | ~14.0.11 | ~55.0.8 | ~56.0.7 | **~57.0.1** | |
| expo-linear-gradient | ~15.0.8 | ~55.0.17 | ~56.0.4 | **~57.0.1** | |
| expo-linking | ~8.0.12 | ~55.0.17 | ~56.0.17 | **~57.0.7** | |
| expo-secure-store | ~15.0.7 | ~55.0.17 | ~56.0.4 | **~57.0.1** | |
| expo-splash-screen | ~31.0.13 | ~55.0.24 | ~56.0.14 | **~57.0.7** | |
| expo-status-bar | ~3.0.9 | ~55.0.6 | ~56.0.4 | **~57.0.1** | plugin + prop deprecations (§4.3) |
| expo-web-browser | ~15.0.11 | ~55.0.19 | ~56.0.6 | **~57.0.2** | |
| react-native-reanimated | ~4.1.1 | 4.2.1 | 4.3.1 | **4.5.1** | side-effect import audit §4.4/§5 |
| react-native-worklets | 0.5.1 | 0.7.4 | 0.8.3 | **0.10.1** | Hermes regression co-factor (§4.4) |
| react-native-safe-area-context | ~5.6.0 | ~5.6.2 | ~5.7.0 | **~5.7.0** | |
| react-native-screens | ~4.16.0 | ~4.23.0 | ~4.26.0 | **~4.26.0** | Stack v5 stays experimental opt-in |
| react-native-svg | 15.12.1 | 15.15.3 | 15.15.4 | **15.15.4** | |
| react-native-web | ~0.21.0 | ~0.21.0 | ~0.21.0 | **~0.21.0** | unchanged across ladder |
| jest-expo (dev) | ~54.0.18 | ~55.0.21 | ~56.0.5 | **~57.0.4 min** | `.0–.3` have peer/mock defects (§7) |
| babel-preset-expo (dev) | ~54.0.12 | ~55.0.x | ~56.0.x | **~57.0.x** | aligned by `expo install --fix` |
| react-test-renderer / @types/react(-test-renderer) | 19.1.0 / ~19.1.0 | 19.2.0 | 19.2.3 | **19.2.3 / ~19.2.x** | move with the React bump |
| typescript | ~5.9.2 | keep | 6.0.3 offered | **decision point** | defer TS 6 to its own PR (§10 R7) |
| lucide-react-native | ^1.14.0 | — | — | **keep, verify peers** | JS lib over react-native-svg; not in bundled list |
| @tanstack/react-query | ^5.100.1 | — | — | **keep** | pure JS |
| root devDeps expo / expo-router | ~54.0.37 / ~6.0.23 | follow | follow | **~57.0.x both** | hoisted tooling pins |

---

## 4. BREAKING CHANGES (grep-audited against THIS repo)

### 4.1 Legacy Architecture removal (SDK 55) — NON-EVENT except one config key

RN 0.82+ cannot disable New Architecture; SDK 55 removes `newArchEnabled` from app config
([sdk-55 changelog](https://expo.dev/changelog/sdk-55), "Dropped support for the Legacy
Architecture"). Our app already runs New Arch (`app.json:10`). Action: delete the now-meaningless
key during the SDK 55 stop.

### 4.2 expo-router forks from React Navigation (SDK 56) — PRIMARY CODE IMPACT

SDK 56 changelog: "`expo-router` no longer depends on `react-navigation` … most code imported
directly from `@react-navigation/*` packages will no longer work out of the box." Official codemod:
`npx expo-codemod sdk-56-expo-router-react-navigation-replace <dir>`; full guide at
[docs.expo.dev/router/migrate/sdk-55-to-56](https://docs.expo.dev/router/migrate/sdk-55-to-56/);
expo-doctor warns when both router and react-navigation are installed (#45323).

Grep evidence — **exactly 5 files** touch `@react-navigation/*`:

- `apps/mobile/app/_layout.tsx:2` — `DarkTheme, DefaultTheme, ThemeProvider` from `@react-navigation/native`
- `apps/mobile/app/(app)/(tabs)/today.tsx:2` — `useFocusEffect` from `@react-navigation/native`
- `apps/mobile/app/(app)/(tabs)/tasks.tsx:2` — `useFocusEffect` from `@react-navigation/native`
- `apps/mobile/app/(app)/tasks/[id].tsx:3` — `useFocusEffect` from `@react-navigation/native`
- `apps/mobile/components/mobile/glass/GlassBottomTab.tsx:1` — `type { BottomTabBarProps }` from `@react-navigation/bottom-tabs` *(type-only but hard-breaks once the package is removed; missed by earlier draft)*

Plus direct deps `@react-navigation/bottom-tabs ^7.4.0` and `@react-navigation/native ^7.1.8`;
tab layouts under `app/(app)/(tabs)/_layout.tsx` consume bottom-tabs APIs. Migration: run the
codemod over `apps/mobile`, port the tab layout to the router tab API, drop both
`@react-navigation/*` deps, confirm router's post-fork exports cover `useFocusEffect`,
`ThemeProvider`, `DarkTheme`/`DefaultTheme`, and `BottomTabBarProps` (typed-routes +
`tsc --noEmit` prove coverage at compile time).

### 4.3 Status-bar / nav-bar config and props deprecated (SDK 55) — HITS OUR app.json AND _layout

SDK 55 changelog ("Deprecations", #43276): with edge-to-edge mandatory on Android,
- the **`androidNavigationBar`** app.json config is deprecated (our block: `app.json:33-37`);
- `androidStatusBar.backgroundColor` and `.translucent` app.json properties are deprecated
  (ours: `app.json:28-32`);
- **`expo-status-bar`'s `backgroundColor`, `translucent` props become deprecated no-ops**
  (ours: `<StatusBar backgroundColor={…} style="dark">` at
  `apps/mobile/app/_layout.tsx:59`);
- replacement direction: `expo-navigation-bar` / `expo-status-bar` config plugins.

These deprecations do not throw at SDK 55; plan the minimal removal/migration at the stop where
the replacement plugins align (56), keeping 55 scoped to key removals (§4.1, §4.9). Also note
`edgeToEdgeEnabled` itself: edge-to-edge becomes mandatory targeting Android 16+, and the
**config key is removed** in SDK 55 (#42518) — ours sits at `app.json:24` and must go.

### 4.4 Hermes V1 memory regression (55/56 era) — HARD VERSION FLOOR

Importing `react-native-worklets` or `react-native-reanimated` under Hermes V1 (default from
RN 0.85) can drastically increase memory usage ([expo/expo#46519](https://github.com/expo/expo/issues/46519);
documented in sdk-56 and sdk-57 changelogs). Fixed by RN 0.86.2 shipped in **`expo@57.0.9`**
(sdk-57 changelog, August 13, 2026 update): "Updating to `expo@57.0.9` or later is crucial."
A dev-only startup-time regression (#48298) remains unfixed upstream as of that date; it does
not affect production builds. Real exposure vector here: bare side-effect
`import 'react-native-reanimated';` at `apps/mobile/app/_layout.tsx:8`.
Mitigation: never land below `expo@^57.0.9`; add an emulator/device memory smoke check (§9);
drop the obsolete side-effect import if reanimated 4.5 install docs no longer require it
(verify at execution time).

### 4.5 expo-blur Android blur rework (SDK 55) — SILENT VISUAL RISK, NO COMPILE BREAK

SDK 55 changelog ("expo-blur is now stable on Android"): Android blur moves to the efficient
RenderNode API on Android 12+ and requires wrapping blurrable background content in
`<BlurTargetView>`; the opt-in `experimentalBlurMethod` prop is renamed `blurMethod` (#39996).
Grep evidence: our glass family (`GlassCard.tsx:60`, `GlassBottomSheet.tsx:47`,
`GlassBottomTab.tsx:114`) uses plain `<BlurView intensity tint>{children}</BlurView>` and never
references either prop — nothing breaks at compile time, but **Android glass backgrounds may
silently stop blurring** until a BlurTargetView pass happens. Plan: device visual QA at the 55
stop; BlurTargetView migration as optional cleanup (§11 PR-6).

### 4.6 datetimepicker 8 → 9 (lands at the SDK 56 stop)

[v9.0.0 (2026-03-16)](https://github.com/react-native-datetimepicker/datetimepicker/releases/tag/v9.0.0)
breaking change, verbatim: "**android:** remove deprecated positiveButtonLabel,
negativeButtonLabel, neutralButtonLabel props (#1039)". Grep evidence: zero matches for any of
those props under `apps/mobile` (usage sites: `app/(app)/tasks/[id].tsx`,
`app/(app)/tasks/create.tsx` use neither) → version bump only, no code change.

### 4.7 `@expo/vector-icons` deprecation path (announced SDK 56)

SDK 56 changelog: "the `expo` package no longer depends on `@expo/vector-icons`. If you wish to
continue using `@expo/vector-icons`, you need to explicitly add it to your project's
dependencies." Long-term direction is `@react-native-vector-icons/*` (codemod:
`npx @react-native-vector-icons/codemod`). We already declare it explicitly
(`apps/mobile/package.json:21`; 22 import statements across 30 files — Ionicons ×21,
FontAwesome ×1), so nothing breaks at SDK 57. Icon-set migration is a separate future task,
explicitly NOT part of this migration.

### 4.8 `expo/fetch` becomes `globalThis.fetch` (SDK 56)

SDK 56 changelog ("Notable breaking changes"): WinterTC-compliant fetch installed as the default
`globalThis.fetch`; opt-out `EXPO_PUBLIC_USE_RN_FETCH=1`. Directly relevant seam:
`apps/mobile/lib/api/ega.ts:25-36` resolves `globalThis.fetch` per request, and the L3
integration suite stubs `global.fetch` (`lib/api/__tests__/integration.test.ts:128`). The seam
design survives (it binds whatever global fetch is present); action: runtime smoke of API calls
on device (§9) and keep the L3 suite green through the 56 stop.

### 4.9 Platform floors

iOS deployment target 15.1 → **16.4** and Xcode minimum **26.4** at SDK 56
([docs.expo.dev/versions/latest](https://docs.expo.dev/versions/latest/) table; sdk-56
changelog drops iPhone 7/7+, 6s/6s+, SE 1st gen, iPad mini 4, iPad Air 2). Android unchanged
(API 36, Android 7+) across all stops. This repo ships Android APKs only; iOS is informational.

### 4.10 Tooling changes with no repo impact (operator notes)

On-Demand Filesystem replaces `watchFolders` as load-bearing config (we define no metro.config
— verified absent under `apps/mobile/`; only `babel.config.js` with plain
`babel-preset-expo`); native Node watcher replaces Watchman; Hermes bytecode diffing defaults
apply to expo-updates (not installed → N/A); **`eas update` requires `--environment` from SDK 55**
(we run none → N/A); config plugins gain typed exports and `.ts/.mjs/.cjs` loading (our three
plugins are string-form, unchanged); `expo prebuild` clears/regenerates android/ios by default
from SDK 57 (#47209 — matches our existing delete-and-regenerate CNG habit); status bar gains a
declarative component + config plugin at 56 (we already render `<StatusBar style="…">`
declaratively — compatible aside from §4.3).

### Deprecated-API usage summary (grep-audited)

| Deprecated/removed item | Used here? | Evidence |
| --- | --- | --- |
| Legacy Architecture / `newArchEnabled:false` | No (opposite) | `app.json:10` sets true; key deleted at 55 |
| `edgeToEdgeEnabled` config key (removed at 55, #42518) | **Yes** | `app.json:24` — remove at 55 |
| `androidStatusBar.*` / `androidNavigationBar` blocks (deprecated at 55, #43276) | **Yes** | `app.json:28-37` — migrate at 56 |
| `<StatusBar backgroundColor>` prop (deprecated no-op at 55) | **Yes** | `_layout.tsx:59` — drop prop at 56 |
| `@react-navigation/*` imports alongside router | **Yes — 5 files** | §4.2 list |
| Reanimated side-effect import | Yes, 1 site | `_layout.tsx:8` |
| datetimepicker button-label props | No | zero grep hits (§4.6) |
| expo-blur `experimentalBlurMethod` | No (but Android blur behavior shifts) | §4.5 |
| expo-file-system legacy/sync copy-move APIs | N/A | package absent |
| `watchFolders` metro config | No | no metro.config customization |

---

## 5. CODE IMPACT (files likely touched, derived from §4 evidence)

| File | Change | Stop |
| --- | --- | --- |
| `apps/mobile/package.json` | all §3 deltas; drop both `@react-navigation/*` at 56; keep explicit `@expo/vector-icons` | each |
| `package.json` (root) | devDeps `expo`, `expo-router` ranges → `~57.0.x` | each |
| `package-lock.json` | regenerated (single root lock authority preserved) | each |
| `apps/mobile/app.json` | remove `newArchEnabled` + `edgeToEdgeEnabled` (55); retire `androidStatusBar`/`androidNavigationBar` blocks in favor of plugins (56) | 55/56 |
| `apps/mobile/app/_layout.tsx` | theme imports → router equivalents (56); drop deprecated `<StatusBar backgroundColor>` (56); possibly remove reanimated side-effect import (57) | 56/57 |
| `apps/mobile/app/(app)/(tabs)/today.tsx` | `useFocusEffect` import source | 56 |
| `apps/mobile/app/(app)/(tabs)/tasks.tsx` | `useFocusEffect` import source | 56 |
| `apps/mobile/app/(app)/tasks/[id].tsx` | `useFocusEffect` import source | 56 |
| `apps/mobile/components/mobile/glass/GlassBottomTab.tsx` | `BottomTabBarProps` type source → router equivalent | 56 |
| `apps/mobile/app/(app)/(tabs)/_layout.tsx` | bottom-tabs → router tabs API (codemod + manual pass) | 56 |
| `apps/mobile/components/mobile/glass/*` | optional `BlurTargetView` wrap to restore Android blur | optional (post-57) |
| `apps/mobile/app/+html.tsx` | verify `expo-router/html` export still exists across 6→55→56→57 | verify each |
| `scripts/ci/workspace-proofs.mjs` | pin assertions enumerated in §7 (incl. header comment lines 22-23) | each |
| `docs/mobile-verification-ladder.md` | record proven levels per stop | each |

No other `apps/mobile` file references removed APIs per the greps in §4.

---

## 6. NATIVE IMPACT

- **CNG regeneration**: at every stop (native modules change each time), delete untracked
  `apps/mobile/android/` and regenerate via `npm run mobile:prebuild:android` before device/bundle
  work. Never hand-edit generated gradle files; hygiene keeps them untracked regardless. From
  SDK 57, `expo prebuild` cleans+regenerates by default (#47209), matching this habit.
- **Config plugins**: the same three plugins ship SDK-57-compatible versions; no option changes.
  Optional additions at 56: `expo-status-bar` and `expo-navigation-bar` plugins to replace the
  deprecated app.json styling keys (§4.3) — recommended, not required.
- **Permissions**: none declared today; none introduced by our plugin set at SDK 57.
- **Android**: compile/target stay API 36; edge-to-edge stays (becomes unconditional);
  predictive-back stays disabled. Gradle/JDK toolchain updates arrive inside regenerated
  templates — confirm the Java 17 setup in `mobile-apk-manual.yml:75` still satisfies them.
- **EAS**: `extra.eas.projectId` retained; no `updates` block; no `eas.json` profiles exist, so
  no image-pin edits are needed. First local build after each stop downloads newer templates —
  budget extra first-build time once per stop.
- **Binary freshness**: every stop requires a fresh APK/dev-build; old binaries keep running old
  JS. With no expo-updates/EAS Update configured there is no OTA drift channel — JS and native
  always move together per install.

---

## 7. TEST IMPACT

- **jest-expo**: floor `~57.0.4` (also the value pinned by sdk-57 `bundledNativeModules.json`).
  Two documented defects make this real, not cosmetic:
  - `jest-expo@57.0.0-.3` peer-conflicts `@react-native/jest-preset@^0.85.0` against RN 0.86 —
    ERESOLVE on a stock SDK 57 template ([expo/expo#47435](https://github.com/expo/expo/issues/47435),
    verified; workaround documented there if ever needed mid-ladder).
  - `jest-expo@57.0.3` lacks the `ExpoObserve.getIntegrations` mock entry, crashing suites that
    transitively import `expo-image` under jsdom (expo/expo#48617; carried from prior-attempt
    research, consistent with the 57.0.4 alignment — not independently re-opened here).
  - npm registry confirms `jest-expo@57.0.4` published 2026-08-10.
  Align Jest itself via `npx expo install jest-expo jest`; record selected versions in each PR.
- **react-test-renderer / @types/react(-test-renderer)**: move to 19.2.x with the React bump.
- **Ladder (`scripts/ci/mobile-verification-ladder.mjs`)**: L1-L5 mechanics unchanged; greps show
  no framework-version pins inside the script or its unit test (`test:mobile-ladder` asserts
  classification logic, not versions). L4 (doctor) becomes the active coherence gate: doctor
  fails on mismatched bundled versions and, from SDK 56, on router+react-navigation co-install.
- **workspace-proofs.mjs assertions requiring coherent update** (exact lines at base SHA):
  - header comment `22-23` (narrative versions)
  - `157` mobile Expo pin `~54.0.37` → `~57.0.x`
  - `158` mobile React `19.1.0` → `19.2.3`
  - `159` RN `0.81.5` → `0.86.2`
  - `160` router `~6.0.23` → `~57.0.x`
  - `161` bottom-tabs direct-dep assertion → invert to absence assertion after SDK 56
  - `162` babel-preset-expo manifest pin `~54.0.12` → `~57.0.x`
  - `169-171` web React/ReactDOM `19.1.0` → decision output of the §8 coupling call
  - `173` root router tooling range → `~57.0.x`
  - `203` lock bottom-tabs record → invert/absence after 56
  - `204` lock babel-preset-expo record
  - `208-210` lock web React/ReactDOM + root router records
  - `211` hoisted router `6.0.24` → resolved 57.x value (`212` nested-absence proof stays)
  - `243` single-RN resolution `0.81.5` → `0.86.2`
  - `245-247` root resolved React/ReactDOM values
  - `250-252` resolved babel-preset equality value
  - `254-262` router-resolves-everywhere triplet values
  Note: workspace-proofs pins **no** expo-constants or jest-expo assertions — those packages
  ride along via doctor and the lock, not dedicated proofs.
- **audit-production.mjs nanoid path**: allowlist entry keyed to a reviewed GHSA tied to the
  historical "Expo Router v3 contract" (`scripts/ci/audit-production.mjs:12`), independent of SDK
  version. Keep as-is; re-run security proofs/npm audit at each stop and confirm no NEW
  production advisories appear beyond the mapped one.

---

## 8. CI IMPACT

- `unified-platform-validation.yml`: the paths-filter lists root `package.json` /
  `package-lock.json` under mobile AND server AND api-client triggers — every migration PR runs
  the full matrix, not just mobile. Expected; budget review time accordingly.
- Mobile job steps (doctor → typecheck → test → android bundle export) need no YAML edits; they
  are version-driven through npm scripts. Node 22 setup already satisfies SDK 57's ≥22.13 floor.
- Hygiene job keeps proving generated dirs (`apps/mobile/android/**` etc.) stay untracked — CNG
  discipline survives untouched.
- Web job coupling: root currently hoists one React 19.1.0 shared by web (`next`) and mobile,
  asserted by proofs lines 169-171 / 208-209 / 245-247. Mobile moving to React 19.2.3 forces
  either (1) a coordinated web React bump to 19.2.3 in its own preceding PR — preferred, keeps
  single-hoisting proofs intact; or (2) accepting nested React installs and rewriting hoisting
  proofs. **Decide before the first implementation PR** (recommended: option 1, as PR-2 in §11;
  verify Next.js compatibility with React 19.2.3 in that PR).
- `lint-changed` / regressions jobs are unaffected by this planning PR (docs-only diff).

---

## 9. DEVICE IMPACT (per docs/mobile-verification-ladder.md + docs/mobile-e2e-flows.md reality)

- Ladder ceiling: **L1-L5 proven in CI/local** (typecheck, unit, integration, doctor, bundle
  export). **L6/L7 are fully specified APP-runtime probes** — `adb install -r` → activity
  resolve → `am start` → liveness via `pidof` → UI evidence (`uiautomator` dump) — with working
  automation in the ladder script. They report `NOT PROVEN` today for hardware reasons only:
  the standard environment is ARM64 Linux without KVM; Google publishes no Linux/ARM64 emulator
  binary, redroid needs binder, physical devices can't attach to cloud VMs
  (`docs/mobile-verification-ladder.md:60-82`). What unlocks L6/L7: an x86_64 KVM runner or a
  physically attached device. A merely booted emulator never passes; honesty contract unchanged.
- Consequence for this migration: without arranging L6-capable hardware, runtime parity across
  the three stops rests on L1-L5 + manual human verification. Recommended: schedule one L6
  session on a KVM-capable machine (or physical device) covering the final SDK 57 APK, plus the
  memory smoke below.
- **Memory smoke (new, cheap, targets §4.4)**: launch the SDK 57 build via the L6 chain,
  exercise Today/Tasks screens, compare RSS stability against an SDK 54 build — the practical
  guard given our reanimated/worklet surface.
- Expo Go is NOT a validation path for SDK 55/56/57 (absent from both stores). Dev-build/APK
  only; any "open in Expo Go" workflow ends at the SDK 55 stop.
- Physical devices: nothing device-specific in our config; the iOS-floor bump does not affect
  the Android-first story.

---

## 10. RISKS (ranked, with mitigations)

| # | Risk | Sev | Mitigation |
| --- | --- | --- | --- |
| R1 | Router↔React-Navigation fork (56) silently changes navigation semantics beyond imports (tab layout port, focus effects) | High | Official codemod + [migration guide](https://docs.expo.dev/router/migrate/sdk-55-to-56/); typed routes + `tsc --noEmit` catch missing exports; doctor #45323 flags co-installation; L2/L3 suites cover query-on-focus seams; dedicated manual pass over `(tabs)` layouts |
| R2 | Web React hoisting conflict when mobile jumps 19.1.0→19.2.3 (root single-hoist proofs) | High | Decouple: bump web/root React to 19.2.3 in its own PR first (PR-2), keeping proofs intact; fall back to nested installs only if Next compat blocks, then rewrite proofs deliberately |
| R3 | Hermes V1 memory regression if any intermediate state ships with worklets/reanimated under RN 0.85-era Hermes | Med-High | Hard floor `expo@^57.0.9` at final stop; no release/deploy between stops; memory smoke §9 |
| R4 | Device-verification gap: L6/L7 unrunnable on current hardware, so runtime parity leans on humans | Med | Schedule one KVM-runner or physical-device L6 session per major stop (or at least at 57); keep honesty contract explicit in PR bodies |
| R5 | jest-expo peer/mock defects during ladder (ERESOLVE, missing mocks) | Med | Final stop pins `jest-expo@~57.0.4` minimum; #47435 documents an overrides escape hatch if an intermediate stop hits ERESOLVE |
| R6 | Android glass-family blur silently degrades after 55 (BlurTargetView rework) | Low-Med | Visual QA on device at 55 stop; BlurTargetView migration queued as cleanup PR-6; document expected appearance in PR body |
| R7 | TS 6 pulled in by `--fix` at 56 causing typecheck churn | Low | Defer via `expo.install.exclude: ["typescript"]`; adopt TS 6 in its own later PR |
| R8 | CI fan-out: lockfile touches trigger server/api-client/web jobs too, slowing each PR | Low | Accept; batch related proof updates into the same PR to avoid re-runs |

---

## 11. MIGRATION ORDER (PR sequence; each independently green and revertible)

Each stop = one PR = `npm ci` clean → proofs updated → doctor/typecheck/test/bundle green at
that exact head. Merge order strictly sequential; main stays releasable after every merge.

1. **PR-1 — Web/root React 19.2.3 decoupling (no Expo changes).** Bump react/react-dom for
   web+root; verify Next compatibility; workspace-proofs React assertions updated once here so
   later mobile stops don't fight hoisting. (Resolves R2 before any Expo motion.)
2. **PR-2 — SDK 55 stop.** `npx expo install expo@^55.0.0 --fix`; remove `newArchEnabled` +
   `edgeToEdgeEnabled` from app.json (§4.1/§4.3); accept-but-log status/nav deprecations; proofs
   lines 157-162/173/203-212/243-262 → 55 values; jest-expo ~55. Validate: full mobile job +
   proofs + lint.
3. **PR-3 — SDK 56 stop (largest).** `--fix` to 56; run
   `npx expo-codemod sdk-56-expo-router-react-navigation-replace apps/mobile`; port tab layout +
   GlassBottomTab type import; drop both `@react-navigation/*` deps; invert proof line 161 (+lock
   203) to absence assertions; retire `androidStatusBar`/`androidNavigationBar` blocks in favor
   of status/nav-bar plugins; drop deprecated `<StatusBar backgroundColor>`; decide/exclude TS 6.
4. **PR-4 — SDK 57 stop.** `npx expo install expo@^57.0.9 --fix` (floor, §4.4); jest-expo ≥57.0.4;
   reevaluate `_layout.tsx:8` side-effect import against reanimated 4.5 docs; final proof values
   (RN 0.86.2 etc.); verify `+html.tsx` export.
5. **PR-5 — Device verification wave.** Build debug+release APKs via `mobile-apk-manual.yml`;
   run L1-L8 ladder; execute L6 + memory smoke on KVM runner/physical device; record
   `HIGHEST LEVEL PROVEN` in PR body and ladder doc.
6. **PR-6 — Optional cleanup (separate authorization).** `@react-native-vector-icons` codemod;
   `BlurTargetView` glass migration; TS 6 adoption; Stack v5 evaluation. None block TASK-10
   completion.

---

## 12. ROLLBACK PLAN

- **Per-PR revert**: each stop is a single coherent commit set touching manifests + code +
  proofs together; `git revert` of the merge restores the previous fully-green state because no
  intermediate shared state persists (single root lockfile regenerates cleanly on revert+ci).
- **No OTA drift channel**: expo-updates/EAS Update are not configured, so a rolled-back main
  cannot leave devices on orphaned JS; binaries and bundles always ship together per build.
- **CNG hygiene**: native dirs are ignored output; rollback requires no native cleanup — next
  prebuild regenerates from whatever config is current.
- **Stop-level abort**: if a stop proves deeper than planned (e.g., router fork blockers at 56),
  halt the ladder; main remains on the last green SDK with support noted in §2 (54 window closes
  ~Sep/Oct 2026 — escalate rather than rush a partial stop).
- **Binary inventory**: APKs are version-stamped artifacts in the manual workflow; keep the last
  SDK-54 APK until PR-5 device verification passes on the 57 build.

## 13. ESTIMATED COMPLEXITY: **L**

Why L and not M: spans three SDK majors with two genuinely breaking surfaces (router fork at 56,
React hoist coupling), touches a version-proof gate with ~20 exact-pin assertions, requires
regenerated native builds at every stop, and runtime verification depends on hardware we must
arrange (R4). Why not XL: New Architecture already enabled (the hardest historical lift is done);
official codemod covers the router fork; every dependency delta has an official `--fix` path and
verified target versions; no expo-updates/notifications/custom native code expands blast radius;
each PR is independently verifiable and revertible. One PR (PR-3) alone would rate L; the rest
are S-M.

## 14. GO / WAIT RECOMMENDATION: **GO (schedule now; execute within the SDK 54 support window)**

Justification:
- SDK 57 exists, is the documented stable target, and its patch line has absorbed the one
  serious regression affecting our dependency shape (`expo@57.0.9` fixes #46519).
- Our exposure is fully mapped above with grep evidence; nothing suggests an unmapped blocker.
- New Architecture is already on — historically the most expensive part of such migrations.
- Waiting has a deadline: SDK 54 exits its ~1-year support window when the next SDK ships
  (~September/October 2026 per the SDK 57 changelog). Post-migration, the new cadence makes
  staying current cheaper.
- Conditions (not blockers): land PR-1 (web React) first; arrange one L6-capable device session
  before declaring the migration complete; respect the `^57.0.9` floor everywhere.
