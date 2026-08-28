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
| Automation run | Durable automation run state owns delivery lifecycle; events/artifacts provide evidence | deployed `automation.*`, Runner SQL/migrations | Slack, Hermes output, Git branch names, queue messages as terminal truth | Complete deployed schema may contain authority not represented by one local file |
| Queue | PGMQ owns pending execution, not terminal state | `scripts/ega-runner/src/queue.ts` | Executable `pgmq.pop()` or deletion before durable classification | Archive preconditions are not centrally encoded |
| Claim/lease | `claimed_by` and `lease_expires_at` establish temporary ownership | Runner lease code, queue VT | Side effects after ownership is uncertain | Heartbeat/process-stop semantics require runtime proof |
| Runner authorization | A run must be bound to an authorized issue and scope before implementation | Runner context/scope + persisted context hash | Label-only or prompt-only authorization | Project/blocker semantics must be verified from current code/runtime |
| Worktree | One verified attempt owns one isolated branch/worktree from a pinned base | Runner worktree/attempt records | Main implementation, stale worktree reuse, destructive collision handling | Re-check current implementation before carrying forward historical force-reset gaps |
| Hermes | Hermes generates candidate code; Runner owns lifecycle and independent proof | `hermes-executor`, result/Git evidence, [`../../HERMES_MASTER_PROMPT.md`](../../HERMES_MASTER_PROMPT.md) | Agent self-certification | Skill visibility must be verified under the Runner profile; project-local trust is explicit |
| Git/GitHub | Commit/push/PR/check state are independently observed evidence | Runner Git/GitHub adapters + persisted fields | Completion without required verified GitHub objects | Delivery-level success may require more than a subsystem `completed` value |
| Merge | Human review is the current safe merge authority for Runner PRs | PR state/repository policy | Broad auto-merge or review bypass | Separate controlled automation must not become implicit general authority |
| Vercel | Deployment truth is exact deployed commit/runtime evidence | platform deployment docs + Vercel API | Inferring deployment from PR text/branch name | Product Hono deployment is separate from Runner preview/terminal proof |
| Slack | Slack reports projections and operational signals | Runner notify/reporting workflows | Messages/markers as durable run state | Delivery must remain valid when Slack is unavailable |
| Reconciliation | Partial external effects need an idempotent canonical repair owner | No complete authority proven | Ad-hoc repeated side effects | ABSENT / UNRESOLVED |

## Approval boundaries

Human approval is required for merge, deployment, production data changes, secrets, destructive cleanup, broad migrations, governance/security weakening, and automatic-merge enablement. Issue authorization permits scoped implementation and non-destructive validation; it does not imply those higher-impact permissions.

## Terminal evidence rule

A delivery-level `COMPLETE` verdict requires all evidence demanded by the authorized contract. At minimum for a PR-producing run:

1. Current ownership was maintained through the final owned mutation.
2. Authorized paths and actual changed paths match.
3. A non-empty implementation commit descends from the pinned base SHA.
4. The intended branch was pushed and the remote SHA matches.
5. A real PR exists and points to that SHA.
6. Required validations/checks are independently observed.
7. Preview/runtime evidence is present when required.
8. Durable run/event/artifact records were written.

If current Runner code does not prove a required item, report that as a current-behavior gap rather than translating a database/status value into delivery success.