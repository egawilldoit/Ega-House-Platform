# Mobile Feature Convergence — Wave 08 Evidence

Status: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE

Branch: `wave/08-mobile-feature-convergence`

Starting accepted HEAD: `034b594406dfa085fbefe5c04cc9d1a5a0592075`

## Objective

Evaluate mobile product-value opportunities from the existing EGA House
capabilities. This wave favors contextual discovery and actionability over
endpoint parity or new top-level navigation.

## Current evidence and decisions

| Capability | Existing mobile path | Current product evidence | Wave 08 decision |
| --- | --- | --- | --- |
| Operator | `/api/today` → `Today` → `HealthCoachSnapshot` and task suggestions | Today already renders the canonical operator snapshot and suggestion actions. Proposal lifecycle DTOs are not consumed by mobile. | Retain contextual Today placement; do not add an Operator tab or page. |
| Health | `useHealthSnapshotQuery` → `HealthCoachSnapshot` inside Today | Workload metrics and recommendations are visible in the Today workflow. A separate Health route would duplicate context. | Retain contextual Today placement; do not add a Health page. |
| Friction | `/api/friction/radar` → `friction.tsx` → `FrictionRadarView` | The route has loading, empty, error, and populated states. Signal DTOs carry task/goal IDs, but signal rows are display-only and no in-product link to the screen was found. | Make existing task/goal signals actionable and add low-clutter discovery without adding a tab. |
| Notifications | `/api/notifications` → notification center; Today bell; Profile/settings entry | List, unread state, mark-opened, mark-all-read, target routing, and preferences already exist. | Preserve the current surface; no redundant notification page or transport work. |
| Weekly Review | `/api/review` → `review.tsx` | The route has date navigation, metrics, blockers, reflection, draft, and no-data/error states. No in-product reference to the route was found, so it is effectively deep-link-only. | Add an existing-workspace discovery path without adding a top-level tab. |

## Candidate scoring

Scores use a 1–5 scale for frequency, phone context, actionability,
simplicity, discoverability, and existing-flow fit. They guide scope rather
than substitute for runtime evidence.

| Capability | Frequency | Phone context | Actionability | Simplicity | Discoverability | Existing-flow fit | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Operator | 5 | 5 | 4 | 5 | 5 | 5 | Keep in Today; already converged. |
| Health | 3 | 4 | 4 | 5 | 5 | 5 | Keep in Today; already converged. |
| Friction | 4 | 5 | 5 | 4 | 1 | 4 | Improve links and discovery. |
| Notifications | 4 | 5 | 4 | 4 | 5 | 5 | Preserve current implementation. |
| Weekly Review | 2 | 4 | 4 | 4 | 1 | 3 | Add lightweight discovery. |

## Runtime boundary

The latest accepted mobile verification evidence proves L1–L5 and an explicit
L8 `/health` request. Android app execution (L6), physical-device execution
(L7), authenticated mobile workflows, and authenticated deployed mutations
remain `NOT VERIFIED` because no emulator/device or authenticated runtime is
available in this environment. Wave 08 will not claim those levels from
source inspection.

## Product gate

The planned scope must answer:

- Why mobile: Friction and Review are low-frequency but useful while away from
  the desktop; Friction should shorten the path from signal to decision.
- Where: existing secondary mobile routes and an existing workspace/profile
  navigation surface, without changing the five primary tabs.
- Discovery: visible, labeled links from an existing authenticated surface.
- Action: open the canonical task/goal detail for actionable Friction signals;
  open the existing Weekly Review route for review work.
- Canonical capability: existing contracts, API client, Hono routes, and
  application behavior; no new mobile data owner.
- Why not new navigation: these are supporting intelligence surfaces, not
  daily destinations that justify another bottom-tab item.

## Verification update

- Focused Wave 08 coverage: 4 suites / 9 tests pass.
- Exact worktree mobile gates pass: typecheck, 42 suites / 248 tests, Expo
  Doctor 18/18, and Android export/bundle.
- Exact pushed implementation checkpoint `e59de38e6e784b4141b76cdd08ead800f04946c5`
  has green GitHub checks (run `33787076273`).
- Exact implementation/evidence-head `d751b490a045d283f3c5977e888e12aadc97770b` has green
  GitHub checks (run `33788150507`), including workspace, architecture,
  security, server, web, mobile, database-invariant, and hygiene gates.
- Final acceptance-record head `cf9d3fc02b7df98d2bbea99b4c52f276c7a21ed0` has
  green exact-head GitHub checks (run `33788620149`), including the same
  required validation jobs.
- Vercel's server status for the SHA is `Skipped - Not affected`; no ready
  Preview was produced.
- Authenticated Android execution remains NOT VERIFIED: no emulator/device or
  authenticated session is available. L6/L7 and authenticated mutation proof
  are external/runtime gaps, not source-level acceptance evidence.

- Fresh independent review: Critical=0, Important=0, Minor=0.
- Wave acceptance: code gate PASS; product gate PASS by source and focused
  rendered-component evidence; runtime gate L1–L5 PASS and explicit L8
  `/health` PASS, with L6/L7/authenticated Android NOT VERIFIED.
- Final exact evidence-head: `cf9d3fc02b7df98d2bbea99b4c52f276c7a21ed0`.
