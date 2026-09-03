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

## Evidence status

Runtime authentication, applied migration state, and cross-user production RLS remain **NOT VERIFIED** until the available environment can exercise them. Local code/tests and any browser evidence will be recorded separately.
