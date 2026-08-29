# EGA House Architecture

**Living current-system map. Last code-truth refresh: 2026-08-27.**

This document describes the repository architecture that is currently present. Executable code, migrations, runtime evidence, and external-system evidence outrank this map when the repository changes. Normative requirements live in the authority chain defined by [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).

## 1. Platform topology

EGA House is an npm-workspace monorepo with three product applications, five shared packages, root database authority, and MCP/OAuth integration surfaces.

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
MCP / OAuth / integrations: apps/web/src/app/api/{agent,mcp,oauth,integrations,cron} + apps/web/src/lib/mcp
```

## 2. Current surface map

| Surface | State | Current evidence / role |
|---|---|---|
| Web product | CURRENT | `apps/web`: Next.js routes, Server Components/Actions, UI, integrations, and compatibility APIs |
| Mobile product | CURRENT | `apps/mobile`: Expo Router native client, authenticated API consumption, local session/navigation/presentation |
| Standalone API | CURRENT | `apps/server`: Hono routes for auth, timer, projects, goals, tasks, and today; separate Vercel deployment |
| Domain package | CURRENT | `packages/domain`: platform-neutral task/project/goal rules/constants |
| Contracts package | CURRENT | `packages/contracts`: transport-neutral mobile/agent/common contracts |
| Application package | CURRENT | `packages/application`: projects/goals/tasks/today use cases, read models, recurrence/focus logic, repository ports |
| Data-access package | CURRENT | `packages/data-access`: Supabase-backed repository adapters |
| API client | CURRENT | `packages/api-client`: typed cross-platform Projects/Goals/Tasks/Today HTTP mechanics |
| Database/schema | CURRENT | root `src/db`, `drizzle/`, `drizzle.config.ts` remain the single schema/migration authority |
| Web compatibility APIs | CURRENT | `apps/web/src/app/api/{agent,mcp,oauth,integrations,cron}` |
| MCP / OAuth | CURRENT | `apps/web/src/lib/mcp`, `apps/web/src/lib/oauth`: typed MCP server and OAuth grant/audit flows |

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

## 6. Current known gaps

### Platform

- The monorepo boundaries are implemented, but feature migration coverage remains a per-surface question; do not assume every legacy/compatibility flow has been converted merely because packages exist.
- Agent/MCP/OAuth/integration/cron transports remain in the web application and must be treated as compatibility surfaces until separately migrated.
- Root DB authority is intentional; relocating schema/migrations requires a dedicated ownership decision and must not create parallel migration trees.
- Runtime/deployment proof is subsystem-specific. Static architecture checks do not prove Vercel, Supabase, mobile-device, or cross-user behavior.

Do not preserve a gap just because it is written here: if current code/runtime now proves it closed, update this map and the decision/evidence trail in the same bounded change.

## 7. Architecture change protocol

For architecture or governance changes:

1. Read [`CONTEXT.md`](CONTEXT.md), the relevant ADR, current code, executable boundary tests, and prior [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) entries.
2. Establish current behavior independently from normative authority.
3. Classify contradictions as defects or unresolved product decisions.
4. Change the canonical owner rather than adding another owner.
5. Update living docs and executable guardrails together when a boundary changes.
6. Mark point-in-time evidence documents as historical instead of rewriting them into false current truth.
7. Validate with [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md).
