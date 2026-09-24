# PWA Mobile — W00 Baseline and Verification Harness

Evidence revision: local `main` `3e3449ecfadcd4f10dcaed1260006da9c179745d` (2026-09-22).
Branch: `feat/mobile-pwa-w00-baseline` (cut from that revision). Source-grounded
baseline plus an executable harness; authenticated/device measurements are gated
on staging credentials and are listed as pending, not assumed.

## 1. Harness

| Piece | Path | Purpose |
| --- | --- | --- |
| Fixture | `apps/web/tests/pwa-fixtures.ts` | `createPwaFixtures(page)` returns `{ page, ownerA, ownerB, setUnreadNotifications }`; UI sign-in on the staging login host; never logs credentials |
| Notification seeding | `setUnreadNotificationsForOwner` / `clearSeededNotificationsForOwner` | Direct Postgres via `E2E_SEED_DATABASE_URL`; deletes/inserts only rows with `idempotency_key LIKE 'e2e-pwa-%'` for the fixture owner |
| Dummy-render spec | `apps/web/tests/pwa-mobile.e2e.spec.ts` | Route/device matrix; runs against the local production build with dummy backend env |
| Staging auth config | `apps/web/playwright.pwa-auth.config.ts` | Authenticated + middleware-redirect proof against `E2E_AUTH_BASE_URL` (default `https://www.egawilldoit.online`), no local webServer; traces disabled (`trace: "off"`) so sign-in credentials can never land in retained trace artifacts |
| Dummy config projects | `apps/web/playwright.config.ts` | `chromium-phone-390`, `chromium-phone-320` (both scoped via `testMatch` to `pwa-*.e2e.spec.ts`), `chromium-desktop` (unrestricted — pre-existing suites such as `test:visual` and `test:auth-session:e2e` keep running exactly once, under desktop) (+ `webkit-phone-390`, pwa-scoped, when `PWA_E2E_WEBKIT=1` and browsers installed) |

Commands (repository root):

```text
npm run test:pwa:mobile          # dummy-render matrix against local production build (requires npm run web:build first)
npm run test:pwa:auth            # authenticated staging matrix (requires E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; E2E_SEED_DATABASE_URL for notification tests)
npm run test:auth-session:e2e    # pre-existing cross-subdomain auth suite
npm run web:build                # production build used by test:pwa:mobile
```

Required env for authenticated coverage: `E2E_AUTH_EMAIL`, `E2E_AUTH_PASSWORD`
(ownerA), optional `E2E_AUTH_SECOND_EMAIL`/`E2E_AUTH_SECOND_PASSWORD` (ownerB,
consumed by W07 account-isolation tests), optional `E2E_SEED_DATABASE_URL`
(direct Postgres for notification seeding), optional `E2E_AUTH_BASE_URL`,
`E2E_AUTH_PLATFORM_DOMAIN`, `E2E_AUTH_LOGIN_HOST`, `E2E_AUTH_PROTOCOL`.

## 2. Route inventory (section 5 mapping, observed in source)

Auth layers: **proxy** = `apps/web/src/proxy.ts`
(`PROTECTED_ROOT_PATH_PREFIXES`, applied only when hostname is in
`ROOT_HOSTS`); **page/service** = page or its page-model/service resolves the
verified session.

| Route | Page file | Auth observed at `3e3449e` |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | `getCurrentUser()`; redirects to `/home` when signed in, else public marketing |
| `/home` | `src/app/home/page.tsx` | proxy + `getCurrentUser()` |
| `/today` | `src/app/today/page.tsx` | proxy + `getCurrentUser()` |
| `/dashboard` | `src/app/dashboard/page.tsx` | proxy + unconditional `redirect("/today")` |
| `/tasks` | `src/app/tasks/page.tsx` | proxy prefix only; page model issues RLS-scoped queries with no explicit auth resolution (anonymous render = empty workspace) |
| `/tasks/projects`, `/tasks/projects/[slug]`, `/tasks/projects/[slug]/delete`, `/tasks/projects/new` | `src/app/tasks/projects/**` | proxy + `requireAuthenticatedUser()` |
| `/goals` | `src/app/goals/page.tsx` → `_lib/goals-page-model.ts` | proxy + `requireAuthenticatedUser()` |
| `/timer` | `src/app/timer/page.tsx` → `_lib/timer-page-model.ts` | proxy + `getCurrentUser()` |
| `/review`, `/review/[reviewId]` | `src/app/review/**` | proxy; `/review` uses `supabase.auth.getUser()` in the page model; `/review/[reviewId]` has no auth check — an RLS-scoped `week_reviews` query returns empty for anonymous and the page calls `notFound()` |
| `/startup`, `/shutdown` | `src/app/startup|shutdown/page.tsx` | proxy path prefix |
| `/ideas` | `src/app/ideas/page.tsx` | proxy prefix; service resolves auth via `getUser()` |
| `/friction` | `src/app/friction/page.tsx` | page-level `getCurrentUser()` (no proxy prefix) |
| `/notifications` | `src/app/notifications/page.tsx` | service-level `requireAuthenticatedUser()` → error/empty state, **no redirect** (no proxy prefix) |
| `/work-analytics` | `src/app/work-analytics/page.tsx` → `_lib` | page-model `getCurrentUser()` (no proxy prefix) |
| `/settings/account` | `src/app/settings/account/page.tsx` | service-level auth (`calendar-settings-service`) (no proxy prefix) |
| `/apps`, `/apps/[workspace]`, `/help` | `src/app/apps/**`, `src/app/help/page.tsx` | **no page-level auth, no proxy prefix**. `/apps` and `/help` render AppShell with neutral shell fallback when unauthenticated; `/apps/[workspace]` is a pure redirect table (`notFound()` for unknown workspaces, `redirect()` into proxy-protected routes for known ones), so auth is enforced downstream by the proxy |
| `/login`, `/signup` | `src/app/login|signup/page.tsx` | `redirect("/dashboard")` when session exists |
| `/oauth/consent` | `src/app/oauth/consent/page.tsx` | redirects to login when unauthenticated |
| `/work-analytics/export`, `/review/export`, `/timer/export` | `route.ts` | service-level auth |

Inventory corrections to the plan's assumptions:

1. `/dashboard` no longer renders a dashboard; it is a compatibility redirect
   to `/today` (`dashboard/page.tsx`). Mobile work should treat `/today` as the
   overview target.
2. The plan's `/friction` and `/work-analytics` rows are page-auth gated, while
   `/notifications`, `/settings/account`, `/apps`, `/help` rely on service-level
   or no gating. `proxy.ts` `PROTECTED_ROOT_PATH_PREFIXES` does not include
   `/notifications`, `/work-analytics`, `/friction`, `/settings`, `/apps`, `/help`.

## 3. Baseline measurements (this environment)

Production build (`npm run web:build`) at `3e3449e`:

- All product routes are server-rendered on demand (`ƒ`); no static product
  pages. Build succeeds with placeholder backend env, matching CI
  (`unified-platform-validation.yml`).
- Route list captured in build output (see §2 table); no unexpected extra
  product routes found.

Unauthenticated rendering matrix (`npm run test:pwa:mobile`): **27 passed,
0 failed, 39 skipped (env-gated)** in 2.1m on 1 worker.

- Viewports: 390x844, 320x844, 1280x800.
- Public routes `/`, `/login`, `/signup`: render h1, `scrollWidth <= clientWidth`
  (strict, zero allowance) at all three viewports.
- Service-gated routes `/notifications`, `/work-analytics`, `/friction`,
  `/settings/account`, `/apps`, `/help`: render with non-empty body and zero
  horizontal overflow at all three viewports (with dummy backend they fall back
  to neutral shell/error states, e.g. "Workspace shell metrics unavailable;
  using neutral fallback").
- Middleware redirect tests skipped locally by design: `proxy.ts` applies auth
  redirects only for `ROOT_HOSTS`; on `127.0.0.1` protected paths return 200
  with fallback rendering. Redirect proof runs via `npm run test:pwa:auth`.

HTML document sizes (local production build, dummy env, single curl each):

| Route | HTML bytes | TTFB |
| --- | --- | --- |
| `/` | 43,895 | 0.32s |
| `/login` | 19,062 | 0.07s |
| `/signup` | 20,097 | 0.05s |
| `/help` | 51,547 | ~7.2s (dummy-env supabase timeout before neutral fallback; not a production number) |
| `/apps` | 44,034 | ~7.2s (same dummy-env artifact) |
| `/notifications` | 37,692 | ~7.1s (same dummy-env artifact) |

## 4. Baseline issues recorded (not fixed in W00)

1. **Middleware protection gap for secondary routes** — `/notifications`,
   `/work-analytics`, `/friction`, `/settings`, `/apps`, `/help` are outside
   `PROTECTED_ROOT_PATH_PREFIXES`. Unauthenticated `/apps` and `/help` render
   the full workspace AppShell with neutral metrics (observed in the dummy
   matrix). W05 must give these routes explicit unauthenticated states or move
   protection to the canonical layer.
2. **Unauthenticated `/` depends on Supabase availability** — `page.tsx` calls
   `getCurrentUser()` before deciding marketing vs `/home`; a failing backend
   delays the public landing (TTFB artifact observed above). Verify production
   behavior during W02 origin work.
3. **`next` runtime mismatch** — `apps/web/package.json` pins `next@16.3.5`,
   but the installed (hoisted) runtime is `16.2.12`. Resolve before W06 SW
   toolchain pinning.
4. **State-dependent bell hiding below 420px — FIXED** in
   `feat/web-light-workspace-refactor`. The editorial shell (and
   `editorial-shell.css`) was replaced by
   [`workspace.css`](../../apps/web/src/styles/workspace.css); the notification
   link now carries a stable `data-has-unread` attribute and the ≤420px rule
   keys off it, so the bell hides only when there is genuinely nothing unread.
   `tests/visual-a11y.spec.ts` asserts both states against the new stylesheet
   (the old `workspace-topbar-icon[aria-label]` hook no longer exists).
5. **Authenticated dataset baseline pending** — payload sizes, navigation
   timings and seeded-data flows for signed-in routes require staging
   credentials (`E2E_AUTH_*`, `E2E_SEED_DATABASE_URL`); the harness in §1 is
   ready but was not executed here. Record in a follow-up baseline note once
   available.

Local-hazard remedy: if `test:pwa:mobile` hangs with no output, a stale
unresponsive `next-server` is likely squatting on port 3000
(`ss -ltnp | grep 3000`); kill it before rerunning.

## 5. Pending before W01 exits

- Run `npm run test:pwa:auth` against staging to lock the redirect + sign-in +
  unread-bell assertions (W01 consumes `setUnreadNotifications`). Verify the
  seed connection can actually write: the `notifications` table has
  `FORCE ROW LEVEL SECURITY` (`src/db/schema.ts`); the seed role must bypass
  RLS or inserts fail loudly.
- ownerA/ownerB must be **dedicated clean e2e accounts** with no non-seeded
  unread notifications: the app counts every `read_at IS NULL` row for the
  owner (`workspace-shell.ts`), while the fixture only controls
  `idempotency_key LIKE 'e2e-pwa-%'` rows. The fixture verifies total unread
  after seeding and fails loudly with a provisioning message if uncontrolled
  rows exist; it never writes non-seeded rows.
- Install WebKit (`npm exec --workspace @ega/web -- playwright install webkit`)
  and set `PWA_E2E_WEBKIT=1` for the WebKit phone project; wire that flag into
  CI or the W01 exit checklist so WebKit coverage is enforced, not optional.
- Strict overflow baseline (`allowance 0`, stricter than the `visual-a11y`
  20px precedent) has only been proven on Chromium; re-validate on WebKit
  before enabling the webkit project, where subpixel overflow is more likely.
- Before any wave tests notification pagination, stagger seeded
  `created_at` values (`now() + n * interval`) — seeded rows currently share
  one timestamp, which can skip/duplicate rows on the cursor pagination path.

Independent review record: four review passes (two first-round: correctness/
security and contract/evidence — approved; two second-round: runtime/flakiness
— approved, and domain-semantic — requested changes). All accepted findings
are fixed in this change set: first-round items listed in §1/§5 above, plus
second-round items — post-seed total-unread verification with a loud
provisioning error, top-bar-scoped bell assertion split by the ≤420px CSS
behavior, case-insensitive seed-email match, settle-waits before overflow
measurement, explicit 60s default timeout, and the three route-table
mechanism corrections above.
