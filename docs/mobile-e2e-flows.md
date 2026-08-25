# Mobile E2E Device Flow Protocol

Reusable manual/automated protocol for proving the EGA House Android app on a
real target (emulator or physical device). The automated ladder
(`scripts/ci/mobile-verification-ladder.mjs`) covers steps 1–2; everything else
is executed per this document until an emulator CI job exists (needs an
x86_64+KVM runner — see [`mobile-verification-ladder.md`](mobile-verification-ladder.md)).

Conventions used by every step:

- `SERIAL` — `adb devices` serial (`emulator-*` = emulator, anything else =
  physical). Record it in the evidence for every step.
- `PKG` — `com.ega_house.mobile` (from `apps/mobile/app.json`
  `expo.android.package`; re-read there if app config changes).
- APK source: build via `.github/workflows/mobile-delivery.yml` (Mobile Delivery — Blacksmith build, temporary artifact `ega-house-apk-<SHA>`, or GitHub Release for tags) or locally with
  `npm run mobile:prebuild:android`, then `./android/gradlew assembleDebug`.
- Screenshot evidence: `adb -s $SERIAL exec-out screencap -p > stepNN.png`.
  Logcat window: start from `adb -s $SERIAL logcat -c`, capture with
  `adb -s $SERIAL logcat -d > stepNN.logcat`.
- **Deps column**: `none` = needs only a booted target + APK;
  `API` = deployed backend required (Production-Hardening Task 5);
  `creds` = test account credentials required (Task 3).

## Flow checklist

| # | Step | How to execute | Evidence to capture | Pass criteria | Deps |
| --- | --- | --- | --- | --- | --- |
| 1 | Install | `adb -s $SERIAL install -r ega-house-debug.apk` | command output, APK sha256sum | exit 0, `Success` | none |
| 2 | Launch | `adb -s $SERIAL shell am start -n "$(adb -s $SERIAL shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $PKG \| tail -1)"`; after 10s `adb -s $SERIAL shell pidof $PKG` | resolved component, pid, logcat window, screenshot | activity starts, process alive ≥10s, no `FATAL EXCEPTION`, welcome/login UI on screen | none |
| 3 | Login | Welcome → "Get started" → enter `$EMAIL`/`$PASSWORD` → tap "Login" | screenshot before/after, logcat (token exchange errors), HTTP host hit | lands on `(app)/(tabs)/tasks` with tab bar visible | API, creds |
| 4 | Session restore | Kill app (`am force-stop $PKG`), relaunch via step-2 launch command | screenshot of restored screen, secure-store presence check in logcat is NOT required | app opens directly into `(app)` tabs without prompting login (SecureStore key `ega.mobile.session`) | API, creds |
| 5 | Tasks list | Tap "Tasks" tab | screenshot, `uiautomator dump` XML | task rows render (or honest empty state); no error banner | API, creds |
| 6 | Today view | Tap "Today" tab | screenshot, dump XML | today content renders consistent with task/goal data | API, creds |
| 7 | Create/edit task | Tasks → create flow (`/(app)/tasks/create`): fill title, save; reopen and edit title | screenshots of form + list, mutation result in UI | new task appears in list; edit persists after pull-to-refresh | API, creds |
| 8 | Goals | Tap "Goals" tab; open `goals/[id]` detail and `goals/create` | screenshots | goal detail/create screens render without crash | API, creds |
| 9 | Projects | Tap "Projects" tab; open `projects/[slug]` detail and `projects/create` | screenshots | project screens render without crash | API, creds |
| 10 | Timer start | Timer tab → select open task → tap "Start timer" | screenshot with running clock, logcat window, recorded `startedAt` shown in UI | active session appears with elapsed clock ticking | API, creds |
| 11 | Background | Press Home (or `input keyevent KEYCODE_HOME`); wait 60–120s; optionally toggle airplane-safe idle | timestamps: background at T0, return at T1 | process still alive (`pidof $PKG`); no fatal in logcat during background | API, creds |
| 12 | Return to foreground | Re-launch via recents or `am start` again | screenshot immediately on return | app resumes to timer screen without restart-from-splash | none |
| 13 | Reconcile | Observe elapsed clock after return vs wall time between T0/T1 | clock value, expected projected value (compute `T1-T0` + pre-background seconds) | displayed elapsed ≈ true elapsed (TanStack refetch on focus via focus-manager) within tolerance ±5s | API, creds |
| 14 | Timer stop | Tap "Stop timer" | screenshot, resulting session entry visible | session closes; tracked total reflects reconciled duration | API, creds |
| 15 | Logout | Profile tab → "Sign out" | screenshot, logcat | returns to public welcome screen ("Get started") | creds |
| 16 | Second account | Sign in with account B (`$EMAIL_B`/`$PASSWORD_B`) | screenshots of tasks/today | B's data renders; no A-owned rows visible | API, creds ×2 |
| 17 | No cache leak | As B, inspect persisted state: clear app data variant — run `run-as $PKG ls files/` where debuggable, else verify via UI absence after step 16 plus fresh-install check (uninstall/reinstall → login as B first) | command outputs/screenshots | no A-account task/goal/project titles render under B; SecureStore holds only B's session | API, creds ×2 |
| 18 | Network loss | Enable airplane mode (`svc wifi disable`, `svc data disable` on emulator), trigger refresh (pull-to-refresh on tasks) | screenshot of error/empty state, logcat fetch errors | graceful failure state, no crash; disable airplane mode → data reloads | API, creds |
| 19 | Deep link | `adb -s $SERIAL shell am start -a android.intent.action.VIEW -d "mobile://tasks"` (scheme from `app.json` `expo.scheme`) | resolved activity in logcat, screenshot | app routes to tasks screen when authenticated; to welcome/login when not | API, creds |

## Evidence bundle

For each protocol execution collect into one dated directory:

1. `serial.txt` — `adb devices -l` full output.
2. `apk.txt` — APK filename + `sha256sum`.
3. `stepNN.png` / `stepNN.logcat` per table row.
4. Final ladder run at the same head: `npm run verify:mobile -- --json`.

A protocol run may be cited as APP-runtime evidence only when every claimed
step's artifacts exist; partial bundles must be reported as partially proven,
never extrapolated.

## Automated CI status (`.github/workflows/mobile-delivery.yml`)

Mobile Delivery is the single orchestrated sideload workflow: GitHub preflight (exact-SHA Unified CI gate) → Blacksmith release APK build (arm64-v8a + x86_64, one `assembleRelease`) → GitHub **launch smoke** on that exact binary (`adb install`, resolve launcher, `am start -W`, `pidof` after 10s). No Maestro, no authenticated flows, no UI assertions — see `docs/ci/mobile-delivery.md`. Production API `https://ega-api.egawilldoit.online` remains the embedded `EXPO_PUBLIC_API_BASE_URL` but is **not** probed by preflight.

Maestro flows (`apps/mobile/e2e/maestro/**`) and the `mobile-verification-ladder.mjs` remain in the repository as **separate/manual** verification capabilities and are **not** executed by Mobile Delivery. Each Mobile Delivery run uploads failure-only diagnostics (`launch-failure-logcat.txt` + `emulator.log`, retention 1 day) only when `pidof` is empty.

| Capability | In Mobile Delivery? | Where? |
| --- | --- | --- |
| `adb install` + launch + pidof | Yes | GitHub launch smoke |
| Ladder L6 / uiautomator / Maestro 00-welcome | No | Manual/local only |
| Authenticated flows (login/tasks/timer) | No | Manual/local only |

See `docs/ci/mobile-delivery.md` for the full delivery graph and `apps/mobile/e2e/README.md` for Maestro as a separate harness.
