# EGA House Agent Task Control API — Initial Implementation Plan

## Current Architecture

- **Runtime**: Next.js 15 App Router with TypeScript
- **Database**: PostgreSQL via Drizzle ORM + `postgres-js` driver
- **Existing Auth**: Supabase SSR JWT (mobile API uses `resolveMobileRequestAuth`)
- **Proposed Auth**: Custom HMAC-SHA256 bearer tokens (`ega_live_<prefix>_<secret>`)
- **Test Framework**: Vitest + node:test + assert (native test runner per convention)

## Existing State (hermes/EGA-412-agent-api-foundation branch)

EGA-412 is partially implemented with:
- `agentIntegrationTokens` table in schema (migrated)
- `agent-token.ts` — crypto functions (generate, parse, hash, verify)
- `agent-token-service.ts` — auth resolution, token generation
- `agent-token-repository.ts` — Drizzle-based repository
- `agent-token-scopes.ts` — scope validation/normalization
- `agent-capabilities-handler.ts` — handler factory
- `src/app/api/agent/capabilities/route.ts` — capabilities endpoint
- Extensive tests for all above

**What EGA-412 still needs**: Nothing significant — it's effectively complete with tests.

## Proposed Agent API Module Boundaries

```
src/lib/
  contracts/agent.ts          # EXISTING — add new error codes + response types
  crypto/agent-token.ts       # EXISTING — no changes
  services/
    agent-token-service.ts    # EXISTING — no changes
    agent-token-repository.ts # EXISTING — no changes
    agent-token-scopes.ts     # EXISTING — no changes
    agent-task-repository.ts  # NEW — Drizzle-based task CRUD (replaces Supabase dep)
  http/
    agent-capabilities-handler.ts  # EXISTING — no changes
    agent-errors.ts           # NEW — shared error response factories
    agent-tasks-handler.ts    # NEW — handler factory for task endpoints
    agent-projects-handler.ts # NEW — handler factory for project endpoints
    agent-goals-handler.ts    # NEW — handler factory for goal endpoints
src/app/api/agent/
  capabilities/route.ts       # EXISTING — no changes
  projects/route.ts           # NEW — GET (list)
  goals/route.ts              # NEW — GET (list, with projectId filter)
  tasks/route.ts              # NEW — GET (list), POST (create), PATCH (update)
  tasks/[id]/archive/route.ts # NEW — POST (archive), DELETE (unarchive)
```

## Endpoint Contracts

| Method | Path | Scope | Issue |
|--------|------|-------|-------|
| `GET` | `/api/agent/capabilities` | none (existing) | 412 |
| `GET` | `/api/agent/projects` | `projects.read` | 414 |
| `GET` | `/api/agent/goals?projectId=...` | `goals.read` | 414 |
| `GET` | `/api/agent/tasks?...` | `tasks.read` | 414 |
| `POST` | `/api/agent/tasks` (envelope: `{ tasks: [...] }`) | `tasks.create` + `tasks.bulk` | 415 |
| `PATCH` | `/api/agent/tasks` (envelope: `{ tasks: [...] }`) | `tasks.updateAny` | 416 |
| `POST` | `/api/agent/tasks/archive` (envelope) | `tasks.archive` | 417 |

## Auth Context Pattern

Every route handler follows this pattern:
```typescript
const auth = await resolveAgentAuth(request, repo);
if (!auth.ok) return NextResponse.json(auth.response, { status: auth.status });
// scope guard
if (!auth.context.scopes.tasks?.read) return forbidden();
// use auth.context.ownerUserId for all DB queries
```

## Data Access Strategy

**New Drizzle-based repository** (not Supabase):
- Create `agent-task-repository.ts` using `@/db/client` (drizzle-orm)
- Every query filters by `owner_user_id` from auth context
- Reuse validation helpers from existing domain modules:
  - `task-domain.ts` — `isTaskStatus`, `isTaskPriority`
  - `task-due-date.ts` — `normalizeTaskDueDateInput`
  - `task-estimate.ts` — `normalizeTaskEstimateInput`
  - `task-schedule.ts` — `normalizeTaskScheduleInput`
- Do NOT reuse Supabase-dependent service functions

## Database Changes

Only one new migration needed:
- `task_external_refs` table (or `agent_task_external_refs`):
  - `id` (uuid PK), `owner_user_id`, `task_id` (FK→tasks), `source` (varchar), `source_id` (varchar), `created_at`
  - UNIQUE constraint on `(owner_user_id, source, source_id)`
  - Used for idempotent task creation (EGA-415) and task targeting by source ref (EGA-416, 417)

## Error Conventions

Extended `AgentErrorCode`:
```typescript
"UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "VALIDATION_ERROR" | "CONFLICT" | "UNPROCESSABLE" | "INTERNAL_ERROR"
```

## Implementation Strategy

Since EGA-413 (Guardrails: audit, rate-limit) is NOT in scope for implementation, we:
1. **Skip full audit event table** — implement minimal inline audit logging via console.warn
2. **Skip rate-limiting middleware** — document as future enhancement
3. **Enforce bulk caps manually** in each handler
4. **Focus on the core CRUD endpoints**

## Issue Execution Order

1. **EGA-412** — Already implemented. Verify tests pass, merge to main.
2. **EGA-414** — Project, Goal, Task read endpoints
3. **EGA-415** — Task creation with idempotency
4. **EGA-416** — Task updates with strict allowlists
5. **EGA-417** — Archive/unarchive
6. **EGA-418** — Documentation
7. **EGA-419** — Security regression
8. **EGA-411** — Close parent last

## File Count Estimate

- New service files: 4 (agent-task-repository.ts, agent-errors.ts, agent-tasks-handler.ts, agent-projects-goals-handler.ts)
- New route files: 3 (projects/route.ts, goals/route.ts, tasks/[id]/archive/route.ts)
- Existing route files modified: 1 (tasks/route.ts — add POST, PATCH to existing)
- New migration: 1 (task_external_refs table)
- New documentation: 1 (docs/agent-task-control-api.md)
- Test files: ~5-7 new
- Schema changes: 1 table addition

## Risks

1. **Task service reuse gap**: Existing services depend on Supabase SSR. New Drizzle repository avoids this but means some validation/workflow logic must be reimplemented at the Drizzle layer.
2. **No rate limiting**: PRD requires it but issue 413 is not implemented. Document as gap.
3. **No audit events**: PRD requires them but 413 is not implemented. Keep minimal logging.
4. **Branch state**: 412 work exists on separate branch. Must merge to main before continuing.
5. **Test count will increase**: Ensure all new tests follow existing patterns.
