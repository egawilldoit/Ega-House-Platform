# Mobile OTA Updates — EAS Update without EAS Build (Production Only)

This document is the authoritative guide for OTA updates for `apps/mobile` via **EAS Update** while APKs remain built by the existing Blacksmith Gradle workflow. Complements `docs/ci/mobile-delivery.md`.

> **Invariants**
> - Android package `com.ega_house.mobile` unchanged.
> - Expo project ID `0dafbb64-7c1e-49b1-aea1-de1f8159a5e6` (`extra.eas.projectId`) is canonical.
> - APKs remain built by `mobile-delivery.yml` → Blacksmith `assembleRelease` + GitHub Releases.
> - **V1 = production channel only**. No `preview` OTA until a real preview APK exists.
> - No EAS Build, no custom OTA server. EAS Update only serves compatible JS/assets.

## 1. Why `appVersion`

Current Expo production guidance recommends `appVersion` over experimental `fingerprint`. The native release authority is **one place**:

```text
apps/mobile/app.json → expo.version
```

This version is simultaneously:
- `versionName` in the APK (`android.defaultConfig.versionName`)
- `expo_runtime_version` string in `strings.xml` (`runtimeVersion`)
- `version` and `runtimeVersion` in `release-manifest.json`

Every native change (SDK, native dep, plugin, permission, `runtimeVersion`, package id, Gradle, native file) **MUST** bump `expo.version` and build a new APK. JS-only changes keep the same version/runtime and may use OTA.

## 2. How it works

```
Expo JS + assets  ──appVersion runtimeVersion──>  EAS Update (u.expo.dev)
                                ▲ runtimeVersion == app.json version (string)
APK contains:  expo_runtime_version = 1.0.3 + update URL + expo-channel-name: production
                │
                └── only builds with same runtimeVersion receive the OTA (EAS protocol)
```

Additional client-side guard: before EAS, the app fetches the **latest stable mobile release** (`mobile-vX.Y.Z` with `release-manifest.json`) via a deterministic selector (highest semver among `draft==false` && `prerelease==false` && tag `^mobile-vX.Y.Z$`, paginated `per_page=100`), validates `release-manifest.json`, and blocks OTA if version/runtime differ. Repo-wide `releases/latest` (e.g. `architecture-wave-2-complete`) is **never** used.

## 3. Native vs OTA decision (fail-closed)

Inputs:

```text
local:  Constants.expoConfig.version (e.g. 1.0.2)
        Updates.runtimeVersion (should == 1.0.2 for appVersion policy)

remote: manifest.version
        manifest.runtimeVersion
        manifest.gitSha / apkFile / channel
```

Classification in `lib/updates/native.ts`:

- **Case A:** `remote.version > local.version` → `NATIVE_UPDATE_REQUIRED`
- **Case B:** `remote.version == local.version && remote.runtimeVersion != local.runtimeVersion` → `NATIVE_UPDATE_REQUIRED` (invariant violation, never OTA)
- **Case C:** `remote.version == local.version && remote.runtimeVersion == local.runtimeVersion` → `UP_TO_DATE` → EAS check allowed
- **Case D:** manifest missing/malformed/network/timeout → `ERROR` → `native release status unavailable` (fail closed, **do not** return `UP_TO_DATE` and do not call EAS)

Validated fields: `repository`, `androidPackage`, `version` (strict semver), `runtimeVersion`, `gitSha` (40 hex), `gitRef`, `apkFile`, `channel`. Malformed → `ERROR`.

Service flow (`lib/updates/service.ts` owns the single coordinated check):

```text
CHECKING
 → fetch native manifest once
 → validate / classify
 → if NATIVE_UPDATE_REQUIRED: NATIVE_UPDATE_REQUIRED, STOP, expose latestNativeVersion/runtime/apkUrl
 → if ERROR: ERROR (“native release status unavailable”), STOP
 → if UP_TO_DATE: Updates.checkForUpdateAsync() → OTA_AVAILABLE or UP_TO_DATE
```

One `Check for updates` action → one manifest fetch → one EAS call at most. No duplicate fetches on status changes. Native config uses `checkAutomatically: ON_LOAD` so every cold launch can fetch a newer fix even when a route-level React error boundary catches the current bundle's failure.

States: `IDLE`, `CHECKING`, `UP_TO_DATE`, `OTA_AVAILABLE`, `DOWNLOADING`, `OTA_READY`, `NATIVE_UPDATE_REQUIRED`, `ERROR`.

## 4. App configuration (source of truth)

`apps/mobile/app.json` (authoritative):

```json
{
  "expo": {
    "version": "1.0.2",
    "runtimeVersion": { "policy": "appVersion" },
    "updates": {
      "url": "https://u.expo.dev/0dafbb64-7c1e-49b1-aea1-de1f8159a5e6",
      "fallbackToCacheTimeout": 0,
      "checkAutomatically": "ON_LOAD",
      "requestHeaders": { "expo-channel-name": "production" }
    },
    "extra": { "eas": { "projectId": "0dafbb64-7c1e-49b1-aea1-de1f8159a5e6" } }
  }
}
```

`apps/mobile/eas.json` (minimal — no EAS Build, no custom `update` block):

```json
{
  "cli": { "version": ">= 5.9.1", "appVersionSource": "local" }
}
```

Production channel authority for Blacksmith/CNG is `app.json` `requestHeaders` plus server-side channel created once:

```bash
eas channel:create production
```

Verify:

```bash
eas channel:view production --json --non-interactive
```

After `npx expo prebuild --platform android --clean --no-install`, the generated `android/` contains:

- `android/app/src/main/res/values/strings.xml` → `<string name="expo_runtime_version">1.0.3</string>` (must equal `expo.version`)
- `android/app/src/main/AndroidManifest.xml` → `EXPO_RUNTIME_VERSION`, `EXPO_UPDATE_URL=https://u.expo.dev/0dafbb64...`, `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY={"expo-channel-name":"production"}`

## 5. Update service (`apps/mobile/lib/updates/`)

- `types.ts` — `UpdateServiceState` with `appVersion`, `runtimeVersion`, `channel`, `currentUpdateId`, `latestNativeVersion`, `latestNativeRuntimeVersion`, `latestApkUrl`, `latestNativeReleaseUrl`, `lastCheckedAt`, etc.
- `native.ts` — strict semver, `validateManifest`, `classifyNativeUpdate` (cases A-D), `fetchLatestReleaseManifest` (timeout 8s, fail closed), `buildApkUrlFromManifest`.
- `service.ts` — `getAppUpdateInfo`, `checkForUpdate` (native-first, fail-closed), `downloadUpdate`, `reloadApp` (surfaces `Unable to restart…` and transitions to `ERROR` keeping retry possible), `createUpdateService` state machine (single owner, `isChecking`/`isDownloading`/`isReady`).
- `useAppUpdates.ts` — hooks `useUpdateService`, `useAppUpdateInfo` (no duplicate manifest fetches; UI reads service state).\n- `recovery.ts` — root-route error recovery helper: check server, fetch a newer update or rollback directive, then reload.
- Tests: `native.test.ts` (version/runtime cases, malformed, timeout), `service.test.ts` (native required/error → no EAS call, OTA flow, reload failure), `guard-ota-native.test.mjs` (JS-only vs native dep/SDK/app.json/permission/eas/gradle, lock-only not native).

## 6. UI (`apps/mobile/features/updates/`)

- Route `app/(app)/updates.tsx` → `UpdatesScreenContent` (consistent with `mobileTheme`).
- Profile entry `app/(app)/profile.tsx` links to `/updates`.
- Shows `App version` (`appVersion`), `Runtime version` (`runtimeVersion`), `Channel`, `Update ID`, `Launch` (embedded/update), status badge.
- **Native-required state:** `New app version required — Installed: 1.0.2 · Available: 1.0.3 (runtime 1.0.3). A full APK update is required.` Button `Open official release` → `WebBrowser` to APK URL or `https://github.com/egawilldoit/Ega-House-Platform/releases` (never auto-download).
- **Error state:** if `native release status unavailable` → `Couldn't verify the latest app version. Check your connection and retry.` Otherwise `offline: …` or `Unable to restart…`. No silent “Up to date”.
- **Reload failure:** `service.reload()` on `OTA_READY` that throws → service transitions to `ERROR` with `Unable to restart and apply update. Retry restart.` UI shows banner and keeps retry possible.\n- **Route crash recovery:** the root Expo Router `ErrorBoundary` offers `Recover latest update`, which directly checks/fetches/reloads through `expo-updates` instead of only re-rendering the broken route.

## 7. Publishing OTA (CI — production only)

### One-time setup

1. `EXPO_TOKEN` at `https://expo.dev/settings/access-tokens` → repo Settings → Secrets → `EXPO_TOKEN`.
2. Ensure channel exists (once, with token):
   ```bash
   eas channel:create production
   eas channel:view production --json --non-interactive
   ```
3. No `preview` channel in V1.

### Trigger (manual only)

Actions → *Mobile OTA (EAS Update — production only)* → Run workflow → input `message` (required) → Run. Or:

```bash
gh workflow run mobile-ota.yml --ref main -f message="fix: login alignment"
```

Only `refs/heads/main` may publish production OTA.

### Workflow `mobile-ota.yml` (EAS CLI pinned `13.4.2`)

**Preflight** (12 checks, all must pass, no override-by-warning):

1. `message` required, `refs/heads/main` only.
2. Unified Platform Validation `success` for exact `SHA`.
3. Clean `npm ci --no-audit --no-fund`.
4. `EXPO_TOKEN` present.
5. EAS project ID `0dafbb64…` matches `app.json`.
6. `requestHeaders` production present.
7. Latest **stable mobile** `mobile-vX.Y.Z` release selected deterministically (highest semver, `draft==false`/`prerelease==false`, `release-manifest.json` present, `per_page=100` pagination) via `mobile-release-selector.mjs`; **not** repo-wide `releases/latest`.
8. `androidPackage == com.ega_house.mobile`.
9. `channel == production`.
10. `runtimeVersion == version` (appVersion equality) and `version == app.json expo.version` (same native baseline).
11. `manifest.gitSha` is ancestor of OTA `SHA` (`git merge-base --is-ancestor`).
12. `guard-ota-native.mjs --base <manifest.gitSha> --head <OTA_SHA> --check-ota-safe` → `OTA SAFE` (exit 1 + `OTA BLOCKED / NEW APK REQUIRED` on native diff).

Any failure → `DO NOT PUBLISH`.

**Verify channel exists:**

```bash
eas config --platform android --json --non-interactive
eas channel:view production --json --non-interactive
```

**Publish (exactly once, Android only):**

```bash
eas update \
  --channel production \
  --platform android \
  --message "<message> (sha <sha>, production, <ref>)" \
  --non-interactive \
  --json \
  > eas-update.json \
  2> eas-update.stderr.log
# no retry on failure
jq -e . eas-update.json   # prove JSON
```

Extract `updateId`/`group` from **stdout** JSON only. Upload `eas-update.json`, `eas-update.stderr.log`, `eas-config.json`, `channel.json`, `eas-cli-version.txt`, `release-manifest.snapshot.json` (7d). Record `EAS_CLI_VERSION=13.4.2` in summary.

## 8. Rollback (current EAS CLI)

List and inspect:

```bash
eas update:list --branch production
eas update:view --branch production --json
```

Rollback to previous group (requires group ID where CLI demands it):

```bash
eas update:republish --branch production   # interactive picker, or
eas update:republish --group <previous-group-id> --branch production --non-interactive
# Modern CLI also supports:
eas update:rollback --branch production --non-interactive   # check `eas --help` for required --group in your CLI version
```

Do not preserve outdated `eas update:rollback` examples without verifying current CLI `--help`. Clients on same `runtimeVersion`/`production` channel receive the rollback on next check.

## 9. Native-release procedure (when OTA is not enough)

Changes requiring a new APK (new `expo.version` + new runtime):

- Expo SDK / React Native upgrade
- Native deps (`react-native`, `expo-*` native, `reanimated`, `screens`, `safe-area`, etc.)
- `app.json` `plugins`, `permissions`, `runtimeVersion`, `package`, `updates.requestHeaders`, `version`
- `eas.json` channel changes, native `android`/`ios` files, Gradle.

Guard:

```bash
node scripts/ci/guard-ota-native.mjs --base <LAST_NATIVE_APK_SHA> --head <OTA_SHA> --check-ota-safe   # exit 1 + OTA BLOCKED if native
node scripts/ci/guard-ota-native.mjs --base origin/main --head HEAD --json   # local preview
```

Where `LAST_NATIVE_APK_SHA = manifest.gitSha` from the **highest valid stable `mobile-vX.Y.Z` release** (`scripts/ci/mobile-release-selector.mjs`, `per_page=100`, strict semver, `draft==false`/`prerelease==false`, `release-manifest.json` required, `manifest.version == tag version` && `runtimeVersion == version`).

Production native baseline is **not** repo-wide `releases/latest` (which may be `architecture-wave-2-complete`).

If blocked → **do not OTA** → bump `expo.version` (e.g. `1.0.2` → `1.0.3`), commit, trigger Mobile Delivery (`gh workflow run mobile-delivery.yml --ref main` or tag `mobile-v1.0.3`), wait for Blacksmith APK + `release-manifest.json`, install new APK once, then future JS-only changes may use OTA again:

```text
APK at A → B (JS only) => OTA allowed
APK at A → C (native) => OTA BLOCKED → new APK at C → D (JS only) => OTA allowed again
```

## 10. What can / cannot be OTA

| OTA-safe (same version & runtime) | Requires new APK (new version/runtime) |
|---|---|
| JS/TSX, styling, copy, translations, screen layouts, non-native logic | Expo SDK, RN, native deps, `expo-updates`, `expo-constants`, `reanimated`, etc. |
| Assets (images/fonts) via OTA | Permissions, entitlements, `app.json` native config, package id, Gradle, `android/`/`ios/` files, new native modules |

## 11. Expo project relink baseline (this PR)

Changing the Expo project ID and update URL changes the native embedded configuration and therefore requires a **NATIVE RELEASE**.

- `mobile-v1.0.1` is the one true bootstrap/version baseline. It belongs to the old Expo project and cannot be reused as the canonical project's APK because the relink changes native embedded configuration.
- New `expo.version` (`1.0.2`) → a new Blacksmith APK must be built from merged `main`.
- That APK must be installed once by users.
- `release-manifest.json` for `mobile-v1.0.2` must exist in GitHub Release.
- Future compatible `1.0.2` JS changes may then be delivered via OTA on the new project.

Do **not** publish an OTA before the new-project `mobile-v1.0.2` APK exists.

## 12. Verification (clean checkout)

```bash
npm ci --no-audit --no-fund                    # PASS mandatory (Node 22.23.2 / npm 10.9.8 as CI)
npm run mobile:typecheck                      # tsc PASS
npm run mobile:test                           # 33 suites 213 tests PASS (native, service, guard)
npm run mobile:doctor                         # 18/18 PASS
npm run mobile:bundle                         # expo export android PASS
npm run mobile:prebuild:android               # prebuild PASS
# prove generated config
grep 'expo_runtime_version' apps/mobile/android/app/src/main/res/values/strings.xml  # == 1.0.3
grep 'EXPO_UPDATE_URL' apps/mobile/android/app/src/main/AndroidManifest.xml           # https://u.expo.dev/0dafbb64...
grep 'expo-channel-name.*production' apps/mobile/android/app/src/main/AndroidManifest.xml
npm run check:architecture                    # 21 PASS
npm run ci:purity                             # PASS
npm run test:guardrails                       # 50 PASS
node --test scripts/ci/guard-ota-native.test.mjs  # 11 PASS
npm run lint:changed -- --base origin/main    # 0 regressions
```

`rm -rf apps/mobile/android apps/mobile/.expo` after prebuild (artifacts not committed).

## 13. Current external-unproven items (honest)

- Real `eas update --channel production --platform android` publish requires `EXPO_TOKEN` + `u.expo.dev` — not run in this PR; the new-project channel must be verified before publishing.
- Device proof that a new-project OTA-enabled `1.0.2` APK receives a later OTA requires a new `mobile-v1.0.2` APK, an intermediate `eas update`, and emulator/physical load (ladder L6 remains **NOT PROVEN**).
- `release-manifest.json` authority requires at least one post-merge tag `mobile-v1.0.2` build; until then updater correctly reports `native release status unavailable` rather than `UP_TO_DATE`.

## 14. Broken-OTA recovery hardening (v1.0.3)

The first production OTA exposed a recovery gap: Expo Router's route-level error boundary caught a React render loop and displayed its fallback, so the failure was no longer an uncaught fatal JS error. Meanwhile the native APK used `checkAutomatically: ON_ERROR_RECOVERY`, which disables normal startup update checks. A device that had already cached the broken bundle could therefore keep relaunching it even after a fixed OTA was published.

v1.0.3 closes that gap in two layers:

1. Native config uses `checkAutomatically: ON_LOAD`, so each app launch checks for a newer compatible update and downloads it for the next restart.
2. The root route `ErrorBoundary` exposes an explicit recovery action that calls `checkForUpdateAsync()` → `fetchUpdateAsync()` → `reloadAsync()` for either a newer update or an embedded rollback directive.

Because `checkAutomatically` is native configuration and `runtimeVersion.policy=appVersion`, this recovery hardening requires a new `mobile-v1.0.3` APK. It must not be shipped as an OTA to the existing 1.0.2 runtime.

## 15. References (current docs as authority)

- EAS Update: Getting Started — https://docs.expo.dev/eas-update/getting-started/
- Using EAS Update without EAS Build — https://docs.expo.dev/eas-update/getting-started/#using-eas-update-without-eas-build
- Runtime Versions (`appVersion`) — https://docs.expo.dev/eas-update/runtime-versions/
- expo-updates API — https://docs.expo.dev/versions/latest/sdk/updates/
- Downloading Updates — https://docs.expo.dev/eas-update/download-updates/
- Rollback — https://docs.expo.dev/eas-update/rollback/ (verify `republish`/`rollback` `--group` per your CLI `eas --help`)
- EAS CLI `eas.json` — https://docs.expo.dev/build/eas-json/ & `eas config` / `eas channel:view`
- GitHub Actions + `EXPO_TOKEN` — https://docs.expo.dev/eas-update/github-actions/
