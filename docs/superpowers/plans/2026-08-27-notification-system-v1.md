# Notification System V1 — Implementation Plan

**Branch:** `feat/notification-system-v1`  
**Worktree:** `.worktrees/notification-system-v1`  
**Base:** `origin/main@147a84b` (2026-08-27)  
**Spec date:** 2026-08-27

## 0. Repository Truth Verification (pre-implementation)

### Instruction chain
- Root `AGENTS.md` + `apps/server/AGENTS.md` + `apps/mobile/AGENTS.md` + `packages/AGENTS.md` + `ARCHITECTURE.md` + `CONTEXT.md` + `docs/architecture/platform-monorepo.md` + `docs/agent-context/decision-log.md` + `docs/agent-context/testing-and-validation.md` read and respected. No plan-mode bypass.

### Current main state
- Latest migration is `0044_task_sessions_owner_open_unique.sql` → next migration is `0045`.
- `src/db/schema.ts` owns `task_reminders` with fields `id, owner_user_id, task_id, remind_at, channel='email', status='pending'|'processing'|'sent'|'failed'|'cancelled', sent_at, failure_reason, created_at, updated_at`. No notification tables yet.
- `apps/web/src/app/api/cron/task-reminders/route.ts` delegates to `apps/web/src/lib/services/task-reminder-delivery-service.ts` which implements `deliverTaskReminderEmails` (claim pending email reminders, send via Resend, mark sent/failed). Uses `EGA_OWNER_USER_ID` single-owner model — will be replaced.
- Mobile reminder UX lives in `apps/mobile/app/(app)/tasks/[id].tsx` + `apps/mobile/features/tasks/query.ts` + `apps/mobile/lib/api/tasks.ts` → `POST /api/tasks/:id/reminders` and `PATCH` cancel. Hardcodes `channel=email`.
- Server tasks routes in `apps/server/src/routes/tasks.ts` expose `POST /:id/reminders` and `PATCH /:id/reminders/:reminderId` via `createTaskReminder` / `cancelTaskReminder` in `@ega/application/tasks/service.ts` → `SupabaseTasksRepository`.
- Resend consumers: `apps/web/src/lib/email/resend.ts`, `task-reminder-delivery-service.ts`, `weekly-review-email-service.ts`, `daily-email` cron. Only task-reminder path is in scope; daily/weekly remain untouched.
- Mobile auth: `lib/auth/auth-context.tsx` owns session bundle, `lib/api/client.ts` configures `configureMobileApiClient`, storage via `expo-secure-store`. Root layout is `MobileQueryProvider → AuthProvider → ThemeProvider → Stack`.
- Mobile config: `app.json` package `com.ega_house.mobile`, no `expo-notifications` yet, no `eas.json` (must stay absent per zero-EAS policy).
- Server composition: `apps/server/src/app.ts` authenticates via Bearer token → `createAuthenticatedActorFromIdentity` → request-scoped Supabase client. Mounts `/api/projects`, `/api/goals`, `/api/tasks`, `/api/today`, `/api/timer`, `/api/auth`.
- Packages: `@ega/contracts` exports `mobile.ts`, `agent.ts`, `common/task-list`; `@ega/application` owns `tasks/service.ts`, `tasks/ports.ts`, etc.; `@ega/data-access` has `tasks/repository.ts` with request-scoped Supabase; `@ega/api-client` is typed HTTP client without UI state.
- Env conventions: `DATABASE_URL`, Supabase `url`/`anonKey` via `apps/server/src/env.ts` (`getSupabaseEnv`), Resend via `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` via `apps/web/src/lib/cron/route-runtime.ts`. Server push secrets will follow same pattern: `FCM_*` or `GOOGLE_*` (decision in Wave 2).

### Open risks noted
- Single-owner `EGA_OWNER_USER_ID` must not become notification architecture.
- FCM token must never be logged; provider auth must use Google auth library, not hand-rolled JWT.
- Device ownership requires auth-derived RPC/function, not caller-supplied `ownerUserId`.

## 1. Architecture to Implement

```
Source/Intent → Canonical Notification → Delivery Policy → Push|Email → Provider → FCM HTTP v1 / Resend
```

- `Reminder` = scheduling intent (`task_reminders` evolved).
- `Notification` = canonical user-facing event (`notifications`).
- `Delivery` = per-channel/endpoint projection (`notification_deliveries`).
- `Provider` = external infra (`FcmPushProvider`, `ResendEmailProvider`).

Dependency direction preserved:

```
apps/web ─┐
          ├─> application ─> domain/contracts
apps/server┘          │
                      └─> repository ports ─> data-access
mobile ─> api-client ─> contracts ─> apps/server
```

## 2. Data Model (Wave 1 — migration 0045)

**New tables (all `owner_user_id uuid NOT NULL default auth.uid()` where applicable):**

- `notifications`
  - `id uuid pk default gen_random_uuid()`
  - `owner_user_id uuid not null`
  - `type varchar(32) not null check in ('task_reminder')` (extensible enum)
  - `title text not null`
  - `body text`
  - `target_type varchar(32) null check in ('task')`
  - `target_id uuid null`
  - `idempotency_key text not null`
  - `read_at timestamptz null`
  - `opened_at timestamptz null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - Unique: `(owner_user_id, idempotency_key)`
  - Indexes: `(owner_user_id, created_at desc)`, partial `where read_at is null`

- `notification_devices`
  - `id uuid pk`
  - `owner_user_id uuid not null`
  - `installation_id text not null` (client-generated UUID, stable per app install)
  - `platform varchar(16) not null check in ('android')`
  - `provider varchar(16) not null check in ('fcm')`
  - `provider_token text not null` (FCM registration token)
  - `is_active boolean not null default true`
  - `last_seen_at timestamptz not null default now()`
  - `invalidated_at timestamptz null`
  - `created_at/updated_at timestamptz not null default now()`
  - Unique: `(installation_id)` + unique active endpoint constraint handled via RPC; indexes on `owner_user_id`, `provider_token`
  - RLS: owner-scoped select/update via `auth.uid()`

- `notification_deliveries`
  - `id uuid pk`
  - `notification_id uuid not null references notifications(id) on delete cascade`
  - `owner_user_id uuid not null`
  - `channel varchar(16) not null check in ('push','email')`
  - `device_id uuid null references notification_devices(id) on delete set null` (null for email)
  - `provider varchar(16) not null check in ('fcm','resend')`
  - `status varchar(32) not null check in ('queued','sending','provider_accepted','retry_scheduled','invalid_endpoint','failed')`
  - `provider_message_id text null`
  - `attempt_count integer not null default 0`
  - `next_attempt_at timestamptz null`
  - `last_error_code text null`
  - `last_error_reason text null`
  - `provider_accepted_at timestamptz null`
  - `failed_at timestamptz null`
  - `created_at/updated_at not null default now()`
  - Unique: `(notification_id, channel, coalesce(device_id, '00000000-0000-0000-0000-000000000000'))` to prevent duplicate per-device delivery; indexes on `(status, next_attempt_at)` for worker.

- `notification_preferences`
  - `id uuid pk`
  - `owner_user_id uuid not null`
  - `notification_type varchar(32) not null check in ('task_reminder')`
  - `push_enabled boolean not null default true`
  - `email_enabled boolean not null default true`
  - `created_at/updated_at not null default now()`
  - Unique: `(owner_user_id, notification_type)`

**Device ownership safety:**
- SQL function `claim_notification_device(p_installation_id text, p_platform text, p_provider text, p_provider_token text)` with `SECURITY DEFINER` but `auth.uid()` derived, atomic `INSERT ... ON CONFLICT (installation_id) DO UPDATE` which reassigns `owner_user_id = auth.uid()`, deactivates any other active row with same `provider_token` for different owner, sets `is_active=true`, `last_seen_at=now()`. Returns device row. Revoke public execute from anon, grant to authenticated. No caller-supplied owner param.
- Additional trigger/function to ensure single active owner per token: `unique index where is_active` on `(provider_token) where is_active = true` is insufficient when token rotates; instead enforce via function + partial unique. Also add row-level policy that only owner can select.

**Evolve `task_reminders`:**
- Add `delivery_mode varchar(16) not null default 'email' check in ('push','email','both')`
- Add `processed_at timestamptz null`
- Add `processing_error text null`
- Keep `remind_at`, `status`, `sent_at`, `failure_reason` for backward compat but deprecate `status` as scheduling status only (`pending|processing|processed|cancelled|failed`), not per-channel delivery. Migration will backfill `delivery_mode='email'` for existing rows.
- Add index `(status, remind_at) where status='pending'`

Migration is **created but NOT applied** to production in this task.

## 3. Contracts (Wave 1)

File: `packages/contracts/src/notifications.ts`
- `NotificationType = 'task_reminder'`
- `NotificationTargetType = 'task'`
- `NotificationTarget = { type: NotificationTargetType, id: string }`
- `Notification = { id, type, title, body, target: NotificationTarget|null, readAt, openedAt, createdAt, updatedAt }`
- `NotificationListResponse = { ok:true, notifications: Notification[], nextCursor?: string }`
- `NotificationUnreadCountResponse = { ok:true, unreadCount: number }`
- `RegisterNotificationDeviceInput = { installationId, platform:'android', provider:'fcm', providerToken }`
- `UnregisterNotificationDeviceInput = { installationId }`
- `NotificationPreferences = { notificationType, pushEnabled, emailEnabled }`
- `UpdateNotificationPreferencesInput = { notificationType, pushEnabled?, emailEnabled? }`
- Update `CreateTaskReminderInput` to `{ remindAt: string, deliveryMode?: 'push'|'email'|'both' }`

Export via `src/index.ts` and workspace `package.json#exports`.

## 4. Application Layer (Wave 2)

Module: `packages/application/src/notifications/`
- `ports.ts`: `NotificationRepository`, `NotificationDeviceRepository`, `NotificationDeliveryRepository`, `NotificationPreferenceRepository`, `PushProvider`, `EmailProvider`, `EmailDestinationResolver`
- `service.ts`: use cases `listNotifications(actor, pagination)`, `getUnreadCount(actor)`, `markRead(actor, id)`, `markOpened(actor, id)`, `markAllRead(actor)`, `getPreferences(actor)`, `updatePreferences(actor, input)`, `registerDevice(actor, input)` (delegates to data-access RPC), `unregisterDevice(actor, installationId)`, `createNotification(actor, input with idempotencyKey)`, `processDueTaskReminders(adapter bundle)`, `queueDeliveries(notification)`, `processPendingDeliveries(adapter bundle)`
- `delivery.ts` (if justified): pure functions `resolveDeliveryChannels(preferences, reminderDeliveryMode)`, `classifyFcmError(errorCode)`, `nextRetryAt(attempt)`, `shouldDeactivateDevice(classification)`
- FCM provider: `packages/data-access/src/notifications/fcm-provider.ts` implementing `PushProvider` with:
  - `google-auth-library` (`GoogleAuth` with service account JSON path or env vars `FCM_SERVICE_ACCOUNT_JSON` or `FCM_PROJECT_ID`+`FCM_CLIENT_EMAIL`+`FCM_PRIVATE_KEY`)
  - FCM HTTP v1 `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`
  - payload: `message.token = providerToken`, `notification.title/body`, `data: { notificationId, type, targetType, targetId }` (string values only)
  - classify: `UNREGISTERED`/`INVALID_ARGUMENT` → `invalid_endpoint`, 429/5xx/UNAVAILABLE/INTERNAL → `retry_scheduled`, auth failures → `failed`
  - never log token or private key, return `providerMessageId` on 200.

Pre-existing Resend integration stays; add narrow `ResendEmailProvider` behind `EmailProvider` port if not already abstracted, and `SupabaseEmailResolver` for destination.

## 5. Data Access (Wave 2)

- `packages/data-access/src/notifications/repository.ts`: implements all 4 repositories with request-scoped Supabase client, mapping rows↔domain, enforcing idempotency via `onConflict: owner_user_id,idempotency_key do nothing then select`.
- Tests focus on error classification and mapping; live Supabase transport mocked.

## 6. Server API (Wave 3)

Base: `/api/notifications`
- `GET /` → list (cursor `?limit&cursor`)
- `GET /unread-count`
- `PATCH /:id/read` body `{ read: boolean }` or empty → sets `read_at`
- `PATCH /:id/opened` → sets `opened_at` + `read_at` if null
- `POST /read-all` → marks all unread read
- `POST /devices` body `RegisterNotificationDeviceInput`
- `DELETE /devices/:installationId`
- `GET /preferences`
- `PATCH /preferences` body `UpdateNotificationPreferencesInput[]` or single

All routes derive actor from bearer token, use application services, return contracts DTOs. Mount in `apps/server/src/app.ts` via `createNotificationRoutes(dependencies)`.

## 7. API Client (Wave 3)

`packages/api-client/src/notifications.ts` with methods mirroring server; add to `createEgaApiClient` composition. Tests assert path/method/body/decoding.

## 8. Mobile Native Registration (Wave 4)

- `npx expo install expo-notifications expo-crypto` (exact Expo SDK 54 compatible versions)
- `app.json` plugins: `expo-notifications` config, keep `com.ega_house.mobile`
- `apps/mobile/lib/notifications/`:
  - `installation.ts`: `getOrCreateInstallationId()` via SecureStore (`notification_installation_id`), `expo-crypto.randomUUID()` fallback
  - `permissions.ts`: `getPermissionStatus()`, `requestPermissionWithRationale()` (contextual only)
  - `channel.ts`: `ensureAndroidChannel()` with id `task-reminders`, importance MAX, vibration
  - `token.ts`: `getFcmDeviceToken()` via `Notifications.getDevicePushTokenAsync()`, never `getExpoPushTokenAsync`
  - `registration.ts`: `registerDeviceWithServer(installationId, token)` via api-client, `unregisterOnLogout()`, token refresh listener
  - `target.ts`: `notificationTargetToRoute(target)` → `/tasks/[id]` for `task`, fallback `/notifications`
  - `provider.tsx`: `NotificationProvider` wrapping `AuthProvider` child, owns permission state, registration lifecycle, foreground handler (`Notifications.setNotificationHandler`), response/tap listener, cold-start (`getLastNotificationResponseAsync`)
- Integration: confirm `app/_layout.tsx` tree `MobileQueryProvider → AuthProvider → NotificationProvider → ThemeProvider → Stack`; keep order deterministic.
- Logout: best-effort `DELETE /devices/:installationId` before `clearSession`; login: if permission granted, silent register; token rotation via `addPushTokenListener`.

## 9. Task Reminder → Notification Delivery (Wave 5)

- Evolve `packages/application/src/tasks/service.ts` `createTaskReminder` to accept `deliveryMode`.
- New orchestration `processDueTaskReminders`:
  1. `SELECT ... FROM task_reminders WHERE status='pending' AND remind_at <= now() LIMIT 25 FOR UPDATE SKIP LOCKED` equivalent via conditional claim `UPDATE ... SET status='processing' WHERE id=? AND status='pending' RETURNING *`
  2. For each claimed: `createNotification` with `idempotency_key='task-reminder:'||reminder.id`
  3. `queueDeliveries`: resolve preferences + deliveryMode → channels; for push, load active devices → one delivery per device; for email, one delivery
  4. Mark reminder `processed`/`processed_at`
  5. `processPendingDeliveries`: load `queued|retry_scheduled` where `next_attempt_at <= now()` → call provider → update status/attempts, deactivate invalid endpoints
- `apps/web/src/app/api/cron/task-reminders/route.ts` becomes thin: authorize cron, build adapters, `await processDueTaskReminders(...)` + `await processPendingDeliveries(...)`, return counts. Keep Resend path via new orchestration, remove old `deliverTaskReminderEmails` after verification.

## 10. Mobile Notification Center + Settings + Reminder UX (Wave 6)

- Header bell: `apps/mobile/app/(app)/(tabs)/today.tsx` (or shared header) shows `NotificationsBell` with unread badge from `useNotificationUnreadCount()` (React Query polling 30s + on focus).
- Screen `apps/mobile/app/(app)/notifications.tsx`: list grouped by `Today`/`Earlier`, uses existing `mobileTheme.colors`, `Card`/`Text` primitives, empty/loading/error states, tap → `markOpened` + navigate via `target.ts`, swipe/mark read, `Mark all read`.
- Profile: `apps/mobile/app/(app)/(tabs)/profile.tsx` adds `Notifications >` row → `apps/mobile/app/(app)/settings/notifications.tsx` with toggles for `task_reminder` push/email (exposes Push/Email/Both UX but persists as two booleans), shows OS permission status + `Open Settings` via `Linking.openSettings()`.
- Reminder composer: `apps/mobile/app/(app)/tasks/[id].tsx` adds delivery selector `[Push] [Email] [Both]` + contextual permission sheet (`Enable notifications` button if push selected but permission denied).

## 11. Hardening + Documentation (Wave 7)

- Audit idempotency, retries, multi-user isolation, no raw router paths in DB, no ExpoPushToken, no EAS, no secrets, no token logs, correct `provider_accepted` terminology, backward compat, exports.
- Update `ARCHITECTURE.md` only if system map materially changes; add `docs/architecture/notifications.md` or section in platform doc.
- Document env vars (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` with newline normalization), migration `0045` not applied, local setup, Android proof checklist.
- Final local validation per wave spec, **no CI** (`ci:*` excluded), no production DB mutation, no PR/deploy until authorized.

## 12. Out of Scope (explicitly not built)

EAS, Expo Push Service, iOS/APNs, web push, quiet hours, briefings, goals/timers/reviews generic events, rich actions, analytics, Kafka/Redis/broker, microservices, Knock/Novu.

## 13. Sequencing & Commits

1. `docs: add notification system implementation plan` (Wave 0 — this file)
2. `feat(notifications): add contracts and persistence model` (Wave 1)
3. `feat(notifications): add notification orchestration and providers` (Wave 2)
4. `feat(notifications): expose authenticated notification API` (Wave 3)
5. `feat(mobile): add native notification registration and routing` (Wave 4)
6. `feat(notifications): deliver task reminders through notification pipeline` (Wave 5)
7. `feat(mobile): add notification center and preferences` (Wave 6)
8. `docs(notifications): document notification runtime and setup` (Wave 7)

Each wave: TDD → local typecheck/test → `git diff --check` → review → commit before next.

## 14. Acceptance Scenarios Mapping

1. Schedule Push reminder → `task_reminders.delivery_mode=push` stored.
2. Due → one `notifications` row with `idempotency_key=task-reminder:<id>`.
3. Two active devices → two `notification_deliveries` push rows.
4. One invalid → that delivery `invalid_endpoint`, device `is_active=false`, other unaffected.
5. Transient → `retry_scheduled` with bounded backoff (5 attempts, exponential 1m→2m→4m→8m→16m).
6. Accepted → `provider_accepted`, never `delivered`.
7. Open center → canonical notification listed regardless of delivery.
8. Tap → `opened_at`+`read_at` set, navigate to task detail.
9. Preference change → future `queueDeliveries` respects new booleans.
10. Replay → idempotent create returns existing notification, no duplicate deliveries.
11. Logout/login same install → RPC reassigns ownership, old owner loses active endpoint.
12. No credentials → fakes in tests, runtime surfaces clear config error, no fake creds committed.

## 15. Remaining External Prerequisites (post-branch)

- Firebase project with `google-services.json` package `com.ega_house.mobile` wired via Expo config.
- Server env `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` (newline-normalized) or `FCM_SERVICE_ACCOUNT_JSON`.
- Controlled `drizzle-kit migrate` of 0045 after review.
- Release APK build via Blacksmith `mobile-delivery` (not EAS), real-device proof.
