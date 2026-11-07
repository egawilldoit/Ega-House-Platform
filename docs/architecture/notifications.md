# Notifications Subsystem V1 — Architecture & Runtime

**Status:** Implemented in the current repository (migration and real-device
push remain externally unverified). Last updated 2026-11-07 (PWA-18 / #347:
canonical event taxonomy, target allowlist, quiet hours, suppressed deliveries,
finance copy privacy). Earlier sections remain historical V1 context.

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

## 2. Data Model (migrations 0045 + 0079)

`0079_notification_events_policy.sql` widens the canonical type/target/preference
check constraints, adds `suppressed` to the delivery status check, and adds
owner-scoped `notification_settings`. The historical `0045` coalesce delivery
index is mirrored in `src/db/schema.ts` (schema parity; it is not re-added in
SQL).

**New tables (all RLS + FORCE RLS, owner-scoped policies `owner_user_id = auth.uid()`):**

- `notifications`
  - `id, owner_user_id, type (bounded taxonomy above), title, body, target_type (bounded allowlist|null), target_id, idempotency_key, read_at, opened_at, created_at, updated_at`
  - `unique(owner_user_id, idempotency_key)`, `index(owner_user_id, created_at desc)`, partial index `where read_at is null`
- `notification_devices`
  - `id, owner_user_id, installation_id (unique), platform ('android'), provider ('fcm'), provider_token, is_active, last_seen_at, invalidated_at`
  - `unique(installation_id)`, index `owner+is_active where is_active`
- `notification_deliveries`
  - `id, notification_id FK cascade, owner_user_id, channel ('push'|'email'), device_id FK set null, provider ('fcm'|'resend'), status ('queued'|'sending'|'provider_accepted'|'retry_scheduled'|'invalid_endpoint'|'failed'|'suppressed'), attempt_count, next_attempt_at, last_error_*, provider_message_id, provider_accepted_at, failed_at`
  - `unique(notification_id, channel, device_id)` + coalesce unique index for email dedupe (`device_id is null`), index `(status, next_attempt_at)`
- `notification_preferences`
  - `id, owner_user_id, notification_type (bounded taxonomy), push_enabled, email_enabled`
  - `unique(owner_user_id, notification_type)`
- `notification_settings` (0079)
  - `owner_user_id PK default auth.uid(), quiet_hours_enabled bool not null default false, quiet_hours_start varchar(5) not null default '22:00', quiet_hours_end varchar(5) not null default '07:00', created_at, updated_at`
  - `HH:MM` check constraints, RLS ENABLE + FORCE, owner select/insert/update policies, grants to `authenticated`; no service-role CRUD shortcut.


**Evolved `task_reminders`:**
- Added `delivery_mode ('push'|'email'|'both') default 'email'`, `processed_at`, `processing_error`, check constraint, index `(status, remind_at) where pending`.
- Existing `channel`/`status`/`sent_at` retained for backward compat; `status` now represents scheduling intent (`pending`/`processing`/`processed`/`failed`/`cancelled`), not per-device result.

**Device ownership safety:**
- `claim_notification_device(p_installation_id, p_platform, p_provider, p_provider_token)` is `SECURITY DEFINER` but derives `auth.uid()` internally, never accepts `owner_user_id`. Atomically deactivates any other active row with same `provider_token` for a different owner, then `INSERT ... ON CONFLICT (installation_id) DO UPDATE` to claim. Granted only to `authenticated`. No caller can make a token active for two users.

## 3. Contracts

`packages/contracts/src/notifications.ts`:
- **Event taxonomy (bounded):** `task_reminder`, `task_comment_mention`,
  `timer_state_change`, `routine_reminder`, `money_threshold`, `daily_review`,
  `weekly_review`, `job_search_reminder`.
- **Target types (bounded):** `task`, `timer`, `routine`, `money`, `review`,
  `today`. `review` and `today` are singletons whose `id` is `null`; entity
  targets (`task`/`timer`/`routine`/`money`) require a non-empty id. Targets are
  semantic values, never router paths.
- `NotificationDeliveryMode = 'push'|'email'|'both'`, `NotificationChannel`,
  `NotificationProvider`, `NotificationPlatform`.
- **Delivery status (bounded):** `queued`, `sending`, `provider_accepted`,
  `retry_scheduled`, `invalid_endpoint`, `failed`, `suppressed`.
- `Notification`, `NotificationTarget`, `NotificationListResponse`,
  `NotificationUnreadCountResponse`, `RegisterNotificationDeviceInput`,
  `NotificationPreferences`, `UpdateNotificationPreferencesInput`,
  `NotificationSettings` / `UpdateNotificationSettingsInput` (owner quiet
  hours), `MarkNotification*Response`, `PushNotificationPayload` (typed data
  payload with `notificationId, type, targetType, targetId` only, no secrets,
  amounts, merchants, or raw routes).

`CreateTaskReminderInput` optionally carries `deliveryMode`; omitting it
defaults to `email` for backward compat.

## 3a. Event identity vs delivery identity

- **Event identity** is per owner: `idempotency_key = ${type}:${eventId}` built
  by `buildNotificationEventKey`. A duplicate producer trigger resolves to the
  same `notifications` row (`unique(owner_user_id, idempotency_key)`).
- **Delivery identity** is per event/channel/endpoint:
  `unique(notification_id, channel, device_id)` plus a coalesced unique index
  for null `device_id` (email). A duplicate trigger cannot fan out duplicate
  logical deliveries.
- Repository `createNotification` returns `{ notification, created }` and
  `createDeliveries` returns `{ created, existing }`, so orchestration counts
  are based on a real created/replayed signal rather than heuristics.

## 3b. Delivery policy table

`packages/application/src/notifications/policy.ts` owns one authoritative table
per event type:

| Type | Category | Critical | Privacy | Quiet hours |
|---|---|---|---|---|
| `task_reminder` | task | no | standard | suppress |
| `task_comment_mention` | task | **yes** (direct mention bypasses quiet hours) | standard | bypass |
| `timer_state_change` | timer | no | standard | suppress |
| `routine_reminder` | routine | no | standard | suppress |
| `money_threshold` | money | no | **private_finance** | suppress |
| `daily_review` | review | no | standard | suppress |
| `weekly_review` | review | no | standard | suppress |
| `job_search_reminder` | job_search | no | standard | suppress |

Policy helpers:
- `isWithinQuietHours({ now, timezone, start, end })` — same-day and overnight
  windows, owner IANA timezone wall-clock via `Intl` (DST-safe). Invalid /
  missing timezone or malformed `HH:MM` returns `false` (do **not** suppress);
  server local time is never guessed.
- `sanitizeNotificationCopy(type, title, body)` — `private_finance` events
  discard caller copy and use fixed generic title/body so lock screens cannot
  leak amounts, merchants, accounts, or free text. Standard copy is trimmed and
  capped (title 200, body 500).
- `normalizeNotificationTarget(type, id)` — bounded allowlist; unknown types,
  blank entity ids, and path-like ids are rejected; singletons stay id-less.
- `buildNotificationEventKey(type, eventId)` — stable bounded event identity.
- `isTerminalDeliveryStatus(status)` — `provider_accepted`, `invalid_endpoint`,
  `failed`, `suppressed` are terminal; `queued`/`sending`/`retry_scheduled` are
  not.

## 4. Application Layer

`packages/application/src/notifications/`:
- `ports.ts` — repository ports (`NotificationRepository`, `NotificationDeviceRepository`, `NotificationDeliveryRepository`, `NotificationPreferenceRepository`, `NotificationSettingsRepository`, `TaskReminderIntentRepository`) + provider ports (`PushProvider`, `EmailProvider`, `EmailDestinationResolver`).
- `delivery.ts` — pure functions: `resolveDeliveryChannels(deliveryMode, preferences)`, `nextRetryAt(attempt)` (exponential 1m,2m,4m,8m,16m, max 5), `classifyFcmError(httpStatus, fcmCode)` → `invalid_endpoint`|`transient`|`permanent`|`auth`, `shouldDeactivateDevice`, `buildPushDataPayload`.
- `policy.ts` — the canonical taxonomy/copy/target/quiet-hours policy above.
- `service.ts` — use cases: `createNotification` (returns created vs replayed), `listNotifications`, `getUnreadCount`, `markRead`/`Opened`/`AllRead`, `get/updatePreferences`, `get/updateNotificationSettings`, `register/claimDevice`/`unregisterDevice`, `processDueTaskReminders`, `processPendingNotificationDeliveries`.

No transport, Supabase, or FCM details leak into application. Owner timezone
remains the existing shared Time Context authority
(`packages/application/src/shared/time-context.ts` + data-access
`user_time_context`); quiet hours do not create a second timezone store.

**Orchestration semantics:**
- Due reminders use the real `created` signal. A replay can repair missing
  delivery rows but never double-counts events/deliveries.
- Reminder intent is marked processed only after the event and deliveries are
  durable.
- At queue time, a noncritical event inside owner quiet hours creates
  `notification_deliveries` rows as `status='suppressed'`,
  `last_error_code='quiet_hours'`, no `next_attempt_at`, and no provider call.
  This is a recorded terminal result, **not** a deferred queue.
- A disabled channel preference prevents a delivery row from being created; the
  canonical inbox notification may still exist with zero deliveries.
- Dispatch re-checks current opt-out and quiet hours before calling a provider;
  an affected delivery becomes `suppressed` (`opt_out` / `quiet_hours`).
- Read failures fail closed at the authoritative dispatch boundary:
  - queue time: a **preference** read failure leaves the intent retryable with
    no event/delivery fan-out; a **device** read failure also leaves it
    retryable so push is never silently dropped; a **quiet-hours/
    time-context** read failure still creates the canonical event and queued
    (non-suppressed) deliveries, bounded by dispatch.
  - dispatch: any preference/settings/time-context/notification read failure
    calls no provider and records explicit `retry_scheduled`
    (`preferences_unavailable`, `quiet_hours_unavailable`,
    `notification_unavailable`), then `failed` after the bounded retry budget.
    A failed deferral write is reported as a persistence error and remains
    reclaimable by the stale-`sending` lease.
  - A missing preference row keeps the legacy enabled default; a missing/invalid
    owner timezone or invalid `HH:MM` keeps the documented no-suppress default
    (configuration states, not read failures). A missing
    `notification_settings` table (0079 not applied) degrades to legacy
    quiet-hours-disabled behavior.
- Event keys must use the canonical `${type}:` prefix; outer whitespace is
  trimmed before persistence and a mismatched type prefix is rejected.
- Entity target ids must be UUIDs (the `target_id` column is `uuid`); invalid
  ids degrade to no target instead of reaching Postgres with `22P02`.


## 5. Data Access / Providers

`packages/data-access/src/notifications/`:
- `repository.ts` — Supabase adapters for all repositories including
  `SupabaseNotificationSettingsRepository`; idempotent `createNotification`
  returns `{ notification, created }` on insert vs 23505 replay;
  `createDeliveries` persists queued/suppressed rows and returns
  `{ created, existing }`; `listPending` filters `queued`/`retry_scheduled`
  where due plus stale `sending` leases and never returns `suppressed`.
- `fcm-provider.ts` — `FcmPushProvider` using `google-auth-library` JWT (no hand-rolled crypto), FCM HTTP v1 `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`, payload `token, notification.title/body, data {notificationId, type, targetType, targetId}, android.priority=HIGH`. Never logs token or private key. Returns `providerMessageId` on 200; classifies `UNREGISTERED`/`INVALID_ARGUMENT` → `invalid_endpoint` (deactivates device), 429/5xx/`UNAVAILABLE` → `retry_scheduled`, 401/403 → `failed` with `auth` code. Uses `resolveFcmServiceAccountFromEnv` reading `FCM_SERVICE_ACCOUNT_JSON` or `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` (with `\\n` → `\n` normalization).
- `email-provider.ts` — `ResendEmailProvider` and `SupabaseEmailResolver` (best-effort lookup via `profiles` or `auth.getUser`).

## 6. Server API (Hono)

`apps/server/src/routes/notifications.ts` mounted at `/api/notifications`:
- `GET /` — list with `?limit&cursor` (cursor = `created_at`), returns `NotificationListResponse` with typed targets (no raw routes).
- `GET /unread-count`
- `PATCH /:id/read`, `PATCH /:id/opened`, `POST /read-all`
- `POST /devices` — body `RegisterNotificationDeviceInput` (validates `android`/`fcm`), returns `device {id, installationId, platform, provider, isActive}` without echoing token.
- `DELETE /devices/:installationId`
- `GET /preferences`, `PATCH /preferences` (single object `{notificationType, pushEnabled?, emailEnabled?}`; bounded known type).
- `GET /settings`, `PATCH /settings` — owner quiet hours (`quietHoursEnabled`, `quietHoursStart` `HH:MM`, `quietHoursEnd` `HH:MM`). Owner is derived from the verified bearer token; request-scoped Supabase only.

All routes derive `actor` from verified bearer token, use request-scoped Supabase client, return `@ega/contracts` DTOs, and remain thin. Notification list/read/opened responses map the bounded target allowlist; unknown target types are dropped, and singleton targets (`review`/`today`) carry `id: null`. No caller-supplied `ownerUserId` is accepted.

## 7. API Client

`packages/api-client/src/notifications.ts` — typed `NotificationsApi` with methods mirroring server (including `settings()` / `updateSettings()`); composed into `createEgaApiClient().notifications`. Tests assert path/method/body/contract decoding; no React Query or Expo logic.

## 8. Mobile Native Layer

- `expo-notifications@~0.32.17` and `expo-crypto@~15.0.9` are installed via `npx expo install` (SDK 54 compatible). The repository contains minimal `apps/mobile/eas.json` CLI metadata, but no EAS Build/Submit/Update workflow or `ExpoPushToken` path.
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
- Runs `processDueTaskReminders` (find due `pending` reminders, claim via `UPDATE ... WHERE status='pending'`, create idempotent event `task_reminder:<id>`, resolve channels via `resolveDeliveryChannels` (mode + per-type preferences), apply current owner quiet hours, create per-device push or per-email deliveries via `createDeliveries` (`suppressed` rows when quiet; idempotent unique; created vs existing), `markProcessed` only after durability), then `processPendingNotificationDeliveries` (load `queued`/`retry_scheduled` due, `markSending`, re-check opt-out/quiet hours, call provider, classify, update `provider_accepted`|`retry_scheduled` with `nextRetryAt`|`invalid_endpoint` (deactivate device)|`failed`|`suppressed`, bounded 5 attempts).
- Composition now includes `SupabaseNotificationSettingsRepository` and the existing `SupabaseTimeContextRepository`; no second timezone store.
- No longer uses `EGA_OWNER_USER_ID`; handles all owners. No business rules in the route.

## 10. Mobile UI

- **Today header bell:** `app/(app)/(tabs)/today.tsx` imports `useUnreadCountQuery` and renders `NotificationBell` (Pressable with `notifications-outline` + badge `danger` when `unreadCount>0`, caps at `99+`) alongside Search, pushing to `/(app)/notifications`.
- **Notification center:** `app/(app)/notifications.tsx` — `SectionList` grouped `Today`/`Earlier`, `RefreshControl`, empty/loading/error states using `mobileTheme`/`GlassCard`/`GlassButton`, each item shows icon, title, body, `relativeTime`, unread dot + `itemUnread` styling, `Pressable` → `markOpened` + `notificationTargetToRoute` → `router.push`. `Mark all read` in header when any unread.
- **Profile:** `app/(app)/(tabs)/profile.tsx` adds `Pressable` row `Notifications > Push and email reminders` with `notifications-outline` icon, pushing to `/(app)/settings/notifications`.
- **Settings:** `app/(app)/settings/notifications.tsx` — shows `pushEnabled`/`emailEnabled` Switches for `task_reminder`, permission status with `Linking.openSettings()` and `Refresh status`, hint box explaining `Push`/`Email`/`Both`.
- **Reminder composer:** `app/(app)/tasks/[id].tsx` adds `reminderDeliveryMode` state (`email` default) with `GlassPill` selector `Push`/`Email`/`Both`, contextual permission hint when `push`/`both` + `permissionStatus !== 'granted'` (alert + `Enable notifications` → `requestPermissionAndRegister` → `Linking.openSettings`), `Schedule reminder` button now passes `deliveryMode`, pending/history lists show `deliveryMode` (`Push`/`Push + Email`/`Email`) instead of hardcoded `Email`.

All UI reuses `mobileTheme.colors.background/surface/accent` glass primitives; no second design system, no extra bottom tab, no filters.

## 11. Push Content / Privacy

- Standard `task_reminder`: `title: "Task reminder"`, `body: task title` (≤500 chars, no description/notes/secrets), `data: {notificationId, type, targetType, targetId}` (all strings).
- `money_threshold` (`private_finance`): title/body are forced generic (`Finance update` / `Open EGA House to review your finance update.`); caller amounts, merchants, account endings, and free text are discarded before persistence, so neither lock-screen text nor FCM data can leak them.
- `task_comment_mention` is critical and bypasses quiet hours.
- FCM `data` values already string-constrained; `notification` carries only the sanitized title/body for the lock screen.

## 12. Retry / Failure Behavior

- `transient` (408, 429, 5xx, `UNAVAILABLE`, `INTERNAL`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `ABORTED`) → `retry_scheduled` with `nextRetryAt` (1m,2m,4m,8m,16m) until `attemptCount > 5` → `failed`.
- `invalid_endpoint` (HTTP 404/410, `UNREGISTERED`, `INVALID_ARGUMENT`, `INVALID_TOKEN`, `REGISTRATION_TOKEN_NOT_REGISTERED`, `SENDER_ID_MISMATCH`, `NOT_FOUND`) → `invalid_endpoint`, device deactivated, no retry.
- `auth` (401/403/`UNAUTHENTICATED`/`PERMISSION_DENIED`) and other permanent 4xx → `failed` with `failedAt`, surfaced in cron result.
- `suppressed` is a terminal recorded result for opt-out/quiet hours; it is never picked by `listPending` and is not a deferred queue.
- `provider_accepted` never called `delivered`; `read_at`/`opened_at` remain separate. At-least-once semantics remain: provider acceptance is not exactly-once delivery or user-read proof.

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
- Added `drizzle/0079_notification_events_policy.sql` + journal idx `79` (`0079_notification_events_policy`): widens notification/preference type checks and target allowlist, adds `suppressed`, creates owner-scoped `notification_settings` (RLS + FORCE + HH:MM checks).
- **Migration sequencing note:** Track C (#346) owns the initial new expense migration if it lands; this branch-local `0079` must be re-sequenced/reconciled with Track C before any future merge. It is not applied to any shared/production/DEV database. Only a disposable local DB was used for constraint/RLS proof.
- **Rollout rule:** apply `0079` before/with enabling the fail-closed reminder cron. If that order is violated, `SupabaseNotificationSettingsRepository.getSettings` recognizes a missing `notification_settings` table (`42P01`, `PGRST205`, "does not exist"/"schema cache"/"could not find") and returns "no settings row", so quiet hours degrade to legacy disabled behavior instead of stalling every reminder. Other settings read errors remain failures and are retried/failed at dispatch.
- **Event-key rollout:** the legacy V1 key was `task-reminder:<reminderId>`; the canonical key is `task_reminder:<reminderId>`. There is no second key format or legacy-key lookup. If old code/`0045` are already live and a reminder is replayed across the upgrade (crash between event creation and intent `processed`), a one-time duplicate event/delivery fan-out is possible. Recommended order: apply `0079`, deploy this code, then replay/recover any crash-window reminders; normal processed reminders are unaffected.
- **NOT applied** to production. Controlled `drizzle-kit migrate` (or `supabase db push`) required after review, with pre-flight duplicate checks if any.

## 15. Verification Checklist (later explicit phase)

- controlled `0045` migrate on staging → prod
- deploy backend (Hono + web cron) with FCM env
- EAS Build/Submit/Update is **not** used; build the release APK via Blacksmith `mobile-delivery` (`gh workflow` or `scripts/ci/mobile-delivery`). `apps/mobile/eas.json` is CLI metadata only.
- install on real Android device (package `com.ega_house.mobile`)
- login, grant notification permission contextually via reminder composer, verify `POST /api/notifications/devices` with RPC claim
- schedule reminder with `Push` / `Tomorrow 09:00` → `POST /api/tasks/:id/reminders {remindAt, deliveryMode:'push'}`
- close app, wait until `remind_at` passes, trigger cron `POST /api/cron/task-reminders` with `Authorization: Bearer $CRON_SECRET`, verify response `{due, deliveries}` and DB `notifications` + `notification_deliveries: provider_accepted`
- verify system notification appears (title `Task reminder`, body task title, no extras), tap → app opens → `opened_at`/`read_at` set → exact task detail via `target.ts`
- inspect delivery states: `provider_accepted` (not `delivered`), invalid token → `invalid_endpoint` + device `is_active=false`
- second cron run for same `remind_at` → no duplicate notification/delivery (idempotency)
- logout + login as different user on same installation → RPC reassigns, old user cannot push to that active token

## 16. Out of Scope / YAGNI

No `ExpoPushToken`, no EAS Build/Submit/Update, no iOS/APNs, no web push/PWA
PushSubscription/VAPID/service-worker delivery (#354), no timer logic (#355), no
Today redesign (#344), no notification-center redesign (#357), no rich actions,
no analytics platform, no Kafka/Redis/broker, no microservices.

The taxonomy includes future event types (`timer_state_change`,
`routine_reminder`, `money_threshold`, `daily_review`, `weekly_review`,
`job_search_reminder`) so contracts/schema are stable, but **this baseline adds
producers only for source features that actually exist**: task reminders
(`processDueTaskReminders`). Direct mentions (`task_comment_mention`) exist only
as taxonomy/policy (`critical`, quiet-hours bypass) and have **no producer** on
this baseline. There is no expense ledger, routine store, daily check-in store,
or per-owner review/job-search producer, so none is invented here. The legacy
weekly-review single-owner email cron is not claimed as a per-owner
notification producer.

Adding APNs later is a new `ApnsPushProvider` behind the same `PushProvider`
port.

## 17. Library Choice

- Chose `google-auth-library` + raw FCM HTTP v1 over `firebase-admin`: smaller server bundle (no full Admin SDK), standard Google auth, explicit `JWT` scope `https://www.googleapis.com/auth/firebase.messaging`, fetch-native, no hand-rolled JWT. Documented in `FcmPushProvider` header.

## 18. Security

- No service-account JSON, private key, or FCM token is logged, committed, or echoed to mobile beyond `installationId`/`isActive`.
- No `getExpoPushTokenAsync` usage.
- RLS `FORCE` + owner policies on all five tables (notifications, devices, deliveries, preferences, settings); cron uses service-role only for narrow due/delivery processing, not for normal mobile CRUD. `notification_settings` has no service-role CRUD shortcut.
- No caller-supplied `ownerUserId` anywhere; all ownership derives from `auth.uid()` or verified bearer.
- Private finance copy is sanitized before persistence; FCM data carries only ids/type/target.

## 19. PWA-18 / #347 — current evidence and unverified gaps

**Observed (repository evidence in this worktree):**
- Contracts/application/data-access/api-client/server notification checks pass;
  application orchestration covers fail-closed dispatch reads, queue-time
  availability, canonical event keys, and canonical target/copy policy.
- Disposable local PostgreSQL 18 proof applied `0045` + `0079` and verified:
  owner A/B select/update isolation on notifications; duplicate
  `(owner, idempotency_key)` rejection; duplicate channel/device delivery
  rejection (including the null-device coalesce key); `suppressed` accepted and
  invalid status rejected; taxonomy target/preference constraint rejection;
  `notification_settings` owner isolation (insert/select/update) and invalid
  `HH:MM` rejection. The disposable DB was dropped afterward.
- Suffix environment notes (not repository-wide proof):
  - `mobile:typecheck`/`mobile:test` pass only after a clean lockfile `npm ci`;
    dependency drift in a reused `node_modules` can surface untouched-file
    `jest-expo`/`react-native` export-map failures.
  - Full `web:test`/`server:test` retain unrelated Windows failures (timezone
    and CRLF assertions, relative-URL fetch, `spawn EINVAL`) reproduced on base
    `b3f367cc`. Hosted CI conclusions are reported in the PR, not claimed here.

**Not verified / gaps:**
- Real FCM/Android device delivery and real Resend email delivery.
- Deployment/DEV RLS and migration application: `0079` is repository-only and
  not applied to any shared database.
- Authenticated web/mobile end-to-end flow for quiet-hours settings (no
  authorized controlled credentials/DB in this environment).
- Track C (#346) migration-sequencing reconciliation before any merge.
- Web test suite has unrelated pre-existing failures in this Windows
  environment (timezone/CRLF); see the PR report.
- Adapter-level `SupabaseNotificationRepository.createNotification` replay,
  partial `createDeliveries`, and real `listPending` SQL behavior are evidenced
  by the disposable-DB unique constraints plus application fakes; there is no
  real Supabase-client adapter test in this worktree.
