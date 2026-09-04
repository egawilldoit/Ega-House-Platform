# EGA House Platform Monorepo Architecture

**Status: IMPLEMENTED CURRENT ARCHITECTURE. Last reviewed: 2026-08-25.**

The first-wave migration that introduced this topology has landed. This document now describes the current package/application boundary and preserves the August 2026 migration stack only as historical provenance. For the cross-subsystem current map, see [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Current topology

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
                ┌─────────────┴─────────────┐
                ▼                           ▼
          @ega/domain                @ega/application
                                            │
                                     repository ports
                                            │
                                     @ega/data-access
                                            │
                              request-scoped Supabase/RLS
```

Root `src/db` + `drizzle/` remain the single schema/migration authority. `scripts/ega-runner` remains a separate autonomous-delivery subsystem.

## Responsibilities

### `apps/web`

Owns Next.js web transport/rendering, Server Components/Actions, presentation, and retained compatibility routes such as Agent/MCP/OAuth/integrations/cron. Server-side web code may compose application/data-access directly; it must not self-fetch the repository's Hono server merely to reuse the same application logic.

### `apps/mobile`

Owns Expo-native UI, navigation, token/session storage, and native composition. Canonical mobile product traffic uses the standalone authenticated Hono API. Mobile must not import server-side application/persistence/web internals.

### `apps/server`

Owns the standalone Hono HTTP transport. Current route families include Auth,
Timer, Projects, Goals, Tasks, Today, Inbox, Notifications, Friction, Health,
Operator, Time Context, and Weekly Review. It verifies Supabase bearer
identity, derives the authenticated actor, creates request-scoped persistence
composition, and maps HTTP to shared use cases instead of duplicating business
rules. Deployment authority is documented in [`hono-deployment.md`](hono-deployment.md).

### `@ega/contracts`

Owns reusable platform-neutral DTOs/contracts. It must not depend on React, Next, React Native, Expo, Supabase, Drizzle, or database queries.

### `@ega/domain`

Owns pure domain constants/rules and stays framework-/transport-/persistence-independent.

### `@ega/application`

Owns use-case semantics, stable application errors, orchestration, repository ports, read models, and product calculations. Current exports cover Projects, Goals, Tasks, Today, focus-queue/recurrence behavior, and related ports. It does not own HTTP, redirects, cookies, rendering, Supabase implementation, or DB drivers.

### `@ega/data-access`

Owns repository adapters for shared application ports. User-scoped adapters receive/use request-scoped Supabase context; they do not create a global privileged authorization shortcut.

### `@ega/api-client`

Owns reusable typed HTTP mechanics and current endpoint methods for the shared
server route families. Token/session acquisition remains client-side
composition rather than package-owned Expo storage.

## Dependency direction

Executable enforcement lives in `scripts/architecture/check-boundaries.mjs`.

```text
apps/web         -> contracts/domain/application/data-access
apps/server      -> contracts/domain/application/data-access
apps/mobile      -> contracts/domain/api-client
api-client       -> contracts
application      -> contracts/domain + repository ports
data-access      -> application ports + request-scoped Supabase
contracts/domain -> platform-neutral primitives only
```

Forbidden examples include mobile importing application/data-access/server/web/DB internals; contracts/domain importing framework or persistence packages; and api-client importing Expo/React/Next/Supabase/application/data-access implementations.

## Request security and RLS

```text
Authorization: Bearer <Supabase access token>
                ↓
server-side token verification
                ↓
verified user.id
                ↓
AuthenticatedActor { userId }
                ↓
request-scoped Supabase client carrying caller token
                ↓
PostgREST / RLS
```

Identity never comes from JSON body, URL/query parameter, FormData, or a custom user-id header. Normal user-scoped requests must not use service-role/unrestricted privileged DB access as an authorization shortcut.

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

The web application does not need an internal HTTP hop to `apps/server` for logic it can compose directly.

## Mobile data flow

```text
Expo screen / feature
        ↓
mobile session + API adapter
        ↓
@ega/api-client where covered
        ↓
apps/server
        ↓
shared application/data-access
        ↓
Supabase/RLS
```

Package adoption is feature-specific; do not infer that every transport helper has been consolidated into `@ega/api-client` merely because the package exists.

## Database ownership

Canonical DB/migration authority remains at repository root:

- `src/db/schema.ts`
- `src/db/mcp-schema.ts`
- `src/db/client.ts`
- `drizzle/`
- `drizzle.config.ts`

There is no second tracked schema/migration authority under `apps/web` or `apps/server`. Relocation requires a separate explicit ownership ADR/migration plan.

## Retained compatibility surfaces

The current monorepo intentionally still contains compatibility surfaces outside the shared native HTTP path, including:

- Agent API under `apps/web/src/app/api/agent`;
- MCP API;
- OAuth;
- integrations;
- cron/background routes;
- Runner;
- root database/migration authority;
- compatibility/re-export/presentation shims with live consumers.

Their existence is not permission to put new shared product rules in transport code. Migrate one bounded surface only when its ownership and compatibility evidence are explicit.

## CI and executable enforcement

The root manifest exposes architecture/workspace/purity/security checks plus per-workspace typecheck/test/build scripts. Use [`../agent-context/testing-and-validation.md`](../agent-context/testing-and-validation.md) rather than frozen test-count baselines.

Important structural gates include:

- `npm run check:architecture`
- `npm run test:architecture`
- `npm run ci:purity`
- `npm run ci:security`
- `npm run ci:workspace`

These prove source/package constraints for the executed revision; they do not by themselves prove deployed Vercel/Supabase/mobile-device behavior.

## Historical migration provenance — 2026-08-08 to 2026-08-09

> **HISTORICAL SNAPSHOT — NOT CURRENT BRANCH TRUTH.** The original first-wave was delivered as an ordered stacked-PR chain (`arch/01-*` through `arch/10-*`, PRs #119–#128). At the time this section was written, stages were pre-merge validated/open. That status has since been superseded by the topology now present on `main`. Use Git history/PR metadata for exact historical SHAs/check runs; use current code and this document's sections above for present architecture.

The migration sequence was:

1. architecture guardrails;
2. npm workspace foundation;
3. contracts/domain extraction;
4. application/data-access extraction;
5. authenticated Hono transport;
6. cross-platform API client;
7. Next.js move into `apps/web` while retaining root DB authority;
8. native Projects/Goals adoption;
9. unified platform CI;
10. compatibility cleanup/readiness evidence.

The original scope deliberately avoided a microservices rewrite, pnpm/Turborepo migration, broad auth redesign, and premature DB-schema relocation. Those non-goals remain useful context but are not perpetual prohibitions if a future explicit architecture decision supersedes ADR 001.

## Architecture evolution rule

When this boundary changes, update together:

1. the accepted/new ADR;
2. executable boundary/security/purity checks;
3. this living architecture document;
4. root `ARCHITECTURE.md` when the system map changes;
5. `CONTEXT.md` only when the product mental model changes;
6. the decision log for the conflict/resolution trail.
