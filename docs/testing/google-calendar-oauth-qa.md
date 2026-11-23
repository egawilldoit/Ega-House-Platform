# Google Calendar OAuth QA

Production deploys must set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_CALENDAR_SCOPES`; `GOOGLE_CALENDAR_ID` is optional and defaults to `primary`.

`GOOGLE_CALENDAR_SCOPES` must include `openid`, `email`, and
`https://www.googleapis.com/auth/calendar.events` so the connected Google
account has a stable subject/email destination binding. Deployments that keep
only the Calendar scope still sync to the stored calendar, but account switches
cannot be distinguished until they include `openid email` on reconnect.

After changing any of those Vercel environment variables, redeploy before testing Connect Calendar. Google Cloud Console must list the exact `GOOGLE_REDIRECT_URI` as an authorized redirect URI.

Before testing callback persistence in production, verify the database has applied `drizzle/0030_calendar_integration_settings.sql`. The `calendar_integration_settings` table must include `owner_user_id`, `provider`, token columns, `connected_at`, `disconnected_at`, and the unique index on `(owner_user_id, provider)`. The callback authenticates the user from the server Supabase session, then writes the owner-scoped row with the server-only service-role Supabase client. `SUPABASE_SERVICE_ROLE_KEY` must exist only in server env vars.

## Connect URL checklist

The Connect Google Calendar redirect must include:

- `response_type=code`
- `redirect_uri` equal to exact production `GOOGLE_REDIRECT_URI`
- `state`
- `access_type=offline`
- `include_granted_scopes=true`
- `prompt=consent`
- `scope` from `GOOGLE_CALENDAR_SCOPES`

## Callback failure codes

Settings renders safe `errorCode` values from callback failures:

- `google_error`: Google returned an OAuth error.
- `state_mismatch`: Browser callback state did not match stored state cookie.
- `missing_code`: Google callback lacked authorization code.
- `token_exchange_failed`: Server-side exchange with Google token endpoint failed.
- `missing_refresh_token`: Google returned access token without refresh token.
- `settings_write_failed`: Token response arrived, but Calendar settings persistence failed.
- `unexpected`: Unclassified server-side callback failure.

Server logs use `google_calendar_oauth_callback_failed` with step-level diagnostics only. Do not log tokens, auth codes, secrets, cookies, redirect URIs, or full callback URLs.

## Manual task sync (issue #428)

Manual sync requires `drizzle/0109_calendar_sync_v2.sql` plus the existing
OAuth variables. The GitHub Actions workflow `ega-calendar-sync.yml` calls
`POST /api/cron/calendar-sync` with the same `APP_URL` and `CRON_SECRET` secrets
as weekly reviews. It is the durable recovery path; keep it enabled before
relying on a closed browser to finish a run.

### Triage policy

The current product policy is **completion removes the managed calendar event**.
The issue raised preserving completed events as calendar history at triage; that
alternative was not adopted, so `status = done`/`completed_at` is an explicit
removal case alongside archived, deleted, unscheduled, and opted-out tasks.

### What to verify from Tasks

- Connect or reconnect returns to `/tasks` with a safe success or error message.
- The first sync reports created/updated, removed, unchanged, excluded,
  pending/retrying, and failed counts plus exclusion reasons.
- Re-running without changes reports unchanged and performs no Google writes.
- A task moved between timed and all-day keeps one event id and replaces both
  start and end boundaries.
- A task completed, archived, unscheduled, opted out, or deleted removes its
  managed event. Unrelated Google events are untouched.
- If Google requires reauthorization, the panel shows reconnect and the run
  pauses. After reconnecting, Synchronize resumes it.
- Closing the page keeps the run recoverable through the scheduled workflow.
- Two tabs cannot advance the same scan concurrently; the second request
  observes the same run.

### Destructive-test boundary

Use a dedicated Google test calendar. Do not point staging checks at a personal
primary calendar, and do not delete unrelated events. A failed or incomplete
`events.list` must never be treated as proof that an event was deleted.
