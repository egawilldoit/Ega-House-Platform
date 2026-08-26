# Hono Server Agent Instructions

Scope: everything under `apps/server/`. These rules extend the repository-root [`AGENTS.md`](../../AGENTS.md).

## Role

`apps/server` is the authenticated HTTP transport for native/API clients. It should remain thin: HTTP parsing, authentication, transport mapping, application calls, and response mapping.

The current canonical security pattern is visible in `src/app.ts`: bearer token extraction → server-side verification → `AuthenticatedActor` creation → request-scoped Supabase client carrying the same token → route/application work.

Read [`../../docs/architecture/hono-deployment.md`](../../docs/architecture/hono-deployment.md) and [`../../docs/architecture/platform-monorepo.md`](../../docs/architecture/platform-monorepo.md) for boundary/deployment context.

## Security invariants

- Never construct `AuthenticatedActor` from body, query, path, FormData, or a caller-selected custom user-id header.
- Verify the bearer token before creating the actor.
- Build request-scoped data access with the **same authenticated token** so Supabase RLS remains in the authorization path.
- Do not replace request-scoped RLS access with a global service-role/unrestricted client for normal user CRUD.
- Keep unauthenticated/public paths explicit and minimal.
- Keep error responses from leaking token contents, secrets, or internal credentials.

If a change makes identity or authorization easier by trusting input instead of verified auth, it is architecturally wrong even if tests can be made to pass.

## Layering

- Routes validate/parse transport input and call application use cases/repositories through approved composition.
- Durable workflow rules belong in `@ega/application` / `@ega/domain`.
- Shared wire shapes belong in `@ega/contracts`.
- Persistence implementation belongs in `@ega/data-access`.
- Do not import web or mobile internals.
- Keep `src/app.ts` composition understandable; do not hide auth authority inside unrelated route helpers.

## Validation

From repository root:

```bash
npm run server:typecheck
npm run server:test
npm --workspace @ega/server run build:vercel
```

For auth/RLS/security changes also run:

```bash
npm run ci:security
npm run check:architecture
npm run test:architecture
```

For cross-package ownership/import changes also run `npm run ci:purity`.

## Do not

- accept caller-selected identity;
- put business workflow policy in Hono handlers;
- introduce a privileged global DB shortcut to avoid RLS;
- duplicate DTOs that belong in `@ega/contracts`;
- turn this server into an internal HTTP dependency for server-side web code.
