# EGA House Waves 2–6 Platform Consolidation Design

Date: 2026-08-10
Status: Approved for implementation by user instruction to execute Waves 2–6 sequentially without stopping.
Starting baseline: `main` after first-wave architecture migration and production smoke validation.

## Goal

Finish the second architecture consolidation wave without changing product intent: move remaining compatibility surfaces onto explicit application/transport boundaries, preserve Supabase/RLS authority, keep web/mobile/agent behavior compatible, then reduce inherited technical debt.

## Delivery model

Use five ordered stacked branches/PRs. Each branch is based on the previous wave head. No branch is merged or deployed automatically.

1. `wave/02-task-today-core`
2. `wave/03-auth-session-core`
3. `wave/04-agent-task-boundary`
4. `wave/05-integration-boundaries`
5. `wave/06-tech-debt-baseline`

The final Wave 6 head must contain all Waves 2–6 and be suitable for runtime testing as one coherent candidate.

## Considered approaches

### A. Big-bang compatibility rewrite

Move Tasks, Auth, Agent, MCP/OAuth/integrations/cron and lint debt together in one branch.

Rejected: very poor fault isolation, difficult review, large rollback surface, and weak runtime attribution.

### B. Thin routing-only adapters

Leave existing business logic in `apps/web` and only add wrappers around it for Hono/mobile/agent.

Rejected as the final architecture: it would preserve duplicate authority and keep web framework code as a hidden application layer. It can be used temporarily as a compatibility bridge inside a wave, but not as the final boundary.

### C. Ordered shared-core extraction (selected)

Reuse the first-wave pattern:

```text
contracts/domain
      ↓
application ports + use cases/read models
      ↓
data-access adapters
      ↓
transport adapters
```

Web Server Components/Actions may compose application + data-access directly. Native/external consumers use Hono + `@ega/api-client`. Agent/MCP/integration transports call shared application authority instead of duplicating task/auth semantics.

This gives the best evidence and rollback boundaries while preserving existing runtime behavior.

---

# Wave 2 — Tasks / Today / recurrence / reminders

## Problem

Task behavior is currently spread across Next Server Actions, task services, transition services, Today planner/read services, mobile route handlers, recurrence helpers, reminder delivery, focus queue, timer integration, calendar sync, and Agent task services.

## Target

Add Task/Today application authority while retaining operational integrations as adapters.

```text
apps/web ───────────────┐
                       ↓
                 @ega/application
                 task/today ports
                       ↓
                 @ega/data-access
                       ↓
                 Supabase / RLS

apps/mobile → @ega/api-client → apps/server → same application authority
```

### Application owns

- task create/update/status/priority/archive semantics;
- blocked-reason and scope validation;
- recurrence intent/normalization orchestration using pure domain rules;
- reminder create/cancel intent;
- Today read-model composition contract;
- stable application errors.

### Adapters retain

- Next redirects/revalidation/`after()` hooks;
- calendar provider calls and queue draining;
- email reminder delivery worker behavior;
- timer side effects until explicitly migrated;
- Supabase query syntax and RLS enforcement.

### Compatibility

Existing web URLs/forms and existing mobile DTO shapes remain stable. Legacy Next mobile task endpoints may remain as compatibility facades until the new Hono/API-client route is proven.

## Wave 2 acceptance

- Shared task application layer has no Next/React/Supabase/DB imports.
- Supabase task repositories are request-scoped and owner-scoped.
- Hono exposes authenticated Task/Today endpoints.
- API client exposes typed Task/Today methods.
- Mobile can use the new API client without importing server/application/data-access internals.
- Existing task, today, recurrence, reminder, timer and Agent regression suites stay green.
- No DB schema migration unless a failing existing behavior proves one is required; default is no DB mutation.

---

# Wave 3 — Auth/session consolidation

## Problem

Web uses Supabase SSR cookies while mobile uses bearer-token session exchange and the standalone Hono server separately verifies bearer tokens. The models are intentionally different at transport level but share identity/session semantics that should be explicit.

## Target

Create one platform-neutral authenticated identity/session contract while retaining transport-specific storage:

- web: cookie-backed Supabase SSR session;
- mobile: secure bearer/refresh-token storage;
- Hono: bearer verification;
- application: only `AuthenticatedActor` and stable auth errors.

### Rules

- Never make mobile depend on web cookies.
- Never accept actor identity from body/query/path/custom user-id headers.
- Never use service-role authorization for normal user traffic.
- Keep Supabase as token/session authority.
- Centralize user mapping and auth error semantics in platform-neutral contracts/application helpers where possible.

## Wave 3 acceptance

- Web, Hono and mobile all derive the same actor shape from verified Supabase identity.
- Mobile refresh remains one-retry maximum and clears the session on terminal refresh failure.
- Auth error envelopes are consistent across new Hono/API-client paths.
- Cookie policy remains web-owned; SecureStore remains mobile-owned.
- Existing auth/session E2E and mobile auth tests remain green.

---

# Wave 4 — Agent task-control boundary

## Problem

Agent task behavior currently has dedicated web-layer services and handlers that risk becoming an independent task business-logic authority.

## Target

Agent remains its own authentication/scopes/rate-limit transport, but task mutations/reads delegate to shared Task application use cases.

```text
Agent token/scopes/rate limits
           ↓
Agent HTTP transport
           ↓
shared Task application authority
           ↓
repository/data-access boundary
```

Agent-specific contracts, idempotency, token scopes, request correlation, and response compatibility remain transport concerns.

## Wave 4 acceptance

- Agent task service no longer owns competing status/priority/archive/task-scope rules.
- Existing Agent API response contract remains compatible.
- Token scope/rate-limit/idempotency behavior remains unchanged.
- Agent regression suite remains green.

---

# Wave 5 — MCP / OAuth / integrations / cron cleanup

## Problem

These surfaces were retained during Wave 1 because they are operational boundaries. The objective is not to force them into one transport; it is to remove duplicated domain/application logic and make ownership explicit.

## Target ownership

- MCP: protocol adapter; delegates product operations to application services.
- OAuth: provider/session handshake adapter; no task/project/goal business authority.
- Integrations: provider adapters and mapping only.
- Cron/background routes: trigger orchestration; reusable worker/application functions own the work.

## Safety constraints

- Preserve existing routes and callback URLs.
- Preserve secrets/env names unless an unavoidable correctness issue is proven.
- Do not delete operational assets merely because imports are absent.
- Do not change database schema by default.
- Keep service-account/privileged operations narrowly limited to background jobs that already require them.

## Wave 5 acceptance

- Transport handlers are thin and testable.
- Shared application authority is used for product mutations.
- MCP/OAuth/integration/cron regression tests stay green.
- Security/static-boundary checks reject transport-to-UI coupling and payload-selected actor identity.

---

# Wave 6 — lint and technical-debt reduction

## Problem

Wave 1 intentionally retained inherited lint debt and used a baseline-aware regression gate.

## Target

Reduce debt only after behavior boundaries are stabilized.

### Priorities

1. Fix errors in files touched by Waves 2–5.
2. Remove dead compatibility shims proven unused by current-tree search + tests.
3. Reduce repository lint error baseline toward zero without broad behavior changes.
4. Keep warning cleanup secondary to errors unless warnings indicate correctness/security issues.
5. Remove superseded migration-only scaffolding only when unified CI has equivalent coverage.

## Wave 6 acceptance

- No new lint errors/warnings versus its parent.
- Inherited lint error baseline is strictly lower than the current baseline, ideally zero.
- Full typecheck/tests/build/architecture/security/audit/mobile/server/api-client/Agent/Runner suites pass.
- Generated-artifact/diff hygiene passes.

---

# Cross-wave invariants

1. Supabase/RLS remains user-data enforcement authority.
2. Actor identity always comes from verified authentication material.
3. `@ega/domain` remains framework/persistence neutral.
4. `@ega/contracts` remains platform neutral.
5. `@ega/application` has no Next/React/Expo/Supabase/Drizzle imports.
6. `@ega/data-access` may know Supabase but not Next rendering/navigation.
7. `@ega/api-client` has no Supabase/application/data-access implementation dependency.
8. Mobile cannot import web/server/data-access/application internals.
9. Web does not self-fetch Hono for server-side operations that can call application/data-access directly.
10. No merges, production deployment, secrets mutation, branch-protection mutation, or database migration without explicit authorization.

# Testing strategy

Each wave uses TDD for new shared boundaries: failing contract/application/repository/transport tests first, then implementation. Every wave must run the existing Unified Platform Validation superset plus wave-specific tests. Runtime tests are deferred until the final Wave 6 candidate or an explicitly requested intermediate candidate.

# Runtime-ready exit criteria

The Wave 6 head is runtime-test ready when:

- all five wave PRs are open and stacked in order;
- latest head CI is green;
- no unresolved important/critical review findings remain;
- no DB migration or secret change is pending;
- production remains untouched;
- the runtime checklist documents web, Hono, mobile, Agent, MCP/OAuth/integration/cron smoke tests and cross-user RLS isolation.
