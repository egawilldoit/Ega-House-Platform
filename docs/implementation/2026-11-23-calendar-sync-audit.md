# Calendar sync v2 implementation audit (2026-11-23)

Issue: [#428](https://github.com/egawilldoit/Ega-House-Platform/issues/428)

This note records the current-main audit that preceded the manual Calendar sync
implementation. It separates repository evidence from external deployment
evidence.

## Existing integration

- OAuth connect and callback already exist at
  `apps/web/src/app/api/integrations/google-calendar/*`. They use offline
  access, a state cookie, the `calendar.events` scope configured through
  `GOOGLE_CALENDAR_SCOPES`, and encrypted server-side token storage.
- Token encryption already existed in
  `apps/web/src/lib/services/calendar-token-crypto.ts`.
- A direct Google Calendar REST client already existed in
  `apps/web/src/lib/services/google-calendar-service.ts` for insert, patch, and
  delete. It did not list events, use deterministic event ids, or persist
  destination-bound mappings.
- `calendar_sync_jobs` already existed as a best-effort outbox. Claims were
  conditional updates without `FOR UPDATE SKIP LOCKED`, no processing lease,
  no claim token, no destination binding, and no run/scan cursor.
- `apps/web/src/app/api/cron/calendar-sync` already existed, but no repository
  workflow invoked it. Recovery therefore depended on an external trigger not
  present in this repository.

## OAuth publishing status finding

Repository evidence: the OAuth code requests offline access and expects a
refresh token, and the callback rejects a missing refresh token. Deployment
evidence: **not established in this environment**. Google Cloud OAuth consent
screen publishing status, the authorized redirect URI, and the hosted Vercel
environment values must be confirmed outside the repository before release.
No production configuration was changed by this implementation.

## Deployed recovery trigger finding

Before this change: the route existed; no scheduled or manual-dispatch workflow
was committed. After this change: `.github/workflows/ega-calendar-sync.yml`
runs every 10 minutes and supports manual dispatch, authenticated with
`CRON_SECRET`. The workflow still requires `APP_URL` and `CRON_SECRET` secrets
and a deployment that includes the route. Deployment status remains external
until verified.

## Recurrence lifecycle finding

Completing a recurring task creates a new task row through
`generateNextTaskForCompletedRecurrence`; it does not advance the existing task
id. The current materialized row is therefore published as a standalone event.
The generated next occurrence starts with Calendar sync disabled (column
default), so it is excluded until the owner opts it in.

## Completion-removal policy

Current policy is removal. Completed tasks (`status = done` or a completed
timestamp), archived tasks, deleted tasks, unscheduled tasks, and tasks that opt
out are removal cases. The issue's triage note about preserving completed events
as calendar history was considered but not adopted; this is called out in the
PR and in `docs/testing/google-calendar-oauth-qa.md`.

## External acceptance still pending

No live Google account, hosted database migration, staging failure injection, or
production OAuth/recovery check was performed. The PR records those as pending
release evidence rather than claiming runtime success.
