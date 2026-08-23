# EGA House Waves 2/3/5/6 — Independent Review

Reviewer: independent audit session (no stack author involvement)
Date: 2026-08-11
Scope: PR #130 → #131 → #134 → #135, read-only. No merges, no pushes, no deployments.

## Executive verdict

**APPROVE WITH NON-BLOCKING FINDINGS**

The canonical stack is exactly as claimed: all four branch SHAs match, ancestry is strictly linear (each wave is ahead of its parent only), all four PRs are OPEN and MERGEABLE, and every canonical head has a green unified CI run at its exact SHA. Independent local re-execution of the full validation matrix reproduces CI: every typecheck, test suite, build, bundle, security proof, and the blocking `lint-changed` gate passes at `d3241f9`. The wave-6 lint trajectory claim (baseline 39E/53W → 15E/51W) is confirmed exactly.

No data leak, auth bypass, service-role misuse on user paths, schema change, or committed secret was found. Findings below are non-blocking: an npm≥11 lockfile install gap, missing application-level ownership pre-checks on reminder/recurrence writes (RLS covers them), a divergence risk between the new Hono authority and the retained legacy web task service, and a pre-existing mobile refresh stampede risk that wave 3 slightly amplifies.

---

## 1. Repository state

```
origin/main:            156946ec120c8bf60b4b94520093b4b95670e6c3 (matches stack base)
reviewed final SHA:     d3241f9f6626480c470c59aee6ce83119b4543df (wave/06 head)
worktree:               /home/ubuntu/ega-house-review-wave6 (detached at final SHA)
review worktree:        clean
local repo worktree:    branch arch/04-project-goal-application-core @ 3ef94ab
                        ONE untracked dir apps/hermes-sidecar/ — left untouched
remote URL:             git@github.com:egawilldoit/Ega-House-Platform.git
Node:                   local v24.18.0 / npm 11.16.0 (CI: node v22.23.1, npm 10.9.8)
```

Install note: `npm ci` fails with the local npm 11.16.0 (`EUSAGE`, lockfile missing 22 of 23 `@esbuild/*` optional platform entries + `fsevents`); it succeeds with the CI npm 10.9.8 (`npx npm@10.9.8 ci`, exit 0, 1448 packages). All validation below ran on the npm-10.9.8 install, matching CI tooling.

---

## 2. Canonical stack verification

| PR | Base | Head | SHA | Open | Mergeable | CI (canonical run @ head) | Result |
| -- | ---- | ---- | --- | ---- | --------- | -- | ------ |
| #130 | main | wave/02-task-today-core | 11e15d669382739eba248522af98281ac6056226 | OPEN | MERGEABLE | 31421528518 @ 11e15d6 | ALL PASS |
| #131 | wave/02-task-today-core | wave/03-auth-session-core | f5c56731286a35fcba1de89cfaf92f3e52a0d4b0 | OPEN | MERGEABLE | 31486296240 @ f5c5673 | ALL PASS |
| #134 | wave/03-auth-session-core | wave/05-mcp-oauth-integrations-cron | 611c00aa40c5c09fb39e027359328659d1d089a8 | OPEN | MERGEABLE | 31495324178 @ 611c00a | PASS (web/contracts/etc.); api-client/mobile/server path-skipped — same-SHA push run 31495320219 ran them ALL PASS |
| #135 | wave/05-mcp-oauth-integrations-cron | wave/06-tech-debt-baseline | d3241f9f6626480c470c59aee6ce83119b4543df | OPEN | MERGEABLE | 31498350133 @ d3241f9 | ALL PASS |

All four expected run IDs match the expected list. Run `head_sha` was verified for every canonical run via the GitHub API.

---

## 3. Ancestry proof

```
git merge-base --is-ancestor W2 W3 → exit 0 (W3 contains W2)
git merge-base --is-ancestor W3 W5 → exit 0 (W5 contains W3)
git merge-base --is-ancestor W5 W6 → exit 0 (W6 contains W5)

rev-list --left-right --count:
  main...W2:   0 29   (W2 ahead of main only)
  W2...W3:     0 15   (W3 ahead of W2 only)
  W3...W5:     0 9    (W5 ahead of W3 only)
  W5...W6:     0 7    (W6 ahead of W5 only)
```

No flattening, no merge commits, no unexpected ancestry. The stacked chain is exactly `main → #130 → #131 → #134 → #135`.

Superseded work (`#132`, `#133`, `wave/05-runtime-integrations-cleanup`, `wave/06-lint-technical-debt`) was not reviewed as canonical. Red "fail" entries visible under PR #131's check list belong to push-triggered runs on the wave/05 branches while they still pointed at `f5c5673` (conclusion `cancelled`, superseded by concurrency) — not to the canonical PR #131 run, which is green at the identical SHA.

---

## 4. Independent validation

All commands executed locally in the isolated worktree at `d3241f9` (npm 10.9.8 install). No result below is assumed — every command was actually run.

| Command | Exit | Tests/result | Verdict |
| ------- | ---: | ------------ | ------- |
| npm run validate:agent-context | 0 | STRUCTURAL PASS (not semantic proof) | PASS |
| npm run test:architecture | 0 | pass | PASS |
| npm run check:architecture | 0 | pass | PASS |
| npm run contracts:typecheck | 0 | pass | PASS |
| npm run contracts:test | 0 | 3 tests | PASS |
| npm run domain:typecheck | 0 | pass | PASS |
| npm run domain:test | 0 | 4 tests | PASS |
| npm run application:typecheck | 0 | pass | PASS |
| npm run application:test | 0 | 32 tests | PASS |
| npm run data-access:typecheck | 0 | pass | PASS |
| npm run data-access:test | 0 | 19 tests | PASS |
| npm run api-client:typecheck | 0 | pass | PASS |
| npm run api-client:test | 0 | 29 tests | PASS |
| npm run server:typecheck | 0 | pass | PASS |
| npm run server:test | 0 | 37 tests | PASS |
| npm run mobile:doctor | 0 | pass | PASS |
| npm run mobile:typecheck | 0 | pass | PASS |
| npm run mobile:test | 0 | 10 suites / 45 tests | PASS |
| npm run mobile:bundle | 0 | Android bundle validated | PASS |
| npm run typecheck:ega-runner | 0 | pass | PASS |
| npm run test:ega-runner-pr-loop | 0 | 21 tests | PASS |
| npm run web:typecheck | 0 | pass | PASS |
| npm run web:test | 0 | 136 files / 987 tests | PASS |
| npm run web:build | 0 | production build OK **with CI env vars** | PASS (env-dependent) |
| npm run web:build (no env) | 1 | fails: `Missing env.DATABASE_URL` during page-data collection of /api/agent/capabilities | ENV ONLY — CI sets DATABASE_URL at workflow level; not a code defect |
| npm run lint:changed -- --base 611c00a | 0 | 5 changed files, 0 regressions, new files zero-problem | PASS (blocking gate) |
| npm run lint:report | 0 | 15 errors / 51 warnings, baseline 39/53, within tolerance | PASS (informational) |
| npm run ci:security | 0 | security-proofs: ALL CHECKS PASSED | PASS |

Caution on lint:report: after running `mobile:bundle` in the same worktree, `eslint .` also lints `apps/mobile/.expo/ci-export/**` (generated bundle, gitignored but NOT in eslint `globalIgnores`) producing a false 57E/5790W drift. After removing the generated artifact the result returns to 15E/51W, identical to CI. CI jobs are isolated so this never occurs in the pipeline.

---

## 5. Wave 2 review

### Architecture
`Task/Today semantics → @ega/application (ports + services) → repository ports → @ega/data-access (SupabaseTasksRepository) → request-scoped Supabase client → RLS`. The Hono transport (`apps/server/src/routes/tasks.ts`, `today.ts`) consumes middleware-provided `actor` + `client`; nothing in the stack constructs an actor from request data.

### Task authority
Create/update/archive/unarchive/status/priority all flow through application services into the repository, every query/update scoped `.eq("owner_user_id", actor.userId)`. `createTask` sets `owner_user_id: actor.userId` — request JSON cannot select ownership (server test asserts an injected `owner_user_id: "attacker"` is ignored).

### Today
plan/remove/status/clear-completed all owner-scoped; `clearCompletedPlannedDate` filters by `owner_user_id` + `planned_for_date` + done statuses.

### Recurrence
`setRecurrence` uses an `upsert ... onConflict("task_id")` without an explicit task-ownership filter in the request, relying on RLS. The existing migration `drizzle/0026_equal_war_machine.sql` enforces `task_recurrences_insert_own`: `WITH CHECK (owner_user_id = auth.uid() AND EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND owner_user_id = auth.uid()))`; update/delete policies are owner-scoped. The upsert cannot mutate another user's recurrence (Postgres applies the UPDATE policy to the conflict path). Delete path carries `.eq("owner_user_id", ...)`. PROTECTED at DB layer; application pre-check absent (finding M-1).

### Reminders
`createReminder` inserts without a task-ownership pre-check; RLS insert policy `task_reminders_insert_own` (drizzle/0025) requires task ownership via EXISTS. `cancelReminder` scopes by `id + task_id + owner_user_id`. PROTECTED at DB layer (finding M-1).

### Supabase/RLS
No service-role usage in `packages/application`, `packages/data-access`, or `apps/server` (grep: zero hits). `apps/server/src/auth.ts` verifies via `auth.getUser(token)` (expired/revoked → null → 401) and builds the request client carrying the SAME token.

### Compatibility
The legacy web authority (`apps/web/src/lib/services/task-service.ts`, ~50 direct `from("tasks")` sites) remains in place as the web compatibility transport, user-scoped through `createClient()` (SSR session client → RLS). The migration plan explicitly retains it. Duplication risk is real and intentional; see findings M-3.

### Findings
See section 14: M-1 (defense-in-depth pre-checks), M-3 (dual authority drift risk), M-4 (updateTask scope validation asymmetry), L-1.

---

## 6. Wave 3 review

### Identity
`AuthenticatedIdentity` (packages/contracts/src/auth.ts) is produced only from verified sources: web `requireAuthenticatedIdentity` → Supabase SSR `getUser()`; server `createAuthenticatedActorFromIdentity({ id: userId })` only after `verifyAccessToken` (bearer). Grep for `body.userId | query.userId | formData.get("userId") | param("userId")` across server/application/data-access/api-client: zero hits. security-proofs scans all tracked TS for actor construction from formData/body/request/c.req — passes.

### Actor derivation
`createAuthenticatedActorFromIdentity(VerifiedIdentity)` is the single entry point; the server proof asserts the identity literal `{ id: userId }` is used.

### Web session
Unchanged Supabase SSR/cookie semantics; wave 3 only added shared identity helpers to `auth-service.ts`.

### Mobile refresh
`getMobileEgaApiClient` now injects `refreshAccessToken: refreshMobileSessionIfConfigured`; the client triggers it after an authenticated 401 and retries once. SecureStore/session persistence, refresh-token storage, logout/clear remain in the mobile session layer (`lib/api/client.ts` + storage); the shared client stores nothing.

### Hono bearer
Bearer extracted via `extractBearerToken` (header only), verified server-side, actor + request-scoped client set in middleware. Unchanged by wave 3 (comment churn + identity helper adoption).

### 401 retry correctness
`HttpClient.requestAttempt`: refresh invoked at most once per request; retry sets `allowRefresh=false`; second 401 is terminal and surfaces through `onAuthError` + `errorResult`. No recursion, no infinite loop, no silent swallow (tested by `auth-refresh.test.ts`, 29 api-client tests pass). Retry replays the original request (including mutation bodies) — safe because a 401 means the server rejected before processing; no double-execution window exists on this server.

### Findings
M-2 (concurrent-401 refresh stampede, no single-flight lock in `performRefresh` — pre-existing, amplified by the new client-side await-and-retry). L-2 (no branch protection; nothing enforces CI before merge).

---

## 7. Wave 5 review

### MCP
Not touched by the wave-5 diff. `/api/mcp/route.ts` remains thin (`createLazyMcpEndpoint`); operational-boundaries test asserts no supabase/task/project/goal references in the route. `MCP_ENABLED`/`MCP_WRITES_ENABLED` config intact (`lib/mcp/config.ts` + endpoint). PR title claims "MCP OAuth integration and cron boundaries" but the diff is cron-only — title overstates scope (L-4).

### OAuth
Not touched. Consent decision route still enforces `requireSameOrigin` + `parseAuthorizationId`; state validation and CSRF/origin checks unchanged (per operational-boundaries test, decision route contains no product mutation authority).

### Google Calendar
Not touched. Callback validates `state` presence; token storage/refresh/error-redaction code unchanged by the stack.

### Cron
Shared runtime (`lib/cron/route-runtime.ts`) centralizes Bearer authorization (`CRON_SECRET`), missing-env handling, and sanitized failure wrapping; route-specific work (email builds, sync processing, weekly-review scheduling) remains route-specific. Route names unchanged (calendar-sync, daily-email, task-reminders, test-email, sendWeeklyReviews/weekly-review-email aliases kept as thin adapters). Env names preserved: `CRON_SECRET`, `EGA_OWNER_USER_ID`, `RESEND_API_KEY`, `EMAIL_FROM`, `DAILY_ASSISTANT_EMAIL`. No secrets in responses (sanitized generic failure messages).

### Environment handling
`authorizeCronRequest` returns the same 500 missing-env response for a missing `CRON_SECRET` as the previous per-route code.

### Error redaction
Cron failures return fixed strings. `test-email` returns the raw Resend error object — pre-existing, not a secret channel (Resend errors carry request IDs, not keys).

### Findings
L-3 (timing-unsafe `!==` secret comparison — pre-existing pattern retained), L-4 (title/scope mismatch), L-5 (skipped CI coverage of wave-5 jobs was justified; same-SHA push run covered them).

---

## 8. Wave 6 review

### Lint delta
Baseline 39E/53W (captured at b5e59ee) → **15E/51W at head, exactly as claimed** (verified independently twice; CI job 93801778314 log matches local output).

### Runtime behavior risk
- Timer `useRef(new Animated.Value)` → `useState(() => new Animated.Value())`: equivalent init-once semantics, compiler-friendly. No behavior change.
- `AnimatedPressable`: same pattern. No behavior change.
- `useClientOnlyValue.web.ts`: `useState`+`useEffect` → `useSyncExternalStore` (canonical React 18+ hydration-safe pattern; server snapshot = server value, client snapshot = client value). Correct.
- Runner `evidence.ts`: dynamic `require("node:child_process")` → static import; plus trailing-newline fix. No behavior change.
- `lint-diagnostics.mjs`: new informational error-diagnostics printer, always exits 0; `lint:report` now chains it. No lint rule disabled, no severity downgrade, no ignore-path change, no baseline inflation (diff contains zero eslint config edits).

### Remaining lint debt
15 errors (section 12): 10× `react-hooks/set-state-in-effect`, 1× `react-hooks/preserve-manual-memoization`, 2× runner `no-explicit-any`, 2× runner `prefer-const`. All low-risk; none blocks merge.

### Runner
Only the import fix; runner typecheck + PR-loop tests pass (21 tests).

### Mobile changes
Timer + AnimatedPressable stabilization; mobile tests (45) and Android bundle pass.

### Findings
L-1 (eslint globalIgnores missing `apps/mobile/.expo/**` and `artifacts/**` → generated bundles pollute local lint:report).

---

## 9. Security review

| Attack | Protection | Evidence | Result |
| ------ | ---------- | -------- | ------ |
| 1. Send another user's userId in JSON | Actor always from verified bearer; owner_user_id forced | server test asserts attacker-id ignored; security-proofs | PROTECTED |
| 2. Change task/project/goal IDs | Path param IDs only; repository scopes by owner; scope check on create | repository.ts | PROTECTED |
| 3. Read another user's Task | `.eq("owner_user_id", actor.userId)` on all reads | repository.ts:155,176 | PROTECTED |
| 4. Mutate another user's Task | update/archive/status all owner-scoped | repository.ts:252,274 | PROTECTED |
| 5. Cancel another user's reminder | cancel scoped id+task_id+owner_user_id; RLS update policy owner-scoped | repository.ts:305-310; drizzle/0025 | PROTECTED |
| 6. Mutate recurrence of another user | upsert conflict path gated by RLS INSERT/UPDATE policies (EXISTS task-owner check) | drizzle/0026 | PROTECTED (RLS); app pre-check absent (M-1) |
| 7. Expired bearer token | `auth.getUser` fails → null → 401 | auth.ts:35-42 | PROTECTED |
| 8. Infinite refresh | refresh once + retry once + `allowRefresh=false`; second 401 terminal | http.ts:136-158; tests | PROTECTED |
| 9. Replay mutations after refresh | Retry only on explicit 401 (server rejects before processing); no loss-retry | code inspection | PROTECTED |
| 10. Bypass cron auth | All cron routes call `authorizeCronRequest`; no route reads CRON_SECRET itself anymore | route files + operational-boundaries test | PROTECTED |
| 11. Spoof CRON_SECRET | Bearer must equal secret; constant secret in env | route-runtime.ts | PROTECTED (timing side-channel theoretical — L-3) |
| 12. Inject identity via OAuth request data | consent origin + authorization_id validated; decision service only | oauth/decision route | PROTECTED |
| 13. Expose Supabase errors | sanitizeSupabaseError; generic messages; server onError masks internals | data-access/supabase/errors | PROTECTED |
| 14. Expose OAuth tokens | No token in errors/logs (unchanged code paths) | inspection | PROTECTED |
| 15. Service-role for normal user API | Zero service-role refs in application/data-access/server; web user flows use SSR client; service-role only in cron workers + post-response queue drain | greps; security-proofs | PROTECTED |

---

## 10. Duplicate-authority audit

| Path | Classification |
| ---- | -------------- |
| packages/data-access/src/tasks/repository.ts | canonical |
| packages/data-access/src/projects, goals repositories | canonical (pre-existing PR4 work) |
| apps/server/src/routes/tasks.ts, today.ts | canonical transport |
| apps/web/src/lib/services/task-service.ts (+ task-read/transition/today-planner/focus-queue/timer-service) | legacy compatibility (intentional, documented; user-scoped SSR client) |
| apps/web/src/lib/services/agent-task-service.ts, lib/mcp/read-repository.ts | intentional agent/MCP authority (separate contract) |
| apps/web/src/app/api/cron/*, task-reminder-delivery-service.ts, calendar-sync-service.ts, assistant-data.ts, send-weekly-reviews.ts | intentional privileged worker (service role, cron) |
| apps/web/src/app/tasks/actions.ts:166 `getSupabaseServiceClient` | privileged queue drain after user response (pre-existing; cron remains reliable path) — NOT a user-data authorization path |
| apps/web read-only aggregators (dashboard-data, workspace-shell, review/export, weekly-review-page, work-analytics) | legacy read paths (user-scoped) |

Verdict: one product authority exists per surface where intended. The web legacy task service remains the largest legacy duplication and the primary drift risk (M-3).

---

## 11. CI quality review

- Green builds genuinely test their claimed heads: every canonical run's `head_sha` equals the branch SHA; checkout uses `ref: head.sha`.
- `lint-report` job has `continue-on-error: true` (workflow line 260) and the script exits 1 on drift — the check renders PASS either way. It is documented as informational; the blocking gate is `lint-changed` (changed files vs per-file baseline, including zero-problem for new files). Not misleading per se, but a drift would only be visible in logs, not check state. L-6.
- Path-filtered skips (#134: api-client/mobile/server skipped in the PR run because the wave-5 diff touches only apps/web + apps/web/lib/cron) are honest: the same SHA's push run 31495320219 executed all of them green. TESTED ON THIS HEAD — via a sibling run, not skipped-and-untested.
- "Macroscope - Correctness Check" is an external informational bot ("skipping") — not a real gate.
- No `.skip(`/`.only(` in unit suites; one conditional `test.skip` in a Playwright e2e (needs E2E_AUTH_EMAIL/PASSWORD), which is not run by CI at all (L-5).
- `|| true` occurrences: mobile-apk-manual artifact find (manual workflow) and runner's internal bounded git-call fallbacks — benign.
- Branch protection is disabled repo-wide (main and wave/*): mergeable ≠ CI-enforced. L-2.

---

## 12. Remaining lint debt

| File | Rule | Count | Risk | Recommendation |
| ---- | ---- | ----: | ---- | -------------- |
| apps/mobile/app/(app)/tasks/[id].tsx:244 | react-hooks/set-state-in-effect | 1 | LOW (state sync on prop change; cascading render only) | guard with `useEffect` on task id, or derive draft during render |
| apps/mobile/app/(app)/tasks/create.tsx:96 | react-hooks/set-state-in-effect | 1 | LOW | same |
| apps/web/src/app/tasks/create-task-form.tsx:94,98 | react-hooks/set-state-in-effect | 2 | LOW | reset via key or derived state |
| apps/web/src/components/tasks/inline-task-update-form.tsx:73,77 | react-hooks/set-state-in-effect | 2 | LOW | same |
| apps/web/src/components/tasks/quick-task-sheet.tsx:244,259,299 | react-hooks/set-state-in-effect | 3 | LOW | same |
| apps/web/src/components/timer/live-duration.tsx:21 | react-hooks/set-state-in-effect | 1 | LOW | redundant initial sync; keep interval update |
| apps/mobile/lib/auth/auth-context.tsx:55 | react-hooks/preserve-manual-memoization | 1 | LOW (compiler skips manual memo; runtime unaffected) | let compiler manage memoization |
| scripts/ega-runner/src/github-checks.ts:135,138 | @typescript-eslint/no-explicit-any | 2 | NONE (type-only) | replace `Record<string, any>` with typed JSON |
| scripts/ega-runner/src/result.ts:113,114 | prefer-const | 2 | NONE (mechanical) | `const` |

Classification: 4 SAFE MECHANICAL, 11 NEEDS BEHAVIOR REVIEW (all low actual risk), 0 SHOULD BLOCK MERGE.

---

## 13. Runtime test plan

Next gate before merge: human review + real-runtime testing with two users (USER A / USER B) on web, Hono, and mobile/Hono paths.

### Web (user-session, RLS)
- login/logout; tasks list/create/update; Today plan/status/remove/clear-completed; reminder create/cancel; recurrence set/clear; projects; goals; timer start/stop/export; agent capabilities endpoint; MCP toggle; OAuth consent + Google Calendar connect/callback; cron routes (with CRON_SECRET bearer and without → 401).

### Server/Hono
- `/health`; `/api/tasks` with invalid bearer (401), expired bearer (401), valid bearer (200); create/update/archive/reminder/recurrence; `/api/today` all mutations; cross-user ownership: USER A creates task; USER B GET /api/tasks/:id → 404, PATCH → 400/404, recurrence upsert → rejected (RLS), reminder cancel → no-op.

### Mobile
- login; session restore; refresh on 401; refresh failure → logout; second 401 terminal; task/today/reminder/recurrence flows; timer; app restart mid-session; airplane-mode network error; expired session mid-burst (watch for the M-2 stampede).

### OAuth / MCP / Cron / RLS
- OAuth: consent approve/deny, state mismatch, cross-origin POST → 403; MCP: enable/disable, writes on/off; cron: wrong secret → 401, missing CRON_SECRET → 500, correct secret → operation; RLS: repeat cross-user matrix for tasks, reminders, recurrences.

### Required cross-user proof
A creates → B cannot read (web/Hono/mobile), cannot mutate (web/Hono/mobile), cannot cancel A's reminder, cannot set/clear A's recurrence.

---

## 14. Findings

### BLOCKER
None.

### HIGH
None.

### MEDIUM
- **M-1 (defense in depth)**: `createReminder` (repository.ts:288) and `setRecurrence` upsert (repository.ts:324) do not pre-verify task ownership at the application layer; protection rests entirely on RLS INSERT/UPDATE policies (verified present in drizzle/0025/0026 with EXISTS task-owner checks). If a future migration weakens the policies, the application layer would not catch it. Recommend pre-checking task ownership (e.g., a `getTask` before insert/upsert) and adding a repository test that simulates missing policies.
- **M-2 (refresh stampede, pre-existing, amplified)**: mobile `performRefresh()` has no single-flight lock; N concurrent authenticated 401s → N parallel refresh POSTs with the same refresh token. Supabase refresh-token rotation makes only one succeed; the others can clear the session and log the user out mid-burst. Wave 3's await-then-retry makes the failure more visible. Add an in-flight refresh promise shared by all callers.
- **M-3 (dual authority drift risk)**: web legacy `task-service.ts` (and companions) still implement independent task/today/recurrence/reminder business rules in parallel to the new Hono/application authority. Intentionally retained as compatibility transport, but no divergence test exists (e.g., same input → same validation outcome). Recommend a cross-authority contract test before legacy removal.
- **M-4 (validation asymmetry)**: `updateTask` accepts `projectId`/`goalId` changes without the ownership/consistency scope check that `createTask` performs (service.ts:141-146). A user can move their task to a project/goal they do not own, producing dangling references. Add scope validation on update.

### LOW
- **L-1**: eslint `globalIgnores` misses `apps/mobile/.expo/**` and `apps/mobile/artifacts/**`; generated bundles pollute local `lint:report` (observed 57E/5790W false drift). CI unaffected (isolated jobs). Add ignores.
- **L-2**: no branch protection on any branch; CI green is not enforced. Process risk only.
- **L-3**: cron secret comparison uses `!==` (not constant-time). Pre-existing; network-dominated timing makes exploitability theoretical.
- **L-4**: PR #134 title/branch claim "MCP OAuth integration" while the diff is cron-only; MCP/OAuth were consolidated in earlier waves. Title overstates scope.
- **L-5**: Playwright auth-session e2e only runs with E2E_AUTH_EMAIL/PASSWORD and is not wired into CI; real-browser auth/session regression coverage is a gap.
- **L-6**: `lint-report` renders PASS under `continue-on-error` even when drift is detected (visible only in logs). Acceptable by design, but consider a visible annotation when drift occurs.
- **L-7 (environment)**: `web:build` requires `DATABASE_URL` at build time (page-data collection for /api/agent/capabilities); CI supplies it. Not a defect; document for local builds.

---

## 15. Final merge recommendation

**READY FOR HUMAN REVIEW + RUNTIME TESTING**

The next gate is: (1) human review of this stack per the runtime test plan (section 13), including the USER A / USER B cross-ownership matrix on web, Hono, and mobile; (2) address M-1..M-4 before or during runtime testing — none blocks starting; (3) merge order #130 → #131 → #134 → #135 after evidence is recorded. Do not merge on CI green alone.
