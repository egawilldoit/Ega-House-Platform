# Task activity producers (EGA-784)

Durable, owner-scoped history for task changes. One append-only ledger contract
is shared by every surface; there is no second activity store.

## Storage and authority

| Source | Table | Why it exists | Read-model contribution |
| --- | --- | --- | --- |
| Field/reminder/comment changes | `task_activity_events` | New observable changes, append-only for clients | `field_change`, `created`, `archived`, `restored`, reminder kinds, `comment` |
| Status transitions and completion analytics | `task_status_events` | Existing analytics/heatmap authority; must not be double-counted | `status` |
| Timer evidence | `task_sessions` | Existing single-open timer invariant | `session` |

Rows in `task_activity_events` are written only by `SECURITY DEFINER` triggers or
trusted service-role producers. `authenticated`/`anon` have SELECT only (RLS
`owner_user_id = auth.uid()`); direct INSERT/UPDATE/DELETE is revoked. Status and
timer ledgers keep their existing append/ownership rules and gain actor columns
(additive).

Merged ordering is `occurred_at DESC, id DESC`; pagination is offset over that
order. Drawer and project card call the same `@ega/application` read model
(`packages/application/src/tasks/activity-read-model.ts`).

## Actor contract

`packages/domain/src/tasks/activity.ts` defines `TaskActivityActor`:

- `owner` — verified `auth.uid()` with no OAuth `client_id`; label renders "You".
- `agent` — stable `agentId` plus a label snapshotted at write time:
  - MCP OAuth: `client_id` claim, label = grant `client_name` (fallback: client id).
  - Scoped agent token API: token id; the database snapshots the token row's
    `name` at write time (fallback: token id).
- `system` — trusted job/service write without user or agent context.
- `unknown` — historical/malformed rows with no trustworthy proof. Never
  invented as owner or agent.

Labels are stored per event. Revoking or rotating a credential does not rewrite
history. Actor identity is never read from a request body or query string.

The agent-token path applies `createActorScopedServiceClient` with
`x-ega-actor-kind` / `x-ega-actor-agent-id` headers (no display text). The
database resolver trusts those headers only when the PostgREST role claim is
`service_role`; an `authenticated`/`anon` request that sets the same headers is
still attributed by its verified JWT. The label comes from the token row, not
the request.

## Mutation-path matrix

| Surface / producer | Write path | Auth context | Actor | Event evidence | Executable proof |
| --- | --- | --- | --- | --- | --- |
| Web server actions / legacy services (`task-transition-service`, `task-bulk-service`, drawer field patch) | Supabase user client → `tasks` | Verified Supabase session | `owner` | `created`, `field_change`, `archived`, `restored` via trigger | `scripts/db/task-activity-attribution-invariant-verify.mjs` `OWNER_WEB`, `NO-OP`; `apps/web/src/lib/services/task-activity-service.test.ts` |
| Hono / mobile (`apps/server`, api-client) | Request-scoped Supabase client → `tasks` | Verified bearer → RLS session | `owner` | Same trigger path | Same DB proof `OWNER_WEB` (same `auth.uid()` boundary); `apps/server/test` unaffected |
| MCP web transport (`apps/web/src/lib/mcp/write/tasks.ts`) | User client → `tasks` / reminders / sessions | OAuth JWT with `client_id` + active grant | `agent` | `created`, `field_change`, status, reminder, session | DB proof `MCP_AGENT`; `apps/web/src/lib/mcp/write/tasks.test.ts` |
| Scoped agent API (`/api/agent/tasks`, `agent-task-service`) | Service client with actor headers | Verified EGA token (hash + revocation) | `agent` | `created`, `field_change`, `archived` | DB proof `AGENT_TOKEN`; `agent-task-service.test.ts` |
| Timer start/stop (web, MCP) | `task_sessions` | Session JWT / OAuth JWT | `owner` or `agent` at start; stop never rewrites | `session` | DB proof `TIMERS` |
| Reminders (web, MCP, application) | `task_reminders` insert/update | Session JWT / OAuth JWT | `owner`/`agent` | `reminder_scheduled`, `reminder_updated`, `reminder_cancelled` | DB proof `REMINDERS` |
| Recurrence generation | User/MCP client → `tasks` insert on completion | Session or OAuth JWT | `owner`/`agent` | `created` for the generated occurrence | DB proof `OWNER_WEB`/`MCP_AGENT` (same insert trigger) |
| Cron / privileged jobs | Service/privileged connection → `tasks` insert | No user claim | `system` | `created` for the generated occurrence | DB proof `SYSTEM_JOB` |
| Comments (EGA-783) | Trusted producer → `task_activity_events` `event_kind='comment'` | Verified author at producer | `owner`/`agent` | One row per comment; `source_event_id` unique | DB proof `COMMENTS`; shared kind in `TASK_ACTIVITY_EVENT_KINDS` |
| Unknown/legacy rows | Pre-migration evidence | None | `unknown` | No fabricated activity; timer/status defaults stay unknown | DB proof `TIMERS` legacy case |

## Idempotency and failure semantics

- Database triggers write the event in the same transaction as the task/reminder
  mutation. A failed mutation cannot leave an event.
- No-op updates (same values) produce no event; repeated status writes of a done
  spelling produce no duplicate completion.
- Bulk operations emit one row per changed task.
- Comment producers use `source_event_id` with a partial unique index
  `(owner_user_id, event_kind, source_event_id)`; retries fail closed instead of
  duplicating. EGA-783 owns comment storage and writes through this contract.
- Reminder delivery-only statuses (`sent`, `processing`, `failed`) emit no
  activity.

## Historical states

- Migration `0068_task_activity_attribution.sql` adds actor columns with default
  `unknown` to existing status/timer rows. No timestamp or actor is invented.
- Field activity before stage 1 has no rows; the drawer says "No activity
  recorded yet. Changes made from now on appear here."
- A truncated page shows "Showing the latest N changes" instead of implying the
  list is complete.

## Runtime assumptions not covered by the disposable proof

- Hosted PostgREST forwarding of the server-set `x-ega-actor-kind` /
  `x-ega-actor-agent-id` headers into `request.headers` is platform behavior.
  The disposable proof sets the resulting GUC directly, so it proves the
  resolver contract, not the HTTP hop. A real scoped-agent request against a
  deployed environment must confirm the header arrives before runtime
  acceptance of that surface.
- Protected drawer/project screens need authenticated credentials for a browser
  walkthrough. The repository visual test accepts a `/login` redirect, so it is
  not proof that the activity UI rendered.
