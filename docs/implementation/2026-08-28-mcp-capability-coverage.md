# MCP Capability Coverage — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`
**Base SHA:** `1a01bf3d03bf2394358f204448d247f1b04d544e`
**Protocol target:** `2026-07-28`, SDK v2 (`@modelcontextprotocol/server` 2.0.0)

This document defines **FULL READ/WRITE** for EGA House MCP.

## Authority

- `packages/application` use cases are canonical workflow authority
- `packages/data-access` implements repository ports
- MCP must not duplicate business rules; it validates input → AuthenticatedActor → application → RLS

## Capability inventory

### Projects

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list projects | `ProjectsRepository.listProjects` | `projects` SELECT | R | `ega_list_projects` | `projects.read` | no | n/a | EXPOSE |
| create project | `createProject` | `projects` INSERT | W | `ega_create_project` | `projects.create`* | optional | operationId | EXPOSE |
| update project status | `updateProjectStatus` | `projects` UPDATE status | W | `ega_update_project_status` | `projects.update` | no | operationId | EXPOSE |
| archive/unarchive project | `archiveProject` | `projects` UPDATE | W | `ega_archive_project` / `ega_unarchive_project` | `projects.update` | no | operationId | EXPOSE |

*New permissions: `projects.create`, `projects.update` under `workspace_manager` profile.

### Goals

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list goals | `GoalsRepository.listGoals` | `goals` SELECT | R | `ega_list_goals` | `goals.read` | no | n/a | EXPOSE |
| create goal | `createGoal` | `goals` INSERT | W | `ega_create_goal` | `goals.create` | no | operationId | EXPOSE |
| update goal status | `updateGoalStatus` | `goals` UPDATE status | W | `ega_update_goal_status` | `goals.update` | no | operationId | EXPOSE |
| update goal health | `updateGoalHealth` | `goals` UPDATE health | W | `ega_update_goal_health` | `goals.update` | no | operationId | EXPOSE |
| update next step | `updateGoalNextStep` | `goals` UPDATE next_step | W | `ega_update_goal_next_step` | `goals.update` | no | operationId | EXPOSE |
| archive goal | via `updateGoalStatus(archived)` | `goals` UPDATE | W | `ega_archive_goal` | `goals.update` | optional | operationId | EXPOSE |

### Tasks (core)

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list tasks (rich filters) | `TasksRepository.listTasks` | `tasks` SELECT | R | `ega_list_tasks` | `tasks.read` | no | n/a | EXPOSE |
| get task | `getTask` | `tasks` SELECT | R | `ega_get_task` | `tasks.read` | no | n/a | EXPOSE |
| create task | `createTask` | `tasks` INSERT (+ scope check) | W | `ega_create_task` | `tasks.create` | no | operationId | EXPOSE |
| update task | `updateTask` | `tasks` UPDATE | W | `ega_update_task` | `tasks.update` | no | operationId | EXPOSE |
| archive task | `archiveTask` | `tasks` UPDATE archived_at | W | `ega_archive_task` | `tasks.update` | optional | operationId | EXPOSE |
| unarchive task | `unarchiveTask` | `tasks` UPDATE | W | `ega_unarchive_task` | `tasks.update` | no | operationId | EXPOSE |
| focus rank | `getFocusRank`/`setFocusRank` | `tasks.focus_rank` | W | `ega_set_task_focus_rank` | `tasks.update` | no | operationId | EXPOSE |
| reminders | `createTaskReminder`/`cancelTaskReminder` | `task_reminders` | W | `ega_create_task_reminder`/`ega_cancel_task_reminder` | `tasks.update` | no | operationId | EXPOSE |
| recurrence | `createTask` recurrence field | `task_recurrences` | W | via `ega_create_task` recurrence | `tasks.create` | no | operationId | DEFER (v1 excludes) |
| scheduling | `UpdateTaskRecordInput.scheduledStartAt/EndAt` | `tasks.scheduled_*` | W | via `ega_update_task` | `tasks.update` | no | operationId | EXPOSE |

### Today (projection)

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| get today plan | `getTodayPlan` | derived from `tasks` + `task_sessions` | R | `ega_get_today_plan` | `tasks.read` | no | n/a | EXPOSE |
| plan task for today | `planTaskForToday` | `tasks.planned_for_date` UPDATE | W | `ega_plan_task_for_today` | `tasks.update` | no | operationId | EXPOSE |
| remove from today | `removeTaskFromToday` | `tasks.planned_for_date` null | W | `ega_remove_task_from_today` | `tasks.update` | no | operationId | EXPOSE |
| update today task status | `updateTodayTaskStatus` | `tasks` UPDATE status via Today port | W | `ega_update_today_task_status` | `tasks.update` | no | operationId | EXPOSE |
| clear completed today | `clearCompletedToday` | mass UPDATE | W | `ega_clear_completed_today` | `tasks.update` | **yes** (destructive) | operationId | EXPOSE with MRTR |

### Timer

| Capability | Application | Storage | RW | MCP candidate | Permission | MRTR | Idempotency | Verdict |
|---|---|---|---|---|---|---|---|---|
| list open/recent sessions | `listOpenSessions`/`listRecentSessions` | `task_sessions` SELECT | R | `ega_list_timer_sessions` | `timer.read` | no | n/a | EXPOSE |
| start timer | `insertOpenSession` via service | `task_sessions` INSERT | W | `ega_start_timer` | `timer.create` | no | operationId | EXPOSE |
| stop timer | `finalizeOpenSession` | `task_sessions` UPDATE ended_at | W | `ega_stop_timer` | `timer.update` | no | operationId | EXPOSE |

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
| delivery runs | existing delivery observer | `automation_*` | R | `ega_list_delivery_runs` etc already via task_manager? | `delivery_runs.read` | no | EXPOSE (read only, already via delivery_observer) |
| agent integration tokens/events | legacy agent API | — | — | — | — | **EXCLUDE** | Legacy, not MCP |

## Counts (actual runtime @ cb5f0a8 + W2-W8)

- **Read EXPOSE runtime:** 6 (`ega_list_projects`, `ega_list_goals`, `ega_list_tasks`, `ega_get_today_plan`, `ega_list_timer_sessions`, `ega_get_capabilities` + delivery observer reads deferred)
- **Write EXPOSE runtime:** 9 (`ega_create_project`, `ega_update_project_status`, `ega_create_goal`, `ega_create_task`, `ega_update_task`, `ega_plan_task_for_today`, `ega_start_timer`, `ega_stop_timer`, `ega_clear_completed_today` MRTR)
- **DEFERRED with product reason (not in this PR, per isolation directive):**
  - Projects archive/unarchive (canonical `archiveProject` exists but MCP archive not exposed — defer, low ROI)
  - Goals update health/nextStep/archive (canonical exists, defer — not critical for agent)
  - Tasks archive/unarchive, focus rank, reminders, scheduling (canonical exists, defer — agent can use updateTask for now)
  - Today remove/updateTodayTaskStatus (Today is projection, remove handled via plan null; update via updateTask)
  - Delivery writes remain read-only per architecture
- **EXCLUDE/DEFER with reason above:** calendar, week reviews, external refs, sync jobs, idea write, saved views write

## Permission catalog for MCP

```
read_only:            projects.read, goals.read, tasks.read, timer.read, today.read (via tasks.read), delivery_runs.read ...
task_manager (legacy): + tasks.create, tasks.update
workspace_manager (new): full workspace
  projects.read, projects.create, projects.update,
  goals.read, goals.create, goals.update,
  tasks.read, tasks.create, tasks.update,
  today.read, today.update (alias tasks.update),
  timer.read, timer.create, timer.update
delivery_observer:    delivery_runs.read, delivery_events.read, delivery_artifacts.read
```

`workspace_manager` is the explicit human-consented write grant. `MCP_WRITES_ENABLED` global kill switch gates all writes even when grant permits.

## MRTR candidates

- `ega_clear_completed_today` (destructive mass update)
- `ega_archive_project` / `ega_archive_goal` / `ega_archive_task` (optional, low risk but could require confirmation for bulk)
- `ega_start_timer` when conflicting open timer exists? No — DB will reject, no MRTR needed

Only `clearCompletedToday` is required MRTR for v1.

## Idempotency

All writes require `operationId` (UUID v4, client-generated). Ledger key: `(owner, oauth_client_id, tool_name, operation_id)`. Same args → replay cached. Different args → 409 conflict.

## RLS exposure

Reads already RLS-enforced via `private.has_active_mcp_permission`. Writes need analogous `*_insert`/`*_update`/`*_delete` policies gated on workspace_manager permissions plus owner check.

## Open items

- Saved views write deferred — explicit rollout decision, not a gap
- Idea notes write deferred — needs product decision on MCP-owned idea pipeline
