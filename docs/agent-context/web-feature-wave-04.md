# Wave 04 web feature convergence

**Starting accepted HEAD:** `c421ba612bcfda19241afd67ab17170bf24fd961`
**Branch:** `wave/04-web-feature-convergence`
**Dependency:** Wave 03 / PR #211
**Evidence date:** 2026-09-03

## User-value gate

### Selected capability: Notifications

- **User problem:** Task reminders can be produced by the notification subsystem, but a web user has no notification history, unread indication, or reliable way to follow a reminder back into work.
- **Existing capability:** `packages/application/src/notifications/service.ts` owns listing, unread counts, marking read/opened, and read-all. `apps/server/src/routes/notifications.ts`, `packages/contracts/src/notifications.ts`, and `packages/api-client/src/notifications.ts` already expose the canonical transport path. Mobile already has a notification surface.
- **Why web:** The web workspace is a primary planning and review surface. Notification history belongs beside the existing task/review workflow and can use the authenticated web application/data-access path directly.
- **Placement:** A `/notifications` workspace route, a System navigation entry, and a top-bar bell link with an unread count.
- **Discovery:** The route is present in the workspace navigation; the top-bar bell exposes the unread count and links to the same center.
- **Primary action:** Open a notification’s task target, marking it opened/read through the existing application service; users can also mark individual items read or all items read.
- **Success state:** The notification changes to read/opened and the shell unread count is revalidated.
- **Empty state:** Explain that the user is caught up and that task reminders will appear here.
- **Error state:** Show a recoverable inline message and preserve the rest of the notification list.

The selected change does not add a new Inbox surface. Wave 01 marks the existing Ideas/Inbox workflow `COMPLETE` on static evidence; notification history is the higher-value web exposure gap.

## Starting evidence

| Layer | Current evidence | Gap addressed |
| --- | --- | --- |
| Application | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `markNotificationOpened`, and `markAllNotificationsRead` | No web composition |
| Persistence | `SupabaseNotificationRepository` owner-scopes list/count/update operations | No web caller |
| Server | Authenticated `/api/notifications` route family | Web does not need self-HTTP for server-side rendering |
| Contracts/API client | Shared notification DTOs and native client methods already exist | No new contract authority required |
| Web | Reminder cron exists; no notification center or unread shell affordance | Add discoverable, authenticated workflow |
| Mobile | Notification list and settings surfaces exist | Preserve as the native implementation |

## Scope guard

This wave will not add notification preferences, a second transport, a new persistence owner, or a separate Operator/Health page. It will reuse the existing application policy and owner-scoped repository, and it will keep task targeting within the existing `/tasks` route semantics.

## Root-cause findings

The notification capability was already implemented below the web presentation layer. The web gap was an absent composition and discovery path: no web route called the notification use cases, workspace metrics did not query the unread projection, and the shared navigation/top bar had no notification affordance. Adding another server endpoint would have duplicated an existing transport rather than closing the web product gap.

## Changes implemented

- Added an authenticated `/notifications` page backed directly by the existing application use cases and request-scoped `SupabaseNotificationRepository`.
- Added list, unread count, task-target open, individual mark-read, mark-all-read, pagination, empty, success, and recoverable error states.
- Added a task-target helper that resolves only canonical task targets to `/tasks?view=all#task-<id>`; non-actionable notifications remain in the notification center.
- Added System navigation, command-palette discovery, top-bar unread affordance, and mobile-drawer discovery through the shared shell.
- Kept the unread shell query fail-soft so a missing/unavailable notifications relation cannot take down unrelated workspace navigation; the notification page still reports its own load failure.

## Verification snapshot

- Focused web suite: **PASS** — 5 files / 15 tests, including target routing, page/action wiring, top-bar unread state, shell metrics, command palette, and route metadata.
- Exact-head CI initially exposed one stale command-palette fixture: adding Notifications changed the empty-query option count from 19 to 20. The first clean run had 164/165 web files and 1,271/1,272 tests passing; the expectation and explanatory comment were corrected in `5a899932`.
- Exact-head CI after that correction: **PASS** — web typecheck, 1,272/1,272 web tests, web production build, workspace audit, and final hygiene all passed.
- `git diff --check`: **PASS**.
- Local web typecheck: **NOT VERIFIED** in this worktree because the shared install state is missing pre-existing MCP and `zod-v4` modules; after the boundary corrections there were no Wave 04 diagnostics. Clean CI is the authoritative web typecheck/build check.
- Runtime authentication, applied migration state, and cross-user production RLS remain **NOT VERIFIED** until the available environment can exercise them.

## Evidence status

Runtime authentication, applied migration state, and cross-user production RLS remain **NOT VERIFIED** until the available environment can exercise them. Local code/tests and any browser evidence are recorded separately. No production deployment or database mutation is part of this wave.

## Acceptance record

**Result:** `ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE`

- **Exact accepted HEAD:** `d90274628c241b2acd2bca39ef761adf0f95bdcc`
- **Code gate:** PASS. Focused tests, exact-head GitHub web/typecheck/build, workspace, hygiene, package checks, architecture, purity, and security checks passed.
- **Runtime gate:** NOT VERIFIED for authenticated web/database behavior because no safe authenticated environment or branch preview is available. Vercel branch execution is suppressed by the accepted Wave 00 guard.
- **Product gate:** PASS. Notifications is documented as a web workflow with navigation, unread discovery, task targeting, mark-read actions, empty/error/submitting states, and no duplicate Inbox or business-policy owner.
- **Review gate:** PASS. Fresh exact-range review found no Critical or Important findings.
- **Publication gate:** PASS. The exact SHA has no Vercel deployment record; the API Vercel status is `Canceled by Ignored Build Step`; no production deployment or database mutation occurred.

## Reconciliation with current main (2026-09-04)

After Waves 02 (`a05a6bd6`) and 03 (`b71d86a6`) merged, the Wave 04 branch was rebuilt
directly on current `main` (`b71d86a6`) by replaying only the nine Wave 04 commits
(`41cbbe1a..d0b53242`). No Wave 00–03 history was carried over and no current-main
functionality was reverted: the eight overlapping non-web files (server purge transport,
api-client purge re-exports, shared purge contracts, and their tests) are byte-identical
to current `main`, which already converges purge DTOs under `@ega/contracts/projects`.
The final diff is exactly the 16 intended Wave 04 files (web notification center plus
this record). A focused shell-metrics test pinning the unread-count mapping was added
during reconciliation; no production behavior was changed to satisfy any test.
