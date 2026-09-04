# Web App Agent Instructions

Scope: `apps/web/`. This extends the root [`AGENTS.md`](../../AGENTS.md).

## Ownership and boundaries

`src/app` owns routes, Server Components/Actions, and compatibility APIs;
`src/components` owns presentation; `src/hooks` owns client hooks; `src/lib`
owns web composition, adapters, utilities, and retained compatibility surfaces.

- Server-side web code may compose `@ega/application` and `@ega/data-access`
  directly. Do not self-fetch Hono merely to reuse an endpoint.
- Put workflow policy in `@ega/application`/`@ega/domain`, not components or
  actions. Client components must not import DB, persistence, or secrets.
- Identity is server-derived. Root `src/db` and `drizzle/` remain schema
  authority. Preserve `src/app/api` and `src/lib` compatibility surfaces until
  callers and removal safety are proven.
- Reuse the nearest feature pattern. Do not add a duplicate DTO, data owner,
  state system, design system, or icon framework.

## Proof

Use the narrowest test first. From repository root, relevant checks are:

```text
npm run web:typecheck
npm run web:test
npm --workspace @ega/web run lint
npm run web:build
```

For ownership/import changes also run `npm run check:architecture`,
`npm run test:architecture`, and `npm run ci:purity`; for auth/RLS changes add
`npm run ci:security`. Inspect loading, empty, error, success, focus, keyboard,
responsive, and reduced-motion states for touched UI. Do not claim runtime
behavior from source or tests alone.
