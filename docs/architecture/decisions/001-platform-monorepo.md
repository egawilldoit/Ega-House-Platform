# ADR 001: Platform Monorepo Boundaries

- Status: Accepted for staged implementation
- Date: 2026-08-08
- Scope: first-wave EGA House architecture migration

## Context

EGA House currently combines a root Next.js product/API application, a nested Expo application, Supabase/Postgres access, Agent/MCP/OAuth/integration/cron routes, and the autonomous Runner in one repository. Projects and Goals are currently implemented through web UI/transport code and Supabase-backed services rather than through a shared application boundary that can be consumed safely by both web and native transports.

The first-wave goal is to create explicit application/package boundaries without rewriting unrelated product surfaces or weakening Supabase RLS.

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

The repository stays npm-based. No pnpm/Turbo migration is introduced. Next.js and Expo versions stay pinned during this architecture work unless a narrowly required compatibility fix is independently justified.

`apps/web` and `apps/server` may compose `@ega/application` with request-scoped `@ega/data-access`. `apps/mobile` uses `@ega/api-client` for new Projects/Goals HTTP access and must not import server-side application/persistence implementations.

Server-side web rendering/actions call application/data-access directly instead of making HTTP calls to the repository's own standalone server.

## Security decision

For user-scoped Projects/Goals requests, the standalone server must verify the supplied Supabase access token server-side, derive `AuthenticatedActor.userId` from that verified identity, and construct a request-scoped Supabase client carrying the same access token. Supabase/PostgREST RLS remains an enforcement boundary.

Normal product requests must not use a service-role client or privileged raw database connection as an authorization shortcut, and request payloads never choose the actor identity.

## Database decision

`src/db/schema.ts`, `src/db/mcp-schema.ts`, and `drizzle/` remain in their current canonical location during this wave. Schema/package relocation is deferred until additional transport consumers migrate and a dedicated ownership decision can be made without duplicating migration authority.

## Compatibility decision

The first wave does not migrate Agent, MCP, OAuth, integrations, cron/background jobs, Runner, or legacy Mobile Auth/Tasks/Today. Their routes and behavior remain compatibility surfaces in the Next application.

## Consequences

Positive:

- web and native Projects/Goals share one application authority;
- transport concerns become testable independently from business rules;
- mobile cannot bypass the HTTP/auth boundary into persistence code;
- RLS-preserving request scoping stays explicit;
- later migrations can proceed one bounded surface at a time.

Trade-offs:

- the repository temporarily contains both legacy Next route surfaces and the new standalone server;
- database schema files remain outside the eventual shared-package shape;
- deployment configuration must later recognize `apps/web` and a separate `apps/server` deployment target;
- compatibility adapters/re-exports may exist temporarily but must not become duplicated authority.

## Enforcement

`scripts/architecture/check-boundaries.mjs` parses tracked source with the TypeScript compiler API and fails on prohibited imports. CI is strengthened as the workspaces become real. Documentation alone is not considered enforcement evidence.

## Non-goals

This decision does not authorize production deployment, secrets changes, database mutations, automatic merge, a microservices topology, or dependency/framework modernization unrelated to the migration.
