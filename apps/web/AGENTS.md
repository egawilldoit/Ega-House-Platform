# Web App Agent Instructions

Scope: everything under `apps/web/`. These rules extend the repository-root [`AGENTS.md`](../../AGENTS.md).

## Ownership

`apps/web` is the Next.js web product. Its main source areas are:

- `src/app` — routes, layouts, server/client boundaries, Server Actions, compatibility APIs;
- `src/components` — presentation and interactive UI;
- `src/hooks` — web/client hooks;
- `src/lib` — web-specific composition, adapters, utilities, and compatibility surfaces.

Read [`../../CONTEXT.md`](../../CONTEXT.md) for product workflow semantics and [`../../docs/architecture/platform-monorepo.md`](../../docs/architecture/platform-monorepo.md) before changing ownership across workspaces.

## Architecture rules

- Put reusable product workflow policy in `@ega/application` / `@ega/domain`, not in route actions or React components.
- Server Components and Server Actions may compose `@ega/application` with `@ega/data-access` directly.
- Do **not** self-fetch `apps/server` from server-side web code merely to reuse an HTTP endpoint. The Hono server is the native/external transport boundary, not an internal web RPC layer.
- Client Components must not import server-only persistence, root DB modules, or secrets.
- Keep caller identity server-derived. Do not accept a request/body/query user id as a substitute for authenticated identity.
- Root `src/db` and `drizzle/` remain the database/schema authority. Do not create a second web-local schema or migration authority.
- Existing `src/app/api` routes and `src/lib` compatibility surfaces may have external consumers. Preserve them unless the issue explicitly authorizes migration/removal and evidence proves callers are covered.
- Keep UI state/presentation concerns in the web app; do not push React/browser types into shared domain/application packages.

## Pattern selection

Before adding a new action, service, or adapter, find the closest current implementation in the same feature area and reuse its ownership pattern. Prefer a small call into an existing application use case over duplicating orchestration in the route/action.

Treat old compatibility code as **legacy-to-evaluate**, not automatically as a pattern to copy and not automatically as dead code to delete.

## Validation

From repository root, prefer:

```bash
npm run web:typecheck
npm run test:web
npm run lint:web
npm run build:web
```

Use the narrowest relevant test first. Run `npm run build:web` for routing/build-boundary changes, shared import changes, or before claiming a web PR is release-ready. If imports/ownership move across workspaces, also run:

```bash
npm run check:architecture
npm run test:architecture
npm run ci:purity
```

For auth/security boundary changes, also run `npm run ci:security`.

## Do not

- move workflow rules into components/actions for convenience;
- add browser imports of server-only modules;
- add a second database/schema owner under this app;
- bypass established application/data-access boundaries with direct ad-hoc persistence;
- remove compatibility routes based only on an import search.
