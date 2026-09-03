# Cross-Platform Consistency — Wave 10 Evidence

Status: IMPLEMENTATION IN PROGRESS

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
| Task create/edit/complete/archive/restore/pin/reminder/recurrence | `packages/application/src/tasks`; `apps/server/src/routes/tasks.ts`; `packages/api-client/src/tasks.ts` | Tasks, Today, and task detail actions | Tasks list/detail and Today actions use mobile task queries | PARTIAL: static transport coverage is complete; visual exposure of every secondary action needs runtime confirmation | NOT VERIFIED | Compare each mutation response and resulting projection. |
| Today add/remove/status/clear completed | `packages/application/src/today`; `apps/server/src/routes/today.ts`; `packages/api-client/src/today.ts` | Today planner actions | Today query and mutations invalidate Today/task caches | PASS | NOT VERIFIED | Prove one mutation from each surface and observe the projection on the other. |
| Timer start/active/stop/evidence | `packages/application/src/timer`; `apps/server/src/routes/timer.ts`; `packages/api-client/src/timer.ts` | Timer actions also support stopped-task outcome handling | Timer workspace/start/stop uses server-authoritative session state | PASS for execution evidence; outcome prompt is surface-specific | NOT VERIFIED | Confirm active/stop state and execution evidence across surfaces. |
| Inbox capture/edit/archive/restore/convert | `packages/application/src/inbox`; `apps/server/src/routes/inbox.ts`; `packages/api-client/src/inbox.ts` | `/ideas` supports capture, edit, archive, restore, and canonical inbox data | Inbox tab supports capture, list, archive, and a restore branch | PARTIAL: mobile default query is active-only; no edit or conversion action is exposed | NOT VERIFIED | Add minimum mobile all-view, edit, and convert actions using the existing API boundary. |
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

Hypothesis: mobile Inbox is incomplete because its presentation/query layer
stopped at capture and archive even though the canonical transport and
application capabilities already cover the full processing loop. The
divergence begins at the mobile adapter/query/presentation boundary, not in
the application or Hono layers.

Working comparison: web `/ideas` renders `EditIdeaNoteForm` and archive/
restore controls over the server-side service; its conversion path remains
the canonical application conversion route. Mobile should reuse the existing
Hono/API-client contract rather than create a second Inbox authority.

## Acceptance plan

- Keep the five-tab navigation model.
- Add an explicit active/all view choice so archived items are discoverable
  and restore is reachable without duplicating storage.
- Add a focused mobile edit interaction that sends the complete canonical
  update payload while preserving the item status and fields not edited.
- Add a focused mobile conversion interaction that requires/selects an
  existing project, calls the canonical conversion route, and invalidates
  Inbox, task, and Today projections after success.
- Keep loading, empty, error, submitting, success, and retry states visible.
- Add regression coverage at the mobile API/query/presentation seams.

## Runtime status

The accepted prior ladder proves mobile L1–L5 and an explicit L8 `/health`
request. Authenticated web↔mobile mutation scenarios, Android app execution
(L6), physical-device execution (L7), and authenticated deployed Hono
connectivity remain `RUNTIME NOT VERIFIED` until the required external
infrastructure is available.

## Baseline failures not introduced here

- The Wave 01 baseline ledger records the instruction-chain byte-budget
  findings; they are not caused by this wave.
- The dependency audit remediation for `fast-uri` was accepted in Wave 01;
  no new dependency-audit failure is attributed to this wave.

## Initial wave result

Not yet accepted. The Inbox parity gap is a concrete implementation item;
runtime cross-surface evidence is an external verification gap.
