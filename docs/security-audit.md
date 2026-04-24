# EGA House Security Audit

Date: 2026-04-24
Scope: EGA-268 practical RLS, owner-scope, auth/session, middleware, and secret-handling audit for the personal OS web and mobile API surfaces.

## Current Risk Level

Low for the current personal OS scope.

The core private workflow tables are protected by Supabase RLS, forced RLS is enabled, and app reads/writes use authenticated Supabase clients rather than service-role clients. One owner-scope inconsistency was found and fixed for mobile Today timer reads. One RLS hardening gap was found and fixed for saved task views.

## Auth And Session Helpers Checked

| Surface | Files | Result |
| --- | --- | --- |
| Supabase SSR server client | `src/lib/supabase/server.ts` | Uses `createServerClient` with publishable key and request cookies. No service-role key usage. |
| Supabase browser client | `src/lib/supabase/client.ts` | Uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| Middleware Supabase session refresh | `src/middleware.ts` | Uses publishable key and `getClaims()` to gate protected workspace routes. |
| Auth service helpers | `src/lib/services/auth-service.ts` | Uses request-scoped server Supabase client for current user/session helpers. |
| Mobile auth service | `src/lib/services/mobile-auth-service.ts` | Uses stateless publishable-key Supabase client with bearer token. No service-role key. |
| Mobile request auth | `src/app/api/mobile/_lib/auth.ts` | Requires bearer token, validates user, then creates bearer-scoped Supabase client. |

## Protected Routes Checked

Middleware protects these root paths:

| Root route | Protected |
| --- | --- |
| `/dashboard` | Yes |
| `/goals` | Yes |
| `/shutdown` | Yes |
| `/startup` | Yes |
| `/tasks` | Yes |
| `/today` | Yes |
| `/timer` | Yes |
| `/review` | Yes |

Middleware also protects and rewrites these workspace subdomains:

| Host | Route prefix |
| --- | --- |
| `goals.egawilldoit.online` | `/goals` |
| `tasks.egawilldoit.online` | `/tasks` |
| `timer.egawilldoit.online` | `/timer` |
| `review.egawilldoit.online` | `/review` |

Compatibility `/apps/*` routes are not in the protected root prefix list. That is acceptable for the current launcher/compatibility surface, but any future private app content under `/apps/*` should be explicitly protected or moved into canonical workspace routes.

## Tables And RLS Status

Verified against live Postgres catalog through `DATABASE_URL` on 2026-04-24 after applying migration `0017_task_saved_views_owner_scope.sql`.

| Table | RLS enabled | Force RLS | Policies present | Owner-scope notes |
| --- | --- | --- | --- | --- |
| `projects` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | `owner_user_id = auth.uid()`; slug unique per owner. |
| `goals` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | Owner-scoped; insert/update also require owned parent project. |
| `tasks` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | Owner-scoped; insert/update also require owned project and owned optional goal. |
| `task_sessions` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | Owner-scoped; insert/update also require owned parent task. |
| `task_saved_views` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | Fixed in `0017`; owner-scoped and write checks require owned optional project/goal. |
| `week_reviews` | Yes | Yes | `select_own`, `insert_own`, `update_own`, `delete_own` | Owner-scoped; unique per owner/week start. |

No profile/user-owned application table is currently present. Auth users live in Supabase Auth.

## Routes, Actions, And Services Checked

| Domain | Files | Owner-scope result |
| --- | --- | --- |
| Projects | `src/app/tasks/projects/page.tsx`, `src/app/tasks/projects/[slug]/page.tsx`, `src/app/tasks/projects/actions.ts`, `src/app/tasks/projects/new/actions.ts` | Reads/writes use request-scoped Supabase client. RLS scopes visible rows. Project create relies on `auth.uid()` default and owner slug uniqueness. |
| Goals | `src/app/goals/page.tsx`, `src/app/goals/actions.ts` | Reads/writes use request-scoped Supabase client. Goal create/update depends on RLS and policy parent-project checks. |
| Tasks | `src/app/tasks/page.tsx`, `src/app/tasks/actions.ts`, `src/lib/services/task-service.ts` | Reads/writes use request-scoped Supabase client. Create validates visible project/goal scope before insert. Updates/deletes target IDs and are blocked by RLS if not owned. |
| Task sessions / timer | `src/app/timer/page.tsx`, `src/app/timer/actions.ts`, `src/lib/services/timer-service.ts`, `src/app/timer/export/route.ts` | Reads/writes use request-scoped Supabase client. Session writes are protected by RLS parent-task policies. Export route is protected by `/timer` middleware and RLS. |
| Saved task views | `src/app/tasks/saved-views-actions.ts`, `src/lib/task-saved-views.ts` | App validates visible project/goal scope before writes. RLS now also enforces owner and parent-scope checks. |
| Weekly reviews | `src/app/review/page.tsx`, `src/app/review/[reviewId]/page.tsx`, `src/app/review/actions.ts`, `src/app/review/export/route.ts` | Reads use request-scoped client and RLS. Save explicitly gets authenticated user and writes `owner_user_id`; export route is protected by `/review` middleware and RLS. |
| Today planner | `src/app/today/actions.ts`, `src/lib/services/today-planner-service.ts`, `src/app/api/mobile/today/**/route.ts` | Web uses request-scoped Supabase client. Mobile now keeps task, active timer, and timer summary reads on the bearer-scoped client. |
| Mobile tasks API | `src/app/api/mobile/tasks/**/route.ts` | Requires bearer token and passes bearer-scoped Supabase client into task services. RLS protects all reads/writes. |

## Fixes Made

| Fix | Files |
| --- | --- |
| Mobile Today active timer and summary reads now use the supplied bearer-scoped Supabase client instead of falling back to the cookie-based server client. | `src/lib/services/today-planner-service.ts`, `src/lib/services/today-planner-service.test.ts` |
| Saved task views now have forced RLS and separate owner policies. Insert/update policies also verify that optional `project_id` and `goal_id` belong to the authenticated user. Migration was applied to the configured database. | `drizzle/0017_task_saved_views_owner_scope.sql`, `drizzle/meta/_journal.json` |

## Environment Variable Check

Checked `.env.local` variable names only, not secret values.

| Variable | Exposure |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public by design. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public by design; used by browser, middleware, server SSR, and mobile auth clients. |
| `DATABASE_URL` | Server-only. Used by Drizzle config/client and migration/audit commands. No app route imports `src/db/client.ts`. |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST` | Public analytics config by design. |
| `LINEAR_API_KEY` | Server-only; no `NEXT_PUBLIC_` prefix. |
| `OPENCLAW_INTERNAL_URL`, `OPENCLAW_PUBLIC_URL`, `PENCLAW_HEALTH_URL` | Non-Supabase integration config. No service-role exposure found. |

No Supabase service-role key variable was found in `.env.local` or app code.

## Remaining Follow-ups

| Priority | Follow-up |
| --- | --- |
| Low | Consider adding `/apps/*` to protected middleware if compatibility app pages ever show private workspace data. |
| Low | Add a small recurring audit query or script for live RLS policy drift before major auth/data-model changes. |
| Low | Consider making `owner_user_id` columns `NOT NULL` in a future migration after confirming existing rows are backfilled. Current RLS blocks null-owned rows from authenticated access, so this is integrity hardening, not an active leak. |
| Low | Rename `PENCLAW_HEALTH_URL` if it is a typo for `OPENCLAW_HEALTH_URL`; not security-sensitive, but it can cause config confusion. |

## Conclusion

No obvious cross-user data leak remains in app code for the checked private workflow surfaces. The live database now has forced owner-scoped RLS for `projects`, `goals`, `tasks`, `task_sessions`, `task_saved_views`, and `week_reviews`. App code consistently uses authenticated request-scoped or bearer-scoped Supabase clients for private reads and writes.
