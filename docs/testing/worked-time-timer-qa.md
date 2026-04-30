# Worked-Time Timer QA

Manual QA for EGA-291. Run against a real Supabase-backed environment with a signed-in user.

## Setup

- Start from `/tasks`.
- Pick or create a non-archived task visible to the signed-in user.
- Use the main create task form worked-time fields, not timer correction.

## Checklist

1. Create a task with worked time where `From` and `To` are both today.
2. Open `/timer`.
3. Confirm the new session appears in `Session timeline` with the created task title and expected duration.
4. Confirm `Tracked Total` includes the worked-time duration.
5. Confirm `Today Total` includes the worked-time duration.
6. Confirm `Today's distribution` includes the created task and percentage allocation.
7. Open `/timer/export`.
8. Confirm the CSV contains the session row with `task_id`, `started_at`, `ended_at`, and `duration_seconds`.
9. Start and stop a normal timer-created session from `/timer`.
10. Confirm the timer-created session still appears in `Session timeline`, contributes to totals, and appears in CSV export.

## Cross-day Check

1. Create a task with worked time that starts before local midnight and ends today.
2. Open `/timer`.
3. Confirm `Today Total` includes only the portion overlapping today.
4. Confirm `Tracked Total` includes the full session duration.

## Notes

- Do not mark this checklist passed unless browser QA was run against real Supabase data.
- Unit coverage exists for manual completed sessions contributing to timer aggregates and CSV export; this checklist covers route wiring, auth/RLS, and rendered UI.
