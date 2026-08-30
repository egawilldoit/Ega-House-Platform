# Smart Inbox Repair Plan — 2026-08-28
Branch: feat/smart-inbox @ fc5f1ed5 (base feat/intelligence-foundations @ a51c0578)
PR: #186
Repair Focus: sections 13-21 (BUG1 reminder retry, reminder idempotency, BUG2 canonical Task authority, node:crypto purity, code quality)

## 1. Current Behavior (evidence)

**convert.ts (packages/application/src/inbox/convert.ts:67-345):**
- Deterministic Task ID via node:crypto sha256(owner:inboxId) → UUID. Replaces unsafe title+5min heuristic. Good.
- Flow: load inbox → if converted return link task → check existing link (recovery) → validate fields → get deterministicTaskId → check existing deterministic task → try link → createTask with id → link → reminder → mark converted.
- Uses tasksRepository.createTask directly with `id`, bypassing canonical `createTask()` validation (violates BUG2).
- Reminder handling duplicated: once after existingDeterministicTask link (lines 189-207), once after create link (311-336). Both create via `tasksRepository.createReminder` with taskId+remindAt, no idempotency.
- Early recovery path (lines 103-115): if link exists before task creation, it marks converted without checking whether reminder was requested or exists. This is BUG1 core.
- Validation order: reminder future check happens after task/link creation in some paths (race), and timestamp invalid cases could create orphan task before failing (violates invariant).
- No source/sourceId on task_reminders; identification via taskId+timestamp approximate, not DB-unique.
- markInboxItemConverted sometimes returns success even if mark fails (lines 111, 213, etc.), inconsistent.

**task_reminders schema (src/db/schema.ts:331-368):**
- Columns: id PK, owner_user_id, task_id FK, remind_at, channel, delivery_mode, status, sent_at, failure_reason, processed_at, processing_error, created_at, updated_at.
- No source/source_id correlation. Unique indexes: owner_idx, task_idx, pending indexes. No idempotency. Concurrent reminder creates with same inbox would duplicate if same timestamp? No guard.
- TasksRepository.createReminder (packages/data-access/src/tasks/repository.ts:346-362) inserts without source, then hydrates task.

**Canonical createTask (packages/application/src/tasks/service.ts:34-96):**
- Owns validation: title, projectId, status, priority, blockedReason, scope check (projectIds, goals), goal-project consistency, dateOnly, estimate.
- Does NOT support preallocated id. convert.ts duplicates same scope checks (lines 155-168) instead of reusing.
- Ports: CreateTaskRecordInput has optional `id` (added for deterministic), but service doesn't expose it; data-access does support it.

**node:crypto usage:**
- Only in convert.ts deterministicTaskId (import createHash from "node:crypto").
- Application purity scan (scripts/ci/package-purity.mjs) does NOT forbid node: imports for application; contracts/domain do forbid. So currently passes purity.
- Alternative: extracting to shared utility would improve testability but not required for correctness. Decision: keep direct import but document, or extract to `src/shared/hash.ts` if we want dependency inversion.

**GitHub review threads (10):**
- Most already fixed by 0598932f (workspaceShortcutEvents, createTaskReminder, isFutureDate, etc.). Remaining in tests: unused DEFAULT_INBOX_AI_TIMEOUT_MS, unused fail helper, unused archiveInboxItem variable, archiveResult.

## 2. Required Behavior (authority)

- **Invariant:** successful conversion ⇒ Task exactly once AND Inbox→Task link exactly once AND (if remindAt requested) reminder exactly once AND inbox status == converted. Never `converted` while side-effect missing.
- **State machine (repair spec):** Inbox item → deterministic Task identity → ensure Task exists → ensure exact Inbox→Task link exists → if reminder requested: ensure exact reminder exists → mark Inbox converted. Every step retry-safe, resume from durable state, never fuzzy.
- **Reminder idempotency:** smallest exact correlation: source=smart_inbox_conversion, sourceId=inboxItemId (or deterministic key), DB uniqueness. Do not use approximate timestamp.
- **BUG2:** extend canonical createTask to support preallocatedId (internal option, not public Hono), inbox must not duplicate Project/Goal/priority validation.
- **node:crypto:** evaluate purity, document, inject shared utility if needed.
- **Tests A-F:** same title unrelated Task not adopted, retry after link fail, concurrent converts, link succeeds/status fails, reminder failure, cross-owner, invalid timestamp (all must prove invariant).

## 3. Design Decisions

### 3.1 Reminder Idempotency Model
Add nullable columns to task_reminders:
- `source varchar(64)` — e.g., 'smart_inbox_conversion'
- `source_id varchar(256)` — inboxItemId
- Unique partial index: `unique (owner_user_id, source, source_id) where source is not null and source_id is not null`
Migration: drizzle/0048_task_reminder_source_idempotency.sql, schema.ts update.
Update TaskReminderRecord to include source/sourceId optional.
Update TasksRepository.createReminder to accept source/sourceId, handle duplicate 23505 by returning existing reminder's task (idempotent).
Alternative considered: deterministic reminder id via hash(inboxId) — rejected because source correlation is more explicit, debuggable, and smallest change; deterministic id would require client to know reminder id.
For lookup: after task hydration, check `task.reminders.find(r => r.source==='smart_inbox_conversion' && r.sourceId===inboxItemId)` to prove existence without extra query.

### 3.2 Canonical Task Authority
Extend `createTask(actor, repo, input, options?: {preallocatedId?: string})` in tasks/service.ts.
- Internally validates exactly as before (title, projectId, priority, etc.) and passes `id: preallocatedId` to repo.createTask when provided.
- Export new `createTaskWithId` or overload; keep public Hono routes not exposing preallocatedId.
- convert.ts will import and call canonical `createTask` with `{preallocatedId: deterministicTaskId}` instead of duplicating scope checks.
Implementation: add fourth param `options` object, not exposed via HTTP contracts.
Data-access already supports `id` in CreateTaskRecordInput, so no DB change.

### 3.3 State Machine Refactor (TDD)
New convert.ts steps (pseudocode):

```
load inbox, check archived/converted
validate all inputs early (title, project, priority, dueDate, goal, remindAtFuture) BEFORE side effects
deterministicTaskId = deterministicTaskIdForInboxConversion(actor, inboxItemId)

ensureTask():
  existing = getTask(deterministicId)
  if exists return it
  result = createTask(actor, tasksRepo, {title, projectId, goalId, description, priority, dueDate}, {preallocatedId: deterministicId})
  if duplicate conflict -> getTask again else fail
  // createTask reuse provides validation

ensureLink(taskId):
  linkResult = createInboxTaskLink(...)
  if ok return
  if conflict -> getTaskIdForInboxItem -> verify task exists -> return (idempotent)
  else fail

if remindAtRequested:
  // validate timestamp already done
  ensureReminder(taskId):
    // check if task already has reminder with source correlation (from hydrated task)
    task = getTask(taskId) // fresh hydrated includes reminders
    if task.reminders.some(r => r.source===SRC && r.sourceId===inboxId) return task
    // else create
    result = createReminder(actor, {taskId, remindAt, source: SRC, sourceId: inboxId})
    if duplicate -> getTask again and verify else fail
    return updatedTask

markConverted():
  result = markInboxItemConverted(...)
  if not ok -> failure (so retry can resume; don't claim success while not converted)
```

Key fixes vs current:
- Remove early "if link exists then mark converted without reminder" path; replace with full ensure chain that includes reminder check.
- Move remindAt validation to top.
- Use canonical createTask.
- Ensure reminder exactly once via source.

### 3.4 node:crypto Purity
- Current direct import is allowed per purity script. To improve testability and centralize, extract to `packages/application/src/shared/hash.ts`:
  `export function sha256Hex(input: string): string { return createHash("sha256").update(input).digest("hex"); }`
- convert.ts will import from there instead of node:crypto directly. This keeps application layer pure in terms of single injection point, easier to mock, but still uses node crypto.
- Document in this plan and in code comment: why deterministic ID, why sha256, runtime purity evaluation.
- Do not change domain.

### 3.5 Code Quality
- Remove unused imports/helpers flagged by bot: DEFAULT_INBOX_AI_TIMEOUT_MS in test, fail helper, archiveInboxItem, archiveResult etc.
- Ensure eslint override for test files does not hide real prod unused vars; keep prod strict.

## 4. Test Plan (A-F)

Existing tests cover some but miss reminder invariant cases. Add new tests in inbox-conversion.test.ts (TDD red first):

A. Same title unrelated Task not adopted — already exists, keep.
B. Retry after link failure reuses deterministic Task — already, but extend with reminder variant (already partially) — ensure new test proves link failure then retry still same task and reminder not duplicated.
C. Concurrent converts produce single Task — already.
D. Link succeeds but status fails: link exists, status still inbox, second retry should mark converted without duplicate Task and prove reminder if requested; currently would succeed but need to verify status invariant.
E. Reminder failure cases:
  - E1: Task+link succeed, reminder creation fails (DB error) → first call fails, status not converted, no reminder. Retry with same remindAt should create reminder exactly once and then mark converted.
  - E2: Task+link+reminder succeed but mark converted fails → retry should find link+reminder exist, then successfully mark converted, not create duplicate reminder.
  - E3: Retry after reminder creation (crash after reminder before mark) — ensure second call does not create duplicate reminder (source dedup).
  - E4: Convert with remindAt, then second convert without remindAt? Not allowed? But test ensures reminder not removed.
F. Cross-owner: already, extend to ensure cross-owner cannot see other's link/reminder.
G. Invalid timestamp: invalid or past remindAt should fail before creating Task/link/reminder, proving no side effects. Test that with invalid timestamp, no task created.
H. Exact once invariant: after success, verify Task count ==1, link count==1, reminder count==1, status==converted; after retry, still same counts.

Implement FakeTasksRepository to support source correlation: store reminders with source, handle duplicate via unique check, support getTask hydration including source.

## 5. Migration & Schema

- drizzle/0048_task_reminder_source_idempotency.sql
- src/db/schema.ts update taskReminders table
- packages/application/src/tasks/ports.ts TaskReminderRecord + createReminder input
- packages/data-access/src/tasks/repository.ts hydration + insert

## 6. Validation Gates

- application:test, data-access:test, contracts:typecheck+test, server:test, mobile test, web test (if relevant)
- lint:changed --base origin/feat/intelligence-foundations must PASS (0 regressions)
- ci:workspace PASS, check:architecture PASS, ci:purity PASS
- Ensure one writer: worktree is feat/smart-inbox isolated.

## 7. Commit Plan

Additive repair commit: `fix(smart-inbox): repair conversion invariant, reminder idempotency, canonical Task authority`
- Single commit with all repair files + new tests + migration.
- Push to origin/feat/smart-inbox.
- Update Linear with canonical checkpoint (if Linear MCP available, post comment).
