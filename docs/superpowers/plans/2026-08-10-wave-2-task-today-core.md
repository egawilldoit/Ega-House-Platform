# Wave 2 Task/Today Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one shared Task/Today application authority, request-scoped Supabase repositories, authenticated Hono transport, and typed cross-platform API client while preserving existing web/mobile behavior and operational timer/calendar/reminder side effects.

**Architecture:** Reuse the proven Project/Goal package pattern: `@ega/contracts/@ega/domain → @ega/application ports/use-cases/read-models → @ega/data-access → apps/server`. Web adapters call application/data-access directly where feasible; mobile calls the typed `@ega/api-client` transport. Existing Next mobile routes remain compatibility facades during this wave.

**Tech Stack:** TypeScript, Node test runner, Supabase JS, Hono, npm workspaces, Expo/React Native, Next.js, GitHub Actions.

## Global Constraints

- Start from `wave/02-task-today-core`; never write implementation changes to `main`.
- No merge, deployment, secrets mutation, branch-protection mutation, or database migration.
- Preserve existing Task/Today mobile DTOs in `@ega/contracts/mobile`.
- Supabase/RLS remains authorization authority; all user repository operations are request-scoped and explicitly owner-scoped by `actor.userId`.
- `@ega/application` must not import Next, React, Expo, Supabase, Drizzle, or web aliases.
- `@ega/data-access` may import Supabase but not Next/web transport modules.
- `@ega/api-client` must not import Supabase/application/data-access implementation.
- Calendar provider execution, email-reminder delivery, timer process side effects, redirects/revalidation and Next `after()` hooks remain transport/operational adapter concerns.
- Existing legacy `/api/mobile/tasks` and `/api/mobile/today` routes remain available until the Hono path is runtime-proven.
- TDD: add a failing behavior test before each new production boundary, verify RED in Actions, then implement GREEN.

---

### Task 1: Enable isolated wave CI

**Files:**
- Modify: `.github/workflows/unified-platform-validation.yml`

**Produces:** Unified Platform Validation runs on `wave/**` pushes and stacked PRs.

- [ ] Add `"wave/**"` to `pull_request.branches` and `push.branches` alongside existing `main`/`arch/**` selectors.
- [ ] Push on Wave 2 and verify a Unified Platform Validation run is created for the exact branch head.
- [ ] Commit: `ci: validate architecture consolidation waves`.

### Task 2: Define Task application ports and policies with tests

**Files:**
- Create: `packages/application/src/tasks/ports.ts`
- Create: `packages/application/src/tasks/service.ts`
- Create: `packages/application/src/tasks/read-model.ts`
- Create: `packages/application/src/today/read-model.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/package.json`
- Modify: `packages/application/test/application.test.ts`

**Interfaces produced:**
- `TasksRepository`
- `TaskRecord`, `TaskReminderRecord`, `TaskRecurrenceRecord`, `TaskScopeRecord`
- `createTask`, `updateTask`, `archiveTask`, `unarchiveTask`, `createTaskReminder`, `cancelTaskReminder`
- `getTasksReadModel`, `getTaskReadModel`, `getTodayReadModel`

**Required behavior:**
- title/project validation;
- canonical status/priority validation from `@ega/domain`;
- blocked status requires blocked reason;
- goal must exist and belong to selected project;
- reminder time must be valid and in the future;
- reminder create status is pending; cancel status is cancelled;
- repository failures are converted to stable application errors.

- [ ] Write failing application tests for the behavior above using a fake `TasksRepository`.
- [ ] Verify the application test job fails because Task APIs do not exist.
- [ ] Add minimal ports/services/read models and exports.
- [ ] Verify application typecheck/tests pass and existing Project/Goal tests remain green.
- [ ] Commit: `refactor: add shared task application authority`.

### Task 3: Add request-scoped Supabase Task repository with tests

**Files:**
- Create: `packages/data-access/src/tasks/repository.ts`
- Modify: `packages/data-access/src/index.ts`
- Modify: `packages/data-access/package.json` only if export wiring requires it
- Modify: `packages/data-access/test/data-access.test.ts`

**Consumes:** `TasksRepository` from Task 2.

**Produces:** `SupabaseTasksRepository`.

**Required repository proof:**
- every Task/Reminder/Recurrence read/write is scoped to `actor.userId` directly or through an owner-scoped task lookup;
- task insert sets `owner_user_id: actor.userId`;
- project/goal scope reads are owner scoped;
- no service-role client creation;
- Supabase errors pass through `sanitizeSupabaseError`.

- [ ] Add failing fake-Supabase repository tests for owner scoping, task create/update, scope validation data, reminder create/cancel, list/get.
- [ ] Verify RED.
- [ ] Implement `SupabaseTasksRepository` minimally.
- [ ] Verify data-access tests/typecheck GREEN.
- [ ] Commit: `refactor: add request-scoped task data access`.

### Task 4: Add authenticated Hono Task/Today transport

**Files:**
- Create: `apps/server/src/routes/tasks.ts`
- Create: `apps/server/src/routes/today.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/test/server.test.ts`

**Routes:**
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/archive`
- `POST /api/tasks/:id/unarchive`
- `POST /api/tasks/:id/reminders`
- `PATCH /api/tasks/:id/reminders/:reminderId`
- `GET /api/today`

- [ ] Add failing server tests covering bearer auth, actor-derived ownership, validation errors, list/get/create/update/archive/reminders/Today and 404 semantics.
- [ ] Verify RED.
- [ ] Implement thin routes using `SupabaseTasksRepository` + application functions only.
- [ ] Verify server tests/typecheck GREEN.
- [ ] Commit: `feat: add authenticated task and today transport`.

### Task 5: Extend platform-neutral API client

**Files:**
- Create: `packages/api-client/src/tasks.ts`
- Create: `packages/api-client/src/today.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/src/types.ts`
- Modify: `packages/api-client/test/api-client.test.ts`
- Modify: `packages/api-client/package.json` only if `@ega/contracts` consumption is not already declared.

**Produces:** `EgaApiClient.tasks` and `EgaApiClient.today`.

- [ ] Add failing fetch-mock tests for Task/Today paths, query encoding, JSON bodies, bearer header behavior, and normalized 401/validation responses.
- [ ] Verify RED.
- [ ] Implement Task/Today APIs; reuse canonical DTOs from `@ega/contracts/mobile` where they already match instead of redefining them.
- [ ] Verify api-client tests/typecheck GREEN and purity check passes.
- [ ] Commit: `feat: add task and today api client`.

### Task 6: Route native Tasks/Today through the shared API client

**Files:**
- Modify: `apps/mobile/lib/api/ega.ts`
- Modify: `apps/mobile/lib/api/tasks.ts`
- Modify: `apps/mobile/lib/api/today.ts`
- Modify/add tests under `apps/mobile/lib/api/__tests__/`

**Compatibility:** Keep current exported functions (`listMobileTasks`, `getMobileTaskById`, `createMobileTask`, `updateMobileTask`, reminder helpers, Today helpers) so UI/query hooks do not need a behavior rewrite.

- [ ] Add failing adapter tests proving the exported mobile functions call `EgaApiClient.tasks/today` rather than legacy `/api/mobile/*` fetch helpers.
- [ ] Verify RED.
- [ ] Adapt functions to the session-bound `getEgaApiClient()` singleton and unwrap the common `ApiResult` consistently.
- [ ] Verify mobile API tests, mobile typecheck, Doctor and existing native Tasks/Today tests GREEN.
- [ ] Commit: `refactor: route native task flows through shared api client`.

### Task 7: Thin web Task validation around application policies without moving operational effects

**Files:**
- Modify: `apps/web/src/app/tasks/actions.ts`
- Modify: `apps/web/src/lib/services/task-service.ts` only for compatibility delegation that removes duplicated pure validation
- Modify/add focused web tests in existing task service/action test locations.

**Scope:** Do not rewrite timer/calendar/email worker behavior. Reuse shared application policy for status/priority/blocked/scope/reminder validation where the web flow can do so without changing form messages or redirects.

- [ ] Add/adjust regression tests that lock existing form error strings and task side-effect ordering.
- [ ] Verify tests fail only for the intended new delegation boundary.
- [ ] Replace duplicated pure rules with shared application calls/helpers while preserving current FormData and redirect/revalidation semantics.
- [ ] Verify full web tests/typecheck/build GREEN.
- [ ] Commit: `refactor: align web task adapters with application core`.

### Task 8: Strengthen architecture/security proof for Task boundary

**Files:**
- Modify: `scripts/architecture/check-boundaries.mjs`
- Modify: `scripts/architecture/check-boundaries.test.mjs`
- Modify: `scripts/ci/package-purity.mjs`
- Modify: `scripts/ci/security-proofs.mjs`

- [ ] Add failing fixture/proof tests rejecting Task application Supabase/Next imports, mobile application/data-access imports, task transport payload-selected actor identity, service-role use in user Task routes, and missing owner scoping in `SupabaseTasksRepository`.
- [ ] Verify RED.
- [ ] Extend static checks minimally.
- [ ] Verify architecture/security/purity checks GREEN.
- [ ] Commit: `ci: enforce task application boundaries`.

### Task 9: Wave 2 full verification and PR

- [ ] Run/observe exact-head Unified Platform Validation and require all blocking jobs GREEN.
- [ ] Verify diff from Wave 2 base contains no DB migrations, secrets, deployment config or unrelated feature work.
- [ ] Verify current `main` is not modified by Wave 2 implementation.
- [ ] Open PR with base `main`, head `wave/02-task-today-core`, title `refactor: consolidate task and today application core` and explicit `DO NOT MERGE INDEPENDENTLY` / no deployment authorization note.
- [ ] Record exact head SHA and successful CI run in PR body.
