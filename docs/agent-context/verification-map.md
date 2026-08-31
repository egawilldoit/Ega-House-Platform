# Verification Map — Mobile V1 and Web

Executable evidence for what `origin/mobile-v1` actually does. Generated and maintained by the `scripts/verification/verify.mjs` harness. Regenerate command evidence with:

```bash
npm install            # note: npm ci fails on this lockfile (see Findings F1)
node scripts/verification/verify.mjs          # full matrix
node scripts/verification/verify.mjs --quick  # skips bundle + build
```

This map preserves the repository's evidence distinctions. A label is the **strongest proven** class for that row; lower classes were also true but are not repeated. Nothing here grants runtime evidence that was not executed.

## Baseline

| Item | Value |
|---|---|
| Branch under test | `origin/mobile-v1` @ `58e845840f7d89627c35ba35fab72bff192bbde7` |
| Verification branch | `night/verification` |
| Toolchain | node v24.18.0, expo SDK ~54.0.34, next 16.2.12 |
| Native toolchain | Java 21 present; **no Android SDK, no adb, no emulator** |

## Command matrix (executed)

| Command | Exit | Totals | Evidence class |
|---|---|---|---|
| `npm run mobile:typecheck` | 0 | — | STRUCTURAL PASS |
| `npm run mobile:test` | 0 | 11 suites, 53 tests | UNIT TESTED |
| `npm run mobile:doctor` | **1** | 17/18 checks | STRUCTURAL FAIL (F2) |
| `npm run mobile:bundle` | 0 | android JS bundle exported | BUNDLE PROVEN (Android export ≠ device) |
| `npm run web:typecheck` | 0 | — | STRUCTURAL PASS |
| `npm run web:test` | 0 | 136 files, 987 tests | UNIT TESTED |
| `npm run test:session` | 0 | cookie-options cases | UNIT TESTED |
| `npm run test:timer-recovery` | 0 | conflict-resolution cases | UNIT TESTED |
| `npm run web:build` | 0 | Next.js production build | WEB BUILD PROVEN |
| `ci:purity`, `ci:security`, `ci:workspace`, `check:architecture`, `test:architecture` | 0 | — | STRUCTURAL PASS |

Notes:

- `web:build` requires `DATABASE_URL` at build time even though no connection is made; the harness injects a placeholder when none exists.
- `npm run test:auth-session:e2e` (Playwright): every test self-skips without `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD`; it targets the production domain by default and does not start a local server. **BLOCKED** — credentials unavailable; auth was not faked.
- `npm ci` fails on this checkout: package-lock.json is missing esbuild platform binaries (see F1). Install with `npm install` and restore the committed lockfile afterwards.

## Feature map — MOBILE (apps/mobile)

| Feature | Strongest proven evidence | Detail |
|---|---|---|
| login screen | SOURCE INSPECTED | `app/(public)/login.tsx`; no executable test |
| session restore (bootstrap) | SOURCE INSPECTED | `lib/auth/auth-context.tsx` restore + SecureStore (`lib/storage/session.ts`); no test |
| expired-token refresh (401) | UNIT TESTED | `lib/api/__tests__/refresh-single-flight.test.ts`: real `client.ts` against mocked fetch |
| expired-token refresh (proactive, ≤45 s) | SOURCE INSPECTED | `isSessionNearExpiry` path in auth-context; untested |
| concurrent refresh | UNIT TESTED | 8 concurrent 401s → exactly 1 refresh POST |
| logout | SOURCE INSPECTED | clears SecureStore + state; **does not reset React Query cache** (F3) |
| User A → User B isolation | INTEGRATION TESTED | `lib/api/__tests__/cross-account-isolation.test.ts`: post-swap requests carry only user B's bearer token; cache-lifecycle gap documented in-suite |
| tasks: list/create/edit/status/priority/due | SOURCE INSPECTED | `features/tasks/query.ts`, `lib/api/tasks.ts`; zero executable tests |
| tasks: reminder / recurrence | SOURCE INSPECTED | mutation hooks exist; untested |
| tasks: archive | SOURCE INSPECTED | archive/unarchive wrappers exist; untested |
| tasks: pin/focus | ABSENT | no pin/focus mutation exists on mobile |
| Today board states | SOURCE INSPECTED | `features/today/query.ts` + `/api/mobile/today`; screens untested |
| clear completed | SOURCE INSPECTED | endpoint + hook exist; untested |
| suggestions | ABSENT | no suggestion logic found |
| projects: list/detail/create/status/archive | UNIT TESTED (partial) | delegation + query-keys + slug util + card render; screens untested |
| goals: list/create/edit | UNIT TESTED (partial) | same pattern as projects; screens untested |
| timer start/stop/resume | SOURCE INSPECTED | `app/(app)/(tabs)/timer.tsx` is a local-state pomodoro; **no server persistence, no recovery, no task binding** (F5) |
| timer restart recovery / task binding | ABSENT | contradicts canonical `task_sessions` model; unresolved product decision |
| deep links | SOURCE INSPECTED | scheme `mobile://`, typed routes enabled; no link-handling tests |
| notifications | ABSENT | expo-notifications not installed; menu icon string only |
| AppState / focusManager | ABSENT | no wiring anywhere |
| offline / network transition | ABSENT | no NetInfo dependency or usage |
| Android bundle export | BUNDLE PROVEN | `expo export --platform android --no-bytecode`, 2.74 MB entry |
| Android emulator / device | RUNTIME NOT VERIFIED | no SDK/adb/emulator on this VM |

## Feature map — WEB (apps/web)

| Surface | Strongest proven evidence | Detail |
|---|---|---|
| login page | UNIT TESTED | redirect-target + jsdom navigation-regression suites; browser-level proof blocked (E2E creds) |
| session cookie options | UNIT TESTED | `cookie-options.test.ts` (also `test:session`) |
| proxy/middleware session refresh | SOURCE INSPECTED | `proxy.ts` executes `getClaims()` + cookie copy; tested only via duplicated constants |
| dashboard | UNIT TESTED (lib-level) | helpers/adapters/focus-panel; page component never rendered |
| Today | UNIT TESTED (lib-level) | planner services/builders/adapters; `today/page.tsx` unrendered |
| Tasks | UNIT TESTED (lib-level) | transitions/archive/saved-views/due-date/recurrence libs (68-case service suite among them); page unrendered |
| Projects | SOURCE INSPECTED | page covered only by readFileSync regex assertions |
| Goals | SOURCE INSPECTED | lib coverage only; zero UI tests |
| Timer | UNIT TESTED (lib-level) | recovery/actions/export/service; page unrendered |
| Review | UNIT TESTED (lib-level) | actions/generator/email/heatmap; week-selector is regex-checked |
| responsive/navigation | STRUCTURAL PASS | class-contract + drawer ARIA/keyboard suites; no viewport execution |
| production build | WEB BUILD PROVEN | `next build` exit 0 |
| authenticated E2E | BLOCKED | Playwright suite requires production credentials |

## Security matrix

| Claim | Strongest proven evidence | Detail |
|---|---|---|
| identity never taken from request data | STRUCTURAL PASS | `ci:security` source scan |
| owner-scoped repositories | STRUCTURAL PASS + UNIT TESTED | data-access fakes assert `owner_user_id` filtering |
| RLS policies enforce isolation | SOURCE INSPECTED | migrations assert `owner_user_id = auth.uid()`; **SQL never executed against Postgres** (F9) |
| mobile token isolation across accounts | INTEGRATION TESTED | deterministic Auth+QueryClient seam proof; not production evidence |
| cross-account cache isolation | KNOWN GAP (F3) | logout leaves React Query cache populated |
| authenticated E2E incl. logout re-protection | BLOCKED | needs `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD` |
| production behavior | RUNTIME NOT VERIFIED | nothing in this map was executed against production |

## Cross-platform matrix

| Claim | Strongest proven evidence | Detail |
|---|---|---|
| shared durable truth (tasks/plans/sessions) | SOURCE INSPECTED | mobile API routes → services → `tasks`, `projects`, `goals`, `task_sessions` tables |
| web mutation visible on mobile | RUNTIME NOT VERIFIED | no live two-client execution performed |
| mobile mutation visible on web | RUNTIME NOT VERIFIED | same |
| timer shared truth | KNOWN GAP | mobile timer does not persist sessions at all (F5) |

## Branch-head validation

Checked after `git fetch origin --prune`. Do not merge these branches; validate heads independently in disposable worktrees under `~/ega-worktrees/night/verify-temp/`.

| Branch | SHA | Check | Result | Evidence class |
|---|---|---|---|---|
| night/mobile-stabilization | — | existence | NOT AVAILABLE YET | — |
| night/mobile-features | — | existence | NOT AVAILABLE YET | — |
| night/platform-convergence | — | existence | NOT AVAILABLE YET | — |
| night/web-v2 | — | existence | NOT AVAILABLE YET | — |

## Findings (defects and unresolved decisions)

- **F1 (defect)** `package-lock.json` out of sync on `origin/mobile-v1` — `npm ci` exits 1 (missing esbuild platform binaries). Blocks reproducible installs.
- **F2 (defect)** `mobile:doctor` exits 1: expo/expo-constants/jest-expo at patch versions behind Expo SDK requirements (54.0.36 vs ~54.0.37 etc.).
- **F3 (defect, isolation)** mobile sign-out clears SecureStore/auth state but no code path resets the React Query cache (`staleTime` 30 s, `gcTime` 5 min); user B can observe user A's cached data after account switch. Proven by `cross-account-isolation.test.ts`.
- **F4 (friction)** `next build` throws at page-data collection without `DATABASE_URL`.
- **F5 (gap vs authority)** mobile timer has no server persistence, background/recovery, or task binding despite canonical `task_sessions` ownership.
- **F6 (absent capabilities)** notifications, AppState/focusManager, offline handling, deep-link tests: absent from mobile.
- **F7 (coverage hole)** 12 web test files are excluded from the vitest config and executed by no runner.
- **F8 (trivial test)** `apps/mobile/__tests__/smoke.test.ts` asserts `1+1===2`.
- **F9 (unproven invariant)** RLS validated only as SQL text; no behavioral database evidence exists in this repo.

## Harness

`node scripts/verification/verify.mjs [--quick] [--only=mobile|web|structural]`

- Runs each command with exact exit codes and durations; writes a timestamped JSON result under `scripts/verification/results/` (gitignored).
- Cleans its own generated artifacts (`.expo/ci-export`, `.next`) after capture.
- Exits non-zero when any blocking check fails; `mobile:doctor` is tracked as non-blocking until F2 is fixed.
- Encodes no secrets; placeholder `DATABASE_URL` is build-time only.

## Explicitly unproven claims

No statement in this map supports: emulator/device behavior, push or local notifications, offline transitions, deep-link cold starts, production authentication flows, deployed RLS enforcement, or live cross-platform propagation. All remain RUNTIME NOT VERIFIED or BLOCKED as labeled above.
