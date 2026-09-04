# Wave 06 — Mobile Runtime Audit

Date: 2026-09-04 UTC
Branch: `wave/06-mobile-runtime-audit`
Base: `origin/main` at Wave 05 merge (rebuilt; historical stacked Wave06 tip
preserved under local backup `backup/wave06-pre-reconcile-1eaa8e14`, not pushed).
Scope: investigation and evidence only; no mobile product code was changed.

## Audit result

STATIC/TEST/BUNDLE VERIFIED through the Android bundle boundary. RUNTIME NOT
VERIFIED for app-level Android execution: no emulator or physical device is
attached in this environment and no APK is available. The deployed Hono health
endpoint is RUNTIME VERIFIED reachable (read-only `/health` probe, HTTP 200)
when its origin is supplied explicitly.

```text
Code gate: PASS through L5
Runtime gate: L1-L5 PASS; L6/L7 NOT PROVEN; L8 PASS (explicit probe only)
Product gate: runtime product behavior NOT VERIFIED without an Android target
Review gate: evidence-only audit; no implementation finding to review
Result: ACCEPTED — EXTERNAL DEVICE EVIDENCE NOT AVAILABLE
```

This result does not claim that the Android app has no runtime defects. It
records that the app target required to reproduce or rule out those defects
was unavailable.

## Environment evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Repository/worktree | PASS | Isolated worktree at `.worktrees/wave-06-mobile-runtime-audit`; branch reset to `origin/main`, clean `git status`. |
| Android bridge | PASS | `/usr/bin/adb` installed; daemon starts. |
| Android target | RUNTIME NOT VERIFIED | `adb devices -l` returned only `List of devices attached`; no serial present. |
| Emulator tooling | RUNTIME NOT VERIFIED | `emulator` and `sdkmanager` are not installed on this host (`which` returns nothing). |
| APK | RUNTIME NOT VERIFIED | No local APK under `apps/mobile` output/artifact paths; bundle export is JS evidence, not an installable APK. `apps/mobile/.expo/ci-export` is gitignored build output. |
| Dependencies | PASS | Existing workspace `node_modules` reused; no reinstall performed. |

## Verification ladder

Full command:

```bash
npm run verify:mobile -- --json
```

Full-run result: exit `0`; highest level proven by that run: `L5`.

| Level | Result | Evidence |
| --- | --- | --- |
| L1 static/type | STATIC VERIFIED (PASS) | `mobile:typecheck` (`tsc --noEmit`) clean; architecture boundary checks green; no mobile imports of `@ega/application`, `@ega/data-access`, root `src/db`, `drizzle`, `apps/web`, or `apps/server` internals (grep over app/components/hooks/services/providers/lib, excluding tests). |
| L2 mobile unit | TEST VERIFIED (PASS) | 38 suites, 238 tests passed, 0 snapshots. |
| L3 mobile integration | TEST VERIFIED (PASS) | 1 integration suite, 2 tests passed (`lib/api/__tests__/integration.test.ts`). |
| L4 Expo Doctor | STATIC VERIFIED (PASS) | 18/18 checks passed; no issues detected. |
| L5 Android bundle | BUNDLE VERIFIED (PASS) | `expo export --platform android` produced `apps/mobile/.expo/ci-export` (Android JS bundle `entry-*.js`, ~3.09 MB). |
| L6 emulator app | RUNTIME NOT VERIFIED | No emulator in `device` state: `adb devices -l` had no attached target. |
| L7 physical app | RUNTIME NOT VERIFIED | No physical device in `device` state. |
| L8 deployed Hono | RUNTIME NOT VERIFIED in the full default run | `MOBILE_PRODUCTION_BASE_URL` was intentionally unset, so the default run did not touch a deployed origin. |

Explicit, read-only connectivity probe using the dedicated Hono origin named
by the deployment documentation:

```bash
MOBILE_PRODUCTION_BASE_URL=https://ega-api.egawilldoit.online \
  npm run verify:mobile -- --levels 6-8 --json
```

Result: exit `0`; L6 and L7 remained `NOT PROVEN`; L8 returned HTTP `200`
from `https://ega-api.egawilldoit.online/health` (~1.3 s).

The L8 result proves backend health connectivity only. It does not prove that
the Android app can reach, authenticate to, or use that backend. No
screenshots, logcat, uiautomator, emulator, or authenticated Android flows
were executed, and none are claimed.

## Reachable route inventory

The route tree was inspected at the current base. A source route is not
treated as runtime proof. All routes below are STATIC VERIFIED present;
Android runtime is RUNTIME NOT VERIFIED for every one (no target).

### Primary tabs (5)

| Surface | Expo route | Source inspection |
| --- | --- | --- |
| Today | `/(app)/(tabs)/today` | Present; query, focus refresh, task status actions, Health snapshot, notification entry point. |
| Work | `/(app)/(tabs)/work` | Present; one surface switches between Tasks and Projects modes. |
| Goals | `/(app)/(tabs)/goals` | Present; list and create/detail navigation wired. |
| Timer | `/(app)/(tabs)/timer` | Present; server-backed start/stop workspace and execution evidence UI. |
| Inbox | `/(app)/(tabs)/inbox` | Present; capture, archive/restore, retry, empty and mutation feedback paths wired. |

Tasks and Projects are modes inside the Work tab; there is no separate
`Tasks` tab route and no `Projects` tab route. This mismatch with older
verification wording is recorded in the ledger below, not inferred to be a
product defect.

### Secondary routes

| Surface | Route(s) inspected |
| --- | --- |
| Tasks | `/(app)/tasks`, `/(app)/tasks/create`, `/(app)/tasks/[id]` |
| Projects | `/(app)/projects`, `/(app)/projects/create`, `/(app)/projects/[slug]` |
| Goals | `/(app)/goals/create`, `/(app)/goals/[id]` |
| Search | `/(app)/search` |
| Friction | `/(app)/friction` |
| Weekly Review | `/(app)/review` |
| Notifications | `/(app)/notifications` |
| Profile | `/(app)/profile` |
| Settings | `/(app)/settings/notifications` |
| Updates | `/(app)/updates` |

### Guards and boundaries

| Surface | Source inspection |
| --- | --- |
| Root index | `app/index.tsx`: waits for auth readiness, redirects authenticated actors to `/(app)/(tabs)/today`. |
| Auth guard | `app/(app)/_layout.tsx`: unauthenticated actors redirect to `/(public)/welcome` via `useAuth`. |
| Public routes | `app/(public)/welcome`, `app/(public)/login` present. |
| Error boundary | `app/_layout.tsx` exports an `ErrorBoundary`. |
| Not-found | `app/+not-found.tsx` present. |

Startup and Shutdown have no mobile routes at this base; they remain a
capability matrix gap rather than an unverified reachable screen.

## Runtime issue ledger

The following ledger distinguishes infrastructure limits from app defects.
No app P0/P1 claim is made from source inspection or unit tests. No defect
found here blocks Wave 06 verification; reproducible P0/P1 app defects, if
any, belong to the Wave 07 repair owner.

| ID | Screen/scope | Severity | Reproduction | Expected | Actual | Evidence | Failing layer | Root-cause status | Recommended owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOB-06-001 | All Android screens | Verification blocker | Run `adb devices -l`, then attempt the L6/L7 launch protocol. | A booted emulator or attached device should provide a serial for install, launch, liveness, and UI evidence. | No target serial; launch protocol could not start. | `adb devices -l` output; ladder L6/L7 `NOT PROVEN`. | External device infrastructure | Confirmed environmental blocker; not an app defect. | Mobile CI/device environment; carry into Wave 07/09. |
| MOB-06-002 | App installation/launch | Verification blocker | Resolve an APK from the documented output paths and run `adb install -r`. | A built APK should be available for L6/L7. | No local APK was available; bundle export is JS evidence, not an installable APK. | APK path scan; ladder L5 PASS and L6/L7 `NOT PROVEN`. | Build artifact/device boundary | Confirmed missing external artifact for local app runtime. | Mobile delivery/device environment. |
| MOB-06-003 | Authenticated flows | Verification dependency | Execute login, session restore, mutations, network-loss, and cross-account flows. | Test credentials and a target app should produce observable authenticated UI and requests. | Not executed; no device and no authorized test credentials were available. | `docs/mobile-e2e-flows.md` dependency labels; L8 health-only probe. | Runtime credentials/app boundary | Unverified; no application root cause can be assigned. | Wave 07 runtime owner when a target/credentials exist. |
| MOB-06-004 | Tasks/Projects navigation documentation | P2 documentation | Follow the device protocol's "lands on `(app)/(tabs)/tasks`" login destination and "Tap `Projects` tab" step against the current route tree. | Protocol should identify the current discoverable Tasks and Projects entries and the current post-login route. | Current source exposes Tasks and Projects through the Work tab, and the authenticated root redirect lands on `today`, not `(tabs)/tasks`. | `app/(app)/(tabs)/_layout.tsx`, `work.tsx`, `app/index.tsx`, and `docs/mobile-e2e-flows.md` rows 3 and 9. | Living verification documentation | Root cause confirmed as stale protocol wording; no runtime product judgment made. | Wave 14 documentation reconciliation. |

No crash, fatal log, API mismatch, dead navigation, or mutation failure was
observed because no Android app session could be started. That is an absence of
execution, not evidence that those classes of defect are absent.

## Source/test seam observations for the next wave

These are handoff observations, not runtime claims:

- the protected layout redirects an unauthenticated actor to the public
  welcome route;
- list and detail flows expose loading/error/empty or retry paths in the
  inspected source;
- Today, Friction, Tasks, Projects, and Goals use focus refresh patterns;
- Timer relies on query invalidation and the focus manager rather than a
  render-triggered focus refetch;
- search uses debounced input and explicit query refetches;
- the mobile unit/integration suites cover the existing query and API seams;
- mobile imports remain behind the API-client/contracts boundary at L1.

Wave 07 should use a real target to validate these observations before calling
them runtime behavior. The issue ledger is intentionally not a license to
patch any of these paths without reproduction.

## Acceptance checklist

- [x] Primary and secondary source routes inventoried at the current base.
- [x] Runtime ladder L1-L5 executed at this base (exit 0).
- [x] L6 emulator attempt made; no target, so RUNTIME NOT VERIFIED.
- [x] L7 physical-device attempt made; no target, so RUNTIME NOT VERIFIED.
- [x] L8 explicitly attempted against the documented Hono origin; HTTP 200.
- [x] Runtime issue ledger records unavailable evidence and ownership.
- [x] No product code was changed speculatively during the audit.
- [x] No production database mutation or deployment was performed.
- [ ] Authenticated Android UI and mutation flows — requires external target and test credentials.
- [ ] Screenshots/logcat/uiautomator evidence — requires external target.

Next wave: use this ledger as the evidence boundary for mobile API/runtime
repair. Do not elevate source or mocked-test observations into Android runtime
proof.
