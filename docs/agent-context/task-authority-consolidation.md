# Task authority consolidation (PR-06 follow-up)

**Status:** implemented on `followup/task-authority` (base `origin/main`
`b0e30ac`). No behavior, capability, or transport was removed.

## Objective

`apps/web/src/lib/services/task-service.ts` had grown to ~3.3k lines and
re-implemented task rules that Hono/MCP already execute through
`@ega/application`. This follow-up moves the reusable write/validation policy to
the shared packages and leaves the web service as the request-scoped adapter.

## Canonical authority after this change

| Capability | Canonical owner | Web usage |
| --- | --- | --- |
| Calendar-date validation, `start <= due` normalization primitives | `@ega/domain` `tasks/date-only` | re-exported through `lib/task-due-date` |
| Estimate validation | `@ega/domain` `tasks/estimate` | re-exported through `lib/task-estimate` |
| Scheduled-block wall-time validation | `@ega/domain` `tasks/schedule` | re-exported through `lib/task-schedule` |
| Task title limit | `@ega/domain` `tasks/title` | re-exported through `lib/task-domain` |
| Calendar reminder lead time | `@ega/domain` `tasks/calendar-reminder` | re-exported through `calendar-settings-service` |
| Local wall-clock projection | `@ega/domain` `getLocalWallTimeParts` | re-exported through `lib/task-calendar` |
| Inline task-edit validation and blocked-reason rule | `@ega/application` `tasks/write-policy` | `validateTaskInlineUpdateInput` |
| Single-field drawer patch composition | `@ega/application` `tasks/field-patch` | `buildTaskFieldPatchInput` |
| Calendar drag/resize wall window | `@ega/application` `tasks/schedule-window` | `buildRescheduledWallWindow` |
| Project/goal write scope rule | `@ega/application` `tasks/scope` | `getTaskInsertScopeError` |
| View project/goal owner-option sanitization | `@ega/application` `tasks/view` | `scopeTaskViewToAvailableOptions` |
| Reminder input parsing and lifecycle validation | `@ega/application` `tasks/reminder-input` | reminder create/update/cancel adapters |

Hono task routes and MCP task write handlers continue to call the application
task use cases directly; they gain the same primitives without a new DTO or
second policy owner. `getTasksWorkspaceData` already delegates filtering,
ordering and grouping to `@ega/application/tasks/view`.

## Residual web responsibilities

These remain in `task-service.ts` because they compose request-scoped Supabase
I/O with web-only side effects. They are adapters, not policy owners.

- **Workspace read assembly** — owner project/goal options, saved-view fallback
  rows, task reminders/recurrences, timer totals and the calendar projection.
  The filter/sort/group engine is application-owned; the projection shapes are
  consumed by web components.
- **Bulk creation** (`createTasks`, `createTaskWithOptionalWorkedTime`) — table
  insert plus the legacy missing-column fallbacks, calendar-sync enqueueing and
  optional worked-time session insert.
- **Inline write** (`updateTaskInline`) — one row update with `board_rank`,
  `start_date`, `completed_at`, legacy column fallbacks, recurrence follow-up,
  completed-recurrence generation and calendar-sync enqueueing. The application
  use case does not model these web-only side effects yet; splitting it now
  would change the observable write sequence.
- **Archive/delete** (`updateTaskArchiveState`, `deleteTaskSafely`) — active
  timer guards, focus-rank clearing, calendar-sync lifecycle and safe-delete
  history checks.
- **Reminder persistence** (`createTaskEmailReminder`, `updateTaskEmailReminder`,
  `cancelTaskReminder`) — the application reminder use cases return a task while
  the web drawer needs the reminder row and an update operation; the shared
  validation is used, persistence stays request-scoped.
- **Recurring completion** (`generateNextTaskForCompletedRecurrence`) — claim,
  dedupe and next-row creation on `task_recurrences`/`tasks`.
- **Drawer detail** (`getTaskDrawerDetail`) — dependency and tracked-time joins
  for the drawer header.

No caller was migrated to a path that would lose a capability, and the file was
not deleted while these web-specific contracts still exist.

## Owner isolation

- Web task reads/writes use the cookie-bound request client from
  `@/lib/supabase/server`; no service-role/admin client appears in the task
  mutation path (asserted by `task-service-owner-isolation.test.ts`).
- Hono/MCP paths use `SupabaseTasksRepository`, which filters every task query
  by `owner_user_id` and stamps inserts with the verified actor
  (`packages/data-access/test/task-repository.test.ts`).
- Cross-owner tests cover get, field patch, inline update, archive, delete and
  reminder creation; both the hidden-row (`unavailable`/`not found`) and the
  no-write outcome are asserted.

## Proof

```text
npm run domain:typecheck && npm run domain:test
npm run application:typecheck && npm run application:test
npm run data-access:typecheck && npm run data-access:test
npm run web:typecheck && npm run web:test
npm run server:typecheck && npm run server:test
npm run check:architecture && npm run test:architecture && npm run ci:purity
npm run ci:security && npm run ci:workspace
npm run web:build
```

New regression coverage:

- `packages/application/test/task-write-policy.test.ts` — moved policy matrix.
- `apps/web/src/lib/services/task-service-cross-transport-parity.test.ts` —
  Web validator vs application use case vs real MCP handler.
- `apps/web/src/lib/services/task-service-owner-isolation.test.ts` — RLS-shaped
  cross-owner read/mutation refusals plus the request-client source proof.
- `apps/server/test/task-mutations-parity.test.ts` — Hono update rejection
  before any repository write.
- `packages/application/test/task-view.test.ts` — owner-option view scoping.

## Observed evidence (2026-11-22)

- `domain:typecheck`/`domain:test`: 262 pass.
- `application:typecheck`/`application:test`: 777 pass.
- `data-access:typecheck`/`data-access:test`: 254 pass.
- `web:typecheck`, `server:typecheck`: pass.
- `web:test`: 331 files / 2488 tests pass (3 skipped by existing config).
- `server:test`: 233 pass.
- `check:architecture`, `test:architecture` (21), `ci:purity`, `ci:security`,
  `ci:workspace`: pass.
- `npm run lint`: 0 errors (the single unused-import warning introduced during
  the refactor was removed; targeted lint of every changed file is clean).
- `web:build`: compilation, TypeScript and all 21 static pages complete; the
  command exits at the bundled Next.js security advisory nudge. The retry
  requested by the build instructions repeated the same advisory gate. This is
  an environment/framework advisory, not a build error in this change; no
  package pin or security gate was bypassed.

`apps/web/src/lib/services/task-service.test.ts` and
`task-service-archive.test.ts` are excluded from `web:test`. Running them
directly shows the same baseline stale-mock failures that exist on the base
commit (for example the calendar-sync select columns and archived-ancestry
`.not()` query predate this change); the moved validation/scope cases pass.
They are not a regression signal for this patch.
