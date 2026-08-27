# EGA House Evidence and Product Authority

Use the following hierarchies for different questions. Do not collapse them into one precedence list.

## Current-behavior evidence

Use this hierarchy to determine what the repository currently does:

1. Observed runtime, database, and external-system evidence.
2. Executable code and migrations.
3. Tests exercising the current path.
4. Current runbooks and living documentation.
5. Historical plans, prompts, audit snapshots, and migration evidence.

A lower layer may explain intent but cannot prove that a higher-layer behavior occurred.

## Normative product authority

Use this hierarchy to determine what behavior is required:

1. Explicit current user authorization and the assigned issue/contract.
2. Approved product invariants and accepted architecture decisions.
3. Versioned product specifications.
4. Current architecture and subsystem contracts.
5. Existing implementation patterns when they do not conflict with higher authority.

> When current implementation conflicts with normative authority, classify the difference as a **defect** or **unresolved product decision**. Do not silently normalize the current code and do not silently rewrite product policy.

Search [`decision-log.md`](decision-log.md) before making a new material classification. The log records prior classifications/resolutions; it does not outrank the authority hierarchy. Resolved durable architecture decisions should live in an ADR/spec and be linked from the log.

## Platform authority map

“Known gap” means current-behavior evidence does not yet prove/enforce the normative rule.

| Domain | Normative rule | Canonical owner/evidence | Forbidden bypass | Known gap / caution |
|---|---|---|---|---|
| Product semantics | Project/Goal/Task/Today/Timer/Review rules have one shared authority rather than per-UI copies | `packages/domain`, `packages/application`, [`../../CONTEXT.md`](../../CONTEXT.md) | Workflow truth in components/routes/screens | Migration coverage is feature-specific; verify the actual owner before moving behavior |
| Web transport | Next.js renders/orchestrates web requests and composes shared application/data access | `apps/web` | Self-fetching Hono merely to reuse in-process business logic; transport-owned workflow rules | Compatibility APIs still live in web |
| Native transport | Mobile uses authenticated HTTP and must not import server/application/persistence internals | `apps/mobile`, `apps/server`, `packages/api-client`, architecture boundary checks | Direct mobile DB/application/data-access/server imports | API-client coverage and transport adapters vary by surface; trace the current call path |
| Hono auth/RLS | Bearer token is verified; actor derives from verified identity; request-scoped Supabase preserves RLS | `apps/server`, `packages/data-access`, security proofs | Body/query/custom user-id actor selection; service-role shortcut | Runtime/cross-user isolation still requires external proof beyond static checks |
| Shared contracts | Cross-platform DTO/contracts stay platform-neutral | `packages/contracts` | React/Next/Expo/Supabase/Drizzle dependencies in contracts | Enforced structurally; semantic contract drift still requires tests/review |
| Domain package | Pure rules/constants stay framework/persistence neutral | `packages/domain` | UI/transport/persistence imports | Not every legacy rule is necessarily migrated yet |
| Application package | Use cases/read models/orchestration own workflow semantics behind ports | `packages/application` | HTTP/cookies/rendering/DB-driver ownership | Feature migration is incremental |
| Data access | Repository adapters implement application ports with scoped persistence | `packages/data-access` | Global privileged client for user-scoped requests | Root Drizzle schema remains separate by decision |
| Database/schema | One root schema/migration authority | `src/db`, `drizzle/`, `drizzle.config.ts` | Duplicate app-local schema/migration tree | Relocation is deferred until a dedicated ownership decision |
| Agent API | Token scopes and owner filtering govern external task access | `apps/web/src/app/api/agent`, agent service/audit persistence | Direct unscoped table access from agent routes | Verify current rate-limit/process behavior before assuming distributed enforcement |
| Git/GitHub | Commit/push/PR/check state are independently observed evidence | Git/GitHub + persisted fields | Completion without required verified GitHub objects | Check/preview completeness must be verified against required contract |
| Merge | Human review is the current safe merge authority | PR state/repository policy | Broad auto-merge or review bypass | Separate controlled automation must not become implicit general authority |
| Vercel | Deployment truth is exact deployed commit/runtime evidence | platform deployment docs + Vercel API | Inferring deployment from PR text/branch name | Product Hono deployment must be verified from exact deployed commit |

## Approval boundaries

Human approval is required for merge, deployment, production data changes, secrets, destructive cleanup, broad migrations, governance/security weakening, and automatic-merge enablement. Issue authorization permits scoped implementation and non-destructive validation; it does not imply those higher-impact permissions.

## Terminal evidence rule

A PR-producing implementation requires at minimum:

1. Authorized paths and actual changed paths match.
2. A non-empty implementation commit descends from the pinned base SHA.
3. The intended branch was pushed and the remote SHA matches.
4. A real PR exists and points to that SHA.
5. Required validations/checks are independently observed.
6. Preview/runtime evidence is present when required.

If the implementation does not prove a required item, report that as a current-behavior gap rather than translating a status value into success.
