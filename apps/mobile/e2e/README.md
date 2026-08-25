# Mobile E2E smoke harness (Maestro)

Small declarative smoke journeys for the EGA House mobile app. They complement
the automated ladder (`scripts/ci/mobile-verification-ladder.mjs`): the ladder
proves install → launch → liveness → UI-rendered; these flows prove the
*functional* path (login → tasks visible → timer start/stop → logout).

## Why Maestro (decision record)

| Option | Verdict | Reason |
| --- | --- | --- |
| Detox | rejected | Requires native build integration, a Jest runner config, and per-app native deps — heavyweight for this repo's size philosophy. |
| Raw adb scripting | rejected for journeys | The ladder already owns the adb-level smoke chain; hand-rolled tap/log parsing would duplicate it poorly. |
| **Maestro** | **chosen** | Flows are plain YAML committed here; the `maestro` CLI is installed on demand by whoever runs them. Zero npm dependencies added to the workspace. |

## Requirements

- A live Android device or emulator with the EGA House APK installed
  (build via `.github/workflows/mobile-delivery.yml` (artifact `ega-house-apk-<SHA>`) or
  `npm run mobile:prebuild:android` + Gradle).
- The [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro):
  `curl -fsSL "https://get.maestro.dev/cli" | bash` (not committed to this repo).
- Login/timer/task journeys need a deployed API plus a test account
  (Production-Hardening Tasks 3/5 dependency). Without credentials only
  UI-presence assertions on the welcome/login screens will pass.

## Running

```bash
export MAESTRO_APP_ID=com.ega_house.mobile   # matches apps/mobile/app.json
maestro test -e EMAIL=you@example.test -e PASSWORD='***' apps/mobile/e2e/maestro/suite.yaml
# or one journey at a time:
maestro test apps/mobile/e2e/maestro/01-login.yaml
```

CI: Mobile Delivery (`.github/workflows/mobile-delivery.yml`) **does not run Maestro**. It performs only the lean launch smoke (`adb install` → `am start -W` → `pidof` after 10s) on the exact Blacksmith APK. Maestro flows remain a **separate/manual** harness — run locally with `maestro test` against any APK (see `docs/mobile-e2e-flows.md`). Mobile Delivery no longer gates on `00-welcome.yaml` or the ladder; its success is `ANDROID LAUNCH SMOKE = PASS`.
