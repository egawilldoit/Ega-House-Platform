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
- Keep state minimal: derive display values from current props/data when possible;
  use effects for synchronization with external systems, not to mirror derived
  state. Keep browser-only code behind the smallest necessary client boundary.
- For performance changes, inspect the actual slow route or interaction first.
  Check repeated fetches, query shape, client JavaScript, render work, and cleanup
  before adding memoization or caching. Measure comparable before/after behavior;
  do not treat `memo`, `useMemo`, or a build pass as performance proof.

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

For changed mutations, verify persisted outcome, failure feedback, and invalidation
of affected projections. Check user-switch cache isolation and shared task/timer/
Today semantics when touched; select date/timezone and duplicate-submit cases by
risk. Rendered tests do not establish an authenticated end-to-end flow.
`tests/visual-a11y.spec.ts` accepts a login redirect for protected routes, so a
green run does not prove those screens rendered. For a changed protected screen,
drive it with an authenticated browser at relevant viewport sizes and inspect the
action, resulting UI, and persisted state when applicable; report unavailable
credentials as a coverage gap.
