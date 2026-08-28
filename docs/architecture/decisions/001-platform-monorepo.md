# ADR 001: Platform Monorepo Boundaries

- **Status:** Accepted and implemented
- **Decision date:** 2026-08-08
- **Implementation status reviewed:** 2026-08-25
- **Scope:** first-wave EGA House architecture migration

## Current status note

The topology decided here is now present on `main`: `apps/web`, `apps/mobile`, `apps/server`, and five `packages/*` workspaces. The original context below describes the pre-migration problem and is intentionally historical. Current implementation detail lives in [`../platform-monorepo.md`](../platform-monorepo.md) and [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md).

The standalone Hono transport has since expanded beyond the original first-wave Projects/Goals scope to the canonical mobile Auth/Timer/Projects/Goals/Tasks/Today surface. That expansion does not change this ADR's core dependency/security decision.

## Context (historical at decision time)

EGA House combined a root Next.js product/API application, a nested Expo application, Supabase/Postgres access, Agent/MCP/OAuth/integration/cron routes, and the autonomous Runner in one repository. Projects and Goals were implemented through web UI/transport code and Supabase-backed services rather than through a shared application boundary consumable safely by both web and native transports.

The first-wave goal was to create explicit application/package boundaries without rewriting unrelated product surfaces or weakening Supabase RLS.

## Decision

Use npm workspaces with three applications and five shared packages:

```text
apps/web
apps/mobile
apps/server

packages/contracts
packages/domain
packages/application
packages/data-access
packages/api-client
```

The repository stays npm-based. This ADR does not introduce pnpm/Turbo or a microservices topology.

`apps/web` and `apps/server` may compose `@ega/application` with request-scoped `@ega/data-access`. `apps/mobile` uses authenticated HTTP/`@ega/api-client` for shared native product access and must not import server-side application/persistence implementations.

Server-side web rendering/actions call application/data-access directly instead of making HTTP calls to the repository's own standalone server merely to reuse application logic.

## Security decision

For user-scoped Hono requests, the standalone server verifies the Supabase access token server-side, derives `AuthenticatedActor.userId` from that verified identity, and uses request-scoped Supabase context carrying the same caller token. Supabase/PostgREST RLS remains an enforcement boundary.

Normal product requests must not use a service-role client or privileged raw database connection as an authorization shortcut, and request payloads never choose actor identity.

## Database decision

`src/db/schema.ts`, `src/db/mcp-schema.ts`, root DB client wiring, and `drizzle/` remain the canonical schema/migration authority during this architecture. Schema relocation is deferred until a separate ownership decision can be made without duplicating migration authority.

## Compatibility decision

The first wave did not force Agent, MCP, OAuth, integrations, cron/background jobs, Runner, or all legacy/native surfaces through the new package/server boundaries. Compatibility surfaces may remain while migration proceeds feature-by-feature; their behavior must not become a second authority for newly shared product semantics.

## Consequences

Positive:

- web and native can share one application/domain authority;
- transport concerns are independently testable;
- mobile cannot bypass the HTTP/auth boundary into persistence code;
- RLS-preserving request scoping is explicit;
- migrations can proceed one bounded surface at a time.

Trade-offs:

- compatibility Next routes coexist with the standalone server;
- database schema files remain outside shared packages;
- web and server deploy as separate application targets;
- compatibility adapters/re-exports may temporarily exist but must not become duplicated authority.

## Enforcement

`scripts/architecture/check-boundaries.mjs` parses tracked source and fails on prohibited imports. CI adds package-purity, workspace, security, typecheck/test/build evidence. Documentation alone is not enforcement proof.

## Non-goals

This decision by itself does not authorize production deployment, secrets changes, database mutation, automatic merge, a distributed microservices rewrite, or unrelated dependency/framework modernization.

## Supersession rule

A future change to these core boundaries should create a new ADR that explicitly supersedes the relevant part of ADR 001; do not silently edit current code into a new architecture while leaving this decision appearing authoritative.