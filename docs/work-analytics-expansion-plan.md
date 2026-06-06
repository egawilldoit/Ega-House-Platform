# Work Analytics Expansion Plan

## Purpose

The app already captures execution evidence through tasks, timer sessions, weekly reviews, projects, and goals. The next step is to turn that evidence into clearer analytics so the user can understand:

- how much work happened per day, week, and month
- where time is going by project, goal, task, status, and priority
- which work patterns are helping or hurting execution
- where planning estimates differ from reality
- which problems keep returning, such as blockers, stale tasks, skipped work days, or fragmented sessions

This document describes the current state, gaps, and a practical roadmap for richer analytics in the EGA House app.

## Current State

### Current Product Surfaces

The app already has several analytics-adjacent surfaces:

- `src/app/work-analytics/page.tsx`
  - Current dedicated analytics page.
  - Shows today, yesterday, this week, streak, last 7 days, last 30 days, 30-day project breakdown, and basic insights.
  - Output is mostly text strings inside cards rather than visual charts or drilldowns.

- `src/lib/services/work-analytics-service.ts`
  - Main analytics calculation module.
  - Supports period totals, daily series, project breakdown, and basic insights.
  - Current insight set includes previous-period delta, percent change, best day, lowest non-zero day, days worked, current streak, average session length, longest session, and shortest session.

- `src/lib/services/work-analytics-data-adapter.ts`
  - Loads timer sessions for a selected window.
  - Joins each session to task, project, and goal context.

- `src/app/dashboard/_components/WorkStatsPulse.tsx`
  - Shows worked today and current streak on the dashboard.
  - Links to `/work-analytics`.

- `src/app/dashboard/_components/DashboardOptimizedView.tsx`
  - Shows tracked today, total tracked, longest session, session count, and active timer state.

- `src/app/review/page.tsx`
  - Weekly review already contains strong analytics foundations:
    - cycle velocity
    - tracked weekly time
    - sessions logged
    - tasks created
    - blockers
    - goals touched
    - session heatmap
    - most tracked tasks, projects, and goals
    - CSV export

- `src/lib/review-session-heatmap.ts`
  - Aggregates tracked seconds by day across a recent window.

- `src/lib/review-most-tracked.ts`
  - Ranks tracked tasks, projects, and goals for a weekly window.

- `src/lib/services/timer-service.ts`
  - Provides timer summary data including tracked today, total tracked, sessions today, longest session, and task breakdown.

### Current Data Sources

The current schema already supports useful analytics without major database changes.

#### Projects

Table: `projects`

Useful fields:

- `id`
- `owner_user_id`
- `name`
- `slug`
- `description`
- `status`
- `created_at`
- `updated_at`

Can answer:

- which projects receive the most time
- which projects are active but not receiving time
- which projects have stale movement
- how work distributes across project status

#### Goals

Table: `goals`

Useful fields:

- `id`
- `owner_user_id`
- `project_id`
- `title`
- `next_step`
- `health`
- `status`
- `created_at`
- `updated_at`

Can answer:

- which goals receive execution time
- which goals are touched often
- which goals are stale
- goal health versus actual time invested
- goals with many tasks but little completion

#### Tasks

Table: `tasks`

Useful fields:

- `id`
- `owner_user_id`
- `project_id`
- `goal_id`
- `title`
- `description`
- `blocked_reason`
- `status`
- `priority`
- `estimate_minutes`
- `focus_rank`
- `due_date`
- `planned_for_date`
- `scheduled_start_at`
- `scheduled_end_at`
- `completed_at`
- `archived_at`
- `created_at`
- `updated_at`

Can answer:

- tasks created per day/week/month
- tasks completed per day/week/month
- completion rate
- blocked task count and blocker age
- planned versus completed work
- scheduled versus actual timer work
- estimate versus tracked time
- priority mix
- focus queue pressure
- stale task age

#### Task Sessions

Table: `task_sessions`

Useful fields:

- `id`
- `owner_user_id`
- `task_id`
- `started_at`
- `ended_at`
- `duration_seconds`
- `created_at`
- `updated_at`

Can answer:

- total worked time
- daily, weekly, monthly worked time
- session count
- average session length
- longest and shortest sessions
- time by task, project, and goal through joins
- active/open timer sessions
- fragmentation and deep-work patterns

#### Week Reviews

Table: `week_reviews`

Useful fields:

- `id`
- `owner_user_id`
- `week_start`
- `week_end`
- `summary`
- `wins`
- `blockers`
- `next_steps`
- `created_at`
- `updated_at`

Can answer:

- review consistency
- saved reflection history
- recurring blockers from review text
- weekly narrative versus actual tracked data
- weeks without saved review

## Current Gaps

### 1. Analytics Are Spread Across Surfaces

The app has useful analytics, but they are split between Dashboard, Timer, Review, Today, and Work Analytics. `/work-analytics` should become the central command surface for understanding execution patterns.

### 2. Work Analytics Is Mostly Text

Current `/work-analytics` output joins daily values into text. It needs visual scanning:

- bar charts for daily/weekly/monthly work
- stacked bars by project or goal
- heatmap for consistency
- trend lines for moving averages
- ranked tables for projects, goals, and tasks

### 3. Monthly Understanding Is Thin

Current logic has a last-30-days daily series but not true month-level analysis. The user needs:

- current month-to-date
- previous month comparison
- month-by-month history
- best month
- worst non-zero month
- active days per month
- monthly project distribution

### 4. Weekly Comparison Is Basic

The service can compare a current window to the previous same-length window. It should become more explicit:

- this week versus last week
- last 4 weeks
- rolling 7-day average
- weekly active days
- weekly sessions
- weekly top projects/goals/tasks
- weekly blockers and stale work

### 5. Estimate Versus Actual Is Not Surfaced

Tasks already have `estimate_minutes`, and sessions provide actual tracked time. This can expose planning quality:

- tasks over estimate
- tasks under estimate
- total estimated versus total tracked
- estimate accuracy by project
- estimate accuracy by task type or priority

### 6. Problems Are Not Called Out Directly

The app currently reports data, but it should diagnose likely issues:

- work is fragmented into too many short sessions
- one project consumes most work time
- urgent tasks are growing
- blocked tasks are aging
- tasks are created faster than completed
- high-priority tasks receive little tracked time
- scheduled work is not converted into timer sessions
- goals are marked active but not receiving work

### 7. Timezone Behavior Needs One Clear Policy

Some analytics use UTC date splitting, while current day windows use local date behavior. The app should define one policy:

- User-facing day/week/month charts should use the user's local timezone.
- Server-side aggregation should accept an explicit timezone or offset.
- Export rows should preserve ISO timestamps and include the report timezone.

### 8. "Per Web" Requires Clarification

The current database does not track websites, browser domains, desktop apps, or tool names. If "per web" means "per week", existing session data is enough. If it means "per website/app used", the app needs a new data source.

Possible interpretations:

- Per week: implement weekly analytics from current `task_sessions`.
- Per workspace/project: use projects/goals/tasks from current schema.
- Per website/app: add an activity ingestion model, browser extension, desktop tracker, or manual tags.

## Analytics We Can Add Now

These features can be built from current tables.

### Daily Analytics

Show:

- total worked time today
- sessions today
- completed tasks today
- created tasks today
- active timer
- top task today
- top project today
- work by hour of day
- work started versus work planned
- task completion rate today

Charts:

- hourly bar chart
- task breakdown table
- project breakdown table
- current day timeline

Useful questions:

- What did I actually work on today?
- How much deep work did I get?
- Did I finish anything?
- Did I spend time on the right project?
- Did I drift away from planned work?

### Weekly Analytics

Show:

- total worked time this week
- active days this week
- sessions this week
- average session length
- best day this week
- lowest non-zero day this week
- current streak
- top projects, goals, and tasks
- tasks created versus completed
- blockers opened or still active
- estimate versus actual for completed tasks

Charts:

- 7-day bar chart
- project stacked bar
- goal stacked bar
- task completion funnel
- consistency heatmap

Useful questions:

- Which days were productive?
- What project consumed the week?
- Did I complete enough relative to what I created?
- Which blockers slowed work?
- Which goals moved?

### Monthly Analytics

Show:

- month-to-date worked time
- previous month worked time
- month-over-month delta
- active days this month
- average worked time per active day
- top projects this month
- top goals this month
- completed tasks this month
- task creation/completion balance
- over-estimate and under-estimate patterns
- best week of the month
- best day of the month

Charts:

- month calendar heatmap
- week-by-week bar chart
- project distribution chart
- rolling 7-day trend
- monthly comparison table

Useful questions:

- Is this month better than last month?
- Which project dominated my month?
- Did I work consistently or in bursts?
- Which week was strongest?
- Am I finishing work or just creating tasks?

### Project Analytics

Show per project:

- total tracked time
- session count
- active days
- completed task count
- open task count
- blocked task count
- stale task count
- estimate versus actual
- latest work date
- goal coverage

Useful questions:

- Which projects get most of my time?
- Which projects are active but neglected?
- Which projects have the most blockers?
- Which projects have bad estimate accuracy?

### Goal Analytics

Show per goal:

- total tracked time
- linked tasks
- completed linked tasks
- open linked tasks
- blocked linked tasks
- latest execution session
- health versus actual activity
- next step age

Useful questions:

- Which goals are moving?
- Which goals are declared active but not worked on?
- Which goals need a clearer next step?
- Which goals produce the most completed work?

### Task Analytics

Show per task:

- total tracked time
- estimate
- estimate delta
- session count
- first worked date
- last worked date
- completed date
- cycle time from creation to completion
- whether task was scheduled
- whether scheduled time matched actual timer time

Useful questions:

- Which tasks took the most time?
- Which tasks were underestimated?
- Which tasks are stale?
- Which tasks have many sessions but no completion?
- Which tasks are blocked too long?

### Session Quality Analytics

Show:

- average session length
- median session length
- longest session
- shortest meaningful session
- sessions under 5 minutes
- sessions under 15 minutes
- sessions over 90 minutes
- number of context switches per day
- session count per project/day

Useful questions:

- Am I doing focused sessions or fragmented work?
- Which projects cause the most switching?
- Are sessions too short to produce progress?
- Do long sessions correlate with completions?

### Planning Quality Analytics

Show:

- estimate accuracy
- total estimated minutes versus tracked minutes
- estimated work planned for day/week/month
- actual tracked time for scheduled tasks
- planned tasks completed
- planned tasks untouched
- tasks completed without planned date
- due tasks completed versus overdue

Useful questions:

- Is planning realistic?
- Do planned tasks actually receive time?
- Are estimates useful?
- Are due dates creating execution pressure or noise?

### Problem Detection

The app can compute "problem signals" and show them as diagnostic cards.

Signals:

- No tracked time today.
- Work streak broke.
- More tasks created than completed this week.
- Urgent task count increased.
- Blocked tasks are older than 3 days.
- High-priority tasks have zero tracked time this week.
- One project consumed more than 70 percent of weekly time.
- Average session length is below 15 minutes.
- A task has more than 5 sessions but is still not done.
- Scheduled tasks were missed.
- Active goals have no sessions this week.
- Review was not saved for the previous week.

Each signal should include:

- severity
- explanation
- affected project/goal/task
- suggested next action
- link to the relevant app surface

## New Work Analytics Page Shape

Route:

- `/work-analytics`

Recommended page layout:

### Header

Controls:

- range selector: Today, 7 days, 30 days, Month, Quarter, Custom
- grouping selector: Day, Week, Month
- breakdown selector: Project, Goal, Task, Priority, Status
- include open sessions toggle
- export button

Summary cards:

- Worked time
- Active days
- Sessions
- Average session
- Tasks completed
- Estimate accuracy

### Main Trend

Primary chart:

- day/week/month bar chart
- optional moving average
- previous period comparison

### Breakdown

Tabs:

- Projects
- Goals
- Tasks
- Priorities
- Statuses

Each tab should show:

- ranked table
- tracked time
- percent of total
- sessions
- completed tasks
- blocked/open counts where relevant

### Problem Signals

Diagnostic cards:

- top 3 to 8 current problems
- each signal links to the affected task, goal, project, or review

### Estimate Accuracy

Panel:

- total estimated versus total tracked
- over-estimated tasks
- under-estimated tasks
- tasks without estimates
- project-level accuracy

### Consistency

Panel:

- heatmap
- active days
- streak
- best day
- worst non-zero day
- average per active day

### Session Quality

Panel:

- average session
- median session
- short session count
- long session count
- context switch count
- longest session

### Drilldown Drawer

Clicking any chart bar or table row should reveal:

- date/window
- sessions inside that window
- task names
- project/goal context
- start/end timestamps
- duration
- links to task and project pages

## Service Additions

Create a richer analytics service beside the existing service:

- `src/lib/services/work-analytics-report-service.ts`

Responsibilities:

- compose report windows
- load sessions and task metadata
- compute all report sections
- return serializable data for the page

Keep lower-level pure calculations in:

- `src/lib/work-analytics-calculations.ts`

This keeps the UI thin and makes analytics easy to test.

### Proposed Types

```ts
export type WorkAnalyticsRangePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "month_to_date"
  | "previous_month"
  | "quarter_to_date"
  | "custom";

export type WorkAnalyticsReport = {
  range: WorkAnalyticsResolvedRange;
  summary: WorkAnalyticsSummary;
  trend: WorkAnalyticsTrendPoint[];
  comparison: WorkAnalyticsComparison;
  breakdowns: WorkAnalyticsBreakdowns;
  consistency: WorkAnalyticsConsistency;
  sessionQuality: WorkAnalyticsSessionQuality;
  estimateAccuracy: WorkAnalyticsEstimateAccuracy;
  problemSignals: WorkAnalyticsProblemSignal[];
};
```

### Summary Metrics

```ts
export type WorkAnalyticsSummary = {
  totalWorkedSeconds: number;
  sessionCount: number;
  activeDayCount: number;
  averageSessionSeconds: number;
  medianSessionSeconds: number;
  completedTaskCount: number;
  createdTaskCount: number;
  blockedTaskCount: number;
  estimatedSeconds: number;
  estimateDeltaSeconds: number;
};
```

### Trend Points

```ts
export type WorkAnalyticsTrendPoint = {
  key: string;
  label: string;
  startIso: string;
  endIso: string;
  workedSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
  createdTaskCount: number;
};
```

### Breakdown Rows

```ts
export type WorkAnalyticsBreakdownRow = {
  id: string | null;
  label: string;
  href: string | null;
  workedSeconds: number;
  percentOfTotal: number;
  sessionCount: number;
  completedTaskCount?: number;
  openTaskCount?: number;
  blockedTaskCount?: number;
  estimateDeltaSeconds?: number;
};
```

### Problem Signals

```ts
export type WorkAnalyticsProblemSignal = {
  id: string;
  severity: "info" | "warn" | "danger";
  title: string;
  detail: string;
  href: string | null;
  metricValue?: string;
};
```

## Data Loading Strategy

For most analytics, load one report window and a previous comparison window.

Session query:

- `task_sessions`
- join `tasks`
- join `projects`
- join `goals`
- filter by owner
- filter sessions overlapping report window

Task query:

- tasks created in window
- tasks completed in window
- tasks open/blocked at report time
- tasks planned/scheduled in window

Review query:

- reviews in selected week/month range
- previous review status

### Existing Query Pattern To Reuse

`getWorkAnalyticsSessionsForWindow` already uses the correct overlap strategy:

- `started_at < window.endIso`
- `ended_at is null OR ended_at >= window.startIso`

This prevents sessions that cross midnight or cross a report boundary from being lost.

## Timezone Policy

Use local user-facing report windows.

Recommended approach:

- Accept `timeZone` or `timezoneOffsetMinutes` in report requests.
- Daily, weekly, and monthly buckets should be built in that timezone.
- Store raw timestamps as ISO strings as today.
- Export should include:
  - report timezone
  - bucket start/end ISO
  - raw session start/end ISO

Minimum first step:

- Keep current server behavior, but document that current charts are UTC/local mixed.
- Add tests for sessions crossing midnight.
- Then introduce explicit timezone support before finalizing monthly reports.

## If Website/App Tracking Is Needed

Current app data cannot answer "which websites did I use?" because it only tracks task sessions.

To support website/app analytics, add a separate optional activity model:

```sql
activity_events
- id
- owner_user_id
- source_type -- browser, desktop, manual, integration
- source_name -- Chrome, VS Code, Figma, Linear
- domain -- optional, example github.com
- window_title -- optional
- started_at
- ended_at
- duration_seconds
- task_id -- optional manual/automatic link
- project_id -- optional inferred/manual link
- created_at
```

Possible ingestion paths:

- browser extension for website domains
- desktop watcher for active app/window
- manual activity tags
- import from external tools

Privacy rule:

- Do not collect URLs, titles, or domains by default.
- Make app/website tracking explicit, opt-in, and easy to pause.
- Allow local-only summaries if raw event storage is too sensitive.

## Implementation Roadmap

### Phase 1 - Make Existing Analytics Useful

Goal:

- Improve `/work-analytics` without schema changes.

Add:

- proper visual daily chart for last 30 days
- current month-to-date card
- previous month comparison
- top projects/goals/tasks
- active days
- average per active day
- sessions count and average session
- problem signals from current data

Files likely touched:

- `src/app/work-analytics/page.tsx`
- `src/lib/services/work-analytics-service.ts`
- `src/lib/services/work-analytics-data-adapter.ts`
- new tests around analytics calculations

Acceptance criteria:

- User can see work per day for the selected window.
- User can see work per week and month.
- User can see top projects/goals/tasks.
- User can see at least 5 problem signals.
- Existing `/review` and `/dashboard` behavior does not regress.

### Phase 2 - Add Report Service And Filters

Goal:

- Centralize analytics into a report data model.

Add:

- range selector
- grouping selector
- project/goal filters
- report service
- serializable report payload
- reusable chart components

Acceptance criteria:

- `/work-analytics?range=month_to_date`
- `/work-analytics?range=last_7_days`
- `/work-analytics?range=last_30_days`
- `/work-analytics?groupBy=week`
- Query params are shareable and reload-safe.

### Phase 3 - Estimate And Planning Analysis

Goal:

- Show whether planning is accurate.

Add:

- estimate versus actual panel
- scheduled versus tracked panel
- planned tasks touched/untouched
- overdue completion signals
- tasks without estimates

Acceptance criteria:

- User can see tasks where actual time exceeded estimate.
- User can see projects with poor estimate accuracy.
- User can see planned tasks that received no tracked sessions.

### Phase 4 - Monthly Review And Export

Goal:

- Make monthly self-review possible.

Add:

- monthly report route or tab
- month calendar heatmap
- month-over-month table
- Markdown export
- CSV export
- generated monthly summary draft

Acceptance criteria:

- User can export a monthly analytics Markdown report.
- Report includes work totals, active days, top projects/goals/tasks, problem signals, and planning accuracy.

### Phase 5 - Optional Website/App Tracking

Goal:

- Support true per-website or per-app analytics if desired.

Add:

- opt-in activity event schema
- privacy controls
- source adapters
- linking activity to tasks/projects
- app/domain breakdown charts

Acceptance criteria:

- User can view time by app/domain.
- Raw tracking can be disabled.
- Sensitive fields can be hidden or omitted.

## Suggested First Implementation Slice

Build the smallest valuable version first:

1. Keep using existing `task_sessions`.
2. Add a richer `/work-analytics` page.
3. Show:
   - today
   - last 7 days
   - last 30 days
   - month-to-date
   - previous month
   - top projects
   - top goals
   - top tasks
   - problem signals
4. Add pure calculation tests.
5. Do not change schema.

This gives better understanding quickly and avoids introducing tracking complexity before the current execution data is fully used.

## QA Plan

### Unit Tests

Add tests for:

- session overlap across day boundaries
- sessions crossing month boundaries
- open session inclusion/exclusion
- daily aggregation
- weekly aggregation
- monthly aggregation
- best/worst day
- active-day count
- project/goal/task breakdown
- estimate versus actual
- problem signal generation

### Page Tests

Add rendering tests for:

- empty analytics state
- one-session state
- multi-project state
- month comparison state
- problem signal state

### Manual QA

Check:

- `/work-analytics`
- `/dashboard`
- `/review`
- `/timer`
- export links
- mobile width
- sessions crossing midnight
- no data state
- active timer state

## Risks

- Timezone bugs can make daily/monthly totals feel wrong.
- Open sessions can inflate reports if included by default.
- Too many metrics can make the page noisy.
- Querying too much session history can slow the page.
- Estimate accuracy is only useful when tasks have estimates.
- Website/app tracking would introduce privacy and product complexity.

## Recommendation

Do Phase 1 first. The app already has enough execution data to answer the most important questions:

- How much did I work today?
- How much did I work this week?
- How much did I work this month?
- Which projects/goals/tasks received the time?
- What problems are visible from the data?
- Am I planning realistically?

After Phase 1, decide whether "per web" means weekly analytics or true website/app tracking. If it means true websites/apps, treat it as a separate opt-in product track, not part of the core timer analytics work.
