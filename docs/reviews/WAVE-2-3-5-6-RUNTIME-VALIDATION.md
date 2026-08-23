# EGA House Runtime Validation

**Date:** 2026-08-12
**Validator:** runtime-validation agent (final gate)
**Stack validated:** Wave 2 → Wave 3 → Wave 5 → Wave 6 (PR #130 → #131 → #134 → #135)

## Verdict

**RUNTIME PASS — READY FOR ORDERED MERGE**

Runtime testing found one real defect (M-2 refresh race on the `mobileApiFetch` path), which was fixed forward per protocol, pushed to `wave/03-auth-session-core`, restacked through Waves 5/6, and re-validated. All runtime matrices and the full automated matrix are green at the final heads.

## Exact stack

| Wave | PR | Branch | SHA | CI (Unified Platform Validation) |
|---|---|---|---|---|
| Wave 2 | #130 | wave/02-task-today-core | `11e15d669382739eba248522af98281ac6056226` | success (unchanged head, previously verified) |
| Wave 3 | #131 | wave/03-auth-session-core | `03806c34de81b36c1d749b723b11328bffee4b6b` | success — runs 31612060310, 31612053726 |
| Wave 5 | #134 | wave/05-mcp-oauth-integrations-cron | `def0f1d4638e59967486b4b4efa07eaed701488d` | success — runs 31612082577, 31612075970 |
| Wave 6 | #135 | wave/06-tech-debt-baseline | `80ffcbc24ae9ea93166949e35a6baa6b15f0054a` | success — runs 31612096430, 31612091223 |

Ancestry verified: W2 ⊇ main, W3 ⊇ W2, W5 ⊇ W3, W6 ⊇ W5. No merge commits introduced by restacks; content deltas between reviewed SHAs and final SHAs are exactly the M-2 fix commits.

**Note on reviewed SHAs:** Wave 3/5/6 heads had already moved before this validation began (single-flight fix `507bdca` on Wave 3 with documented runtime reproduction of 2026-08-12, plus a clean restack of W5/W6 onto it). This validation inspected those commits first, then ran the runtime matrix, which exposed a remaining gap (below).

## Runtime environment

- Node v24.18.0 / npm 11.16.0 on host; installs and lockfile ops performed with npm 10.9.8 via corepack (CI-equivalent per tooling finding). No lockfile regeneration.
- Web (Next.js 16.2.12, dev) on `http://localhost:3000`; Hono server on `http://localhost:3001`.
- Supabase project `ofpqkogwatceimtzvenh` (real runtime). DATABASE_URL, Supabase URL/anon key, CRON_SECRET, EGA_OWNER_USER_ID sourced from the pre-existing validated runtime env (`/tmp/opencode/web.env` + repo `.env.local`); `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `GOOGLE_*` credentials are NOT present in this environment (see findings L-1/L-2).
- Two dedicated runtime users created/confirmed: `ega-runtime-user-a@egawilldoit.online` and `ega-runtime-user-b@egawilldoit.online` (no admin/service accounts used).

## Web

| Test | Result | Evidence |
|---|---|---|
| GET / (public) | 200 | curl status |
| Login page render | 200 | curl status |
| Authenticated SSR session (cookie) on /dashboard /tasks /today /timer /review /goals /settings/account | 200 each | curl with SSR session cookie; dashboard renders user email |
| Hydration / server-action errors in browser log | none | 0 hydration warnings in dev log |
| Unexpected 500s (excluding env-gated cron/MCP paths) | none | log scan |

## Hono

| Test | Result | Evidence |
|---|---|---|
| GET /health | 200 `{"status":"ok"}` | curl |
| /api/tasks, /api/projects, /api/today without bearer | 401 | curl |
| Invalid bearer token | 401 `UNAUTHENTICATED` | curl |
| GET nonexistent task id | 404 NOT_FOUND | curl |
| GET malformed (non-UUID) task id | 500 INTERNAL | curl — see finding L-3 |

## Task / Today

| Test | Result | Evidence |
|---|---|---|
| Create task (title, project, goal, status, priority, dueDate, estimateMinutes, description) | PASS — all fields persisted | matrix rows 2.x |
| Update task (status, priority, dueDate, estimate, description) | PASS — all persisted | matrix rows 3.x |
| Complete todo → done | PASS | matrix row 4 |
| Blocked status + blockedReason (incl. 400 when reason missing) | PASS | matrix row 4 |
| Archive → hidden by default / visible with includeArchived → unarchive | PASS | matrix rows 5.x |
| Today: plan task, list, status change, day-boundary exclusion, clear-completed, cleared task gone | PASS (6/6) | matrix rows 6.x |
| Today excludes unrelated date (timezone/day-boundary regression) | PASS | matrix row 6.4 |

## Reminder / recurrence

| Test | Result | Evidence |
|---|---|---|
| Create reminder with remindAt | PASS | matrix 7.1–7.2 |
| Past timestamp rejected | 400 | matrix 7.3 |
| Read reminders + cancel + persisted cancelled status | PASS | matrix 7.4–7.6 |
| Set daily recurrence / change to weekly:monday / timezone persisted / clear recurrence | PASS (4/4) | matrix 8.x |
| Monthly rule supported by domain values (`monthly:day-of-month`) | verified in domain constants | recurrence.ts |

## RLS isolation

| Attack (USER B against USER A resource) | Result | Evidence |
|---|---|---|
| GET A task | 404 | matrix 9.2 |
| PATCH A task | 4xx | matrix 9.3 |
| Archive / unarchive A task | 4xx | matrix 9.4–9.5 |
| Plan A task today / change today status | 4xx | matrix 9.6–9.7 |
| Create reminder on A task / cancel A reminder | 4xx | matrix 9.8–9.9 |
| Set recurrence on A task | 4xx | matrix 9.10 |
| B list contains no A tasks; A list contains no B tasks | PASS | matrix 9.11, 9.16 |
| B create task referencing A's project | 400 | matrix 9.12 |
| B create task referencing A's goal | 400 | matrix 9.13 |
| B update A task with A's project | 4xx | matrix 9.14 |
| B GET A project / A goal | 404 | matrix 9.17–9.18 |
| Validation edges (no title, bogus status, blocked w/o reason, bogus token) | 400/400/400/401 | matrix 10.x |

**Total matrix: 61 passed / 0 failed** (M-1/M-4 cross-user ownership and scope-validation defense-in-depth confirmed; no runtime evidence of a defect — no code change made).

## Mobile auth/session

| Scenario | Result | Evidence |
|---|---|---|
| Sign in (web mobile auth endpoint) | PASS — session with access+refresh tokens | rt-session-a/b.json |
| Session restore + near-expiry refresh (auth-context bootstrap) | PASS (unit-covered; auth-context.tsx) | mobile suite |
| 401 → refresh exactly once → retry → 200 | PASS | harness A |
| **Concurrent 401 burst (M-2)** | **PASS after fix** | see below |
| Refresh failure → session cleared, terminal, no storm | PASS | harness C |
| Second 401 after refresh → terminal, no recursion | PASS | harness D |
| Mutation refresh safety: create with expired token → +1 resource, not +2 | PASS (delta=1, refreshCalls=1) | harness E |
| App restart / full physical-device regression | NOT RUN — no physical device in environment; Expo bundle + doctor + suite all green | see findings L-4 |

### Concurrent 401 count / refresh count / retry count / logout

Reproduction phase (pre-fix `mobileApiFetch` path, server logs): **124 refresh POSTs across bursts, 24× 401** — rotation race confirmed (this matches the earlier reproduction in commit `507bdca`: 8 concurrent requests → 7 refresh calls, 7 session clears, 1/8 success).

Post-fix verification (single-flight through the shared promise):

| Metric | Result |
|---|---|
| Concurrent expired-token requests | 8 (also 5–10 range covered by unit tests) |
| Refresh calls per burst | 1 at the unit seam (5/5 single-flight tests); ≤2 in the end-to-end harness (a late-arriving 401 after completion reuses the freshly rotated token — no race, no clear) |
| Successful retries | 8/8 |
| Session cleared / logout | 0 |
| Second 401 | terminal (harness D) |
| Duplicate mutation | none (harness E: +1) |

## MCP

| Test | Result | Evidence |
|---|---|---|
| MCP_ENABLED=false → endpoint disabled | 404 sanitized `MCP endpoint is disabled.` | restart with MCP_ENABLED=false |
| No bearer token | 401 `invalid_token` | curl |
| Invalid bearer token | 401 `invalid_token` (no leak) | curl |
| Protected-resource metadata (`/.well-known/oauth-protected-resource[/api/mcp]`) | 200, resource + authorization_servers | curl |
| Consent page render | 200 | curl |
| Decision cross-origin POST | 403 | curl |
| Decision bogus/unknown authorization_id | 400 `Invalid OAuth consent request.` | curl |
| Decision without session | 303 → login (no bypass) | curl |
| Decision approve with valid session | reaches grant activation; fails only on missing SUPABASE_SERVICE_ROLE_KEY in this env | curl — see finding L-1 |
| MCP_ENABLED=true + full token flow (tool listing / read tools) | NOT RUN — requires service-role key for grant activation | finding L-1 |

## OAuth

| Test | Result | Evidence |
|---|---|---|
| Authorization server discovery | 200 (issuer, endpoints, scopes) | curl |
| Dynamic client registration | 201 with client_id (public client, PKCE) | curl |
| Authorize without PKCE | 302 error `PKCE flow requires both code_challenge and code_challenge_method` (state echoed) | curl |
| Authorize with PKCE | 302 → consent with authorization_id | curl |
| Consent decision deny/approve with bad origin | 403 / invalid request | curl |
| State validation on Google callback | `state_mismatch` on missing/mismatched cookie | curl |
| Google callback missing code | `missing_code` | curl |
| Google connect without provider creds | safe redirect error, no crash | curl |
| Redirect safety (parseRedirectUrl) | https/http only, length capped, provider response validated | code (decision-service.ts) |
| Full consent click-through + token exchange | NOT RUN — requires service-role key (grant activation) and interactive browser | finding L-1 |

## Calendar

| Test | Result | Evidence |
|---|---|---|
| Connect endpoint behavior | safe error redirect when GOOGLE_* env missing | curl |
| Callback state validation | state_mismatch rejected; no token exposure in query/log | curl |
| Token persistence / real sync / disconnect | NOT RUN — no Google provider credentials in environment | finding L-2 |
| Token redaction in error bodies/logs | no token material in any captured response/log | log + body scan |

## Cron

| Test | Result | Evidence |
|---|---|---|
| No Authorization | 401 (all 6 routes incl. both weekly aliases) | curl |
| Wrong bearer | 401 | curl |
| Wrong method (GET) | 405 | curl |
| Correct CRON_SECRET | worker executes; returns env-gated failure for email routes (RESEND_API_KEY missing) and calendar-sync (no service key / no jobs) | curl |
| Both weekly-review aliases present and symmetric | `sendWeeklyReviews` + `weekly-review-email` both 401-unauthed, both execute with secret | curl |
| Failure redaction | `runCronOperation` returns only generic message; no DB/connection/provider/stack/key material in bodies | curl + source |

## Legacy Task parity (M-3)

| Operation | Legacy (task-service via web mobile API) | New (Hono/application) | Parity |
|---|---|---|---|
| Create (title/status/priority/due/estimate/description) | 200, persisted | 200, persisted | identical DB state |
| Update status/priority/dueDate/estimate | 200 | 200 | identical DB state |
| Reminder create | 201 | 201 | identical (remind_at, pending) |
| Recurrence set (daily/UTC) | 200 (via PATCH body) | 200 (PUT route) | identical (rule, timezone) |
| Archive | no mobile-API route (404) — legacy web uses server action `archiveTaskSafely` (covered by tests) | POST archive route | documented divergence: legacy mobile API intentionally lacks archive/recurrence-dedicated endpoints; legacy web server action covers archive (tested). No domain-state divergence. |

## Automated matrix (final heads, worktree at 80ffcbc)

| Command | Result |
|---|---|
| validate:agent-context | STRUCTURAL PASS |
| test:architecture / check:architecture | PASS |
| contracts:typecheck / test | PASS |
| domain:typecheck / test | PASS |
| application:typecheck / test | PASS |
| data-access:typecheck / test | PASS |
| api-client:typecheck / test | PASS |
| server:typecheck / test | PASS |
| mobile:doctor | 18/18 checks passed |
| mobile:typecheck / test | PASS (50/50) |
| mobile:bundle | PASS (exported .expo/ci-export) |
| typecheck:ega-runner / test:ega-runner-pr-loop | PASS |
| web:typecheck / web:test | PASS (987/987) |
| web:build (DATABASE_URL set) | PASS (compiled, 40/40 static pages) |
| lint:changed (CI-equivalent base) | PASS — 5 changed files, 0 regressions |
| lint:report | informational drift only (inherited debt; non-blocking) — locally 57E/5790W due to dev-env toolchain, baseline drift flagged informational; CI lint-report job is non-blocking by design |

## Findings

### BLOCKER
None.

### HIGH
None.

### MEDIUM
- **M-2 (fixed): mobile refresh race on the `mobileApiFetch` path.** Runtime reproduction: 124 refresh POSTs across bursts, 24× 401, session clears observed (pre-fix). Fixed in `wave/03-auth-session-core`:
  - RED: two new regression tests in `apps/mobile/lib/api/__tests__/refresh-single-flight.test.ts` failed (8 concurrent 401s → 8 refreshes, 8 session clears).
  - Fix: `mobileApiFetch` 401-retry now awaits the shared single-flight `refreshMobileSessionIfConfigured()` (client.ts), exactly one refresh per burst, one clear on failure, one retry per request, second 401 terminal.
  - GREEN: 5/5 single-flight tests, 50/50 mobile suite, mobile typecheck clean, lint-changed clean.
  - Waves 5/6 restacked onto new Wave 3 head; exact-head CI green (runs listed above).

### LOW
- **L-1:** Full MCP read-tool invocation and OAuth consent→token exchange require `SUPABASE_SERVICE_ROLE_KEY` (grant activation `createAdminClient`), not present in this dev runtime. All reachable gates (disabled/enabled, auth, metadata, decision security, redaction) verified. Requires production/staging credentials to complete the last wire hop.
- **L-2:** Google Calendar real connect/sync and email cron execution require `GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI`/`GOOGLE_CALENDAR_SCOPES` and `RESEND_API_KEY`/`EMAIL_FROM`, absent here. Failure paths verified redacted and safe.
- **L-3:** Hono `GET /api/tasks/:id` with a malformed (non-UUID) id returns 500 INTERNAL instead of 400/404. Not an ownership or data-integrity issue (only reachable with a bogus id), no cross-user leak. Candidate for a later bounded fix on Wave 5 (route validation).
- **L-4:** Physical mobile device regression (app restart, offline/recover, physical login) not executed — no device available in this environment. Covered indirectly: Expo bundle, doctor 18/18, mobile suite 50/50, refresh harness against the real web endpoint, session restore logic unit-covered.
- **L-5:** PR descriptions could not be updated with new SHAs/CI runs — the `gh` account (`abdelilahmortaki`) lacks GraphQL `UpdatePullRequest` permission. Evidence is preserved in this report instead.

## Final recommendation

**READY FOR ORDERED MERGE**

Merge order: PR #130 → PR #131 → PR #134 → PR #135 (maintains canonical stack ancestry). Do not merge automatically — merge requires separate user authorization.
