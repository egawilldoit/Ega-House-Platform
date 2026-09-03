# Cross-Platform Consistency — Wave 10 Evidence

Status: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE

Branch: `wave/10-cross-platform-consistency`

Starting accepted HEAD: `c4eb9c922f57c68bb7679d7430f4ad6340b92100`

## Objective

Verify that web and mobile use one EGA House product model across the core
Project → Goal → Task → Timer → Review loop and its supporting intelligence.
The comparison follows the canonical application layer through Hono,
contracts, the API client, web surfaces, and mobile surfaces. Runtime claims
are separated from source and test evidence.

## Evidence rules

- Application/domain behavior is the semantic authority.
- Web server-side workflows use the application/data-access path directly.
- Mobile uses the mobile API adapters over `@ega/api-client`; it does not
  import application, data-access, database, server, or web internals.
- Authenticated cross-surface mutation proof is `RUNTIME NOT VERIFIED` in the
  current environment because no authenticated browser/database session or
  Android emulator/device is available.

## Scenario ledger at the starting head

| Scenario | Canonical owner and transport evidence | Web surface | Mobile surface | Static result | Runtime result | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Project create/status/archive | `packages/application/src/projects`; `apps/server/src/routes/projects.ts`; `packages/api-client/src/projects.ts` | Workspace project list/detail and actions | Projects list/detail and action sheet | PASS | NOT VERIFIED | Verify create → observe → status across surfaces when authenticated runtime exists. |
| Goal create/status/health/next step/archive | `packages/application/src/goals`; `apps/server/src/routes/goals.ts`; `packages/api-client/src/goals.ts` | Goals workspace and actions | Goals list/detail and action sheet | PASS | NOT VERIFIED | Verify shared state and archive lifecycle at the actual boundary. |
| Task create/edit/complete/archive/restore/pin/reminder/recurrence | `packages/application/src/tasks`; `apps/server/src/routes/tasks.ts`; `packages/api-client/src/tasks.ts` | Tasks, Today, and task detail actions | Tasks list/detail and Today actions use mobile task queries, including Active/All scope and archive controls | PASS for canonical task transport and covered mobile archive scope; secondary action visibility remains runtime-unverified | NOT VERIFIED | Compare each mutation response and resulting projection. |
| Today add/remove/status/clear completed | `packages/application/src/today`; `apps/server/src/routes/today.ts`; `packages/api-client/src/today.ts` | Today planner actions | Today query and mutations invalidate Today/task caches | PASS | NOT VERIFIED | Prove one mutation from each surface and observe the projection on the other. |
| Timer start/active/stop/evidence | `packages/application/src/timer`; `apps/server/src/routes/timer.ts`; `packages/api-client/src/timer.ts` | Timer actions also support stopped-task outcome handling | Timer workspace/start/stop uses server-authoritative session state | PASS for execution evidence; outcome prompt is surface-specific | NOT VERIFIED | Confirm active/stop state and execution evidence across surfaces. |
| Inbox capture/edit/archive/restore/convert | `packages/application/src/inbox`; `apps/server/src/routes/inbox.ts`; `packages/api-client/src/inbox.ts` | `/ideas` supports capture, edit, archive, restore, and canonical inbox data | Inbox tab supports Active/Archived/All processing, edit, archive/restore, and project-backed conversion | PASS for canonical processing actions and invalidation coverage | NOT VERIFIED | Verify the complete processing loop at an authenticated runtime boundary. |
| Weekly Review source and semantics | `packages/application/src/weekly-review`; `apps/server/src/routes/weekly-review.ts`; `packages/api-client/src/weekly-review.ts` | Review source and saved reflection flow | Review route reads canonical DTO and handles week navigation/states | PASS | NOT VERIFIED | Verify same review window/source data when authenticated runtime exists. |
| Notifications unread/read/opened | `packages/application/src/notifications`; `apps/server/src/routes/notifications.ts`; `packages/api-client/src/notifications.ts` | Notification center, unread count, read/open/read-all | Notification center, unread state, opened/read-all, target routing | PASS for current task-target contract | NOT VERIFIED | Confirm unread/read/opened state is consistent across surfaces. |

## Root-cause findings

### Inbox restore/edit/convert gap

Reproduction from source:

1. Open `apps/mobile/app/(app)/(tabs)/inbox.tsx`.
2. Observe `useInboxListQuery()` has no `view` parameter, so the canonical
   application default is `active`.
3. Archive an active item; the mutation invalidates the list.
4. The refreshed active list cannot contain the archived item, so the
   screen's existing `Restore` branch is unreachable through normal use.
5. The screen has no edit or convert control, while the API client already
   exposes `inbox.update` and `inbox.convert` and the server exposes the
   corresponding authenticated routes.

Hypothesis: mobile Inbox was incomplete because its presentation/query layer
stopped at capture and archive even though the canonical transport and
application capabilities already cover the full processing loop. The
divergence began at the mobile adapter/query/presentation boundary, not in
the application or Hono layers.

Working comparison: web `/ideas` renders `EditIdeaNoteForm` and archive/
restore controls over the server-side service; its conversion path remains
the canonical application conversion route. Mobile should reuse the existing
Hono/API-client contract rather than create a second Inbox authority. The
implementation now adds the missing view, edit, restore, and conversion
actions in that existing path.

### Task archive scope and read-model gap

The canonical task repository already accepted `includeArchived` and
`plannedForDate`, but the mobile list parser and list read model did not
preserve both fields at the Hono boundary. The mobile adapter also dropped
the filters and exposed no archive mutation wrappers, so the task UI could
not prove archive/restore parity.

Hypothesis: task parity diverged at serialization and the mobile adapter,
not in task persistence. Regression tests proved the request filters,
response fields, owner-scoped repository predicates, and archive/unarchive
delegation before the minimal transport and presentation repair.

## Implementation evidence

- `4b9ee11e`: keeps Inbox view placeholders scoped and routes a converted
  task to its actual task detail destination without claiming Today
  inclusion.
- `fe581544`: preserves task archive/date filters and read-model fields
  through contracts, application, Hono, and the mobile adapter.
- `05eb5d24`: exposes mobile Active/All task scope and archive/unarchive
  controls with query invalidation and mutation feedback.
- Focused regression coverage proves Inbox processing, task archive scope,
  planned-date serialization, archive/unarchive delegation, and owner-scoped
  task predicates.

The five-tab navigation model remains unchanged. No second storage owner or
parallel workflow policy was introduced.

## Runtime status

The accepted prior ladder proves mobile L1–L5 and an explicit L8 `/health`
request. Authenticated web↔mobile mutation scenarios, Android app execution
(L6), physical-device execution (L7), and authenticated deployed Hono
connectivity remain `RUNTIME NOT VERIFIED` until the required external
infrastructure is available. Package-level and route-level evidence is not
being used as a substitute for that runtime proof.

## Baseline failures not introduced here

- The Wave 01 baseline ledger records the instruction-chain byte-budget
  findings; they are not caused by this wave.
- The dependency audit remediation for `fast-uri` was accepted in Wave 01;
  no new dependency-audit failure is attributed to this wave.

## Independent review

The required fresh review range is
`c4eb9c922f57c68bb7679d7430f4ad6340b92100..05eb5d24922a030ae8a59693dcddac65d9bcd5af`.

The independent review agent could not return a result because the agent
platform reported its usage limit before review completion. As the mandated
continuation fallback, a separate local range review checked the complete
wave diff for mobile boundary violations, actor/owner-scope regressions,
Hono transport leakage, cache placeholder scope, task archive/read-model
behavior, Inbox conversion semantics, and accidental generated files.
Targeted and package-level tests independently cover those behavioral seams.
Local review findings: Critical 0, Important 0, Minor 0. Fresh subagent
review: NOT AVAILABLE — platform usage limit.

## Acceptance evidence

- Exact implementation head reviewed: `05eb5d24922a030ae8a59693dcddac65d9bcd5af`.
- Exact-head CI run `33797963672` passed all 16 jobs.
- Server suite: 129/129 passed.
- Mobile suite: 45 suites / 261 tests passed.
- Contracts: 24/24 tests passed; API-client, typecheck, architecture,
  security, and purity checks passed.
- Wave-local `git diff --check` passed and no generated build artifacts are
  tracked.
- Vercel status for the implementation head was successful with
  `Canceled by Ignored Build Step`; no non-main Preview became ready.

## Wave result

ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE. Code, contract, static product,
and local runtime-adjacent evidence for the identified Inbox and Task
convergence gaps passed. Authenticated web↔mobile mutation scenarios, Android
app execution (L6), physical-device execution (L7), and authenticated Hono
connectivity remain `RUNTIME NOT VERIFIED` because the required external
credentials/device infrastructure is unavailable. The Wave 10 acceptance
record is this document on the next pushed exact head.
