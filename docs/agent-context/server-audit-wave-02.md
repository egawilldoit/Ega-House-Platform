# Wave 02 server audit

Status: audit baseline committed before any server implementation change.

Base: `def37b14b4e595d37431cc7d98cf6fb86d2980b8`

Scope: authenticated Hono transport in `apps/server`. Evidence below is from
the checked-in route source and the executable server suite at this base. A
passing test proves the exercised fake-Supabase path; it does not claim a
deployed database or production runtime.

## Boundary evidence

| Invariant | Evidence | Result |
| --- | --- | --- |
| Actor comes only from verified bearer | `apps/server/src/app.ts:80-111` extracts the bearer, calls `verifyToken`, then constructs `AuthenticatedActor`; `apps/server/test/server.test.ts:153-208` covers missing, malformed, empty, and invalid auth. `server.test.ts:240-262` and `task-mutations-parity.test.ts:41-68` reject/ignore caller identity fields. | PROVEN |
| RLS client carries the same token | `apps/server/src/app.ts:108-109` sets the actor and `createRequestClient(token)` after verification; `apps/server/src/auth.ts:37-64` builds the Supabase client with the bearer Authorization header. Repository tests assert owner predicates throughout `apps/server/test` and `packages/data-access/test`. | PROVEN by source and request-scoped test doubles; deployed RLS NOT RUNTIME VERIFIED |
| Public surface is intentionally narrow | `apps/server/src/app.ts:60-65` allows only `/api/auth/session` and `/api/auth/refresh` through auth middleware; `/health` and `/ready` are separate operational endpoints. `vercel-entrypoint.test.ts` and `platform-server.test.ts` exercise these paths. | PROVEN |
| Transport delegates policy | Route modules construct request-scoped repositories and call `@ega/application`; no route owns persistence SQL. The audit found no new framework or service-role CRUD path. | PROVEN by source inspection |
| Error boundary does not expose raw failures | `apps/server/src/app.ts:146-155` logs server-side and returns the stable INTERNAL envelope. Route tests cover validation, not-found, and repository-failure mappings. | PROVEN for exercised paths; unexercised route coverage listed below |

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
| Inbox — `routes/inbox.ts` | `inbox-server.test.ts`, `inbox-fast-capture.test.ts` cover list/detail/create/update/archive/restore, empty/missing, ownership, converted guard, malformed data, and same-key idempotency. Convert is exercised through the application boundary and route source; a dedicated route conversion response test is a remaining coverage gap. | PARTIAL — add/verify dedicated convert transport case if behavior is changed |
| Notifications — `routes/notifications.ts` | `notifications.test.ts:101-210` covers auth, list/unread, read/opened, read-all, device registration/removal, preferences, invalid input and owner scoping. | PASS |
| Friction — `routes/friction.ts` | `friction-server.test.ts:108-487` covers auth, empty/populated signals, owner scope, rolling window, timezones, DST, malformed evidence and response shape. | PASS |
| Health — `routes/health.ts` | Application tests cover the workload snapshot and recommendations, including empty/quality/fallback/timezone cases. No server transport test currently exercises `/api/health/snapshot`. | PARTIAL — transport status/contract/error path is NOT VERIFIED |
| Operator — `routes/operator.ts` | Application tests cover proposal policy/idempotency/approval/apply/dismiss. No server transport suite currently exercises proposal routes, query validation, actor scope, or response envelopes. | PARTIAL — transport status/contract/error path is NOT VERIFIED |
| Time Context — `routes/time-context.ts` | Domain/application tests cover dates, timezone, fallback, DST and historical windows. No server transport test currently exercises `/api/time-context`. | PARTIAL — transport status/contract/error path is NOT VERIFIED |
| Weekly Review — `routes/weekly-review.ts` | Application tests cover weekly source data, comparison, owner scope and validation. No server transport test currently exercises `/api/review`. | PARTIAL — map/contract/status/error path is NOT VERIFIED |
| Operational/unknown — `app.ts`, `routes/health.ts` | `vercel-entrypoint.test.ts` covers `/health`, `/ready`, API auth, unknown path JSON 404 and the native entrypoint. | PASS for local module runtime |

## Audit rulings

1. The authenticated actor and request-scoped client are established once in
   the `/api/*` middleware and are the only authority passed to application
   and repository code. No caller-selected user id was found in route source.
2. Existing tests provide broad coverage for the core Project → Goal → Task →
   Today → Timer and Inbox/Notifications loops. Those paths have no proven P0
   or P1 defect at this audit base.
3. Health, Operator, Time Context, and Weekly Review have application/domain
   coverage but lack transport-level executable tests. This is a verification
   gap, not evidence that the routes work in production. It is the highest
   confidence Wave 02 follow-up and must be closed or explicitly carried as a
   NOT VERIFIED risk before acceptance.
4. The audit found no justification for a Hono rewrite, service-role shortcut,
   duplicate business policy, or new abstraction. Any implementation should be
   limited to transport tests or a regression-backed correction.

## Runtime classification

- L1 static/source inspection: VERIFIED.
- L2 package/server tests: VERIFIED at the accepted predecessor base.
- L3 live external HTTP/auth/database/RLS: NOT VERIFIED in this audit.
- Production deployment: not triggered.
