# Work Analytics SQL EXPLAIN Validation

**Date:** 2026-06-01
**Branch:** `hermes/work-analytics-sql-explain-validation`
**Slice:** 7 of Work Analytics Audit

## Objective

Run `EXPLAIN (ANALYZE, BUFFERS)` on the two key work analytics queries from
`src/lib/services/work-analytics-data-adapter.ts` and document query plans,
index usage, and performance characteristics.

## Approach

A Node.js script (`scripts/explain-work-analytics.mjs`) was used to connect
directly to the Supabase Postgres database via the `postgres.js` client
(already a project dependency). The `DATABASE_URL` from `.env.local` is used
— no secrets are printed or stored.

### How to run locally in the future

```bash
# Ensure .env.local has DATABASE_URL set
node scripts/explain-work-analytics.mjs
```

The script:
1. Loads `DATABASE_URL` from `.env.local` (never printed)
2. Connects via `postgres.js` (the same client used by Drizzle ORM)
3. Runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` for all query shapes
4. Prints query plans to stdout
5. Closes the connection cleanly

**Security:** The script never prints the connection URL or any credentials.

---

## Query 1: Task Sessions Window Query

**Equivalent SQL:**

```sql
SELECT task_id, started_at, ended_at, duration_seconds
FROM task_sessions
WHERE owner_user_id = '<user_id>'::uuid
  AND started_at < '<window_end>'
  AND (ended_at IS NULL OR ended_at >= '<window_start>')
ORDER BY started_at DESC;
```

**EXPLAIN (ANALYZE, BUFFERS) output:**

```
Sort  (cost=2.38..2.38 rows=1 width=36) (actual time=0.010..0.010 rows=0 loops=1)
  Sort Key: started_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1
  ->  Index Scan using task_sessions_owner_user_id_idx on task_sessions
        (cost=0.14..2.37 rows=1 width=36) (actual time=0.006..0.006 rows=0 loops=1)
        Index Cond: (owner_user_id = '<user_id>'::uuid)
        Filter: ((started_at < '<window_end>') AND
                 ((ended_at IS NULL) OR (ended_at >= '<window_start>')))
        Buffers: shared hit=1
Planning Time: 0.101 ms
Execution Time: 0.037 ms
```

### Analysis

| Metric | Value |
|--------|-------|
| Index used | `task_sessions_owner_user_id_idx` (single-column on `owner_user_id`) |
| Scan type | Index Scan |
| Filter | `started_at` < end AND (`ended_at` IS NULL OR `ended_at` >= start) |
| Estimated rows | 1 |
| Actual rows (dummy user) | 0 |
| Buffers | 1 shared hit (index) |
| Execution time | 0.037 ms |

### Index recommendation

The current index only covers `owner_user_id`. For real users with many
sessions, a composite index on `(owner_user_id, started_at, ended_at)` would:

- Allow an **Index Range Scan** on both `owner_user_id` and `started_at`
- Potentially avoid the `Filter` step if `ended_at` is also in the index
- Remove the need for a separate Sort step (index is already sorted on `started_at`)

**Recommended index:**

```sql
CREATE INDEX CONCURRENTLY task_sessions_owner_started_ended_idx
  ON task_sessions (owner_user_id, started_at DESC, ended_at);
```

---

## Query 2a: Tasks Created Count

**Equivalent SQL:**

```sql
SELECT id
FROM tasks
WHERE owner_user_id = '<user_id>'::uuid
  AND created_at >= '<window_start>'
  AND created_at < '<window_end>';
```

**EXPLAIN (ANALYZE, BUFFERS) output:**

```
Index Scan using tasks_owner_user_id_scheduled_start_at_idx on tasks
  (cost=0.14..2.37 rows=1 width=16) (actual time=1.365..1.365 rows=0 loops=1)
  Index Cond: (owner_user_id = '<user_id>'::uuid)
  Filter: ((created_at >= '<window_start>') AND
           (created_at < '<window_end>'))
  Buffers: shared hit=1
Planning Time: 16.065 ms
Execution Time: 1.394 ms
```

### Analysis

| Metric | Value |
|--------|-------|
| Index used | `tasks_owner_user_id_scheduled_start_at_idx` (`owner_user_id`, `scheduled_start_at`) |
| Scan type | Index Scan |
| Filter | `created_at` range |
| Estimated rows | 1 |
| Actual rows (dummy user) | 0 |
| Buffers | 1 shared hit |
| Execution time | 1.394 ms |

### Index recommendation

The planner is using `tasks_owner_user_id_scheduled_start_at_idx` because it
provides `owner_user_id` as a leading column. However, `scheduled_start_at`
is not the same as `created_at`, so the `created_at` filter is applied as an
extra filter rather than a range condition.

A dedicated index on `(owner_user_id, created_at)` would be more efficient:

```sql
CREATE INDEX CONCURRENTLY tasks_owner_created_at_idx
  ON tasks (owner_user_id, created_at);
```

---

## Query 2b: Tasks Completed Count

**Equivalent SQL:**

```sql
SELECT id
FROM tasks
WHERE owner_user_id = '<user_id>'::uuid
  AND status = 'done'
  AND completed_at >= '<window_start>'
  AND completed_at < '<window_end>';
```

**EXPLAIN (ANALYZE, BUFFERS) output:**

```
Index Scan using tasks_owner_user_id_scheduled_start_at_idx on tasks
  (cost=0.14..2.37 rows=1 width=16) (actual time=0.005..0.005 rows=0 loops=1)
  Index Cond: (owner_user_id = '<user_id>'::uuid)
  Filter: ((completed_at >= '<window_start>') AND
           (completed_at < '<window_end>') AND
           ((status)::text = 'done'::text))
  Buffers: shared hit=1
Planning Time: 0.724 ms
Execution Time: 0.029 ms
```

### Analysis

Same index as Query 2a — all filtering is done as a post-index-scan filter.

### Index recommendation

A composite index on `(owner_user_id, status, completed_at)` would allow
the planner to use a proper Index Range Scan:

```sql
CREATE INDEX CONCURRENTLY tasks_owner_status_completed_idx
  ON tasks (owner_user_id, status, completed_at);
```

---

## Query 2c: Tasks Blocked Count

**Equivalent SQL:**

```sql
SELECT id
FROM tasks
WHERE owner_user_id = '<user_id>'::uuid
  AND completed_at IS NULL
  AND (blocked_reason IS NOT NULL OR status = 'blocked')
  AND created_at < '<window_end>';
```

**EXPLAIN (ANALYZE, BUFFERS) output:**

```
Index Scan using tasks_owner_user_id_scheduled_start_at_idx on tasks
  (cost=0.14..2.37 rows=1 width=16) (actual time=0.005..0.005 rows=0 loops=1)
  Index Cond: (owner_user_id = '<user_id>'::uuid)
  Filter: ((completed_at IS NULL) AND
           ((blocked_reason IS NOT NULL) OR ((status)::text = 'blocked'::text)) AND
           (created_at < '<window_end>'))
  Buffers: shared hit=1
Planning Time: 0.132 ms
Execution Time: 0.029 ms
```

### Analysis

Heaviest filter — three conditions plus a complex OR. A partial index on
`(owner_user_id, created_at)` where `completed_at IS NULL` could help
significantly:

```sql
CREATE INDEX CONCURRENTLY tasks_owner_blocked_idx
  ON tasks (owner_user_id, created_at)
  WHERE completed_at IS NULL
    AND (blocked_reason IS NOT NULL OR status = 'blocked');
```

---

## Summary of Index Recommendations

| Query | Current Index | Recommended Index |
|-------|--------------|-------------------|
| Sessions window | `task_sessions_owner_user_id_idx` (single) | `(owner_user_id, started_at DESC, ended_at)` |
| Tasks created | `(owner_user_id, scheduled_start_at)` (wrong column) | `(owner_user_id, created_at)` |
| Tasks completed | `(owner_user_id, scheduled_start_at)` (wrong column) | `(owner_user_id, status, completed_at)` |
| Tasks blocked | `(owner_user_id, scheduled_start_at)` (wrong column) | Partial `(owner_user_id, created_at)` WHERE blocked |

> **Note:** These are recommendations for future optimization. Actual migration
> of indexes should only be done after:
> 1. Verifying real-world query patterns with actual user data
> 2. Testing index creation on a staging database
> 3. Monitoring for any impact on write performance

---

## Failure Evidence

The previous audit attempt (finding S3) reported `read ECONNRESET`. This
slice successfully connected via the `postgres.js` client (same as Drizzle
ORM) using `DATABASE_URL` from `.env.local`. The `supabase.rpc()` approach
was not attempted because:
- The project does not have a `supabase.rpc('query', ...)` pattern established
- The direct `postgres.js` client worked on the first attempt
- No `psql` CLI was available on the host

### Connectivity for future runs

The `scripts/explain-work-analytics.mjs` script is committed and can be
re-run anytime. No additional dependencies are required beyond what's
already in `package.json`.
