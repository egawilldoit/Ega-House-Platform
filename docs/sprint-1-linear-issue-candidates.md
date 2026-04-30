# Sprint 1 Linear Issue Candidates

Source: `docs/sprint-1-fast-execution-ux-grill.md`  
Skill used: `to-issues` style vertical slicing  
Target: Linear Sprint 1 issues for Fast Execution UX

## Re-analysis

The earlier issue list is directionally right, but several items are horizontal slices. Sprint 1 should be tracked as thin, demoable slices that each deliver a complete user-visible path through parser/domain logic, server validation, UI, and tests where relevant.

Because Linear tools are not available in this session, I could not check which issues already exist or create new Linear issues directly. These are the missing-or-needed Sprint 1 issue candidates to add if they are not already present.

## Issue 1 - Quick Add creates a Task from one command line

Type: AFK  
Blocked by: None  
Labels: `feature`, `productivity`, `sprint-1`, `quick-add`, `frontend`, `backend`

### What to build

Upgrade the existing Quick Task sheet so a user can enter one deterministic command line, preview the parsed Task fields, and create the Task through the existing server-side creation flow.

This should strengthen the `Project -> Goal -> Task -> Timer -> Review` loop by making Task capture faster without creating a parallel shell surface.

### Acceptance criteria

- [ ] The existing Quick Task sheet opens from the sidebar and `Ctrl/Cmd + Shift + N`.
- [ ] The single-task tab includes a focused command input.
- [ ] The command parser supports title text, `#Project`, `today`, `tomorrow`, weekday names, priority, and estimate tokens.
- [ ] The UI shows a parsed preview before submit.
- [ ] Submit creates a Task through the current server-side Task creation flow.
- [ ] Unknown project names produce a clear validation error.
- [ ] Unknown words remain part of the Task title instead of being dropped.
- [ ] Parser behavior is covered by tests.
- [ ] Server validation is covered for invalid project scope.

## Issue 2 - Quick Add supports Goal and blocked Task tokens

Type: AFK  
Blocked by: Issue 1  
Labels: `feature`, `productivity`, `sprint-1`, `quick-add`, `frontend`, `backend`

### What to build

Extend Quick Add so command input can attach a Task to a Goal and create blocked Tasks with a blocked reason, while preserving server-side ownership and visibility validation.

### Acceptance criteria

- [ ] The parser supports `/Goal` and `goal:Goal Name`.
- [ ] The parser supports `@blocked:reason`.
- [ ] A parsed Goal must resolve inside the selected or parsed Project.
- [ ] Unknown Goals produce clear validation errors.
- [ ] A blocked Task cannot be created without a non-empty blocked reason.
- [ ] The preview shows Goal, blocked status, and blocked reason when present.
- [ ] Server validation prevents cross-project Goal attachment.
- [ ] Tests cover Goal parsing, blocked parsing, unknown Goal, and Goal-outside-Project cases.

## Issue 3 - Compact Kanban card keeps Timer handoff visible

Type: AFK  
Blocked by: None  
Labels: `feature`, `productivity`, `sprint-1`, `kanban`, `frontend`, `ux-polish`

### What to build

Refactor the existing Kanban Task card into a compact execution card that shows only the information needed to scan and start work: priority signal, title, Project, due date, and Timer start action.

### Acceptance criteria

- [ ] Kanban cards show a compact priority signal.
- [ ] Kanban cards show Task title, Project, and due/planned date by default.
- [ ] Non-completed active Tasks expose a Timer start action by default.
- [ ] Goal, estimate, tracked time, and long metadata are hidden from the default card state.
- [ ] The card remains usable in dense columns with many Tasks.
- [ ] Existing Timer start behavior and return paths still work.
- [ ] Tests assert the compact default card content and Timer handoff.

## Issue 4 - Kanban details preserve lifecycle actions

Type: AFK  
Blocked by: Issue 3  
Labels: `feature`, `productivity`, `sprint-1`, `kanban`, `frontend`, `ux-polish`

### What to build

Move secondary Kanban actions and metadata into a details or menu state without removing real behavior. Users must still be able to move, pin, archive, restore, and delete Tasks safely.

### Acceptance criteria

- [ ] Card details or menu exposes Goal, estimate, tracked time, and full blocked reason.
- [ ] Move controls remain available for valid Task status transitions.
- [ ] Pin and unpin remain available.
- [ ] Archive, restore, and delete remain available with current protections.
- [ ] Blocked Tasks have a visually distinct state.
- [ ] Long blocked reasons are truncated by default and readable in expanded/details state.
- [ ] Existing action forms preserve return paths.
- [ ] Tests cover blocked state and all lifecycle action forms.

## Issue 5 - Deep Work saved view ships through JSON definitions

Type: AFK  
Blocked by: None  
Labels: `feature`, `productivity`, `sprint-1`, `saved-views`, `backend`, `frontend`

### What to build

Evolve saved views with a nullable JSON definition model and ship the first system preset, Deep Work, end to end. The preset should appear for every user without seeded per-user rows.

### Acceptance criteria

- [ ] `task_saved_views` supports a nullable JSON definition column.
- [ ] Existing saved view rows continue to work.
- [ ] A tested Task view definition module normalizes and applies allowed filter rules.
- [ ] Deep Work appears as a default saved view.
- [ ] Deep Work filters active Tasks to high or urgent priority with estimate greater than or equal to 30 minutes.
- [ ] Clicking Deep Work updates the Task list.
- [ ] Filtering happens only after owner-scoped reads or through equivalent server-side scoped constraints.
- [ ] Schema migration and domain tests are included.

## Issue 6 - Add Quick Wins, Blocked, and Due This Week default views

Type: AFK  
Blocked by: Issue 5  
Labels: `feature`, `productivity`, `sprint-1`, `saved-views`, `frontend`, `backend`

### What to build

Add the remaining Sprint 1 system saved views using the JSON definition path established by Deep Work.

### Acceptance criteria

- [ ] Quick Wins appears as a default view.
- [ ] Quick Wins filters active Tasks estimated at 15 minutes or less.
- [ ] Blocked appears as a default view.
- [ ] Blocked filters Tasks with blocked status.
- [ ] Due This Week appears as a default view.
- [ ] Due This Week filters active Tasks due from today through the next 7 days.
- [ ] Each default view preserves the active list/Kanban layout where appropriate.
- [ ] Tests cover all default view definitions and URL behavior.

## Issue 7 - Saved views panel separates default and custom views

Type: AFK  
Blocked by: Issue 5  
Labels: `feature`, `productivity`, `sprint-1`, `saved-views`, `frontend`, `ux-polish`

### What to build

Update the Saved Views panel so default system views and user-created custom views are clearly separated while preserving custom saved view create, update, open, and delete behavior.

### Acceptance criteria

- [ ] Default views appear above custom views.
- [ ] Default views are labeled as built-in or default views.
- [ ] Custom saved views still show saved count and descriptions.
- [ ] Users can still save the current URL filters as a custom view.
- [ ] Users can still update and delete custom views.
- [ ] Existing simple saved view columns continue to describe legacy/custom filters correctly.
- [ ] Tests cover default/custom presentation and custom view links.

## Recommended Linear Creation Order

1. Quick Add creates a Task from one command line
2. Quick Add supports Goal and blocked Task tokens
3. Compact Kanban card keeps Timer handoff visible
4. Kanban details preserve lifecycle actions
5. Deep Work saved view ships through JSON definitions
6. Add Quick Wins, Blocked, and Due This Week default views
7. Saved views panel separates default and custom views

## Notes

- The original five issues were not wrong, but issues 1, 3, and 5 above are better tracer bullets because each produces a demoable path.
- If Linear already has broad issues for Sprint 1, add these as implementation children or replace the broad issues with these thinner slices.
- The saved views work should preserve the existing table, current RLS posture, and current custom saved view behavior.
