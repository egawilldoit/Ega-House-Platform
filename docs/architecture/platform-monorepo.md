# EGA House Platform Monorepo Architecture

Status: first-wave target architecture implemented on the ordered August 2026 migration stack. The stack is pre-merge validated; this document does not authorize production deployment.

## Pre-migration baseline

Before this migration wave, the repository's principal delivery surfaces were:

- root `src/app`: Next.js UI, Server Components/Actions, and route handlers;
- `src/app/api/mobile`: legacy mobile Auth, Tasks, and Today HTTP surface;
- `src/app/api/agent`: Agent task-control API;
- `src/app/api/mcp`: MCP integration routes;
- `src/app/api/oauth`: OAuth routes;
- `src/app/api/integrations`: external integrations;
- `src/app/api/cron`: cron/background entry points;
- `src/lib/services`, `src/lib/contracts`, `src/lib/validation`, `src/lib/supabase`;
- root `src/db/schema.ts`, `src/db/mcp-schema.ts`, `drizzle/`;
- `apps/mobile`: Expo application;
- `scripts/ega-runner`: autonomous delivery Runner;
- Supabase/Postgres: durable data and RLS enforcement.

Agent, MCP, OAuth, integrations, cron, Runner, legacy Mobile Auth/Tasks/Today, and root database schema ownership remain compatibility surfaces during this first wave.

## Converged first-wave architecture

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

`@ega/domain` supplies pure platform-neutral rules where appropriate. It does not own transport, persistence, rendering, or authentication.

## Responsibilities

### `apps/web`

Owns Next.js web transport and rendering. Server Components and Server Actions call `@ega/application` and `@ega/data-access` directly. They must not make HTTP calls back into EGA House's own Hono server merely to reach the same application logic.

### `apps/mobile`

Owns Expo-native UI, navigation, token/session storage, and native composition. New Projects/Goals flows use `@ega/api-client` and the authenticated standalone server. Mobile must not import application or persistence implementations.

### `apps/server`

Owns the standalone Hono HTTP transport for first-wave Projects/Goals. It verifies Supabase bearer identity, derives the authenticated actor from the verified user, creates a request-scoped Supabase client carrying the same token, and composes application/data-access. It does not duplicate business rules.

### `@ega/contracts`

Owns reusable platform-neutral DTOs/contracts. It must not depend on React, Next, React Native, Expo, Supabase, Drizzle, Node server APIs, or database queries.

### `@ega/domain`

Owns pure domain constants/rules and stays framework- and persistence-independent.

### `@ega/application`

Owns use-case semantics, stable application errors, orchestration, repository ports, and read-model calculations. It does not own HTTP, redirects, cookies, rendering, Supabase implementation, or DB drivers.

### `@ega/data-access`

Owns repository adapters. First-wave Projects/Goals adapters receive a request-scoped Supabase client from the transport and do not create a global privileged client.

### `@ega/api-client`

Owns typed reusable HTTP mechanics and Projects/Goals endpoint methods. Token acquisition/refresh callbacks are injected; Expo storage/session ownership remains mobile-side.

## Dependency direction

Allowed first-wave direction:

```text
apps/web      -> contracts/domain/application/data-access
apps/server   -> contracts/domain/application/data-access
apps/mobile   -> contracts/api-client
api-client    -> contracts
application   -> contracts/domain + repository ports
data-access   -> application ports/contracts + request-scoped Supabase
contracts     -> platform-neutral primitives only
domain        -> platform-neutral primitives only
```

Forbidden examples include mobile importing application/data-access/server/web internals; contracts/domain importing framework or persistence packages; and api-client importing Expo, React Native, application, or data-access implementation.

Executable enforcement lives in `scripts/architecture/check-boundaries.mjs`; package-purity and security invariants are also enforced by `scripts/ci/*` in Unified Platform Validation.

## Request security and RLS

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

Identity never comes from JSON body, URL parameter, query string, FormData, or a custom user-id header. Normal Projects/Goals requests must not use service-role or unrestricted privileged DB access as an authorization shortcut.

## Web data flow

```text
Server Component / Server Action
        ↓
@ega/application
        ↓
@ega/data-access
        ↓
request-scoped Supabase / RLS
```

The web application does not self-fetch `apps/server` from Server Components/Actions. HTTP is used for native/external consumers where a transport boundary is required.

## Database ownership during this wave

Canonical DB/migration authority remains at the repository root:

- `src/db/schema.ts`
- `src/db/mcp-schema.ts`
- `src/db/client.ts`
- `drizzle/`
- `drizzle.config.ts`

PR #125 originally moved this authority with the web application; the pre-merge architecture audit corrected that defect. There is no duplicate tracked DB authority under `apps/web`.

## Compatibility retained during this wave

The following remain compatibility surfaces rather than being forced through the new Projects/Goals boundary:

- Agent API;
- MCP API;
- OAuth;
- integrations;
- cron/background jobs;
- Runner;
- legacy Mobile Auth;
- legacy Mobile Tasks;
- legacy Mobile Today;
- root Drizzle/schema ownership.

Their behavior must remain stable while Projects/Goals establish the new package/server boundaries.

## Migration sequence

1. Add architecture documentation and executable boundary checks.
2. Establish npm workspaces while keeping the root Next app in place.
3. Extract platform-neutral contracts and domain rules.
4. Extract Projects/Goals application and request-scoped data-access behavior.
5. Add authenticated Hono Projects/Goals transport.
6. Add a cross-platform API client.
7. Move Next.js physically into `apps/web` while retaining root DB authority.
8. Add native Projects/Goals UI through the API-client/server path.
9. Enforce all boundaries and validation in unified CI.
10. Remove only proven-dead compatibility artifacts and document readiness.

## Migration status — 2026-08-09

The migration is delivered as an ordered stacked-PR chain. Each PR targets the immediately preceding stage; open stacked PRs are intentional until an explicit ordered merge is authorized.

| Step | State | Current evidence |
|---|---|---|
| 1 Guardrails + architecture checks | complete, open | `arch/01-baseline-guardrails` @ `d71d689`; PR #119 |
| 2 npm workspace foundation | complete, open | `arch/02-npm-workspace-foundation` @ `cf6ec0a`; PR #120 |
| 3 Contracts + domain | complete, open | `arch/03-contracts-domain` @ `9dcf207`; PR #121 |
| 4 Application + data access | complete, open | `arch/04-project-goal-application-core` @ `9de1f43`; PR #122; exact-head CI run `31335892952` green |
| 5 Authenticated Hono transport | complete, open | `arch/05-hono-project-goal-transport` @ `79c61ba`; PR #123; run `31336079119` green |
| 6 Cross-platform API client | complete, open | `arch/06-api-client` @ `21604b3`; PR #124; run `31336139911` green |
| 7 Next.js move to `apps/web` | complete, open | `arch/07-web-app-workspace` @ `7711e74`; PR #125; run `31336169803` green; root DB authority preserved |
| 8 Native Projects/Goals | complete, open | `arch/08-native-project-goal-ui` @ `71eede6`; PR #126; run `31338780846` green; pre-merge lint regression removed |
| 9 Unified platform CI | complete, open | `arch/09-unified-ci` @ `c909e1f`; PR #127; run `31339129854` green; inherited lint baseline 39 errors / 53 warnings |
| 10 Cleanup + readiness | complete implementation, open | `arch/10-compat-cleanup-readiness`; PR #128. Use live PR #128 head/checks as authority because edits to readiness evidence advance this branch SHA. |

The authoritative current SHA for each open PR is its live GitHub PR metadata. Hard-coded Stage-10 self-SHAs are intentionally avoided in readiness documentation to prevent evidence from becoming stale when the documentation itself changes.

## Lockfile and dependency validation

The root `package-lock.json` is authoritative for platform workspaces. `scripts/ega-runner/package-lock.json` remains an explicit standalone Runner exception.

Unified CI proves lock↔manifest consistency with clean `npm ci`, validates required Linux x64 native optionals, and applies an evidence-gated high/critical production dependency policy. Dependency exceptions are explicit and time-bounded; they are not blanket audit suppression.

## Lint regression policy

Full-repo inherited lint debt is currently **39 errors / 53 warnings**. The Stage-8 pre-merge audit removed 5 errors and 3 warnings that had accidentally been absorbed by an intermediate baseline, then Stage 9 deliberately re-captured the corrected 39/53 ceiling.

`lint-changed` blocks new regression. `lint-report` reports inherited debt until a dedicated cleanup reduces the baseline.

## Intentional non-goals

This is not a microservices rewrite. It does not introduce pnpm/Turborepo, redesign authentication, migrate Agent/MCP/OAuth/Cron to new transports, relocate database schema authority, or authorize production deployment.

The target is a modular npm-workspace monorepo with shared application authority and explicit transport boundaries, not a distributed system with duplicated business/state authority.
