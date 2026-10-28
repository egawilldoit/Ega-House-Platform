# Task view toolbar contract (EGA-791)

The `/tasks` toolbar, saved views and the Hono task list share one versioned
`TaskViewDefinition`. Do not add a second filter store or client-side aggregation
rule; extend this contract instead.

## Definition

```ts
type TaskViewDefinition = {
  version: 2;
  filters: TaskViewFilter[];        // AND across entries
  groupBy: "none" | "status" | "priority" | "project" | "goal" | "due_bucket";
  sort: { key: TaskViewSortKey; direction: "asc" | "desc" };
  search: string;                   // case-insensitive title search
  activeOnly: boolean;              // legacy `tasks=active` (status != done)
};
```

Filters are an allow-listed field/operator/value matrix. Values are compared as
data only; field names never reach SQL.

| Field | Operators | Values | Null handling |
| --- | --- | --- | --- |
| `status` | `is`, `is_not`, `is_any_of`, `is_none_of` | canonical statuses | not nullable |
| `priority` | same | canonical priorities | not nullable |
| `project` | same | owner project id (`[A-Za-z0-9:_-]`, ≤120) | not nullable |
| `goal` | same | owner goal id | `is_not` / `is_none_of` include tasks with no goal |
| `due_bucket` | same | `overdue`, `today`, `next_7_days`, `later`, `none` | `none` means no due date |
| `due_within_days` | `is` | integer 1–365 | legacy `dueWithin`; date range today…today+N |
| `estimate` | `between` | `[min, max]`, either bound open | a null estimate never matches |

Conjunction is **AND** across filters. `is_any_of` / `is_none_of` apply OR
within their own value list. `is_not` is the complement of `is`.

`next_7_days` is the legacy "due soon" window (today through +7) and therefore
overlaps `today`; the disjoint grouping bucket still puts today's work in
`today`. Overdue/today/soon never include completed work; completed work with a
due date falls into `later`.

## Ordering

Every sort is deterministic. Missing values sort last in both directions, and
ties always break on task id ascending:

- `manual` — `focus_rank`, then id
- `title`, `due`, `planned`, `created`, `updated`
- `priority` — urgent → high → medium → low
- `status` — todo → in progress → blocked → done
- `estimate`

## URL and API encoding

Canonical keys keep old links working:

- positive filters: `status`, `priority`, `project`, `goal`, `due`, `dueWithin`,
  `estimateMin`, `estimateMax`
- negative/compound filters: repeated `filter=<field>:<operator>:<v1,v2>`
- `q` search, `group`, `sort`, `dir`, `tasks=active`
- existing scope keys `archive`/`view`, `layout`, `density`, `task`, `taskMode`

Legacy values (`sort=updated_desc`, `sort=due_date_asc|desc`, `due=due_soon`,
`due=due_today`, `due=no_due_date`, comma-separated status/priority) are parsed
into the same definition. `@ega/api-client` sends the same pairs through Hono's
`/api/tasks`; `parseMobileTaskListQuery` reads repeated `filter` values.

## Saved views

`task_saved_views.definition_json` stores version 2. Reads accept version 1
definitions (`{ activeTasks, status, priority[], estimateMinMinutes,
estimateMaxMinutes, dueWithinDays }`) and migrate them in
`getTaskViewFromSavedView`. Rows without `definition_json` fall back to the
legacy `status`, `project_id`, `goal_id`, `due_filter` and `sort_value` columns.
Both paths are bounded by `TASK_VIEW_DEFINITION_MAX_CHARS` (4096) and the filter
limits; invalid payloads are ignored rather than trusted.

New rows still write the legacy columns as a one-dimensional projection so an
older build degrades to a usable view.

## Counts and selection scope

`applyTaskView` returns `matchedCount` (after filters), `loadedCount` (rows in
the page), `totalCount` (exact owner-scoped count when a transport supplies it)
and `truncated`. The web read model pages up to 5000 rows and asks for an exact
count only when a page could be truncated. Group counts describe the filtered
set, not just the loaded page. Selection-driven actions (bulk archive) submit
only ids from the currently rendered filtered rows; the server re-validates
ownership and status.

## Ownership

Project/goal filter values are sanitized against the owner's visible scope before
querying. RLS remains authoritative for row access; a saved view can never widen
the actor's dataset. Parent ownership is unchanged by this feature.
