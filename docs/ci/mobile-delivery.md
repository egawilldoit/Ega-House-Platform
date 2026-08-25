# Mobile Delivery — Build Once, Launch Smoke

Lean sideload delivery: **build once → test exact APK → app launches and does not crash**.

## Architecture

```text
PR / push to main
  -> Unified Platform Validation (ubuntu-latest)
       tests / typecheck / Expo doctor / bundle / delivery map
  -> merge to main
  -> Vercel deploys web + Hono API (unchanged)

workflow_dispatch on main  OR  mobile-v* tag
  -> Preflight (ubuntu-latest) — exact SHA + Unified CI gate
  -> Blacksmith build (blacksmith-2vcpu-ubuntu-2404) — one release APK
  -> temporary exact APK artifact (retention 1 day)
  -> GitHub launch smoke (ubuntu-latest) — install + launch + pidof
  -> optional GitHub Release (tags only)
  -> delivery summary
```

No APK is built during normal PR/main CI.

## Why Blacksmith is only for Gradle

Native Android compilation (`./gradlew assembleRelease`) benefits from Blacksmith's colocated cache and isolates expensive minutes. All other verification (TypeScript, Expo doctor, bundle, emulator boot) runs on free `ubuntu-latest`. Blacksmith transparently redirects `actions/setup-node`, `actions/setup-java`, `gradle/actions/setup-gradle` to its cache — no paid Sticky Disk.

## Runner policy

| Runner | Label | When | Cost guardrail |
|---|---|---|---|
| GitHub | `ubuntu-latest` | every PR/push, plus preflight + launch smoke | free for public repo |
| Blacksmith | `blacksmith-2vcpu-ubuntu-2404` | only `workflow_dispatch` or `mobile-v*` tag | 2 vCPU, timeout 40, no matrix, no paid add-ons |

Do not use larger runners, matrices, scheduled builds, or Sticky Disks.

## How to trigger

Manual (main):

```bash
gh workflow run mobile-delivery.yml --ref main
```

No `-f` parameters — manual always builds a **production-connected release APK** and runs launch smoke.

Tagged release (human creates tag, no automation invents it):

```bash
git tag mobile-v1.0.0-rc.1 20060ca
git push origin mobile-v1.0.0-rc.1
# stable:
git tag mobile-v1.0.0 20060ca
git push origin mobile-v1.0.0
```

Tags: `mobile-vX.Y.Z-rc.N` → prerelease, `mobile-vX.Y.Z` → stable. Each builds the exact immutable tag SHA.

## How to find and download the APK

- **Temporary handoff (1 day):** artifact `ega-house-apk-<40-char SHA>` produced by Blacksmith, consumed by launch smoke. Download:

  ```bash
  gh run download <RUN_ID> -n ega-house-apk-<SHA> -D /tmp/apk
  ls /tmp/apk/*.apk
  sha256sum -c /tmp/apk/SHA256SUMS
  ```

  The artifact URL is shown in the Blacksmith job summary and Delivery summary.

- **Permanent (tags):** GitHub Release for the tag contains `ega-house-<version>-<shortsha>-release.apk`, `release-manifest.json`, `SHA256SUMS`.

## Release manifest

```json
{
  "repository": "egawilldoit/Ega-House-Platform",
  "gitSha": "<40-char>",
  "gitRef": "refs/tags/mobile-v1.0.0",
  "version": "1.0.0",
  "variant": "release",
  "androidPackage": "com.ega_house.mobile",
  "apiBaseUrl": "https://ega-api.egawilldoit.online",
  "builtAt": "2026-08-25T11:30:24Z",
  "runner": "blacksmith-2vcpu-ubuntu-2404",
  "architectures": ["arm64-v8a", "x86_64"],
  "apkFile": "ega-house-1.0.0-a9b43ac-release.apk",
  "apkSha256": "<sha256>"
}
```

Deterministic filename `ega-house-<version>-<shortsha>-release.apk`; SHA is authoritative.

## ABI policy — arm64-v8a + x86_64 only

React Native guidance normally targets broader ABI compatibility. This sideload APK intentionally builds **only `arm64-v8a` (modern phones) + `x86_64` (GitHub emulator)** via:

```
-PreactNativeArchitectures=arm64-v8a,x86_64
```

This is **not** Play Store universal distribution. No `armeabi-v7a` or `x86` is compiled. If legacy-device coverage becomes a future requirement, this policy can be revisited.

No AAB, no `bundleRelease`, no Play Store tracks in this workflow.

## Build details

- Checkout exact SHA (`fetch-depth: 1`), Node 22 (`setup-node@v6`), Java 17 (`setup-java@v5`, no Gradle cache there), minimal Android SDK (`setup-android@v4` with `packages: ''` and `log-accepted-licenses: false`), `npm ci`, `expo prebuild --platform android --clean --no-install` with `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_GIT_STATUS=1 EXPO_PUBLIC_API_BASE_URL=https://ega-api.egawilldoit.online`.
- Gradle cache via `gradle/actions/setup-gradle@v6` (`cache-provider: basic`, Blacksmith-redirected). Main builds read/write, tags read-only.
- One `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon --stacktrace -Dorg.gradle.jvmargs=-Xmx4g`. Zero `assembleDebug`, zero `bundleRelease`. `adb install` later is the installability proof.

## Launch smoke contract

```
APK=<downloaded exact APK>  PKG=com.ega_house.mobile

adb install -r "$APK"
COMPONENT=$(adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER "$PKG" | tail -n 1)
# COMPONENT must be non-empty
adb shell am start -W -n "$COMPONENT"   # must exit 0
sleep 10
PID=$(adb shell pidof "$PKG")
# PID non-empty => PASS, else FAIL
```

- Emulator: API 34, `google_apis`, `x86_64`, lean AVD (2 cores, 2048 MB, 720x1280, 320 dpi, 2G data, headless GPU `swiftshader_indirect`), KVM, bounded 6-minute boot.
- Checksum verified via `sha256sum -c SHA256SUMS` and manifest fields (`gitSha`, `apkSha256`, `androidPackage`, `apiBaseUrl`, `architectures`) using `jq` — no Node installed in runtime.
- On **success**: no screenshots, no logcat artifact.
- On **failure**: `launch-failure-logcat.txt` + `emulator.log` uploaded with `retention-days: 1`.

Final status line: `ANDROID LAUNCH SMOKE = PASS` (or `FAIL`).

## Preflight

- Allows only `refs/heads/main` or `refs/tags/mobile-v*`; anything else fails before Blacksmith.
- Single `gh api` query for a **completed successful** `unified-platform-validation.yml` for the exact source SHA. No polling, no `/health`/`/ready`/`/api/projects` probes. If missing: `BLOCKED_CI_NOT_GREEN`.

## GitHub Release

For `mobile-v*` tags, after Blacksmith + launch smoke both PASS, the **same** checksum-verified APK is published to a GitHub Release (prerelease for `-rc.*`). No second build.

## Cost guardrails (encoded in YAML + tests)

- Blacksmith: manual/tag only, 1 job, 2vCPU, ≤40 min, no matrix/emulator/Maestro/Sticky Disk/`useblacksmith/checkout`.
- GitHub: `ubuntu-latest` only, no larger runners, path-aware unified CI, no Gradle in normal CI, APK retention 1 day, no duplicate APK uploads.

Tests: `scripts/ci/feature-delivery-map.test.mjs` + `mobile-delivery-guardrails.test.mjs` (`node --test`).

## No Play Store / No AAB

This workflow is sideload production, not Play Store distribution. No `bundleRelease`, no `.aab`, no store tracks. AAB/Play Console would be a separate future workflow if needed.

## Blacksmith setup

If the GitHub integration is not installed:

1. Open Blacksmith console → authorize/install for org `egawilldoit`
2. Grant access to `Ega-House-Platform`
3. Rerun Mobile Delivery

Do not change the runner back to `ubuntu-latest`.
