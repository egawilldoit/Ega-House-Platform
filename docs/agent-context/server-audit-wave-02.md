# Wave 02 server audit

Status: transport audit and regression coverage complete; Operator error
classification, bounded proposal reads, optional-body handling, and
post-claim staleness corrections are included below.

Base: `def37b14b4e595d37431cc7d98cf6fb86d2980b8`

Implementation evidence head: `41ce8319` (documentation acceptance commit
follows this implementation head).

Scope: authenticated Hono transport in `apps/server`. Evidence below is from
the checked-in route source and the executable server suite at the corrected
head. A passing test proves the exercised fake-Supabase path; it does not claim
a deployed database or production runtime.

## Boundary evidence

| Invariant | Evidence | Result |
| --- | --- | --- |
| Actor comes only from verified bearer | `apps/server/src/app.ts:80-111` extracts the bearer, calls `verifyToken`, then constructs `AuthenticatedActor`; `apps/server/test/server.test.ts:153-208` covers missing, malformed, empty, and invalid auth. `server.test.ts:240-262` and `task-mutations-parity.test.ts:41-68` reject/ignore caller identity fields. | PROVEN |
| RLS client carries the same token | `apps/server/src/app.ts:108-109` sets the actor and `createRequestClient(token)` after verification; `apps/server/src/auth.ts:37-64` builds the Supabase client with the bearer Authorization header. Repository tests assert owner predicates throughout `apps/server/test` and `packages/data-access/test`. | PROVEN by source and request-scoped test doubles; deployed RLS NOT RUNTIME VERIFIED |
| Public surface is intentionally narrow | `apps/server/src/app.ts:60-65` allows only `/api/auth/session` and `/api/auth/refresh` through auth middleware; `/health` and `/ready` are separate operational endpoints. `vercel-entrypoint.test.ts` and `platform-server.test.ts` exercise these paths. | PROVEN |
| Transport delegates policy | Route modules construct request-scoped repositories and call `@ega/application`; no route owns persistence SQL. The audit found no new framework or service-role CRUD path. | PROVEN by source inspection |
| Error boundary does not expose raw failures | `apps/server/src/app.ts:146-155` logs server-side and returns the stable INTERNAL envelope. Operator routes preserve typed application outcomes: validation → 400, not found → 404, conflict → 409, unknown/repository failure → 500. | PROVEN for exercised paths; unexercised route coverage listed below |

## Endpoint-family matrix

The “checks” column records executable evidence for the relevant combinations:
valid request, malformed/missing data, auth failure, missing/unauthorized
resource, empty result, invalid transition, idempotency, status, and response
shape where that behavior exists for the family.

| Family / source routes | Checks and evidence | Result / remaining risk |
| --- | --- | --- |
| Auth — `routes/auth.ts` | `platform-server.test.ts:94-178` covers session success, bad/missing credentials, refresh success/dead token, and logout auth. Middleware tests cover invalid bearer. | PASS; production identity provider NOT RUNTIME VERIFIED |
| Projects — `routes/projects.ts` | `server.test.ts:210-524` covers create/read/detail/update/archive/unarchive, missing/invalid JSON, duplicate conflict, 404, repository failure, actor scoping, status and response shape. | PASS |
| Goals — `routes/goals.ts` | `server.test.ts:525-759` covers list/create/status/health/next-step/archive/unarchive, missing/invalid data, 404/error mapping, actor scope, and response shape. | PASS |
| Tasks — `routes/tasks.ts` | `task-server.test.ts`, `task-mobile-parity.test.ts`, `task-mutations-parity.test.ts`, `task-recurrence-today-mutations.test.ts` cover list/detail/create/update/archive/restore/pin/unpin/reminder/recurrence, invalid values, unavailable resources, identity, idempotent pin/unpin, and enriched response envelopes. | PASS |
| Today — `routes/today.ts` | `today-mobile-parity.test.ts` covers read model and add/remove/status/clear-completed; not-found mutation behavior and date/time-context behavior are exercised. | PASS; no deployed runtime proof |
| Timer — `routes/timer.ts` | `platform-server.test.ts:179-278` covers workspace, start, second/concurrent start, stop, ownership, and response state. Application tests cover invalid task/state transitions. | PASS |
| Inbox — `routes/inbox.ts` | `inbox-server.test.ts`, `inbox-fast-capture.test.ts`, and `server-coverage-wave-02.test.ts` cover list/detail/create/update/archive/restore, empty/missing, ownership, converted guard, malformed data, same-key idempotency, and the canonical convert response envelope. | PASS; live database/RLS NOT RUNTIME VERIFIED |
| Notifications — `routes/notifications.ts` | `notifications.test.ts:101-210` covers auth, list/unread, read/opened, read-all, device registration/removal, preferences, invalid input and owner scoping. | PASS |
| Friction — `routes/friction.ts` | `friction-server.test.ts:108-487` covers auth, empty/populated signals, owner scope, rolling window, timezones, DST, malformed evidence and response shape. | PASS |
| Health — `routes/health.ts` | `server-coverage-wave-02.test.ts` covers authenticated empty snapshot, owner predicates, response envelope, and repository failure mapped to the stable 500 response; application tests cover recommendations and timezone cases. | PASS; live database/RLS NOT RUNTIME VERIFIED |
| Operator — `routes/operator.ts` | `server-coverage-wave-02.test.ts` covers authenticated owner-scoped list/get, successful create/approve/apply/dismiss envelopes, optional bodyless apply, malformed create/revise/apply bodies, missing-proposal responses, persistence failure, bounded default/rejected limits, and the lost-claim conflict. Application-level lifecycle/error tests cover idempotency, a Task update between pre-claim inspection and claim, and a Task update immediately before the conditional Today write; the data-access tests prove the repository default bound and expected-version conflict. | PASS; live database/RLS NOT RUNTIME VERIFIED |
| Time Context — `routes/time-context.ts` | `server-coverage-wave-02.test.ts` covers authenticated UTC fallback, explicit date, owner predicate, and malformed date rejection without storage access; domain/application tests cover timezone, DST and historical windows. | PASS; live database/RLS NOT RUNTIME VERIFIED |
| Weekly Review — `routes/weekly-review.ts` | `server-coverage-wave-02.test.ts` covers authenticated empty contract, owner-scoped reads, and invalid week rejection without storage access; application tests cover source data, comparison and validation. | PASS; live database/RLS NOT RUNTIME VERIFIED |
| Operational/unknown — `app.ts`, `routes/health.ts` | `vercel-entrypoint.test.ts` covers `/health`, `/ready`, API auth, unknown path JSON 404 and the native entrypoint. | PASS for local module runtime |

## Audit rulings

1. The authenticated actor and request-scoped client are established once in
   the `/api/*` middleware and are the only authority passed to application
   and repository code. No caller-selected user id was found in route source.
2. Existing tests provide broad coverage for the core Project → Goal → Task →
   Today → Timer and Inbox/Notifications loops. Those paths have no proven P0
   or P1 defect at this audit base.
3. The transport coverage gap for Health, Operator, Time Context, Weekly
   Review, and Inbox conversion is closed by
   `apps/server/test/server-coverage-wave-02.test.ts`. The fake Supabase client
   proves route status/envelopes and owner predicates, but it is not a live
   database or RLS test.
4. The audit found four Operator/API boundary defects. Mutation routes returned
   400 for a missing proposal while the GET route and other resource routes use
   404; repository/time-context failures were reported as client validation
   errors; a lost atomic apply claim could be reported as validation instead of
   conflict; and proposal listing accepted unsafe/partial limits and could
   reach an unbounded repository query. The application now carries explicit
   error classes and bounded list policy, the transport maps them to 400/404/
   409/500 as appropriate, the repository always applies a 50-item default with
   a 200-item cap, and the API client preserves CONFLICT/409 envelopes,
   including a malformed 409 envelope without a machine code. Apply preserves
   its body-omitted meaning while rejecting explicitly malformed JSON before
   storage access. Each defect has focused regression coverage.
5. Approved Operator apply now checks Task versions again after the atomic
   proposal claim and before any Today mutation, then passes that observed
   version to a conditional persistence write. The regression tests cover both
   the claim boundary and the final-read/write boundary: the first makes the
   proposal stale, while the second returns a conflict and preserves the
   concurrent Task update. Crash recovery remains intentionally exempt from
   the pre-mutation stale check because `applying` retries must tolerate the
   proposal's own prior `plannedForDate` writes.
6. The audit found no justification for a Hono rewrite, service-role shortcut,
   duplicate business policy, or new abstraction. Any implementation should
   remain limited to transport tests or regression-backed corrections.

## Runtime classification

- L1 static/source inspection: VERIFIED.
- L2 package/server tests: VERIFIED at the implementation evidence head
  (server 128/128; application 416/416; data-access 93/93; API client 47/47).
- L3 live external HTTP/auth/database/RLS: NOT VERIFIED in this audit.
- Production deployment: not triggered.

## Known residuals

- `readJsonBody` still relies on the runtime JSON parser without a route-wide
  byte limit. No large-body behavior was observed or required by this wave;
  adding a limit would affect every existing JSON route and is deferred unless
  a measured or security-backed requirement appears.
- Route fakes prove actor predicates and response mapping, not live Supabase RLS
  enforcement. Deployed authenticated HTTP, database, and RLS remain NOT
  RUNTIME VERIFIED.
