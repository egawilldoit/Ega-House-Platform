# EGA House Platform Monorepo Architecture

Status: target architecture for the staged platform migration authorized in August 2026.

This document defines the migration boundary. It does not claim that later stages are already deployed or complete.

## Current platform

The repository currently contains these production and delivery surfaces:

- `src/app`: the root Next.js application, including UI, Server Components/Actions, and route handlers.
- `src/app/api/mobile`: the legacy mobile Auth, Tasks, and Today HTTP surface.
- `src/app/api/agent`: the Agent task-control API.
- `src/app/api/mcp`: MCP integration routes.
- `src/app/api/oauth`: OAuth routes.
- `src/app/api/integrations`: external integration routes.
- `src/app/api/cron`: cron/background HTTP entry points.
- `src/lib/services`: current application/service behavior.
- `src/lib/contracts`: current wire contracts.
- `src/lib/validation`: current HTTP/input validation.
- `src/lib/supabase`: Supabase adapters.
- `src/db/schema.ts` and `src/db/mcp-schema.ts`: current Drizzle schema ownership.
- `apps/mobile`: Expo application with Today, Tasks, Timer, and Profile surfaces.
- `scripts/ega-runner`: autonomous delivery Runner.
- Supabase/Postgres: durable product data and RLS enforcement.

Agent, MCP, OAuth, integrations, cron, Runner, legacy Mobile Auth/Tasks/Today, and database schema ownership remain compatibility surfaces during this first migration wave.

## First-wave target

```text
                         EGA HOUSE
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
      apps/web          apps/mobile        apps/server
      Next.js              Expo              Hono
          │                  │                  │
          │            @ega/api-client          │
          │                  │                  │
          └──────────┐       │       ┌──────────┘
                     ▼       ▼       ▼
                       @ega/contracts
                              │
                       @ega/application
                              │
                        repository ports
                              │
                       @ega/data-access
                              │
                 request-scoped Supabase client
                              │
                         Supabase/RLS
```

`@ega/domain` supplies pure platform-neutral rules to contracts/application code where appropriate. It does not own transport, persistence, rendering, or authentication.

## Responsibilities

### `apps/web`

Owns the Next.js web transport and rendering surface. Server Components and Server Actions call `@ega/application` and `@ega/data-access` directly. They must not make HTTP calls back into EGA House's own standalone server merely to access the same application logic.

### `apps/mobile`

Owns Expo-native UI, mobile navigation, session/token storage, and native composition. New Projects/Goals data flows through `@ega/api-client` to `apps/server`. Mobile must not import application or persistence implementations.

### `apps/server`

Owns the standalone Hono HTTP transport for first-wave native/external Projects and Goals. It verifies bearer identity, constructs a request-scoped Supabase client carrying the verified access token, and composes application/data-access adapters. It does not duplicate business rules.

### `@ega/contracts`

Owns reusable transport DTOs and platform-neutral contract definitions. It must not depend on React, Next, React Native, Expo, Supabase, Drizzle, Node server APIs, or database queries.

### `@ega/domain`

Owns pure domain constants and rules such as status values and platform-neutral guards/normalizers. It must stay framework- and persistence-independent.

### `@ega/application`

Owns use-case semantics, stable application errors, input orchestration, repository ports, and read-model calculations. It does not own HTTP, redirects, cookies, rendering, Supabase implementation, or database drivers.

### `@ega/data-access`

Owns repository adapters. For first-wave Projects/Goals, adapters receive a request-scoped Supabase client from the transport. They do not create a global privileged client.

### `@ega/api-client`

Owns reusable HTTP mechanics and typed Projects/Goals endpoint methods. Token acquisition and refresh callbacks are injected; Expo storage and session mechanics remain mobile-owned.

## Dependency direction

Allowed first-wave direction:

```text
apps/web      -> contracts/domain/application/data-access
apps/server   -> contracts/domain/application/data-access
apps/mobile   -> contracts/api-client
api-client    -> contracts
application   -> contracts/domain + repository ports

data-access  -> application ports/contracts + request-scoped Supabase
contracts     -> platform-neutral primitives only
domain        -> platform-neutral primitives only
```

Forbidden examples include mobile importing application/data-access/server/web internals; contracts/domain importing framework or persistence packages; and api-client importing Expo, React Native, application, or data-access implementations.

Executable rules live in `scripts/architecture/check-boundaries.mjs` and are designed to activate as the target folders appear.

## Request security and RLS

The existing mobile security property is preserved:

```text
Authorization: Bearer <Supabase access token>
                ↓
server-side Supabase token verification
                ↓
verified authenticated user
                ↓
AuthenticatedActor { userId }
                ↓
request-scoped Supabase client carrying that access token
                ↓
PostgREST / RLS
```

Identity never comes from a JSON body, URL parameter, query string, or custom user-id header. Normal Projects/Goals requests must not use a service-role client or unrestricted privileged `DATABASE_URL` access as an authorization shortcut.

## Web data flow

Correct server-side web flow:

```text
Server Component / Server Action
        ↓
@ega/application
        ↓
@ega/data-access
        ↓
request-scoped Supabase
```

The web application must not fetch its own `apps/server` API from Server Components/Actions. HTTP is for native/external consumers where a transport boundary is required.

## Database ownership during this wave

The migration intentionally does not move:

- `src/db/schema.ts`
- `src/db/mcp-schema.ts`
- `drizzle/`

Schema ownership is a separate architectural decision after additional consumers migrate. Moving it during this first wave would broaden scope and risk creating competing migration authority.

## Compatibility retained during this wave

The following stay on their current Next/Runner paths:

- Agent API
- MCP API
- OAuth
- integrations
- cron/background jobs
- Runner
- legacy Mobile Auth
- legacy Mobile Tasks
- legacy Mobile Today
- Drizzle/schema ownership

Their behavior must remain stable while Projects/Goals establish the new package and server boundaries.

## Migration sequence

1. Add architecture documentation and executable boundary checks.
2. Establish npm workspaces while keeping the root Next app in place.
3. Extract platform-neutral contracts and domain rules.
4. Extract Projects/Goals application and request-scoped data-access behavior.
5. Add the authenticated Hono Projects/Goals transport.
6. Add a cross-platform API client.
7. Move Next.js physically into `apps/web`.
8. Add native Projects/Goals UI through the API client/server path.
9. Enforce all boundaries and validation in unified CI.
10. Remove only proven-dead compatibility artifacts and document deployment readiness.

## Migration status (2026-08-09, arch/10-compat-cleanup-readiness head)

The stack is delivered as sequential `arch/0x` branches; each branch's PR targets
the previous branch's head. Merging happens when the stack lands — branches being
open is the designed state, not a stall.

| Step | State | Evidence |
|---|---|---|
| 1 Guardrails + architecture checks | done, pushed | `arch/01-baseline-guardrails` @ `d71d689`; PR #119 (→ main) open |
| 2 npm workspace foundation | done, pushed | `arch/02-npm-workspace-foundation` @ `cf6ec0a`; PR #120 (→ arch/01) open |
| 3 Contracts + domain packages | done, pushed | `arch/03-contracts-domain` @ `9dcf207`; PR #121 (→ arch/02) open |
| 4 Application + data-access packages | done, pushed | `arch/04-project-goal-application-core` @ `3ef94ab` |
| 5 Standalone Hono server | done, pushed | `arch/05-hono-project-goal-transport` @ `be190ca` — `apps/server` present on this base; `server:typecheck\|test` wired |
| 6 API client | done, pushed | `arch/06-api-client` @ `8c86013` — `packages/api-client` present on this base; `api-client:typecheck\|test` wired |
| 7 Web app move to `apps/web` | in progress, parallel | `arch/07-web-app-workspace` @ `70e1204` pushed but **not merged into this base** — web still lives at the repository root here; `src/lib/**` shims remain at root and are still consumed (retirement candidates post-PR7 merge) |
| 8 Native Projects/Goals UI | in progress, parallel | `arch/08-native-project-goal-ui` @ `603db1f` pushed, not merged into this base |
| 9 Unified validation CI | done, pushed | `arch/09-unified-ci` @ `55a559c` — `unified-platform-validation.yml` + `scripts/ci/*` live on this base; per-stage validators disabled (PR9) and deleted (PR10) |
| 10 Compatibility cleanup + readiness | this branch | `arch/10-compat-cleanup-readiness` — base `55a559c`; see `docs/architecture/readiness.md` |

Open PRs in the stack: #119 (arch/01 → main), #120 (arch/02 → arch/01), #121
(arch/03 → arch/02). Branches arch/04+ are pushed and validated by the unified
workflow on every push/PR; PRs for them are opened as the stack advances.

**Lockfile regeneration (replaces the deleted `pr2-workspace-lock-refresh`
workflow — a documented local act, never automated):**

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

The unified CI `workspace` job proves lock↔manifest consistency on every run, so
an uncommitted lock cannot silently pass.

## Intentional non-goals

This is not a microservices rewrite. It does not introduce pnpm or Turborepo, upgrade Expo, upgrade Next.js, redesign authentication, migrate Agent/MCP/OAuth/Cron, relocate database schemas, or authorize production deployment.

The target is a modular npm-workspace monorepo with one shared application core and explicit transports, not a distributed system with duplicated state authority.
