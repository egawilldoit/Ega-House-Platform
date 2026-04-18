---
name: quality-gate
description: run before shipping any meaningful change to the ega house repo, especially before any pr or merge, after schema changes, and after auth, routing, timer, or session changes.
---

Run sequentially. Stop on first failure.

## Scope

- ui-only change:
  - `npm run lint`
  - `npx tsc --noEmit`

- meaningful feature or route change:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`

- schema change:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
  - Drizzle sync check

- auth, routing, timer, or session-sensitive change:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
  - relevant repo test scripts

## Commands

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run build`

Only if schema changed:
4. `npm run db:generate`
5. inspect generated migration/meta output for expected changes only

Only if auth, routing, timer, or session changed:
6. `npm run test:session`
7. `npm run test:timer-recovery`
8. `npm run test:auth-session:e2e` when credentials/config are available

## Stop conditions

- if lint fails, stop
- if typecheck fails, stop
- do not run build on broken types
- do not run Drizzle checks if lint or typecheck failed
- do not run repo tests if earlier required steps failed

## Pass condition

Done means:
- zero lint errors
- zero TypeScript errors
- clean build
- expected Drizzle output only when schema changed
- relevant repo tests pass when the touched area requires them

## Code coherence check

Before calling the work done, verify:
- no dead imports
- no unused helpers
- no orphaned files created for the change
- no half-wired components, routes, buttons, badges, or panels
- the codebase is more coherent than before
