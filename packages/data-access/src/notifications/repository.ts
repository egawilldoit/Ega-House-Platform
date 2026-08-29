import type { AuthenticatedActor } from "@ega/application/auth/actor";
import type {
  CreateNotificationInput,
  ListNotificationsQuery,
  ListNotificationsResult,
  NotificationDeliveryRecord,
  NotificationDeviceRecord,
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationRepository,
  NotificationDeliveryRepository,
  NotificationDeviceRepository,
  NotificationPreferenceRepository,
  TaskReminderIntentRecord,
  TaskReminderIntentRepository,
} from "@ega/application/notifications/ports";
import type { RepositoryResult } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

const REMINDER_LEASE_MS = 5 * 60 * 1000;
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value as Row;
}
function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}
function nullableString(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

function mapNotification(row: Row): NotificationRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    type: String(row.type) as NotificationRecord["type"],
    title: String(row.title),
    body: nullableString(row.body),
    targetType: nullableString(row.target_type),
    targetId: nullableString(row.target_id),
    idempotencyKey: String(row.idempotency_key),
    readAt: nullableString(row.read_at),
    openedAt: nullableString(row.opened_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDevice(row: Row): NotificationDeviceRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    installationId: String(row.installation_id),
    platform: String(row.platform) as "android",
    provider: String(row.provider) as "fcm",
    providerToken: String(row.provider_token),
    isActive: Boolean(row.is_active),
    lastSeenAt: String(row.last_seen_at),
    invalidatedAt: nullableString(row.invalidated_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDelivery(row: Row): NotificationDeliveryRecord {
  return {
    id: String(row.id),
    notificationId: String(row.notification_id),
    ownerUserId: String(row.owner_user_id),
    channel: String(row.channel) as "push" | "email",
    deviceId: nullableString(row.device_id),
    provider: String(row.provider) as "fcm" | "resend",
    status: String(row.status) as NotificationDeliveryRecord["status"],
    providerMessageId: nullableString(row.provider_message_id),
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: nullableString(row.next_attempt_at),
    lastErrorCode: nullableString(row.last_error_code),
    lastErrorReason: nullableString(row.last_error_reason),
    providerAcceptedAt: nullableString(row.provider_accepted_at),
    failedAt: nullableString(row.failed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPreference(row: Row): NotificationPreferenceRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    notificationType: String(row.notification_type) as NotificationPreferenceRecord["notificationType"],
    pushEnabled: Boolean(row.push_enabled),
    emailEnabled: Boolean(row.email_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapIntent(row: Row, taskTitle?: string | null): TaskReminderIntentRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    taskId: String(row.task_id),
    remindAt: String(row.remind_at),
    deliveryMode: String(row.delivery_mode ?? "email") as TaskReminderIntentRecord["deliveryMode"],
    status: String(row.status),
    taskTitle: taskTitle ?? null,
  };
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createNotification(
    actor: AuthenticatedActor,
    input: CreateNotificationInput,
  ): Promise<RepositoryResult<NotificationRecord>> {
    const payload = {
      owner_user_id: actor.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      target_type: input.target?.type ?? null,
      target_id: input.target?.id ?? null,
      idempotency_key: input.idempotencyKey,
    };

    const insert = await this.supabase
      .from("notifications")
      .insert(payload as never)
      .select("*")
      .maybeSingle();

    if (!insert.error && insert.data) {
      return { ok: true, value: mapNotification(asRow(insert.data)) };
    }

    // If conflict (23505), fetch existing
    if (insert.error && insert.error.code === "23505") {
      const existing = await this.supabase
        .from("notifications")
        .select("*")
        .eq("owner_user_id", actor.userId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();

      if (existing.error) return failure(existing.error);
      if (!existing.data) return failure({ message: "Failed to resolve idempotent notification" });
      return { ok: true, value: mapNotification(asRow(existing.data)) };
    }

    if (insert.error) return failure(insert.error);
    return failure({ message: "Unknown notification creation failure" });
  }

  async getNotification(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>> {
    const result = await this.supabase
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapNotification(asRow(result.data)) };
  }

  async listNotifications(
    actor: AuthenticatedActor,
    query: ListNotificationsQuery,
  ): Promise<RepositoryResult<ListNotificationsResult>> {
    const limit = query.limit ?? 25;
    let req = this.supabase
      .from("notifications")
      .select("*")
      .eq("owner_user_id", actor.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (query.cursor) {
      req = req.lt("created_at", query.cursor);
    }

    const result = await req;
    if (result.error) return failure(result.error);
    const rows = asRows(result.data);
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(slice[slice.length - 1]?.created_at ?? null) : null;
    return {
      ok: true,
      value: {
        notifications: slice.map(mapNotification),
        nextCursor,
      },
    };
  }

  async countUnread(actor: AuthenticatedActor): Promise<RepositoryResult<number>> {
    const result = await this.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", actor.userId)
      .is("read_at", null);
    if (result.error) return failure(result.error);
    return { ok: true, value: result.count ?? 0 };
  }

  async markRead(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>> {
    const nowIso = new Date().toISOString();
    const result = await this.supabase
      .from("notifications")
      .update({ read_at: nowIso, updated_at: nowIso } as never)
      .eq("id", notificationId)
      .eq("owner_user_id", actor.userId)
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapNotification(asRow(result.data)) };
  }

  async markOpened(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationRecord | null>> {
    const nowIso = new Date().toISOString();
    // First fetch to see if read_at is null
    const existing = await this.getNotification(actor, notificationId);
    if (!existing.ok) return existing as RepositoryResult<null>;
    if (!existing.value) return { ok: true, value: null };

    const patch: Record<string, string> = {
      opened_at: nowIso,
      updated_at: nowIso,
    };
    if (!existing.value.readAt) patch.read_at = nowIso;

    const result = await this.supabase
      .from("notifications")
      .update(patch as never)
      .eq("id", notificationId)
      .eq("owner_user_id", actor.userId)
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapNotification(asRow(result.data)) };
  }

  async markAllRead(actor: AuthenticatedActor): Promise<RepositoryResult<number>> {
    const nowIso = new Date().toISOString();
    const result = await this.supabase
      .from("notifications")
      .update({ read_at: nowIso, updated_at: nowIso } as never)
      .eq("owner_user_id", actor.userId)
      .is("read_at", null)
      .select("id");
    if (result.error) return failure(result.error);
    const count = Array.isArray(result.data) ? result.data.length : 0;
    return { ok: true, value: count };
  }
}

export class SupabaseNotificationDeviceRepository implements NotificationDeviceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimDevice(
    actor: AuthenticatedActor,
    input: { installationId: string; platform: "android"; provider: "fcm"; providerToken: string },
  ): Promise<RepositoryResult<NotificationDeviceRecord>> {
    // Use RPC
    const rpc = await (this.supabase as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    }).rpc("claim_notification_device", {
      p_installation_id: input.installationId,
      p_platform: input.platform,
      p_provider: input.provider,
      p_provider_token: input.providerToken,
    });

    if (rpc.error) return failure(rpc.error);
    if (!rpc.data) return failure({ message: "No device returned from claim" });
    // RPC returns single device row; handle array case
    const row = Array.isArray(rpc.data) ? (rpc.data[0] as Row) : (rpc.data as Row);
    return { ok: true, value: mapDevice(row) };
  }

  async getDeviceByInstallationId(
    actor: AuthenticatedActor,
    installationId: string,
  ): Promise<RepositoryResult<NotificationDeviceRecord | null>> {
    const result = await this.supabase
      .from("notification_devices")
      .select("*")
      .eq("installation_id", installationId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapDevice(asRow(result.data)) };
  }

  async deactivateDevice(
    actor: AuthenticatedActor,
    installationId: string,
  ): Promise<RepositoryResult<NotificationDeviceRecord | null>> {
    const nowIso = new Date().toISOString();
    const result = await this.supabase
      .from("notification_devices")
      .update({ is_active: false, invalidated_at: nowIso, updated_at: nowIso } as never)
      .eq("installation_id", installationId)
      .eq("owner_user_id", actor.userId)
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapDevice(asRow(result.data)) };
  }

  async listActiveDevices(actor: AuthenticatedActor): Promise<RepositoryResult<NotificationDeviceRecord[]>> {
    const result = await this.supabase
      .from("notification_devices")
      .select("*")
      .eq("owner_user_id", actor.userId)
      .eq("is_active", true)
      .order("last_seen_at", { ascending: false });
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapDevice) };
  }

  async deactivateByToken(ownerUserId: string, providerToken: string): Promise<RepositoryResult<void>> {
    const nowIso = new Date().toISOString();
    const result = await this.supabase
      .from("notification_devices")
      .update({ is_active: false, invalidated_at: nowIso, updated_at: nowIso } as never)
      .eq("owner_user_id", ownerUserId)
      .eq("provider_token", providerToken)
      .eq("is_active", true)
      .select("id");
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }
}

export class SupabaseNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createDeliveries(
    actor: AuthenticatedActor,
    input: { notificationId: string; deliveries: Array<{ channel: "push" | "email"; deviceId: string | null; provider: "fcm" | "resend" }> },
  ): Promise<RepositoryResult<NotificationDeliveryRecord[]>> {
    if (input.deliveries.length === 0) return { ok: true, value: [] };

    const created: NotificationDeliveryRecord[] = [];
    // Per-target insert to handle partial conflicts (existing + new)
    for (const d of input.deliveries) {
      const row = {
        notification_id: input.notificationId,
        owner_user_id: actor.userId,
        channel: d.channel,
        device_id: d.deviceId,
        provider: d.provider,
        status: "queued",
        attempt_count: 0,
      };
      const insert = await this.supabase.from("notification_deliveries").insert(row as never).select("*").maybeSingle();
      if (!insert.error && insert.data) {
        created.push(mapDelivery(asRow(insert.data)));
        continue;
      }
      if (insert.error && insert.error.code === "23505") {
        // Already exists — fetch that specific delivery
        let q = this.supabase
          .from("notification_deliveries")
          .select("*")
          .eq("notification_id", input.notificationId)
          .eq("owner_user_id", actor.userId)
          .eq("channel", d.channel);
        if (d.deviceId) q = q.eq("device_id", d.deviceId);
        else q = q.is("device_id", null);
        const existing = await q.maybeSingle();
        if (existing.error) return failure(existing.error);
        if (existing.data) created.push(mapDelivery(asRow(existing.data)));
        continue;
      }
      if (insert.error) return failure(insert.error);
    }

    // Also ensure we return all deliveries for this notification (including pre-existing that weren't in input? No, just the desired set)
    // For idempotency, return the union of created + existing for the desired targets (already handled)
    return { ok: true, value: created };
  }

  async listPending(query: { limit: number; nowIso: string }): Promise<RepositoryResult<NotificationDeliveryRecord[]>> {
    const leaseCutoff = new Date(new Date(query.nowIso).getTime() - DELIVERY_LEASE_MS).toISOString();
    // Queued and retry_scheduled
    const queued = await this.supabase
      .from("notification_deliveries")
      .select("*")
      .in("status", ["queued", "retry_scheduled"])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${query.nowIso}`)
      .order("created_at", { ascending: true })
      .limit(query.limit);

    if (queued.error) return failure(queued.error);

    const rows = asRows(queued.data).filter((row) => {
      const status = String(row.status);
      const nextAt = row.next_attempt_at as string | null;
      if (status === "queued") return true;
      if (status === "retry_scheduled") {
        if (!nextAt) return true;
        return new Date(nextAt).getTime() <= new Date(query.nowIso).getTime();
      }
      return false;
    });

    // Also include stale sending (lease expired)
    const staleSending = await this.supabase
      .from("notification_deliveries")
      .select("*")
      .eq("status", "sending")
      .lt("updated_at", leaseCutoff)
      .order("updated_at", { ascending: true })
      .limit(query.limit);

    if (staleSending.error) return failure(staleSending.error);
    const staleRows = asRows(staleSending.data);
    // Combine, dedupe by id, sort, limit
    const combined = [...rows, ...staleRows];
    const seen = new Set<string>();
    const deduped: Row[] = [];
    for (const r of combined) {
      const id = String(r.id);
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(r);
      }
    }
    deduped.sort((a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime());
    return { ok: true, value: deduped.slice(0, query.limit).map(mapDelivery) };
  }

  async listQueuedForNotification(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<RepositoryResult<NotificationDeliveryRecord[]>> {
    const result = await this.supabase
      .from("notification_deliveries")
      .select("*")
      .eq("notification_id", notificationId)
      .eq("owner_user_id", actor.userId);
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapDelivery) };
  }

  async updateDelivery(
    deliveryId: string,
    patch: Partial<NotificationDeliveryRecord> & { nextAttemptAt?: string | null },
  ): Promise<RepositoryResult<NotificationDeliveryRecord | null>> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status) dbPatch.status = patch.status;
    if (patch.providerMessageId !== undefined) dbPatch.provider_message_id = patch.providerMessageId;
    if (patch.attemptCount !== undefined) dbPatch.attempt_count = patch.attemptCount;
    if (patch.nextAttemptAt !== undefined) dbPatch.next_attempt_at = patch.nextAttemptAt;
    if (patch.lastErrorCode !== undefined) dbPatch.last_error_code = patch.lastErrorCode;
    if (patch.lastErrorReason !== undefined) dbPatch.last_error_reason = patch.lastErrorReason;
    if (patch.providerAcceptedAt !== undefined) dbPatch.provider_accepted_at = patch.providerAcceptedAt;
    if (patch.failedAt !== undefined) dbPatch.failed_at = patch.failedAt;
    if (patch.updatedAt) dbPatch.updated_at = patch.updatedAt;
    else dbPatch.updated_at = new Date().toISOString();

    const result = await this.supabase
      .from("notification_deliveries")
      .update(dbPatch as never)
      .eq("id", deliveryId)
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapDelivery(asRow(result.data)) };
  }

  async markSending(deliveryId: string): Promise<RepositoryResult<NotificationDeliveryRecord | null>> {
    const nowIso = new Date().toISOString();
    const leaseCutoff = new Date(Date.now() - DELIVERY_LEASE_MS).toISOString();
    // Try fresh queued/retry first
    let result = await this.supabase
      .from("notification_deliveries")
      .update({ status: "sending", updated_at: nowIso } as never)
      .eq("id", deliveryId)
      .in("status", ["queued", "retry_scheduled"])
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (result.data) return { ok: true, value: mapDelivery(asRow(result.data)) };

    // Try stale sending reclaim
    result = await this.supabase
      .from("notification_deliveries")
      .update({ status: "sending", updated_at: nowIso } as never)
      .eq("id", deliveryId)
      .eq("status", "sending")
      .lt("updated_at", leaseCutoff)
      .select("*")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapDelivery(asRow(result.data)) };
  }
}

export class SupabaseNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listPreferences(actor: AuthenticatedActor): Promise<RepositoryResult<NotificationPreferenceRecord[]>> {
    const result = await this.supabase
      .from("notification_preferences")
      .select("*")
      .eq("owner_user_id", actor.userId);
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapPreference) };
  }

  async upsertPreference(
    actor: AuthenticatedActor,
    input: { notificationType: string; pushEnabled?: boolean; emailEnabled?: boolean },
  ): Promise<RepositoryResult<NotificationPreferenceRecord>> {
    const existing = await this.supabase
      .from("notification_preferences")
      .select("*")
      .eq("owner_user_id", actor.userId)
      .eq("notification_type", input.notificationType)
      .maybeSingle();

    if (existing.error) return failure(existing.error);

    if (existing.data) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof input.pushEnabled === "boolean") patch.push_enabled = input.pushEnabled;
      if (typeof input.emailEnabled === "boolean") patch.email_enabled = input.emailEnabled;

      const upd = await this.supabase
        .from("notification_preferences")
        .update(patch as never)
        .eq("id", String((existing.data as Row).id))
        .select("*")
        .maybeSingle();
      if (upd.error) return failure(upd.error);
      if (!upd.data) return failure({ message: "Preference update returned no data" });
      return { ok: true, value: mapPreference(asRow(upd.data)) };
    }

    const insertPayload = {
      owner_user_id: actor.userId,
      notification_type: input.notificationType,
      push_enabled: input.pushEnabled ?? true,
      email_enabled: input.emailEnabled ?? true,
    };
    const inserted = await this.supabase
      .from("notification_preferences")
      .insert(insertPayload as never)
      .select("*")
      .maybeSingle();
    if (inserted.error) return failure(inserted.error);
    if (!inserted.data) return failure({ message: "Preference insert returned no data" });
    return { ok: true, value: mapPreference(asRow(inserted.data)) };
  }
}

export class SupabaseTaskReminderIntentRepository implements TaskReminderIntentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findDueIntents(nowIso: string, limit: number): Promise<RepositoryResult<TaskReminderIntentRecord[]>> {
    const leaseCutoff = new Date(new Date(nowIso).getTime() - REMINDER_LEASE_MS).toISOString();
    // Pending due
    const pending = await this.supabase
      .from("task_reminders")
      .select("id, owner_user_id, task_id, remind_at, delivery_mode, status, tasks(title)")
      .eq("status", "pending")
      .lte("remind_at", nowIso)
      .order("remind_at", { ascending: true })
      .limit(limit);

    if (pending.error) return failure(pending.error);

    // Stale processing (lease expired) — also claimable
    const stale = await this.supabase
      .from("task_reminders")
      .select("id, owner_user_id, task_id, remind_at, delivery_mode, status, tasks(title)")
      .eq("status", "processing")
      .lt("updated_at", leaseCutoff)
      .lte("remind_at", nowIso)
      .order("remind_at", { ascending: true })
      .limit(limit);

    if (stale.error) return failure(stale.error);

    const rows = [...asRows(pending.data), ...asRows(stale.data)]
      .sort((a, b) => new Date(String(a.remind_at)).getTime() - new Date(String(b.remind_at)).getTime())
      .slice(0, limit);

    return {
      ok: true,
      value: rows.map((row) => {
        const tasks = row.tasks as { title?: string | null } | null;
        const title = tasks && typeof tasks === "object" && "title" in tasks ? String((tasks as Row).title ?? "") : null;
        return mapIntent(row, title);
      }),
    };
  }

  async claimIntent(reminderId: string, nowIso: string): Promise<RepositoryResult<TaskReminderIntentRecord | null>> {
    const leaseCutoff = new Date(new Date(nowIso).getTime() - REMINDER_LEASE_MS).toISOString();
    // Try pending first
    let result = await this.supabase
      .from("task_reminders")
      .update({ status: "processing", updated_at: nowIso } as never)
      .eq("id", reminderId)
      .eq("status", "pending")
      .select("id, owner_user_id, task_id, remind_at, delivery_mode, status, tasks(title)")
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (result.data) {
      const row = asRow(result.data);
      const tasks = row.tasks as { title?: string | null } | null;
      const title = tasks && typeof tasks === "object" && "title" in tasks ? String((tasks as Row).title ?? "") : null;
      return { ok: true, value: mapIntent(row, title) };
    }

    // Try stale processing lease reclaim
    result = await this.supabase
      .from("task_reminders")
      .update({ status: "processing", updated_at: nowIso } as never)
      .eq("id", reminderId)
      .eq("status", "processing")
      .lt("updated_at", leaseCutoff)
      .select("id, owner_user_id, task_id, remind_at, delivery_mode, status, tasks(title)")
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    const row = asRow(result.data);
    const tasks = row.tasks as { title?: string | null } | null;
    const title = tasks && typeof tasks === "object" && "title" in tasks ? String((tasks as Row).title ?? "") : null;
    return { ok: true, value: mapIntent(row, title) };
  }

  async markProcessed(reminderId: string, nowIso: string): Promise<RepositoryResult<void>> {
    const result = await this.supabase
      .from("task_reminders")
      .update({ status: "processed", processed_at: nowIso, updated_at: nowIso } as never)
      .eq("id", reminderId)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async markFailed(reminderId: string, reason: string, nowIso: string): Promise<RepositoryResult<void>> {
    const result = await this.supabase
      .from("task_reminders")
      .update({ status: "failed", processing_error: reason, updated_at: nowIso } as never)
      .eq("id", reminderId)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }
}
