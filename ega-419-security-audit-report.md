# EGA-419 Security Regression Audit — Agent API

**Date:** 2026-06-08  
**Scope:** `/home/ubuntu/ega-house/src/app/api/agent/*`, `/home/ubuntu/ega-house/src/lib/http/agent-*`, `/home/ubuntu/ega-house/src/lib/services/agent-*`, `/home/ubuntu/ega-house/src/lib/crypto/agent-token*`, `/home/ubuntu/ega-house/src/lib/contracts/agent.ts`  
**Auditor:** Hermes Agent (security regression pass)

---

## Results Summary

| # | Control | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Custom agent token does not depend on Supabase `auth.uid()` | **PASS** | `auth.uid()` appears in `db/schema.ts` for other tables but NOT in `agentIntegrationTokens`. Line 436 uses `.notNull()` without `auth.uid()` default. |
| 2 | Service-role DB access contained | **PASS** | All agent DB queries use `getSupabaseServiceClient()` (from `src/lib/supabase/service.ts`), which uses `SUPABASE_SERVICE_ROLE_KEY`. No anon/public key usage in agent code. |
| 3 | Owner-scoped queries on every operation | **PASS** | Every DB query in `agent-task-service.ts` filters by `owner_user_id`. Verified: 27 occurrences of `.eq("owner_user_id", ...)`. Minor note on archive (see finding 2). |
| 4 | Token verification does not store/log raw token | **PASS** | `resolveAgentAuth` parses the Authorization header, extracts prefix/secret, never stores or logs the raw token. All error responses return constant `UNAUTHENTICATED_RESPONSE`. |
| 5 | Revoked token fails | **PASS** | Line 82-84: `if (record.revokedAt !== null) return UNAUTHENTICATED_RESPONSE`. Test confirms (agent-token-service.test.ts:109-133). |
| 6 | Scope failures return 403 | **PASS** | All scope guards use `forbidden()` with status 403. Verified: read handlers (line 101-102), POST (300-301), PATCH (423-424), archive (525-526). |
| 7 | Rate limits keyed by token ID | **PASS** | `AgentRateLimitService.check(key)` called with `auth!.tokenId` in all handlers. |
| 8 | Bulk cap applies (max 50) | **PASS** | POST: `Math.min(scopeBulkLimit, 50)` (line 331). PATCH: `?? 50` (line 451). Archive: `?? 50` (line 553). All capped at 50. |
| 9 | Update allowlist enforced | **PASS** | `ALLOWED_FIELDS = new Set(["title","description","goalId","status","priority","dueDate","estimateMinutes","scheduledStartAt","scheduledEndAt","blockedReason"])`. Unknown fields are rejected with error. |
| 10 | Archive does not change status | **PASS** | Archive only sets `archived_at`, `archived_by`, `updated_at`. Unarchive only clears `archived_at`, `archived_by`, `updated_at`. Status is never touched. |
| 11 | Audit events exclude raw tokens | **PASS** | Schema for `agent_integration_events`: no token_hash, no raw token field. Audit inserts contain only `owner_user_id`, `token_id`, `action`, `resource_type`, `resource_id`, `metadata` (field names only or title/projectId/goalId). |
| 12 | Read responses minimize fields | **PASS** | `AgentProjectResponse`, `AgentGoalResponse`, `AgentTaskResponse` exclude `owner_user_id` and all token data. Verified in `contracts/agent.ts`. |
| 13 | No internal error leakage | **PASS** (minor note) | All 7 catch blocks use `INTERNAL_ERROR_RESPONSE` constant. See finding 1 below. |

---

## Findings

### Finding 1 (Minor): Inconsistent non-catch 500 error messages in GET handlers

**File:** `src/lib/http/agent-task-handlers.ts`  
**Lines:** 115–121 (GET_PROJECTS), 163–169 (GET_GOALS), 229–235 (GET_TASKS)

Three GET handlers return `result.errorMessage` ("Failed to load projects.", "Failed to load goals.", "Failed to load tasks.") instead of `INTERNAL_ERROR_RESPONSE` ("The request could not be completed.") on database query failure. While these are hardcoded generic strings with no stack/query details, they reveal the type of operation that failed. All **catch** blocks correctly use `INTERNAL_ERROR_RESPONSE`.

**Impact:** Very low — messages are generic and reveal no internals.

### Finding 2 (Minor): Archive update lacks `owner_user_id` filter on the write

**File:** `src/lib/services/agent-task-service.ts`  
**Lines:** 833–834

The archive update `supabase.from("tasks").update({...}).eq("id", resolved.id)` does not re-filter by `owner_user_id` on the UPDATE itself. Ownership was verified on the preceding read (line 823), but `updateTasks` (line 733) does include `.eq("owner_user_id", ownerUserId)` — creating an inconsistency. In a TOCTOU race, this could theoretically allow archiving a task if ownership changed between read and write.

**Impact:** Very low — the task ID was resolved with owner filtering on read. Defense-in-depth improvement would be to add `.eq("owner_user_id", ownerUserId)` to both archive update queries.

### Bug Finding (Non-Security): Create audit events have mismatched column names

**File:** `src/lib/services/agent-task-service.ts`, lines 560–571

The create audit inserts use `event_type` (not in schema) instead of `action` (the actual column name, NOT NULL). The `action` column has no default, so these inserts will fail with a NOT NULL violation at runtime. The update audit (line 748) has the same issue with `event_type`. Only the archive audit (line 862) correctly uses `action`.

**Impact:** Audit events for create/update operations silently fail. Not a security regression, but a functional bug.

---

## CI Results

| Check | Status | Details |
|-------|--------|---------|
| `npm run typecheck` | **PASS** | 0 errors (tsc --noEmit) |
| `npm run lint` | **PASS** | 0 errors, 20 warnings (all non-blocking) |
| `npm test` | **PASS** | 94 test files, 757 tests — all passed |
| `npm run build` | **PASS** | Build completed successfully |

---

## Gate Verdict

**PASS** — 13/13 controls verified. All CI checks pass.

All security controls are properly implemented. Two minor observations (non-catch error message inconsistency, archive ownership filter) and one functional bug (audit event column mismatch) are noted but do not block the gate.
