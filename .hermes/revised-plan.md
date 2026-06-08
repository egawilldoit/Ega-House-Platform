# REVISED PLAN — EGA House Agent Task Control API

## Critical Changes from Initial Plan

| Initial Plan | Revised Plan | Rationale |
|---|---|---|
| New Drizzle task repository | Reuse existing Supabase services via `getSupabaseServiceClient()` | Existing services have 1500+ lines of validated business logic (scope checks, transitions, calendar sync, recurrence). Duplicating is high-risk. |
| Skip rate limiting/audit (EGA-413 omitted) | Minimal rate limiter + audit table | EGA-414/415/417 ACs require rate limiting and audit events |
| 4 separate handler files | 1 consolidated `agent-task-handlers.ts` | Less indirection, follows capabilities handler pattern |
| Separate owner-scope middleware | Inline in agent-task-service wrapper | Simpler, no framework dependency |

## Architecture

```
Request → resolveAgentAuth → scope guard → rate limit check → AgentTaskService → existing task services (admin client)
```

## Files to Create/Modify

| File | Action | Issue |
|---|---|---|
| `src/db/schema.ts` | Add `task_external_refs` + `agent_integration_events` | 414+ |
| Drizzle migration | New | 414+ |
| `src/lib/contracts/agent.ts` | Extend error codes | 414 |
| `src/lib/services/agent-task-service.ts` | NEW — orchestrator wrapping existing services | 414 |
| `src/lib/services/agent-rate-limit-service.ts` | NEW — minimal token-based rate limiter | 414 |
| `src/lib/services/agent-audit-service.ts` | NEW — minimal audit event writer | 415 |
| `src/lib/http/agent-task-handlers.ts` | NEW — all CRUD handler factories | 414 |
| `src/app/api/agent/projects/route.ts` | NEW | 414 |
| `src/app/api/agent/goals/route.ts` | NEW | 414 |
| `src/app/api/agent/tasks/route.ts` | NEW (GET+POST+PATCH) | 414+ |
| `src/app/api/agent/tasks/archive/route.ts` | NEW | 417 |
| Tests (~7 files) | NEW | All |
| `docs/agent-task-control-api.md` | NEW | 418 |

## Execution Order

1. Merge EGA-412 to main ✓ (already done)
2. EGA-414: Schema + rate limit + read endpoints
3. EGA-415: Task creation + idempotency
4. EGA-416: Task updates + allowlists
5. EGA-417: Archive/unarchive
6. EGA-418: Documentation
7. EGA-419: Security regression
8. EGA-411: Close parent
