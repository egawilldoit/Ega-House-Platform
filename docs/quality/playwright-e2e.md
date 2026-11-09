# Playwright E2E

Based on main `d0e3e2bcb8833c09959a1d0a5385542d76d4adcb` (merge #389).
The public smoke profile and authenticated persistence profile have separate
reports. Neither skipped cases nor a green discovery run count as acceptance.

## Run locally

Requirements: installed workspace dependencies, Docker access, Supabase CLI
2.118.0, Chromium (`npm exec --workspace @ega/web -- playwright install chromium`).
Keep ports 3000, 55320, 55321 and 55322 free. Do not reuse another app/server or
database. Run commands from the repository root in your isolated worktree.

```sh
node scripts/e2e/local-backend.mjs start
# Keep cleanup in the calling shell so a failed build/test also removes the stack.
trap 'node scripts/e2e/local-backend.mjs stop' EXIT
node scripts/e2e/with-env.mjs npm run build
npm run test:e2e:smoke --workspace @ega/web
node scripts/ci/assert-playwright-smoke.mjs apps/web/test-results/smoke-results.json
npm run test:e2e:authenticated --workspace @ega/web
node scripts/e2e/assert-disposable-report.mjs
```

On the shared `openclaw` VM, follow its host instructions: start/stop the
persistent Docker stack outside `heavy`; wrap finite builds and browser runs
with `/home/ubuntu/.local/bin/heavy` and a reservation that fits. When Docker
requires the already available noninteractive sudo access, set
`E2E_SUPABASE_SUDO=1` and `E2E_SUPABASE_BIN=/usr/bin/supabase` for start/stop.

For development only, run
`node scripts/e2e/with-env.mjs npm run dev --workspace @ega/web -- --hostname 127.0.0.1 --port 3000`
in a separately tracked process, then set `E2E_REUSE_OWNED_SERVER=1` for the
browser command. Stop that owned server after testing. CI refuses reuse and
always starts the production build. Development runs do not certify that build.

## What the profiles prove

| Profile | Required cases | Evidence |
| --- | --- | --- |
| Public smoke | 3 | Marketing hero/workspace link, login form, signup form; no submission |
| Auth | 2 | Canonical-host anonymous redirects on a local request, real login/reload/logout, cookie removal and unauthorized export |
| Tasks and owner isolation | 1 | UI create/reload; ordinary owner B cannot read, update or delete A's known task; A's row remains unchanged; B's UI cannot see it |
| Kanban | 2 | Pointer status move at desktop and phone widths; keyboard ordering, both survive reload |
| Today and timer | 1 | Two known outcomes saved/reloaded; start, recover the same active session after reload, stop and save outcome; exactly one ended session |
| Personal schedule | 5 | Save/reload/pause, appearance write preserves schedule, dirty navigation/discard, server rejection of overlapping guidance, keyboard/reduced motion |
| Money and CSV | 1 | Lose a real committed response and retry without duplicating, reload, export excludes B's same-day expense, edit, soft delete and database evidence |
| Shutdown and review | 1 | Check-in and routine input survive reload and appear in Review evidence |
| Notifications | 1 | Seeded notification, persisted read state and email-channel preference |

The authenticated JSON guard requires the exact 14 reviewed file/title pairs
under `chromium-disposable`, one passed attempt each, zero skipped/flaky/failed
cases, and no report-level errors. Smoke has its own exact three-case guard.
The guard tests include reports produced by the installed Playwright runner,
including its actual skipped and failed serialization.

## Disposable data and credentials

The harness creates a random `ega-e2e-*` Supabase project with real Auth and
PostgREST. It applies every entry in the canonical Drizzle journal. Migration
0035 needs the historical automation table baseline, and 0043 requires its
legacy reconciliation account; those are created only inside this stack.
Auth schemas/functions, RLS and application actions remain real.

Every test gets two fresh confirmed accounts, default preferences, an explicit
Africa/Casablanca time zone and a project. Service credentials are used only
for provisioning/cleanup; assertions use ordinary authenticated clients and
the browser. Account cleanup runs even after a failed case. Stopping the stack
with `--no-backup` removes all test records and volumes, including rows whose
tables do not cascade from Auth. A failed start also attempts this cleanup.
If cleanup fails, state is preserved for an explicit stop/recovery.

Generated credentials live only in ignored `.e2e-local/environment.json`
(directory mode 0700, file mode 0600). Targets must match the fixed loopback
app/API/database and the database run marker. Existing state is never adopted.
The browser blocks external requests. Traces, screenshots and videos are off;
JSON reports are ignored and never uploaded because config can contain local
keys. Do not print or attach generated state or raw authenticated reports.

## CI and limits

The existing required `web` job creates the stack, builds with its environment,
runs smoke and the existing workspace shell contract, runs authenticated
journeys, checks both reports, and tears down with `always()`. It needs no
repository credentials or shared test owners. Other required jobs and aggregate
gates remain in place. Changes to `scripts/e2e/**` select web validation.

Loopback hosts deliberately bypass canonical-host proxy redirects. Auth tests
send `x-forwarded-host` to the local server and inspect redirects without
following them. This proves routing policy, not deployed TLS, DNS, cross-domain
cookies or actual subdomain navigation. Those need a separately authorized
preview topology. This profile does not certify WebKit, offline/PWA behavior,
external providers, a deployed website, or the historical optional mobile matrix.
