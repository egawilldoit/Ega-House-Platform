import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type OwnerScopedRow = {
  owner_user_id?: string | null;
  updated_at?: string | null;
};

type SupportedRealtimeTable = "task_sessions" | "tasks";

type SupabaseRealtimeClient = Pick<
  SupabaseClient<Database>,
  "channel" | "removeChannel"
>;

type RealtimeListenerConfig = {
  ownerUserId: string;
  tables: readonly SupportedRealtimeTable[];
  channelPrefix: string;
  onPayload: (payload: RealtimePostgresChangesPayload<OwnerScopedRow>) => void;
};

function readStringField(value: unknown, key: "owner_user_id" | "updated_at") {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[key];
  if (typeof fieldValue === "string" && fieldValue.length > 0) {
    return fieldValue;
  }

  return null;
}

function getOwnerFromPayload(payload: RealtimePostgresChangesPayload<OwnerScopedRow>) {
  const newOwner = readStringField(payload.new, "owner_user_id");
  if (newOwner) {
    return newOwner;
  }

  const oldOwner = readStringField(payload.old, "owner_user_id");
  if (oldOwner) {
    return oldOwner;
  }

  return null;
}

export function buildOwnerScopedRealtimeFilter(ownerUserId: string) {
  return `owner_user_id=eq.${ownerUserId}`;
}

export function isOwnerScopedRealtimePayload(
  payload: RealtimePostgresChangesPayload<OwnerScopedRow>,
  ownerUserId: string,
) {
  const payloadOwner = getOwnerFromPayload(payload);
  return payloadOwner === ownerUserId;
}

export function getRealtimePayloadUpdatedAt(
  payload: RealtimePostgresChangesPayload<OwnerScopedRow>,
) {
  const newUpdatedAt = readStringField(payload.new, "updated_at");
  if (newUpdatedAt) {
    return newUpdatedAt;
  }

  return readStringField(payload.old, "updated_at");
}

export function subscribeToOwnerScopedRealtimeChanges(
  client: SupabaseRealtimeClient,
  config: RealtimeListenerConfig,
) {
  const channels: RealtimeChannel[] = [];
  const filter = buildOwnerScopedRealtimeFilter(config.ownerUserId);

  for (const table of config.tables) {
    const channel = client
      .channel(`${config.channelPrefix}-${table}-${config.ownerUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        (payload) => {
          if (!isOwnerScopedRealtimePayload(payload, config.ownerUserId)) {
            return;
          }
          config.onPayload(payload);
        },
      )
      .subscribe();

    channels.push(channel);
  }

  return () => {
    for (const channel of channels) {
      void client.removeChannel(channel);
    }
  };
}
