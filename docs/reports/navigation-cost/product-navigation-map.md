# Product navigation consolidation

Status: implemented in `followup/product-nav` on top of `b0e30aca`. No route was
retired in this change. The reviewed disposable journey manifest is unchanged
because no journey test title or file was removed or renamed.

## Target and result

The product target is five primary destinations:

| Destination | Route | Sidebar row |
| --- | --- | --- |
| Today | `/today` | Yes |
| Tasks | `/tasks` | Yes |
| Projects | `/tasks/projects` | Yes |
| Money | `/money` | Yes |
| Review | `/review` | Yes |

Goals and Timer remain real pages as contextual utility surfaces:

| Utility | Route | Contextual entry points | Global entry points |
| --- | --- | --- | --- |
| Goals | `/goals` | Projects header → `Goals` (`/goals?view=all`); project detail → linked milestones; goal search result deep link | Command palette `Goals` |
| Timer | `/timer` | Review header → `Timer history` (`/timer#recent-sessions`); Today header/cockpit → `/timer`; active-timer chip → `Open timer history` | Command palette `Timer` |

The command palette now contains `Goals` and `Timer` as utility destinations.
This is not a return to seven primary sidebar rows: `COMMAND_ROUTES` is still
exactly the five rows above, and the sidebar renders only that registry.

## Why `/goals` and `/timer` were not retired

Both routes are compatibility deep links with executable contracts. Removing or
redirecting either one would lose capability or require weakening reviewed
tests:

| Contract | File | Dependency |
| --- | --- | --- |
| Unauthenticated protection covers both routes | `apps/web/tests/auth-session.e2e.spec.ts` | `protected pages reject a signed-out browser` asserts `/goals` and `/timer` return the login redirect with the original `next` URL. |
| Timer export stays owner-protected | `apps/web/tests/auth-session.e2e.spec.ts` | `real login survives reload and logout revokes protected access` asserts `/timer/export` returns `401` after logout. |
| Timer recovery and competing-client reconciliation | `apps/web/tests/pwa-morning-startup.e2e.spec.ts` | `two timer clients reconcile a competing start and safely retry an old stop` signs in directly to `/timer`, uses `Select task` / `Start session` / `Stop session`, reads `input[name="sessionId"]`, and requires stop feedback to redirect to `/timer?...`. |
| Mobile protected-route matrix | `apps/web/tests/pwa-mobile.e2e.spec.ts` | `MIDDLEWARE_PROTECTED_PATHS` includes `/goals` and `/timer`. |
| Goal management is a product capability | `apps/web/src/app/(workspace)/goals/` | Goal creation, health/status/next-step edits, archive/restore, linked-task navigation, and project milestone deep links all live on the real page. |
| Workspace shell persistence | `apps/web/tests/workspace-navigation.e2e.spec.ts` | Primary and utility navigation must preserve the same shell DOM element and cause zero document reloads. Utility destinations are now entered through the command palette in that test. |

`disposable-journeys.e2e.spec.ts` and
`pwa-personal-operations.e2e.spec.ts` have no direct `/goals` or `/timer`
navigation dependency. They still exercise their own protected flows through
`/today`, `/money`, `/review`, and `/settings`; no assertion was weakened.
`visual-a11y.spec.ts` now includes `/goals` and `/timer` in its authenticated
route matrix; because that suite accepts a login redirect, the addition also
covers the unauthenticated path. It was not run locally in this pass.

## Redirect map that matters here

- `/backlog` redirects to `/tasks?tab=inbox`; the Backlog command keeps the
  redirect.
- `/archive` redirects to `/tasks?tab=archived`.
- `/startup`, `/shutdown`, `/apps`, `/home`, `/dashboard`, and `/favorites`
  redirect to retained surfaces.
- There is intentionally **no** `/goals` or `/timer` redirect.
  `apps/web/src/components/layout/shell-route-meta.test.ts` and the focused
  Goals/Review page tests fail if a redirect is added later.

## Measurement

Navigation cost is measured by `scripts/navigation-cost/measure.mjs`; see
[`docs/reports/navigation-cost/README.md`](navigation-cost/README.md) for the
procedure and metric definitions. The JSON reports next to that README are the
recorded baseline and after measurements. No improvement is claimed in this
change: server request counts are unchanged and First Load JS rises slightly
from the added links and palette entries.

## Verification

Recorded on 2026-11-22 in `followup/product-nav`:

| Check | Result |
| --- | --- |
| `npm run web:typecheck` | Pass |
| `npm --workspace @ega/web run lint` | 0 errors, 15 pre-existing `no-unused-vars` warnings in unrelated tests |
| `npm run web:test` | 334 files / 2487 tests passed; 3 skipped |
| `node --test scripts/navigation-cost/measure.test.mjs` | 5 passed |
| `npm run check:architecture` + `test:architecture` | Pass |
| Reviewed disposable E2E (`auth-session`, `disposable-journeys`, `pwa-morning-startup`, `pwa-personal-operations`) | 11/11 passed against an isolated loopback backend |
| `npm run build --workspace @ega/web` | Compiles, type-checks, and generates all routes. Next 16.4.3 then exits 1 at its security-advisory nudge; repeated retries produced the same post-build exit. The completed `.next` artifacts were used for the measurement. |

The disposable E2E run used an isolated backend on alternate loopback ports
because the default ports were occupied by an unrelated checkout. The temporary
loopback-port allowance and local environment file were reverted/deleted after
the run; no test assertion was changed in the committed diff. The reviewed
journey manifest is unchanged.

Supporting fix: the project detail Server Component called `normalizeProjectTab`
from a `"use client"` module, which fails at render with "Attempted to call ...
from the server". That made the project detail (a Goals contextual entry point)
unusable. Tab values/normalization now live in the server-safe
`project-tabs.ts`; the client tab navigation imports the same values. This is
covered by `project-tabs.test.ts`.

The build advisory gate is external to this change. Upgrade recommendation:
Next.js 16.4.3 is reported by its own build as affected by a known security
vulnerability; run the suggested `next upgrade --agent=security` flow in a
separate change rather than bundling an upgrade into this navigation patch.
