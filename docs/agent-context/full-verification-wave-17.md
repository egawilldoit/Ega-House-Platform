# Wave 17 — VM Recovery + Final Convergence Closeout

Status: VERIFIED — REVIEW PASS (C0/I0), ALL MERGED

## Starting main

- Pre-Wave-17 `origin/main`: `6a465217c5dcae1c2170505b7f32a50ccb4c538c`
- Final `origin/main`: `bc8805d67941c7c17ccdb6aec0f6ef9d1e493dfd`
- Rule followed: recover valid behavior on the current architecture; no stale
  branch resurrected wholesale. Merges sequential; analyses parallel.

## W17.1 Task Detail → Add to Today — RECOVERED

- Classification: valid behavior, was uncommitted on
  `recovery/task-detail-add-to-today`.
- Change: `TaskDetailScreen` gains an `Add to Today` action over the existing
  `useAddTaskToTodayMutation` (pending `Adding...`/disabled, `Added to Today.`
  success, recoverable error). No second Today owner, no legacy endpoint, no
  schema/native change. Test: `task-detail-add-to-today.test.tsx` (4 tests).
- Gates: typecheck PASS, focused 4/4, mobile 48/268, arch/purity/security/
  workspace PASS, doctor 18/18, bundle PASS, OTA SAFE.
- PR #231, head `6157331394b92adef5723640eb0421a5ff61f796`, exact-head CI
  green, review C0/I0 → merge `61bf44ffb41c6e3fd0cfd730f14676c6537a8938`.
- Supersedes `mobile-v1-ws/08-task-actions` (archive portion already contained
  on main via `useArchiveTaskMutation` + `TasksListView`; pin has server
  endpoints but no mobile contract wiring and no wave acceptance — out of
  scope, not a blocker).

## W17.2 Dead mobile template cleanup — RECOVERED

- Classification: valid deletions, re-proved file-by-file on current main
  (fresh branch, not a cherry-pick of `mobile-v1-ws/07-cleanup`).
- Deleted (one dead cluster + orphaned palette + dead test): `EditScreenInfo`,
  `ExternalLink`, `StyledText`, `Themed`, `StyledText-test.js`,
  `useClientOnlyValue(.web)`, `constants/Colors` (only importers were the
  deleted files). Kept live lookalikes: `useColorScheme` (used by
  `app/_layout`), `motion/AnimatedPressable`, `expo-web-browser` dep (used by
  `UpdatesScreen`). Baseline pruned 39E/53W → 38E/52W.
- Gates: typecheck PASS, mobile 47/267 (minus deleted suite), doctor/bundle
  PASS, arch 21 PASS, purity/security/workspace PASS, OTA SAFE.
- PR #232, head `03f1330c1f090615582317f7567d855c22bed8cd`, exact-head CI
  green, review C0/I0 → merge `0ea0012dee389b1889ee6949ddcab56906d42c53`.

## W17.3 Timer recovery — SUPERSEDED, NO CODE

- Historical `SecureStore TimerStorage` authority is invalid under the current
  server-authoritative timer (`GET /api/timer/workspace`, `POST start/stop`;
  `runtime.ts` is a pure server-timestamp projection).
- Proved on main: cold start via `useTimerWorkspaceQuery → fetchTimerWorkspace`
  (query test asserts key + fn); foreground via `connectFocusManagerToAppState`
  + `refetchOnWindowFocus: true`; start/stop failure reconciles workspace only
  (server wins; 5 query tests). Timer + focus suites 15/15 PASS.
- No production change. `mobile-v1-ws/12-timer-runtime` disposition: SUPERSEDED.

## W17.4 Foreground auth refresh — RECOVERED (genuine gap)

- Gap proved: bootstrap refreshes once at launch; a backgrounded app crossing
  token expiry pays 401 churn on every foreground refetch. Focus wiring was
  already on main; proactive near-expiry foreground refresh was missing.
- Change (fresh branch, 3 files): `lib/lifecycle/resume-refresh.ts` reuses the
  existing single-flight `refreshMobileSessionIfConfigured` (same 45s buffer,
  60s cooldown, in-flight dedup; owns/clears no session — logout wins, switch
  wins, stale failure harmless, malformed fail-closed); `auth-context` adds an
  `AppState → active` effect reading the live session ref. Tests: 8 new.
- Gates: typecheck PASS, focused lifecycle+auth 16/16, mobile 48/275, doctor
  18/18, bundle PASS, arch/purity/security/workspace PASS, OTA SAFE.
- PR #233, head `2d88c0833fb77a072559af5d205df97b33e6aeb8`, exact-head CI
  green, review C0/I0 → merge `bc8805d67941c7c17ccdb6aec0f6ef9d1e493dfd`.

## W17.5 Stash — SUPERSEDED

- `14593ada9068fb053c65a8098bcf73ca6360f9a7` ("pre-ega-323", May 2026,
  pre-monorepo `src/...` paths) touched only the flat review page with
  `/review?weekOf=` links. Main carries explicit contracts
  (`weekly-review-generator/preview/page-service/email-service`,
  `ReviewPageView`, `actions` tests) proving the flat route intentional,
  alongside the separate `[reviewId]` past-review route. No contradictory
  evidence. Stash ref already absent (`git stash list` empty); dangling object
  left for GC. No patch reapplied.

## W17.6 VM inventory — NO STRANDED WAVE WORK

- Merged: PRs #231, #232, #233. No open Wave-17 PR.
- Historical refs: `07-cleanup`, `08-task-actions`, `12-timer-runtime`
  SUPERSEDED/CONTAINED (local refs removed after this ledger merges);
  `14-lifecycle` split — focus part contained, resume-refresh re-implemented
  in #233 (local ref removed after merge).
- Untouched by design: `backup/*`, `project-permanent-delete`,
  `project-purge`, and all non-wave branches (out of scope).

## W17.7 Cumulative verification (fresh worktree @ `bc8805d6`, `npm ci`)

- contracts 25/25, domain 52/52, application 443/443, data-access 107/107,
  api-client 54/54, server 155/155, web 168 files/1291 tests, mobile 48
  suites/275 tests — ALL PASS.
- `check:architecture` PASS, `test:architecture` 21/21, `ci:purity`,
  `ci:security`, `ci:workspace` PASS, `mobile:typecheck`/`doctor`(18/18)/
  `bundle` PASS, `git diff --check` clean.
- Native diff 6a465217→bc8805d6: 14 files, JS/TS/tests/lint-baseline only —
  NO NATIVE CHANGE, OTA COMPATIBLE WITH mobile-v1.0.4.
- `validate:agent-context` fails 10 pre-existing instruction-chain byte
  errors; Wave 17 touches zero `AGENTS.md` files (proven by diff), so the
  failure is inherited, not introduced. No physical-device testing claimed.

## Release boundary

Production DB mutation: NONE. Manual deploy: NONE. OTA publish: NONE. APK
build: NONE. Native baseline stays `mobile-v1.0.4`. Classification: OTA SAFE.
