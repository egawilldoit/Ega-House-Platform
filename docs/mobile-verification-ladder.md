# Mobile Verification Ladder

One entry point for all mobile verification evidence:

```bash
npm run verify:mobile                  # all levels
npm run verify:mobile -- --levels 1-5  # subset (range or comma list)
npm run verify:mobile -- --json        # machine-readable summary
```

Entry point: `scripts/ci/mobile-verification-ladder.mjs`. Unit tests for its
classification/probe logic: `scripts/ci/mobile-verification-ladder.test.mjs`
(`npm run test:mobile-ladder`).

## Levels

| Level | Name | Underlying machinery | What it proves |
| --- | --- | --- | --- |
| L1 | static/type proof | `tsc --noEmit` over `apps/mobile` (`mobile:typecheck`) + architecture boundaries (`check:architecture`) | The mobile TypeScript compiles and no boundary rules are violated. Nothing about runtime behavior. |
| L2 | mobile unit tests | jest in `apps/mobile`, excluding integration suites | Unit suites pass with module-boundary mocks. |
| L3 | mobile integration tests | jest on `apps/mobile/**/integration.test.(ts|tsx)` (e.g. `lib/api/__tests__/integration.test.ts`, which drives the real TanStack Query → `useTodayWorkspaceQuery` → `fetchMobileToday` → `mobileApiFetch` seam with only `global.fetch` stubbed) | The query/API seam works end to end against a stubbed network. |
| L4 | expo doctor | `expo-doctor` (`mobile:doctor`) | The Expo toolchain and dependency set are healthy. |
| L5 | android bundle export | `expo export --platform android` (`mobile:bundle`) | A production Android JS bundle exports successfully. |
| L6 | android emulator APP runtime | `adb install -r` → `cmd package resolve-activity` → `am start` → `pidof <package>` after `EGA_MOBILE_ALIVE_AFTER_SECONDS` (default 10) → UI evidence (`uiautomator` dump contains probe text OR clean logcat window) against an online booted emulator | The EGA House APP itself runs on an emulator: the APK installs, its launcher activity starts, the process stays alive, and initial UI renders. A merely reachable/booted emulator is **NOT PROVEN**, never PASS. |
| L7 | physical-device APP runtime | same APP-runtime chain for non-emulator serials | Same APP-level evidence as L6 on attached physical hardware. |
| L8 | deployed Hono connectivity | `GET ${MOBILE_PRODUCTION_BASE_URL}${MOBILE_PRODUCTION_HEALTH_PATH:-/health}` expecting HTTP 200 | The deployed backend origin answers on its health route. Requires the env var to be set explicitly so local runs never touch production implicitly. |

### L6/L7 inputs

- Package/activity identity comes from `apps/mobile/app.json`
  (`expo.android.package`, currently `com.ega_house.mobile`) — verified, not
  guessed.
- APK source: `EGA_MOBILE_APK` env var wins when set; otherwise known output
  dirs are scanned (`apps/mobile/android/app/build/outputs/apk/{debug,release}`,
  `apps/mobile/artifacts`). Build one via the manual
  [`mobile-apk-manual.yml`](../.github/workflows/mobile-apk-manual.yml)
  workflow or locally with `npm run mobile:prebuild:android` + Gradle.
- UI probe text: `EGA_MOBILE_UI_PROBE_TEXT` (default: the package name — every
  uiautomator dump of our app's windows carries it).
- Classification per step, in execution order: missing infrastructure →
  `NOT PROVEN`; executed-and-failed → `FAIL`; whole chain ok → `PASS`.
  Booted-device availability alone can therefore never pass L6/L7.

## Honesty contract

- A level reports `PASS` only from a command that actually ran and exited 0 in
  that run.
- Levels whose infrastructure is absent print `NOT PROVEN` plus the exact
  missing piece (no adb tooling, no online emulator, no APK,
  `MOBILE_PRODUCTION_BASE_URL` unset). `NOT PROVEN` is never treated as PASS.
- For L6/L7 specifically: a reachable, booted device is *device availability*,
  not APP proof. The ladder reports `NOT PROVEN` until install → launch →
  liveness → UI evidence all exist. L6/L7 mean **APP runtime on the target**,
  not merely a target being present.
- Every run ends with `HIGHEST LEVEL PROVEN: L<N>` (or `NONE`). That line is the
  ceiling of what the run proved; claims above it are not backed by the run.
- Exit code is 1 only when an executed level FAILS. `NOT PROVEN` levels are
  visible but do not fail the run.

## Current known ceiling

- Local development and CI both prove **L1–L5**. CI runs the equivalent gates
  (doctor, typecheck, test, bundle) in the unified validation workflow's mobile
  job.
- **L6/L7**: no Android target exists in CI or the standard dev environment, so
  they report `NOT PROVEN`. The local path is exhausted by hardware facts, not
  missing effort:
  - Google ships no Linux/ARM64 emulator binary (`sdkmanager --install emulator`
    fails with "Failed to find package 'emulator'" on this host; the repository
    manifest publishes `emulator-linux_x64-*` and `emulator-darwin_aarch64-*`
    only), and modern system images under pure software emulation would be far
    outside any reasonable timebox.
  - ARM64-native Android containers (redroid) need kernel binder support; cloud
    kernels without `CONFIG_ANDROID_BINDER*` cannot provide it.
  - Physical devices cannot be attached to a cloud VM.
  What unlocks L6/L7: an x86_64 runner with KVM (GitHub-hosted `ubuntu-latest`
  exposes `/dev/kvm`; enable group perms per the [Android emulator runner
  docs](https://github.com/ReactiveCircus/android-emulator-runner)) or a
  physical device attached to the machine running the ladder. The full manual/
  automated protocol lives in [`mobile-e2e-flows.md`](mobile-e2e-flows.md) and
  [`apps/mobile/e2e/`](../apps/mobile/e2e/README.md).
- **L8**: reports `NOT PROVEN` until `MOBILE_PRODUCTION_BASE_URL` is exported
  (optionally `MOBILE_PRODUCTION_HEALTH_PATH`, default `/health`). Point it at
  the dedicated Hono origin (`https://ega-api.egawilldoit.online` once the
  deployment in [`docs/architecture/hono-deployment.md`](architecture/hono-deployment.md)
  exists) — never at the web origin, whose Next.js routes do not serve
  `/health`.
