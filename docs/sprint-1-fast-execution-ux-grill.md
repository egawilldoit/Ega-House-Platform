# Sprint 1 Fast Execution UX - Grill Review and Recommended Release Plan

Source plan: `C:\Users\abmor\Downloads\ega_productivity_features_sprint_plan.md`  
Repo inspected: `https://github.com/MORTAKI0/Ega-House-Platform` from local checkout on `main`  
Date: 2026-04-30

## Scope

This document covers Sprint 1 only:

1. Quick Add Command Bar
2. Minimal Kanban Cards
3. Saved Views / Filters

The recommended implementation must strengthen the product loop:

`Project -> Goal -> Task -> Timer -> Review`

The current repo already has important Sprint 1 foundations:

- Shell quick capture exists in `src/components/tasks/quick-task-sheet.tsx`.
- Keyboard shortcut dispatch exists in `src/components/layout/workspace-keyboard-shortcuts.tsx`.
- Task creation actions already live in `src/app/tasks/actions.ts`.
- Kanban board/cards exist in `src/app/tasks/page.tsx` and `src/components/tasks/task-kanban-card.tsx`.
- Saved views already exist through `task_saved_views`, `src/lib/task-saved-views.ts`, `src/app/tasks/saved-views-actions.ts`, and `src/components/tasks/task-saved-views-panel.tsx`.
- The schema and migrations already include `task_saved_views` with owner-scoped RLS.

Because of that, Sprint 1 should extend the current surfaces instead of creating parallel feature folders or replacement UI.

## Six Grill Questions

### 1. Is Quick Add a new feature surface, or an upgrade to the existing Quick Task sheet?

Recommended answer: upgrade the existing Quick Task sheet.

The app already has a sidebar `QuickTaskSheet`, `Ctrl/Cmd + Shift + N`, single task creation, and batch creation. Adding a separate command bar would duplicate capture entry points and weaken shell trust. The right release is to make the single-task tab command-first while preserving the current field form as the editable fallback.

Recommended behavior:

- Open the existing sheet from sidebar and shortcut.
- Default focus goes to a one-line command input.
- Show parsed preview immediately.
- Allow the user to edit parsed fields before submit.
- Reuse the existing server-side create task path.
- Keep batch create as a separate tab.

### 2. Should parsing resolve projects and goals on the client or server?

Recommended answer: parse tokens on the client for preview, but validate and resolve scope on the server before insert.

The parser can identify `#Project`, `/Goal`, `goal:Goal Name`, due tokens, estimates, priority, and blocked tokens without touching the database. But project and goal resolution must stay server-trusted because ownership and visibility are database concerns. Client preview can mark unknown names, but the final action must resolve against visible projects/goals under the current Supabase SSR client and RLS model.

Recommended split:

- `src/lib/task-quick-add.ts`: pure parser and date helpers.
- `src/lib/task-quick-add.test.ts`: parser coverage.
- `src/app/tasks/quick-add-actions.ts` or a small addition to `src/app/tasks/actions.ts`: server action that validates parsed input, resolves project/goal scope, and calls existing task creation service.
- `src/components/tasks/quick-task-sheet.tsx`: command UI and preview.

### 3. What is the smallest parser syntax that improves speed without becoming AI-lite?

Recommended answer: support only deterministic MVP tokens and treat everything else as title text unless it is an invalid known token.

Do not build fuzzy NLP in Sprint 1. The parser should be predictable enough that users can learn it in one session.

Recommended MVP tokens:

- `#Project` for project name.
- `/Goal` and `goal:Goal Name` for goal name.
- `today`, `tomorrow`, weekday names for due date.
- `15m`, `45m`, `1h`, `2h` for estimate.
- `low`, `medium`, `high`, `urgent` for priority.
- `@blocked:reason` for `status=blocked` and `blocked_reason`.

Important rule: if a word is not a supported token, keep it in the title. That avoids surprising title loss.

### 4. What should Minimal Kanban Cards remove without removing real behavior?

Recommended answer: hide secondary details by default, but keep all actions wired through compact controls.

The current `TaskKanbanCard` is already functional but visually heavy. It shows status badges, priority badge, goal, estimate, tracked time, blocked reason, move controls, timer, pin, archive, and delete in the card body. Sprint 1 should reduce default density while preserving every action.

Recommended default card:

- Priority dot
- Task title
- Project name
- Due date
- Timer start icon button when actionable
- More menu or details disclosure
- Blocked state line only when blocked

Recommended hidden details:

- Goal
- Estimate
- Tracked time
- Full blocked reason if long
- Pin/archive/delete/move actions

Do not remove archive/delete/pin. Move them into a menu or expanded state.

### 5. Are saved views user rows, system presets, or both?

Recommended answer: both, with system presets in code and user-created views in the existing table.

The Sprint 1 default views should appear for every user without needing per-user seed rows. That makes the release simpler and avoids migration-time owner ambiguity. Keep current saved view rows for custom views, and add system presets as code-defined filter definitions.

Recommended default presets:

- Deep Work: active tasks with priority `high` or `urgent`, estimate greater than or equal to 30 minutes.
- Quick Wins: active tasks with estimate less than or equal to 15 minutes.
- Blocked: active tasks with status `blocked`.
- Due This Week: active tasks due from today through the next 7 days.

The existing saved-view columns cannot express these rules cleanly. Add a nullable `definition_json jsonb` column for richer views while keeping current columns for compatibility.

### 6. What should be released first so each slice is useful alone?

Recommended answer: release in three vertical slices, with tests after each.

1. Quick Add parser and command create flow.
2. Kanban card density redesign.
3. Saved view presets and JSON filter definitions.

This order matches daily execution value. Quick Add makes capture faster. Kanban polish makes browsing faster. Saved views make repeated task selection faster.

## Feature 1 Recommended Release - Quick Add Command Bar

### Product Decision

Build Quick Add as the default mode of the existing Quick Task sheet. Do not add a second command surface to the Tasks page. The sidebar button and `Ctrl/Cmd + Shift + N` should open the same capture experience everywhere in the workspace.

### Implementation Path

1. Add a pure parser:

   - File: `src/lib/task-quick-add.ts`
   - Test: `src/lib/task-quick-add.test.ts`
   - Output type:

```ts
type QuickAddParseResult = {
  title: string;
  projectName: string | null;
  goalName: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  estimateMinutes: number | null;
  status: "todo" | "blocked";
  blockedReason: string | null;
  warnings: string[];
};
```

2. Add server resolution:

   - Resolve project and goal against the current user-visible scope.
   - Require a project before insert.
   - If a `goalName` is provided, require it to belong to the resolved project.
   - Reuse `createTaskWithOptionalWorkedTime` or `createTasks`.
   - Return compact form state for inline errors.

3. Update `QuickTaskSheet`:

   - Add a command input at the top of the `single` tab.
   - Preview parsed fields below the input.
   - Show project/goal resolution errors before submit.
   - Keep current field controls as editable parsed fields.
   - Submit to the existing server action path.

4. Preserve keyboard behavior:

   - Keep `Ctrl/Cmd + Shift + N`.
   - Keep shortcut help text in `src/lib/keyboard-shortcuts.ts`.
   - Do not capture the shortcut while typing in inputs.

### Validation Rules

- Empty title fails.
- Unknown project fails if `#Project` is present.
- Missing project fails if no default project is selected.
- Unknown goal fails if `/Goal` or `goal:` is present.
- Goal outside selected project fails.
- Invalid estimate fails.
- `@blocked:` requires a non-empty reason.

### Tests

- Parser tests for each supported token.
- Parser test that unknown words stay in title.
- Server action test for unknown project/goal.
- Existing `quick-task-sheet.test.ts` should be extended for preview and success state if the current test harness supports it.

### Release Criteria

- User opens Quick Task from the shell.
- User enters `Fix mobile login tomorrow high #EGA-House 45m`.
- Preview shows title, project, due date, priority, and estimate.
- Submit creates the task through the existing task service.
- Invalid project/goal gives a clear error and does not create a task.

## Feature 2 Recommended Release - Minimal Kanban Cards

### Product Decision

Refactor `TaskKanbanCard` into a compact default card with an expandable details/actions area. Do not change task lifecycle behavior in this slice.

### Implementation Path

1. Keep the current `TaskKanbanCard` component.
2. Make the visible default card smaller:

   - Title with priority dot.
   - One metadata row: project and due date.
   - Timer start icon button for non-completed active tasks.
   - More/details control for secondary metadata and actions.

3. Move secondary content behind disclosure/menu:

   - Goal
   - Estimate
   - Tracked time
   - Move controls
   - Pin/unpin
   - Archive/restore
   - Delete

4. Preserve blocked behavior:

   - Blocked cards should have a clear warning tone.
   - Short blocked reason can show inline.
   - Long blocked reason should be truncated until expanded.

5. Preserve form return paths:

   - Keep `returnTo` hidden fields.
   - Keep archive/delete protections.
   - Keep timer start posting to `startTimerAction`.

### Tests

- Update `src/components/tasks/task-kanban-card.test.ts`.
- Assert default markup includes title, priority signal, project, date, timer, and menu/disclosure.
- Assert default markup does not expose full tracked time/estimate/action labels until expanded or in the details region.
- Assert blocked card still renders blocked state.
- Assert action forms still preserve return path.

### Release Criteria

- Kanban view is visibly denser and easier to scan.
- No lifecycle action disappears.
- Timer handoff still works from a card.
- Blocked tasks remain obvious.
- Many-task columns are easier to scan than the current card layout.

## Feature 3 Recommended Release - Saved Views / Filters

### Product Decision

Add system preset views and evolve the saved view data model with a nullable JSON definition. Keep existing saved views working.

### Data Model

Add `definition_json jsonb` to `task_saved_views`.

Recommended shape:

```json
{
  "status": ["todo", "in_progress"],
  "priority": ["high", "urgent"],
  "estimateMinutes": { "gte": 30 },
  "archived": false
}
```

Keep the existing columns:

- `status`
- `project_id`
- `goal_id`
- `due_filter`
- `sort_value`

They can remain as legacy/simple filters while richer saved views use `definition_json`.

### Implementation Path

1. Update schema:

   - Add `jsonb` import in `src/db/schema.ts`.
   - Add `definitionJson: jsonb("definition_json")` to `taskSavedViews`.
   - Generate a Drizzle migration.
   - Update Supabase generated types if this repo workflow requires it.

2. Add filter definition domain:

   - File: `src/lib/task-view-definition.ts`
   - Test: `src/lib/task-view-definition.test.ts`
   - Responsibilities:
     - Normalize definitions.
     - Validate allowed operators.
     - Apply filter to task records after server-side owner-scoped query.
     - Build URLs for preset views.

3. Add system presets:

```ts
export const SYSTEM_TASK_VIEW_DEFINITIONS = [
  {
    key: "deep-work",
    name: "Deep Work",
    definition: {
      status: ["todo", "in_progress"],
      priority: ["high", "urgent"],
      estimateMinutes: { gte: 30 },
      archived: false,
    },
  },
  {
    key: "quick-wins",
    name: "Quick Wins",
    definition: {
      status: ["todo", "in_progress"],
      estimateMinutes: { lte: 15 },
      archived: false,
    },
  },
  {
    key: "blocked",
    name: "Blocked",
    definition: {
      status: ["blocked"],
      archived: false,
    },
  },
  {
    key: "due-this-week",
    name: "Due This Week",
    definition: {
      status: ["todo", "in_progress", "blocked"],
      dueDate: { nextDays: 7 },
      archived: false,
    },
  },
];
```

4. Update task query flow:

   - Add `presetView` or `viewKey` search param support.
   - Keep existing URL filters.
   - Apply preset definition in `getTasksWorkspaceData`.
   - Prefer server-side query constraints where simple.
   - Use in-memory filtering only after owner-scoped Supabase query when the filter is not easily represented by the current helper.

5. Update panel UI:

   - Show default system views above custom saved views.
   - Label them as default views.
   - Preserve layout when opening a saved view.
   - Keep custom saved view create/update/delete behavior.

### Tests

- Definition normalization tests.
- Deep Work, Quick Wins, Blocked, and Due This Week filter tests.
- Saved views panel tests for preset href generation.
- Task workspace service test for applying a preset if existing test shape allows it.
- Migration generated and schema typecheck passes.

### Release Criteria

- Every user sees Deep Work, Quick Wins, Blocked, and Due This Week.
- Clicking a default view updates the task list.
- Existing saved views still load and can be created/updated/deleted.
- The JSON definition model can support later views without another redesign.

## Recommended Sprint 1 Issue Breakdown

### Issue 1 - Add Quick Add parser and command preview

Labels: `feature`, `productivity`, `sprint-1`, `quick-add`, `frontend`, `backend`

Deliverables:

- Pure parser utility.
- Parser tests.
- Command input and parsed preview inside `QuickTaskSheet`.
- Clear unknown project/goal errors.

### Issue 2 - Wire Quick Add create through existing task service

Labels: `feature`, `productivity`, `sprint-1`, `quick-add`, `backend`

Deliverables:

- Server action validation.
- Project/goal scope resolution.
- Reuse of task creation service.
- Smallest correct route revalidation.

### Issue 3 - Redesign Kanban cards as compact execution cards

Labels: `feature`, `productivity`, `sprint-1`, `kanban`, `frontend`, `ux-polish`

Deliverables:

- Compact default card.
- Expanded/menu actions.
- Blocked card state.
- Updated Kanban card tests.

### Issue 4 - Add saved view definition model

Labels: `feature`, `productivity`, `sprint-1`, `saved-views`, `backend`

Deliverables:

- `definition_json` schema addition.
- Drizzle migration.
- Definition normalization/filter helpers.
- Tests for rich view definitions.

### Issue 5 - Ship default saved views

Labels: `feature`, `productivity`, `sprint-1`, `saved-views`, `frontend`, `backend`

Deliverables:

- Deep Work, Quick Wins, Blocked, Due This Week presets.
- Saved views panel presentation.
- URL param support.
- Task query/filter integration.

## Quality Gate

Before shipping Sprint 1:

```bash
npm test
npm run typecheck
npm run lint
```

If schema changes are included:

```bash
npm run db:generate
```

Then inspect the generated migration before applying it.

## Final Recommendation

Ship Sprint 1 as a focused execution-speed release:

1. Make the existing Quick Task sheet command-first.
2. Make Kanban cards compact without losing actions.
3. Add default saved views with a JSON definition path for future filters.

This gives the user a faster capture flow, a cleaner board, and stronger task browsing while staying inside the current shell, route, auth, Supabase, and Drizzle patterns.
