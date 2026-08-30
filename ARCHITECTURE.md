# EGA House Architecture

**Living current-system map. Last code-truth refresh: 2026-08-30 (current `main` product capabilities integrated with MCP V2; production deployment status is tracked separately in the final merge report).**

This document describes the repository architecture that is currently present. Executable code, migrations, runtime evidence, and external-system evidence outrank this map when the repository changes. Normative requirements live in the authority chain defined by [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).

## 1. Platform topology

EGA House is an npm-workspace monorepo with three product applications, five shared packages, root database authority, and a separate autonomous-delivery subsystem.

```text
                               EGA HOUSE
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
        apps/web              apps/mobile           apps/server
        Next.js                  Expo                  Hono
             │                     │                     │
             │                @ega/api-client            │
             │                     │                     │
             └──────────────┐      │      ┌──────────────┘
                            ▼      ▼      ▼
                              @ega/contracts
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
             @ega/domain                         @ega/application
                                                       │
                                                repository ports
                                                       │
                                                @ega/data-access
                                                       │
                                       request-scoped Supabase / RLS
                                                       │
                                              Supabase/Postgres

Root DB authority: src/db + drizzle/
Autonomous delivery: scripts/ega-runner + automation.* + PGMQ + Hermes/GitHub
```

## 2. Current surface map

| Surface | State | Current evidence / role |
|---|---|---|
| Web product | CURRENT | `apps/web`: Next.js routes, Server Components/Actions, UI, integrations, and compatibility APIs |
| Mobile product | CURRENT | `apps/mobile`: Expo Router native client, authenticated API consumption, local session/navigation/presentation |
| Standalone API | CURRENT | `apps/server`: Hono routes for auth, timer, projects, goals, tasks, today, and **notifications** (history, read/unread, devices, preferences); separate Vercel deployment |
| Domain package | CURRENT | `packages/domain`: platform-neutral task/project/goal rules/constants |
| Contracts package | CURRENT | `packages/contracts`: transport-neutral mobile/agent/common contracts (now includes `notifications`) |
| Application package | CURRENT | `packages/application`: projects/goals/tasks/today **plus notifications** use cases (canonical notification, delivery policy, preferences, device claim, due-reminder orchestration), read models, recurrence/focus logic, repository ports |
| Data-access package | CURRENT | `packages/data-access`: Supabase-backed repository adapters (now includes `notifications` repositories + `FcmPushProvider` via `google-auth-library` + FCM HTTP v1 and `ResendEmailProvider`) |
| API client | CURRENT | `packages/api-client`: typed cross-platform Projects/Goals/Tasks/Today **and Notifications** HTTP mechanics |
| Database/schema | CURRENT | root `src/db`, `drizzle/`, `drizzle.config.ts` remain the single schema/migration authority (now includes `notifications`, `notification_devices`, `notification_deliveries`, `notification_preferences` via `0045_notification_subsystem`; `task_reminders` evolved with `delivery_mode`/`processed_at`) |
| Notifications | CURRENT (feature) / EXTERNAL_UNVERIFIED (device push) | Canonical notification + per-device/per-email deliveries, FCM HTTP v1 (direct, not Expo Push or EAS), preferences, Android channel `task-reminders`, deep-typed `task` targets; `apps/web` cron `POST /api/cron/task-reminders` is thin orchestration via `@ega/application` |
| Mobile notifications | CURRENT (code) / EXTERNAL_UNVERIFIED (runtime) | `apps/mobile` `expo-notifications` + `expo-crypto`, persistent `installation_id` in `SecureStore`, `getDevicePushTokenAsync()` (never `getExpoPushTokenAsync`), `NotificationProvider` (permission, channel, registration, rotation, foreground/tap/cold-start, target mapper), bell + notification center + settings + reminder Push/Email/Both selector; no `eas.json`/EAS |
| Web compatibility APIs | CURRENT | `apps/web/src/app/api/{agent,mcp,oauth,integrations,cron}` (cron `task-reminders` now thin over notification delivery) |
| Autonomous Runner | CURRENT / PARTIAL | `scripts/ega-runner`: PGMQ claim/lease, Hermes execution, Git/GitHub evidence, PR-monitor/repair work |
| Reconciliation | ABSENT / GAP | No proven canonical owner repairs every partial external side effect idempotently |

The first-wave monorepo migration is no longer merely a target architecture: the `apps/*` and `packages/*` topology is present on `main`. Historical migration-stack evidence remains in [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md) but must not be interpreted as the current branch state.

## 3. Product request paths

### Web path

```text
Browser
  → apps/web (Next.js route / Server Component / Server Action)
  → @ega/application
  → @ega/data-access
  → request-scoped Supabase / RLS
  → Postgres
```

The web app does not need to call its own Hono deployment to reuse application logic. Transport and rendering stay web-specific; use-case and persistence authority are shared.

### Mobile path

```text
Expo UI
  → mobile session/token boundary
  → typed HTTP client / mobile API adapter
  → apps/server (Hono)
  → verified Supabase bearer identity
  → AuthenticatedActor
  → @ega/application + @ega/data-access
  → request-scoped Supabase / RLS
  → Postgres
```

Current Hono routes cover the canonical mobile Auth, Timer, Projects, Goals, Tasks, and Today API surface. Deployment/runtime details are in [`docs/architecture/hono-deployment.md`](docs/architecture/hono-deployment.md).

### Compatibility web APIs

Agent, MCP, OAuth, integration, and cron/background routes remain under `apps/web/src/app/api`. Their presence is intentional compatibility, not permission to duplicate new business authority in route handlers.

## 4. Package and dependency boundaries

Executable enforcement lives in `scripts/architecture/check-boundaries.mjs`.

Allowed direction:

```text
apps/web      -> @ega/domain / @ega/contracts / @ega/application / @ega/data-access
apps/server   -> @ega/domain / @ega/contracts / @ega/application / @ega/data-access
apps/mobile   -> @ega/domain / @ega/contracts / @ega/api-client
@ega/api-client  -> @ega/contracts
@ega/application -> @ega/domain / @ega/contracts + repository ports
@ega/data-access -> @ega/application ports + request-scoped Supabase
@ega/contracts   -> platform-neutral primitives
@ega/domain      -> platform-neutral primitives
```

Important executable prohibitions include:

- mobile cannot import `@ega/application`, `@ega/data-access`, web/server internals, or root DB modules;
- server cannot import web/mobile/root `src` internals;
- contracts/domain cannot depend on React, React Native, Next, Supabase, or Drizzle;
- api-client cannot depend on Expo/React/Next/Supabase/application/data-access or app internals.

These boundaries keep product authority reusable without coupling platform runtimes together.

## 5. Authentication, persistence, and RLS

For normal user-scoped Hono requests:

```text
Authorization: Bearer <Supabase access token>
        → server-side token verification
        → verified user.id
        → AuthenticatedActor { userId }
        → request-scoped Supabase client carrying the caller token
        → PostgREST / RLS
```

Actor identity must not come from JSON/FormData/query/custom user-id fields. A service-role or unrestricted raw-DB client is not a valid authorization shortcut for normal product requests.

Root database ownership is intentionally separate from `apps/web` and `apps/server`:

- `src/db/schema.ts`
- `src/db/mcp-schema.ts`
- `src/db/client.ts`
- `drizzle/`
- `drizzle.config.ts`

Do not infer that physical app placement owns schema authority.

## 6. MCP v2 (2026-07-28) — stateless agent interface

`apps/web` hosts the MCP endpoint at `POST /api/mcp` (stateless, `createMcpHandler`-style).

```text
MCP client (SDK v2, 2026-07-28)
  → POST /api/mcp
  → Authorization: Bearer <Supabase JWT> (aud=resource, client_id)
  → verifyAccessToken → loadActiveMcpGrant → principal (owner, client, grant, permissionsVersion, permissions)
  → MCP_AUTHORIZED_SCOPE + has_active_mcp_permission(perm) + RLS (private.has_active_mcp_permission)
  → permission-aware tool catalog (read vs workspace_manager)
  → audited handler (rate limit + audit)
  → AuthenticatedActor{userId: principal.ownerUserId}
  → @ega/application (workflow authority, no duplication)
  → @ega/data-access (Supabase adapter, request-scoped client)
  → PostgREST/RLS
```

- **SDK:** `@modelcontextprotocol/server` `2.0.0` / `client` `2.0.0` / `core` `2.0.0` (`zod` `^3.25.0` + `zod-v4` alias `npm:zod@^4.2.0` for MCP schemas per SDK guide), protocol `2026-07-28`, stateless per-request `createMcpHandler` → `handler.fetch(request,{authInfo})` → `ctx.http.authInfo`, `ServerContext` (`ctx.mcpReq.inputResponses`, `ctx.mcpReq.requestState<T>()`).
- **Discovery:** `server/discover` via `createMcpHandler` (ttl 0, private), `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` validated against body (400 / `-32020`), never authorized; no `Mcp-Session-Id`.
- **Auth/Host/Origin:** `withEgaMcpAuth` verifies bearer → `loadActiveMcpGrant` → `principal`; `web-transport-handler` does explicit `Host` (`request.url` host) and `Origin` (allow missing for server-to-server, else must match `resource.origin`, localhost dev allowed), bounded body, correct POST/OPTIONS/GET, CORS `Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name`.
- **Reads runtime:** `ega_get_capabilities`, `ega_list_projects`, `ega_list_goals`, `ega_list_tasks`, `ega_get_today_plan` (via `SupabaseTodayReadPort`), and `ega_list_timer_sessions` (via `SupabaseTimerSessionRepository`) — owner-scoped, bounded, strict `zod-v4` schemas, no `ownerUserId` from caller.
- **Writes runtime (23):** the catalog covers project, goal, task/reminder, Today, and timer create/update/archive operations; `ega_clear_completed_today` uses MRTR `inputRequired` + `requestState`. All writes require `operationId: uuid`, `workspace_manager` permission where applicable, `MCP_WRITES_ENABLED`, and the fail-closed ledger. The complete runtime catalog and profile matrix live in [`docs/implementation/2026-08-28-mcp-capability-coverage.md`](docs/implementation/2026-08-28-mcp-capability-coverage.md).
- **MRTR:** `MCP_REQUEST_STATE_SECRET` (32+ bytes, shared) → `createRequestStateCodec({key, ttlSeconds:300})` HMAC-SHA256 `base64url(json{ p, exp })` `timingSafeEqual`, binding `{user,client,grantId/version,resource,tool,operationId,argsHash,targetDate,phase}`; `ServerOptions.requestState.verify` + `ctx.mcpReq.requestState<T>()` + `inputRequired`/`acceptedContent`; tamper/expiry/grant-revoked/args-changed → `-32602`/`INVALID_ARGUMENT`.
- **Idempotency:** `mcp_mutation_receipts(owner,client,tool,opId,args_hash,result_payload)` PK + `mcp_claim_mutation_receipt`/`mcp_store_mutation_result` SECURITY DEFINER with `ON CONFLICT` and `pg_advisory_xact_lock`, fail-closed, `createHash(sha256, canonical JSON)` for args. Create-domain fencing is complete for projects, goals, tasks, reminders, and sessions: domain inserts carry the authenticated owner/client operation identity, and only the matching named unique collision replays the canonical row through request-scoped RLS.
- **Update guarantee:** status, archive, Today projection, and timer stop/clear mutations remain at-least-once but idempotent; the exactly-once claim is limited to insert-style create effects.
- **Audit/Rate:** `agent_integration_events` + `consumeMcpRateLimit` (reads 120/min, writes 30/min) via `audited-read/write-handlers` (mutation-safe: ledger before success, audit failure logged not swallowed).
- **Migrations:** current-main migrations `0045_notification_subsystem` through `0049_operator_proposals` are followed by MCP migrations `0050_mcp_workspace_manager` through `0059_mcp_domain_operation_fencing`; production application status is environment-specific and must be verified from migration history.
- **Runbook:** `docs/implementation/2026-08-28-mcp-v2-read-write-runbook.md` (rollback `MCP_WRITES_ENABLED=false`, no destructive down migration).

## 7. Autonomous delivery architecture

The Runner is a separate control plane from the productivity product. Its durable run state belongs to the automation database; queue/Git/Hermes/GitHub/Slack are execution and evidence systems around that state.

```text
Authorized issue / trigger
        ↓
 durable automation run
        ↓
      PGMQ
        ↓
 read → claim/lease → classify
        ↓
 verified branch/worktree
        ↓
      Hermes
        ↓
 independent diff / validation / Git proof
        ↓
 push → real GitHub PR → checks/review/preview evidence
        ↓
 READY_TO_MERGE candidate
        ↓
 human merge
        ↓
 durable terminal classification + queue archive when safe
```

Never translate `completed` in one subsystem directly into delivery-level success. The terminal evidence rule in [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md) defines what must be observed for the requested contract.

Subsystem documents:

- [`docs/architecture/delivery-lifecycle.md`](docs/architecture/delivery-lifecycle.md)
- [`docs/architecture/queue-and-leases.md`](docs/architecture/queue-and-leases.md)
- [`docs/architecture/runner-and-worktrees.md`](docs/architecture/runner-and-worktrees.md)
- [`docs/architecture/hermes-execution.md`](docs/architecture/hermes-execution.md)

## 8. Current known gaps

### Platform

- The monorepo boundaries are implemented, but feature migration coverage remains a per-surface question; do not assume every legacy/compatibility flow has been converted merely because packages exist.
- Agent/MCP/OAuth/integration/cron transports remain in the web application and must be treated as compatibility surfaces until separately migrated.
- Root DB authority is intentional; relocating schema/migrations requires a dedicated ownership decision and must not create parallel migration trees.
- Runtime/deployment proof is subsystem-specific. Static architecture checks do not prove Vercel, Supabase, mobile-device, or cross-user behavior.

### Runner

The current agent-context authority records these important delivery gaps until newer executable evidence proves otherwise:

- archive preconditions are not centrally encoded;
- lease-heartbeat failure does not by itself prove active Hermes work stopped before further effects;
- Hermes validation claims are not sufficient independent proof;
- PR/check/preview completeness has historically been weaker than the delivery-level terminal evidence rule;
- reconciliation of partial external effects lacks a proven canonical owner.

Do not preserve a gap just because it is written here: if current code/runtime now proves it closed, update this map and the decision/evidence trail in the same bounded change.

## 9. Architecture change protocol

For architecture or governance changes:

1. Read [`CONTEXT.md`](CONTEXT.md), the relevant ADR, current code, executable boundary tests, and prior [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) entries.
2. Establish current behavior independently from normative authority.
3. Classify contradictions as defects or unresolved product decisions.
4. Change the canonical owner rather than adding another owner.
5. Update living docs and executable guardrails together when a boundary changes.
6. Mark point-in-time evidence documents as historical instead of rewriting them into false current truth.
7. Validate with [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md).
