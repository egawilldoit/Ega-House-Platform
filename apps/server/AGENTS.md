# Hono Server Agent Instructions

Scope: `apps/server/`. This extends the root [`AGENTS.md`](../../AGENTS.md).
Read [`../../docs/architecture/hono-deployment.md`](../../docs/architecture/hono-deployment.md)
and [`../../docs/architecture/platform-monorepo.md`](../../docs/architecture/platform-monorepo.md)
for current transport/deployment context.

## Transport and security

Hono remains thin: parse HTTP, verify bearer auth, derive `AuthenticatedActor`,
compose request-scoped Supabase with the same token, call application/data-access,
and map shared contracts/errors. Never derive identity from body, query, path,
FormData, or custom headers; never replace normal RLS CRUD with service role.

Durable policy belongs in `@ega/application`/`@ega/domain`, wire shapes in
`@ega/contracts`, persistence in `@ega/data-access`. Do not import web/mobile
internals, duplicate DTOs, or turn Hono into a web-internal RPC.

## Proof

```text
npm run server:typecheck
npm run server:test
npm --workspace @ega/server run build:vercel
```

Auth/RLS changes additionally require `npm run ci:security`,
`npm run check:architecture`, `npm run test:architecture`, and
`npm run ci:purity`. Test malformed, unauthenticated, unauthorized, empty,
invalid-transition, and contract/error cases at the closest seam.
