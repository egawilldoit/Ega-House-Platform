# MCP Capability Coverage — 2026-08-29

**Branch:** `feat/mcp-v2-full-read-write`
**Reference checkpoint:** `5c5405f7f9a50de33308949f82de808607f2fba3`
**Protocol target:** `2026-07-28`, SDK v2 (`@modelcontextprotocol/server` 2.0.0)

This living document defines the current **FULL READ/WRITE** EGA House MCP
catalog. Historical evidence and repair ledgers remain unchanged snapshots.

## Authority

- `packages/application` use cases are canonical workflow authority
- `packages/data-access` implements repository ports
- MCP must not duplicate business rules; it validates input → AuthenticatedActor → application → RLS
- `delivery_observer` is retired and is not a supported profile or runtime capability

## Capability inventory

### Projects

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list projects | `ProjectsRepository.listProjects` | `projects` SELECT | R | `ega_list_projects` | `projects.read` | no | n/a | EXPOSE |
| create project | `createProject` | `projects` INSERT | W | `ega_create_project` | `projects.create`* | no | operationId + domain fence | EXPOSE — exactly-once create |
| update project status | `updateProjectStatus` | `projects` UPDATE status | W | `ega_update_project_status` | `projects.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| archive/unarchive project | `archiveProject` | `projects` UPDATE | W | `ega_archive_project` / `ega_unarchive_project` | `projects.update` | no | operationId | EXPOSE — at-least-once, idempotent |

*`projects.create` and `projects.update` are granted by `workspace_manager`.

### Goals

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list goals | `GoalsRepository.listGoals` | `goals` SELECT | R | `ega_list_goals` | `goals.read` | no | n/a | EXPOSE |
| create goal | `createGoal` | `goals` INSERT | W | `ega_create_goal` | `goals.create` | no | operationId + domain fence | EXPOSE — exactly-once create |
| update goal status | `updateGoalStatus` | `goals` UPDATE status | W | `ega_update_goal_status` | `goals.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| update goal health | `updateGoalHealth` | `goals` UPDATE health | W | `ega_update_goal_health` | `goals.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| update next step | `updateGoalNextStep` | `goals` UPDATE next_step | W | `ega_update_goal_next_step` | `goals.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| archive/unarchive goal | via `updateGoalStatus(archived)` | `goals` UPDATE | W | `ega_archive_goal` / `ega_unarchive_goal` | `goals.update` | no | operationId | EXPOSE — at-least-once, idempotent |

### Tasks (core)

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list tasks (rich filters) | `TasksRepository.listTasks` | `tasks` SELECT | R | `ega_list_tasks` | `tasks.read` | no | n/a | EXPOSE |
| get task | `getTask` | `tasks` SELECT | R | `ega_get_task` | `tasks.read` | no | n/a | EXPOSE |
| create task | `createTask` | `tasks` INSERT (+ scope check) | W | `ega_create_task` | `tasks.create` | no | operationId + domain fence | EXPOSE — exactly-once create |
| update task | `updateTask` | `tasks` UPDATE | W | `ega_update_task` | `tasks.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| archive/unarchive task | `archiveTask`/`unarchiveTask` | `tasks` UPDATE archived_at | W | `ega_archive_task` / `ega_unarchive_task` | `tasks.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| focus rank | `getFocusRank`/`setFocusRank` | `tasks.focus_rank` | W | `ega_set_task_focus_rank` | `tasks.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| reminders | `createTaskReminder`/`cancelTaskReminder` | `task_reminders` | W | `ega_create_task_reminder`/`ega_cancel_task_reminder` | `tasks.update` | no | operationId + domain fence for create | EXPOSE |
| recurrence | `createTask` recurrence field | `task_recurrences` | W | — | — | — | — | DEFER — not in MCP v1 schema |
| scheduling | `UpdateTaskRecordInput.scheduledStartAt/EndAt` | `tasks.scheduled_*` | W | — | — | — | — | DEFER — not in MCP v1 schema |

### Today (projection)

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| get today plan | `getTodayPlan` | derived from `tasks` + `task_sessions` | R | `ega_get_today_plan` | `tasks.read` | no | n/a | EXPOSE |
| plan task for today | `planTaskForToday` | `tasks.planned_for_date` UPDATE | W | `ega_plan_task_for_today` | `today.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| remove from today | `removeTaskFromToday` | `tasks.planned_for_date` null | W | `ega_remove_task_from_today` | `today.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| update today task status | `updateTodayTaskStatus` | `tasks` UPDATE status via Today port | W | `ega_update_today_task_status` | `today.update` | no | operationId | EXPOSE — at-least-once, idempotent |
| clear completed today | `clearCompletedToday` | mass UPDATE | W | `ega_clear_completed_today` | `today.update` | **yes** (destructive) | operationId | EXPOSE with MRTR — at-least-once, idempotent |

### Timer

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list open/recent sessions | `listOpenSessions`/`listRecentSessions` | `task_sessions` SELECT | R | `ega_list_timer_sessions` | `timer.read` | no | n/a | EXPOSE |
| start timer | `insertOpenSession` via service | `task_sessions` INSERT | W | `ega_start_timer` | `timer.create` | no | operationId + domain fence | EXPOSE — exactly-once create |
| stop timer | `finalizeOpenSession` | `task_sessions` UPDATE ended_at | W | `ega_stop_timer` | `timer.update` | no | operationId | EXPOSE — at-least-once, idempotent |

Timer invariant: `task_sessions_owner_open_unique` enforces one open per owner — DB-guaranteed.

### Other discovered capabilities

| Capability | Application | Storage | RW | MCP candidate | Permission | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| calendar integration settings | `calendarIntegrationSettings` | `calendar_integration_settings` | R/W | — | — | **EXCLUDE** | Contains encrypted tokens, external OAuth to Google; not workspace-management |
| idea notes | `idea_notes` | `idea_notes` | R/W | `ega_list_idea_notes` (R only) | `ideas.read` | **DEFER** | Separate product surface, no canonical application use case yet |
| week reviews | `week_reviews` | `week_reviews` | R/W | — | — | **EXCLUDE** | Human review email flow, sensitive email state |
| task external refs | `task_external_refs` | `task_external_refs` | R | — | — | **EXCLUDE** | Internal sync bookkeeping |
| calendar sync jobs | `calendar_sync_jobs` | `calendar_sync_jobs` | — | — | — | **EXCLUDE** | Internal job queue |
| task saved views | `task_saved_views` | `task_saved_views` | R/W | `ega_list_task_saved_views` / `ega_save_task_saved_view` | `tasks.read`/`tasks.update` | **DEFER** | Lower priority, defer to v1 coverage closure |
| delivery runs | Runner/control-plane state | `automation_*` | R | — | — | — | EXCLUDE — outside workspace MCP/RLS scope |
| agent integration tokens/events | legacy agent API | — | — | — | — | **EXCLUDE** | Legacy, not MCP |

## Counts (current runtime)

- **Read tools:** 7 (`ega_get_capabilities` plus the six permission-filtered reads).
- **Write tools:** 23, all present in `apps/web/src/lib/mcp/server.ts` and permission-filtered by `tool-discovery.ts`.
- **Workspace manager:** discovers all 30 tools when writes are enabled.
- **Task manager:** discovers the seven reads plus task create/update, archive/unarchive, focus rank, and reminder create/cancel.
- **Read-only:** discovers only the seven reads.
- **Writes disabled:** every profile discovers only the seven reads.
- **Deferred/excluded product surfaces:** calendar integration, week reviews, external refs, sync jobs, recurrence, scheduling, idea-note writes, saved views, and Runner delivery state.

## Permission catalog for MCP

```
read_only:            projects.read, goals.read, tasks.read, timer.read, today.read
task_manager:         read_only + tasks.create, tasks.update
workspace_manager:    full workspace
  projects.read, projects.create, projects.update,
  goals.read, goals.create, goals.update,
  tasks.read, tasks.create, tasks.update,
  today.read, today.update,
  timer.read, timer.create, timer.update
```

`workspace_manager` is the explicit human-consented write grant. `MCP_WRITES_ENABLED` global kill switch gates all writes even when grant permits.

## MRTR candidates

- `ega_clear_completed_today` (destructive mass update)
- `ega_archive_project` / `ega_archive_goal` / `ega_archive_task` (optional, low risk but could require confirmation for bulk)
- `ega_start_timer` when conflicting open timer exists? No — DB will reject, no MRTR needed

Only `clearCompletedToday` is required MRTR for v1.

## Idempotency and effect semantics

All writes require `operationId` (UUID v4, client-generated). The ledger key is
`(owner, oauth_client_id, tool_name, operation_id)`. Same canonical arguments
replay the stored result; different arguments return `CONFLICT` before the
business mutation runs.

The five insert-style MCP creates are fully domain-fenced:

```text
projects        exactly-once
goals           exactly-once
tasks           exactly-once
task_reminders  exactly-once
task_sessions   exactly-once
```

Their `0054` partial unique indexes protect the business row after a process
crash between domain commit and receipt commit. Repository collision handling
accepts the named MCP-operation constraint (or a known competing invariant
index, such as project slug or open session) only after an exact
owner/client/operation lookup through request-scoped RLS.

State-changing and projection tools remain **at-least-once but idempotent**;
this catalog does not broaden the exactly-once claim to those updates.

## RLS exposure

Reads and writes are RLS-enforced via `private.has_active_mcp_permission` and
owner checks. MCP writes require a non-null client identity plus the relevant
create/update permission; direct user paths retain their separate access.

Replay lookup always uses the request-scoped authenticated client and includes
both `owner_user_id` and `mcp_client_id`, so another owner or client cannot be
replayed.

## Mobile support

MCP transport is web-only at `POST /api/mcp`; `apps/mobile` does not implement
MCP transport or tool discovery. Mobile remains supported for shared product
workflows through `@ega/api-client` → `apps/server`. MCP-created rows are
ordinary owner-scoped product rows and are visible to the same authenticated
mobile user through those APIs.

## Open items

- Saved views write deferred — explicit rollout decision, not an MCP fencing gap.
- Idea notes write deferred — needs a product decision on an MCP-owned idea pipeline.
