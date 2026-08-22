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
| L6 | android emulator runtime | `adb devices` probe + `getprop sys.boot_completed` | An online, booted emulator is reachable over adb. App-install/launch automation is future work; this level never claims more than adb-level reachability. |
| L7 | physical device runtime | same probe as L6 for non-emulator serials | Same evidence as L6 for an attached physical device. |
| L8 | deployed Hono connectivity | `GET ${MOBILE_PRODUCTION_BASE_URL}${MOBILE_PRODUCTION_HEALTH_PATH:-/health}` expecting HTTP 200 | The deployed backend origin answers on its health route. Requires the env var to be set explicitly so local runs never touch production implicitly. |

## Honesty contract

- A level reports `PASS` only from a command that actually ran and exited 0 in
  that run.
- Levels whose infrastructure is absent print `NOT PROVEN` plus the exact
  missing piece (no adb tooling, no online emulator, `MOBILE_PRODUCTION_BASE_URL`
  unset). `NOT PROVEN` is never treated as PASS.
- Every run ends with `HIGHEST LEVEL PROVEN: L<N>` (or `NONE`). That line is the
  ceiling of what the run proved; claims above it are not backed by the run.
- Exit code is 1 only when an executed level FAILS. `NOT PROVEN` levels are
  visible but do not fail the run.

## Current known ceiling

- Local development and CI both prove **L1–L5**. CI runs the equivalent gates
  (doctor, typecheck, test, bundle) in the unified validation workflow's mobile
  job.
- **L6/L7**: no Android SDK/emulator or physical device exists in CI or the
  standard dev environment, so they report `NOT PROVEN`. To raise the ceiling,
  install adb (`ANDROID_HOME` or `EGA_MOBILE_ADB`) and attach a booted target.
- **L8**: reports `NOT PROVEN` until `MOBILE_PRODUCTION_BASE_URL` is exported
  (optionally `MOBILE_PRODUCTION_HEALTH_PATH`, default `/health`).
