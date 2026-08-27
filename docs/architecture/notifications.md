# Notifications Subsystem V1 — Architecture & Runtime

**Status:** Implemented on branch `feat/notification-system-v1` (not yet merged, migration not applied to production, no real-device push proof yet). Last updated 2026-08-27.

## 1. Topology

```
Source/Intent → Canonical Notification → Delivery Policy → Provider
     |                     |                    |               |
 Task Reminder     notifications        notification_deliveries   FCM HTTP v1 / Resend
     |                     |                    |               |
     +-- task_reminders ---+                    +-- per device (push) / per email
```

- **Reminder** = scheduling intent (`task_reminders` with `remind_at`, `delivery_mode`, `status`, `processed_at`).
- **Notification** = canonical user-facing event (`notifications` with `type`, `title`, `body`, `target_type`/`target_id`, `idempotency_key`, `read_at`/`opened_at`).
- **Delivery** = attempt to project a notification through one channel/endpoint (`notification_deliveries` with `channel`, `device_id`, `provider`, `status`, `attempt_count`, `next_attempt_at`).
- **Provider** = external infra (`FcmPushProvider` via FCM HTTP v1, `ResendEmailProvider`).

Dependency direction preserved:

```
web ─┐
     ├─> application ─> domain/contracts
server┘          │
                 └─> repository ports ─> data-access
mobile ─> api-client ─> contracts ─> server
```

Mobile never imports `application`, `data-access`, `src/db`, or server internals.

## 2. Data Model (migration 0045)

**New tables (all RLS + FORCE RLS, owner-scoped policies `owner_user_id = auth.uid()`):**

- `notifications`
  - `id, owner_user_id, type ('task_reminder'), title, body, target_type ('task'|null), target_id, idempotency_key, read_at, opened_at, created_at, updated_at`
  - `unique(owner_user_id, idempotency_key)`, `index(owner_user_id, created_at desc)`, partial index `where read_at is null`
- `notification_devices`
  - `id, owner_user_id, installation_id (unique), platform ('android'), provider ('fcm'), provider_token, is_active, last_seen_at, invalidated_at`
  - `unique(installation_id)`, index `owner+is_active where is_active`
- `notification_deliveries`
  - `id, notification_id FK cascade, owner_user_id, channel ('push'|'email'), device_id FK set null, provider ('fcm'|'resend'), status ('queued'|'sending'|'provider_accepted'|'retry_scheduled'|'invalid_endpoint'|'failed'), attempt_count, next_attempt_at, last_error_* , provider_message_id, provider_accepted_at, failed_at`
  - `unique(notification_id, channel, device_id)` + coalesce index for email dedupe, index `(status, next_attempt_at)`
- `notification_preferences`
  - `id, owner_user_id, notification_type ('task_reminder'), push_enabled, email_enabled`
  - `unique(owner_user_id, notification_type)`

**Evolved `task_reminders`:**
- Added `delivery_mode ('push'|'email'|'both') default 'email'`, `processed_at`, `processing_error`, check constraint, index `(status, remind_at) where pending`.
- Existing `channel`/`status`/`sent_at` retained for backward compat; `status` now represents scheduling intent (`pending`/`processing`/`processed`/`failed`/`cancelled`), not per-device result.

**Device ownership safety:**
- `claim_notification_device(p_installation_id, p_platform, p_provider, p_provider_token)` is `SECURITY DEFINER` but derives `auth.uid()` internally, never accepts `owner_user_id`. Atomically deactivates any other active row with same `provider_token` for a different owner, then `INSERT ... ON CONFLICT (installation_id) DO UPDATE` to claim. Granted only to `authenticated`. No caller can make a token active for two users.

## 3. Contracts

`packages/contracts/src/notifications.ts`:
- `NotificationType = 'task_reminder'`, `NotificationTargetType = 'task'`, `NotificationDeliveryMode = 'push'|'email'|'both'`, `NotificationChannel`, `NotificationDeliveryStatus`, `NotificationProvider`, `NotificationPlatform`.
- `Notification`, `NotificationTarget`, `NotificationListResponse`, `NotificationUnreadCountResponse`, `RegisterNotificationDeviceInput`, `NotificationPreferences`, `UpdateNotificationPreferencesInput`, `MarkNotification*Response`, `PushNotificationPayload` (typed data payload with `notificationId, type, targetType, targetId` only, no secrets or raw routes).

`CreateTaskReminderInput` now optionally carries `deliveryMode`; omitting it defaults to `email` for backward compat.

## 4. Application Layer

`packages/application/src/notifications/`:
- `ports.ts` — repository ports (`NotificationRepository`, `NotificationDeviceRepository`, `NotificationDeliveryRepository`, `NotificationPreferenceRepository`, `TaskReminderIntentRepository`) + provider ports (`PushProvider`, `EmailProvider`, `EmailDestinationResolver`).
- `delivery.ts` — pure functions: `resolveDeliveryChannels(deliveryMode, preferences)`, `nextRetryAt(attempt)` (exponential 1m,2m,4m,8m,16m, max 5), `classifyFcmError(httpStatus, fcmCode)` → `invalid_endpoint`|`transient`|`permanent`|`auth`, `shouldDeactivateDevice`, `buildPushDataPayload`.
- `service.ts` — use cases: `createNotification`, `listNotifications`, `getUnreadCount`, `markRead`/`Opened`/`AllRead`, `get/updatePreferences`, `register/claimDevice`/`unregisterDevice`, `processDueTaskReminders`, `processPendingNotificationDeliveries`.

No transport, Supabase, or FCM details leak into application. Idempotency via `task-reminder:<reminderId>`; replay is safe due to DB `unique(owner, idempotency_key)` and `unique(notification_id, channel, device_id)` + conditional claim `WHERE status='pending'`.

## 5. Data Access / Providers

`packages/data-access/src/notifications/`:
- `repository.ts` — Supabase adapters for all four repositories + intent repository; idempotent `createNotification` catches `23505` and returns existing; `listPending` filters `queued`/`retry_scheduled` where `next_attempt_at` is due.
- `fcm-provider.ts` — `FcmPushProvider` using `google-auth-library` JWT (no hand-rolled crypto), FCM HTTP v1 `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`, payload `token, notification.title/body, data {notificationId, type, targetType, targetId}, android.priority=HIGH`. Never logs token or private key. Returns `providerMessageId` on 200; classifies `UNREGISTERED`/`INVALID_ARGUMENT` → `invalid_endpoint` (deactivates device), 429/5xx/`UNAVAILABLE` → `retry_scheduled`, 401/403 → `failed` with `auth` code. Uses `resolveFcmServiceAccountFromEnv` reading `FCM_SERVICE_ACCOUNT_JSON` or `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` (with `\\n` → `\n` normalization).
- `email-provider.ts` — `ResendEmailProvider` and `SupabaseEmailResolver` (best-effort lookup via `profiles` or `auth.getUser`).

## 6. Server API (Hono)

`apps/server/src/routes/notifications.ts` mounted at `/api/notifications`:
- `GET /` — list with `?limit&cursor` (cursor = `created_at`), returns `NotificationListResponse` with typed targets (no raw routes).
- `GET /unread-count`
- `PATCH /:id/read`, `PATCH /:id/opened`, `POST /read-all`
- `POST /devices` — body `RegisterNotificationDeviceInput` (validates `android`/`fcm`), returns `device {id, installationId, platform, provider, isActive}` without echoing token.
- `DELETE /devices/:installationId`
- `GET /preferences`, `PATCH /preferences` (single object `{notificationType, pushEnabled?, emailEnabled?}`).

All routes derive `actor` from verified bearer token, use request-scoped Supabase client, return `@ega/contracts` DTOs, and remain thin. No caller-supplied `ownerUserId` is accepted.

## 7. API Client

`packages/api-client/src/notifications.ts` — typed `NotificationsApi` with methods mirroring server; composed into `createEgaApiClient().notifications`. Tests assert path/method/body/contract decoding; no React Query or Expo logic.

## 8. Mobile Native Layer

- `expo-notifications@~0.32.17` and `expo-crypto@~15.0.9` installed via `npx expo install` (SDK 54 compatible), no EAS, no `eas.json` added, no `ExpoPushToken`.
- `app.json` retains `com.ega_house.mobile`; notifications use native FCM token via `Notifications.getDevicePushTokenAsync()`.
- `lib/notifications/`:
  - `installation.ts` — `getOrCreateInstallationId()` persisted in `expo-secure-store` key `ega.notification.installation_id`, generated via `expo-crypto.randomUUID()` or `getRandomBytesAsync` fallback.
  - `channel.ts` — `ensureAndroidChannel()` creates `task-reminders` channel (importance MAX) before token retrieval.
  - `permissions.ts` — `getPermissionStatus()`/`requestPermission()` wrappers, `undetermined` vs `denied` handling.
  - `token.ts` — `getFcmDeviceToken()` via `getDevicePushTokenAsync()` only.
  - `registration.ts` — `registerCurrentDevice()`/`unregisterCurrentDevice()`/`bestEffortUnregisterBeforeLogout()` using `getMobileEgaApiClient().notifications` and `SecureStore`. Logout calls `bestEffortUnregisterBeforeLogout()` before Supabase sign-out with 3s timeout.
  - `target.ts` — `notificationTargetToRoute(target)` maps `{type:'task', id}` → `/tasks/[id]` else `/notifications`; `parseNotificationPayload` validates `notificationId, type, targetType, targetId` (all strings, no raw path).
  - `provider.tsx` — `NotificationProvider` (placed `MobileQueryProvider → AuthProvider → NotificationProvider → ThemeProvider → Stack`):
    - Sets `Notifications.setNotificationHandler` to show alert in foreground.
    - On `isReady`+`isAuthenticated`, refreshes permission and registers if `granted` (with channel).
    - Listens `addPushTokenListener` for rotation → re-register.
    - Listens `addNotificationReceivedListener` (foreground) and `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` for tap, deduplicates via `lastHandledNotificationId`, marks `opened` via API, navigates via `target.ts` after 300ms, handles cold-start race.

## 9. Task Reminder → Delivery

**Server evolution:**
- `packages/application/src/tasks/service.ts` `createTaskReminder` now accepts optional `deliveryMode` (defaults `email`, validates `push`|`email`|`both`).
- `packages/data-access/src/tasks/repository.ts` `createReminder` inserts `delivery_mode`, `REMINDER_SELECT` and `mapReminder` include it, `toMobileTaskListItem` echoes `deliveryMode`.

**Cron (`apps/web/src/app/api/cron/task-reminders/route.ts`):**
- Thin: `authorizeCronRequest`, create service Supabase client (`getSupabaseServiceClient`), instantiate repositories + `FcmPushProvider.fromEnv()` + `ResendEmailProvider` (or no-op if `RESEND_API_KEY` missing) + `SupabaseEmailResolver`.
- Runs `processDueTaskReminders` (find due `pending` reminders, claim via `UPDATE ... WHERE status='pending'`, create idempotent notification `task-reminder:<id>`, resolve channels via `resolveDeliveryChannels` (mode + preferences), create per-device push or per-email deliveries via `createDeliveries` (idempotent unique), `markProcessed`), then `processPendingNotificationDeliveries` (load `queued`/`retry_scheduled` due, `markSending`, call provider, classify, update `provider_accepted`|`retry_scheduled` with `nextRetryAt`|`invalid_endpoint` (deactivate device)|`failed`, bounded 5 attempts).
- No longer uses `EGA_OWNER_USER_ID`; handles all owners. No business rules in the route.

## 10. Mobile UI

- **Today header bell:** `app/(app)/(tabs)/today.tsx` imports `useUnreadCountQuery` and renders `NotificationBell` (Pressable with `notifications-outline` + badge `danger` when `unreadCount>0`, caps at `99+`) alongside Search, pushing to `/(app)/notifications`.
- **Notification center:** `app/(app)/notifications.tsx` — `SectionList` grouped `Today`/`Earlier`, `RefreshControl`, empty/loading/error states using `mobileTheme`/`GlassCard`/`GlassButton`, each item shows icon, title, body, `relativeTime`, unread dot + `itemUnread` styling, `Pressable` → `markOpened` + `notificationTargetToRoute` → `router.push`. `Mark all read` in header when any unread.
- **Profile:** `app/(app)/(tabs)/profile.tsx` adds `Pressable` row `Notifications > Push and email reminders` with `notifications-outline` icon, pushing to `/(app)/settings/notifications`.
- **Settings:** `app/(app)/settings/notifications.tsx` — shows `pushEnabled`/`emailEnabled` Switches for `task_reminder`, permission status with `Linking.openSettings()` and `Refresh status`, hint box explaining `Push`/`Email`/`Both`.
- **Reminder composer:** `app/(app)/tasks/[id].tsx` adds `reminderDeliveryMode` state (`email` default) with `GlassPill` selector `Push`/`Email`/`Both`, contextual permission hint when `push`/`both` + `permissionStatus !== 'granted'` (alert + `Enable notifications` → `requestPermissionAndRegister` → `Linking.openSettings`), `Schedule reminder` button now passes `deliveryMode`, pending/history lists show `deliveryMode` (`Push`/`Push + Email`/`Email`) instead of hardcoded `Email`.

All UI reuses `mobileTheme.colors.background/surface/accent` glass primitives; no second design system, no extra bottom tab, no filters.

## 11. Push Content / Privacy

- `title: "Task reminder"`, `body: task title` (≤500 chars, no description/notes/secrets), `data: {notificationId, type, targetType, targetId}` (all strings).
- FCM `data` values already string-constrained; `notification` carries title/body for lock-screen.

## 12. Retry / Failure Behavior

- `transient` (429, 5xx, `UNAVAILABLE`) → `retry_scheduled` with `nextRetryAt` (1m,2m,4m,8m,16m) until `attemptCount > 5` → `failed`.
- `invalid_endpoint` (`UNREGISTERED`, `INVALID_ARGUMENT`) → `invalid_endpoint`, `is_active=false`, `invalidated_at=now()`, other devices unaffected.
- `auth`/`permanent` → `failed` with `failedAt`, surfaced in cron result.
- `provider_accepted` never called `delivered`; `read_at`/`opened_at` remain separate.

## 13. External Configuration (still required)

**Android client (`apps/mobile`):**
- Firebase project with `google-services.json` for `com.ega_house.mobile` placed via Expo config (official `expo`/`firebase` convention). No fake config committed; build proceeds without it but `getFcmDeviceTokenAsync` will return null until provided. Verify package name matches `app.json` `android.package`.

**Server (`apps/server` / `apps/web` cron):**
- `FCM_SERVICE_ACCOUNT_JSON` (JSON string with `project_id, client_email, private_key`) **or** `FCM_PROJECT_ID` + `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY` (with `\n` stored as `\\n`; code normalizes). Never log private key or token. Never expose to mobile.
- `RESEND_API_KEY` + `EMAIL_FROM` (and `DAILY_ASSISTANT_EMAIL` for legacy, but cron no longer needs `EGA_OWNER_USER_ID`).
- `CRON_SECRET` for cron bearer, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` for service client.
- Optional: `EXPO_PUBLIC_API_BASE_URL` for mobile to point at Hono server (defaults to `https://www.egawilldoit.online` / `https://ega-server-production.up.railway.app` fallback).

## 14. Migration

- Created `drizzle/0045_notification_subsystem.sql` + `drizzle/meta/_journal.json` entry `0045_notification_subsystem` (when `1787600000000`).
- **NOT applied** to production. Controlled `drizzle-kit migrate` (or `supabase db push`) required after review, with pre-flight `SELECT` for duplicate `installation_id` or `owner_user_id` conflicts if any.

## 15. Verification Checklist (later explicit phase)

- controlled `0045` migrate on staging → prod
- deploy backend (Hono + web cron) with FCM env
- `eas` **not** used; build release APK via Blacksmith `mobile-delivery` (`gh workflow` or `scripts/ci/mobile-delivery`)
- install on real Android device (package `com.ega_house.mobile`)
- login, grant notification permission contextually via reminder composer, verify `POST /api/notifications/devices` with RPC claim
- schedule reminder with `Push` / `Tomorrow 09:00` → `POST /api/tasks/:id/reminders {remindAt, deliveryMode:'push'}`
- close app, wait until `remind_at` passes, trigger cron `POST /api/cron/task-reminders` with `Authorization: Bearer $CRON_SECRET`, verify response `{due, deliveries}` and DB `notifications` + `notification_deliveries: provider_accepted`
- verify system notification appears (title `Task reminder`, body task title, no extras), tap → app opens → `opened_at`/`read_at` set → exact task detail via `target.ts`
- inspect delivery states: `provider_accepted` (not `delivered`), invalid token → `invalid_endpoint` + device `is_active=false`
- second cron run for same `remind_at` → no duplicate notification/delivery (idempotency)
- logout + login as different user on same installation → RPC reassigns, old user cannot push to that active token

## 16. Out of Scope / YAGNI

No `eas.json`, no `ExpoPushToken`, no `EAS Build/Submit/Update`, no iOS/APNs, no web push, no quiet hours, no daily briefing, no goal/timer/review notifications, no rich actions, no analytics platform, no Kafka/Redis/broker, no microservices.

Adding a future `timer` notification is `createNotification({type:'timer', ...})` plus delivery; adding APNs is a new `ApnsPushProvider` behind the same `PushProvider` port.

## 17. Library Choice

- Chose `google-auth-library` + raw FCM HTTP v1 over `firebase-admin`: smaller server bundle (no full Admin SDK), standard Google auth, explicit `JWT` scope `https://www.googleapis.com/auth/firebase.messaging`, fetch-native, no hand-rolled JWT. Documented in `FcmPushProvider` header.

## 18. Security

- No service-account JSON, private key, or FCM token is logged, committed, or echoed to mobile beyond `installationId`/`isActive`.
- No `getExpoPushTokenAsync` usage.
- RLS `FORCE` + owner policies on all four tables; cron uses service-role only for narrow due/delivery processing, not for normal mobile CRUD.
- No caller-supplied `ownerUserId` anywhere; all ownership derives from `auth.uid()` or verified bearer.

