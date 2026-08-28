# Mobile OTA Updates — EAS Update without EAS Build

This document is the authoritative guide for OTA (over-the-air) updates for `apps/mobile` via **EAS Update** while APKs remain built by the existing Blacksmith Gradle workflow. It complements `docs/ci/mobile-delivery.md` (native APK delivery).

> **Invariants**
> - Android package `com.ega_house.mobile` unchanged.
> - Expo project ID `73d127b6-c8f6-450c-8d97-2dca8434cd59` unchanged (`extra.eas.projectId`).
> - APKs remain built by `mobile-delivery.yml` → Blacksmith `assembleRelease` + GitHub Releases.
> - No EAS Build, no custom OTA server. EAS Update only serves compatible JS/assets.

## 1. How it works

```
Expo JS bundle + assets  ──fingerprint runtimeVersion──>  EAS Update (u.expo.dev)
                                ▲ runtimeVersion hash (native layer)
                                │
APK (native) contains:  manifest + runtimeVersion string + update URL (prebuild)
                                │
                          Adapts only to: builds with same runtimeVersion
```

- `runtimeVersion: { policy: "fingerprint" }` in `apps/mobile/app.json` ensures a deterministic hash of the native layer (Expo SDK, native deps, config plugins, permissions, etc.). Only builds sharing the same fingerprint can receive the same OTA update. Incompatible runtimes are never offered (EAS protocol).
- Additional client-side guard: before attempting OTA, the app fetches the latest `release-manifest.json` from GitHub Releases. If `remote.version > local.version`, it classifies `NATIVE_UPDATE_REQUIRED` and never attempts OTA. This is a minimal authoritative source — no DB/service.

## 2. Native vs OTA decision logic

```
Local:  Constants.expoConfig.version (e.g. 1.0.0) + Updates.runtimeVersion (fingerprint)
Remote: GET https://api.github.com/repos/egawilldoit/Ega-House-Platform/releases/latest
        → assets[release-manifest.json].browser_download_url → manifest.version

if remote == null         → UP_TO_DATE (no manifest yet)
else if semver(remote) > semver(local) → NATIVE_UPDATE_REQUIRED
else                      → check EAS Update via Updates.checkForUpdateAsync()

EAS returns isAvailable?
  false → UP_TO_DATE
  true  → OTA_AVAILABLE → fetchUpdateAsync() → OTA_READY → reloadAsync() → Updated
```

**States exposed by `lib/updates/service.ts` / native.ts:**

| Status | Meaning |
|---|---|
| `IDLE` | Initial, no check yet |
| `CHECKING` | Verifying native vs remote + EAS |
| `OTA_AVAILABLE` | Compatible JS update found on current channel/runtime |
| `DOWNLOADING` | Fetching update assets |
| `OTA_READY` | Downloaded, ready to reload |
| `UP_TO_DATE` | No compatible OTA and no native required |
| `NATIVE_UPDATE_REQUIRED` | New APK/runtime needed; OTA suppressed |
| `ERROR` | Offline / timeout / disabled / dev mode (graceful, retryable) |

**Never poll aggressively.** `updates.checkAutomatically: "ON_ERROR_RECOVERY"` disables launch polling; checks are manual (“Check for updates”) or on foreground recovery only.

## 3. App configuration (foundation)

`apps/mobile/app.json`:

```json
{
  "expo": {
    "runtimeVersion": { "policy": "fingerprint" },
    "updates": {
      "url": "https://u.expo.dev/73d127b6-c8f6-450c-8d97-2dca8434cd59",
      "fallbackToCacheTimeout": 0,
      "checkAutomatically": "ON_ERROR_RECOVERY"
    },
    "extra": { "eas": { "projectId": "73d127b6-c8f6-450c-8d97-2dca8434cd59" } }
  }
}
```

After `npx expo prebuild --platform android --clean --no-install`, the generated native project contains:

- `android/app/src/main/AndroidManifest.xml` → `expo.modules.updates.EXPO_UPDATE_URL = https://u.expo.dev/...`
- `android/app/src/main/res/values/strings.xml` → `expo_runtime_version` (fingerprint hash)

`apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 5.9.1" },
  "build": {
    "production": { "channel": "production" },
    "preview": { "channel": "preview" }
  },
  "update": {
    "production": { "channel": "production" },
    "preview": { "channel": "preview" }
  }
}
```

### Channels

- `production` — user-facing APKs + production OTA
- `preview` — internal preview builds + staged OTA validation

APKs built for `production` only receive `production` branch updates. `preview` APKs only receive `preview`. Promotion is a new publish to the target channel.

## 4. Update service (`apps/mobile/lib/updates/`)

- `types.ts` — shared types, `ReleaseManifest`, `UpdateStatus`
- `native.ts` — GitHub `release-manifest.json` fetch + `classifyNativeUpdate` + semver compare. Timeout 8s, offline mapped to `ERROR`.
- `service.ts` — Expo `expo-updates` abstraction: `getAppUpdateInfo`, `checkForUpdate`, `downloadUpdate`, `reloadApp`, `createUpdateService` (state machine with `isChecking`/`isDownloading`/`isReady`/`error`). Graceful handling of offline, timeout, `isEnabled===false`, `__DEV__`. No aggressive polling.
- `useAppUpdates.ts` — React hooks `useAppUpdateInfo`, `useUpdateService`, `useAppUpdatesFlow`
- Tests: `lib/updates/__tests__/native.test.ts`, `service.test.ts`

**Key guard:** `checkForUpdate` first runs `checkNativeUpdateRequired`; if `NATIVE_UPDATE_REQUIRED`, it returns immediately without calling `Updates.checkForUpdateAsync()`. Incompatible native updates are never loaded as OTA.

## 5. UI (`apps/mobile/features/updates/`)

- Route: `app/(app)/updates.tsx` → `UpdatesScreenContent` (consistent with `mobileTheme`, `Card`, `Button`, `FeedbackBanner`, `ScreenHeader`, `AppScreen`)
- Profile entry: `app/(app)/profile.tsx` adds “App Updates” card linking to `/ (app)/updates`
- Displays: app version (`Constants.expoConfig.version`), runtimeVersion (`Updates.runtimeVersion`), channel (`Updates.channel`), update ID (`Updates.updateId`), launch type, status badge.

**User flows:**

OTA:
```
Idle → Check for updates (CHECKING) → Update available (OTA_AVAILABLE)
     → Download update (DOWNLOADING) → Ready to restart (OTA_READY)
     → Restart & update (reloadAsync) → Updated (on next launch UP_TO_DATE)
```

Native:
```
Checking → New app version required (NATIVE_UPDATE_REQUIRED)
        ↳ shows latest version, reason (“Native changes require new APK: SDK, native deps, permissions, plugins”), and button “Open releases page” → `https://github.com/egawilldoit/Ega-House-Platform/releases` (or direct APK URL from manifest) via `expo-web-browser` (never auto-downloads APK)
```

Error/Offline:
```
ERROR badge + concise message (“offline: …”) + retry hint. Retry is safe and rate-limited.
```

## 6. Publishing OTA updates (CI)

### Setup — EXPO_TOKEN

1. Create token at `https://expo.dev/settings/access-tokens` (Expo account that owns project `73d127b6-c8f6-450c-8d97-2dca8434cd59`).
2. Add GitHub secret: Repo Settings → Secrets and variables → Actions → **New repository secret** name `EXPO_TOKEN`, value `<token>`.
3. Never commit the token. Workflow fails fast if missing.

### Publishing — `mobile-ota.yml` (`workflow_dispatch` only)

Production publish is **explicit/manual** initially (no push auto-publish). Requires Unified CI green for the exact SHA before publish.

Trigger:

- GitHub UI: Actions → *Mobile OTA (EAS Update)* → Run workflow → choose `channel=production|preview`, enter `message` → Run
- CLI: `gh workflow run mobile-ota.yml --ref main -f channel=production -f message="fix: login alignment"`

Workflow steps:

1. **Preflight** (ubuntu-latest):
   - Validate `channel` + `message` + production only from `main`/`mobile-v*`
   - Single `gh api` query: Unified Platform Validation must be `success` for exact `HEAD SHA`; else `BLOCKED_CI_NOT_GREEN`
   - Run `guard-ota-native.mjs` (warning if native-sensitive diff vs `origin/main`)

2. **Publish** (ubuntu-latest):
   - Fail if `EXPO_TOKEN` missing
   - Checkout exact `SHA`, `setup-node@22`, `expo-github-action@v8` (`eas-version: latest`, `token: EXPO_TOKEN`)
   - `npm ci`, verify `runtimeVersion` fingerprint policy + `npx expo fingerprint:generate --platform android` (where available)
   - `eas update --channel <channel> --message "<message> (sha <sha>, channel <channel>, <ref>)" --non-interactive` (with `--json` evidence fallback). Output saved to `eas-update.json`.

3. **Evidence** (summary + artifact):
   - Step summary table: channel, message, SHA, ref, `updateId`/`group` (from `eas-update.json`), `EXPO_PROJECT_ID`, runtime policy
   - Artifact `eas-ota-<channel>-<sha>` containing `eas-update.json` + fingerprint, retention 7 days

The Blacksmith APK workflow is **preserved unchanged** (still builds `arm64-v8a+x86_64` release APK on `workflow_dispatch`/`mobile-v*` tag). OTA never replaces APK delivery.

### Recording exact Git SHA / update identity / message

- Message embeds `sha`, `channel`, `ref`: `"$MESSAGE (sha $SHA, channel $CHANNEL, $REF)"`
- `eas-update.json` captured (JSON output of `eas update` where CLI supports it) uploaded as artifact
- Summary posts `update_id`/`group` from JSON

## 7. Rollback

EAS Update provides safe rollback without a new binary:

```bash
# View recent updates
eas update:list --branch production
eas update:view --branch production

# Rollback to previous update (preferred — creates rollback-to-embedded or previous group)
eas update:rollback --branch production --non-interactive

# Or republish a known good group/branch
eas update:republish --group <group-id> --branch production
eas update:republish --branch production   # interactive picker

# Rollout control (if rollout_percentage used)
eas update:revert-update-rollout
eas channel:rollout   # branch-based rollouts
```

If the rollback itself is an update, clients on the same `runtimeVersion`/`channel` will download it on next check (manual or `ON_ERROR_RECOVERY`).

## 8. Native-release procedure (when OTA is not enough)

Changes that **require a new APK** (new runtimeVersion/fingerprint):

- Expo SDK upgrade
- Adding/removing/upgrading native dependencies (`react-native`, `expo-*` native modules, `reanimated`, `screens`, `safe-area`, etc.)
- Config plugins or permissions (`app.json` `plugins`, `android.permissions`, `ios.infoPlist`)
- `android.package` / `ios.bundleIdentifier` changes
- `runtimeVersion` policy changes

Guard: `scripts/ci/guard-ota-native.mjs`

```bash
# Local check before OTA
node scripts/ci/guard-ota-native.mjs --base origin/main --head HEAD
node scripts/ci/guard-ota-native.mjs --check-ota-safe  # exit 1 if native change detected

# In CI: OTA workflow preflight runs guard-ota-native; manual dispatch still requires human judgment
```

If guard reports `requiresNative`:

1. Do **not** publish OTA.
2. Bump `apps/mobile/app.json` `version` (semver) if needed.
3. Commit native change.
4. Trigger Mobile Delivery: `gh workflow run mobile-delivery.yml --ref main` or tag `mobile-vX.Y.Z` (or `mobile-vX.Y.Z-rc.N` for RC).
5. Wait for Blacksmith build + launch smoke + `release-manifest.json` artifact + GitHub Release (for tags).
6. Installer distributes new APK (`https://github.com/egawilldoit/Ega-House-Platform/releases`). Clients will see `NATIVE_UPDATE_REQUIRED` via the in-app checker until they update.
7. After new APK is live, you may resume OTA for JS-only changes on the new fingerprint.

## 9. Offline / failure / retry

- All network calls have timeouts (native check 8s, OTA check 15s, fetch 30s).
- Offline/timeout maps to `ERROR` with prefix `offline: …`, shown via `FeedbackBanner` tone `danger`.
- Retry re-runs `checkNativeUpdateRequired` then `checkForUpdateAsync`; no exponential backoff polling loop, no aggressive auto-retry.
- Dev mode / `isEnabled===false` gracefully returns `UP_TO_DATE` (no fake success).

## 10. Security

- No secrets in repo or manifest. `EXPO_TOKEN` lives only in GitHub Secrets.
- Manifest is public (GitHub Release asset). No PII.
- APKs are never auto-downloaded/installed by the updater; user must explicitly open the GitHub Releases page.

## 11. Verification (what we proved)

Run from repo root:

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:doctor
npm run mobile:bundle          # expo export --platform android
npm run mobile:prebuild:android # expo prebuild --platform android --clean --no-install
npm run test:architecture
npm run test:guardrails
```

CI: `unified-platform-validation.yml` → `mobile` job runs doctor/typecheck/test/bundle; `mobile-ota.yml` preflight gates on that CI SHA. `mobile-delivery.yml` still gates on same CI before Blacksmith and launch smoke.

## 12. Remaining unproven external evidence

- Real `eas update` publication requires `EXPO_TOKEN` plus network to `u.expo.dev` — not run in this PR; documented above.
- Device proof that one OTA-enabled APK receives a subsequent JS update requires two successive APK builds with same fingerprint (native) and an intermediate `eas update` — would need Blacksmith + physical/emulator load; smoke ladder L6 verifies APK launch not OTA apply.
- GitHub Releases `release-manifest.json` is the source of truth only after at least one tag build post-merge; until then, the fallback returns `UP_TO_DATE`.

## 13. References

- EAS Update: Getting Started — https://docs.expo.dev/eas-update/getting-started/
- Using EAS Update without EAS Build — https://docs.expo.dev/eas-update/getting-started/#using-eas-update-without-eas-build
- Runtime Versions — https://docs.expo.dev/eas-update/runtime-versions/
- expo-updates API — https://docs.expo.dev/versions/latest/sdk/updates/
- Downloading Updates — https://docs.expo.dev/eas-update/download-updates/
- Rollouts / Rollbacks — https://docs.expo.dev/eas-update/rollouts/ & https://docs.expo.dev/eas-update/rollbacks/
- GitHub Actions + EXPO_TOKEN — https://docs.expo.dev/eas-update/github-actions/
- Fingerprint — https://docs.expo.dev/versions/latest/sdk/fingerprint/
