import type {
  AuthenticatedActor,
  CreateInboxRecordInput,
  InboxProjectOptionRecord,
  InboxQuery,
  InboxRecord,
  InboxRepository,
  InboxScopeRecord,
  RepositoryResult,
  UpdateInboxRecordInput,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

const ACTIVE_INBOX_STATUSES = ["inbox", "reviewing", "planned"] as const;
const ALL_VISIBLE_INBOX_STATUSES = ["inbox", "reviewing", "planned", "archived"] as const;
const INBOX_SELECT = "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)";

type InboxRow = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  type: string;
  project_id: string | null;
  priority: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  projects?: { name?: string | null } | null;
};

function mapInboxRow(row: InboxRow): InboxRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    body: row.body ?? null,
    status: String(row.status) as InboxRecord["status"],
    type: String(row.type) as InboxRecord["type"],
    projectId: row.project_id ? String(row.project_id) : null,
    priority: row.priority ? (String(row.priority) as InboxRecord["priority"]) : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    projectName: row.projects?.name ?? null,
  };
}

function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

function escapePostgrestPattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function escapePostgrestOrValue(value: string): string {
  // Escape all PostgREST `or=` grammar characters so arbitrary search text cannot inject extra filters.
  // Builds on pattern escaping (\ % _) plus or-separator grammar: , ( ) " ' . : = and control characters.
  let out = escapePostgrestPattern(value);
  out = out.replace(/,/g, "\\,");
  out = out.replace(/\(/g, "\\(");
  out = out.replace(/\)/g, "\\)");
  out = out.replace(/"/g, '\\"');
  out = out.replace(/'/g, "\\'");
  out = out.replace(/\./g, "\\.");
  out = out.replace(/:/g, "\\:");
  out = out.replace(/=/g, "\\=");
  // Control characters and DEL: escape as \xHH to avoid breaking URL/header parsing
  out = out.replace(/[\0-\x1f\x7f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return out;
}

export class SupabaseInboxRepository implements InboxRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getScope(actor: AuthenticatedActor): Promise<RepositoryResult<InboxScopeRecord>> {
    const projects = await this.supabase
      .from("projects")
      .select("id")
      .eq("owner_user_id", actor.userId);
    if (projects.error) return failure(projects.error);
    const rows = (projects.data ?? []) as Array<{ id: string }>;
    return {
      ok: true,
      value: { projectIds: rows.map((r) => String(r.id)) },
    };
  }

  async listInboxItems(
    actor: AuthenticatedActor,
    query: InboxQuery = {},
  ): Promise<RepositoryResult<InboxRecord[]>> {
    let request = this.supabase
      .from("idea_notes")
      .select(INBOX_SELECT)
      .eq("owner_user_id", actor.userId);

    const view = query.view ?? "active";
    if (view === "archived") {
      request = request.eq("status", "archived");
    } else if (view === "all") {
      request = request.in("status", [...ALL_VISIBLE_INBOX_STATUSES]);
    } else {
      request = request.in("status", [...ACTIVE_INBOX_STATUSES]);
    }

    if (query.search) {
      // Harden: escape all PostgREST `or` grammar characters before raw interpolation.
      // Covers , ( ) " ' \ % _ . : = and control characters so arbitrary search cannot inject extra filters.
      // Keep owner filtering intact via prior eq("owner_user_id", actor.userId).
      const escapedSearch = escapePostgrestOrValue(query.search);
      const pattern = `%${escapedSearch}%`;
      request = request.or(`title.ilike.${pattern},body.ilike.${pattern}`);
    }

    if (query.type) {
      request = request.eq("type", query.type);
    }

    if (query.status) {
      request = request.eq("status", query.status);
    }

    if (query.projectFilter === "none") {
      request = request.is("project_id", null);
    } else if (query.projectId) {
      request = request.eq("project_id", query.projectId);
    }

    if (query.priorityFilter === "none") {
      request = request.is("priority", null);
    } else if (query.priority) {
      request = request.eq("priority", query.priority);
    }

    if (query.tag) {
      request = request.contains("tags", [query.tag]);
    }

    request = request.order("created_at", { ascending: false });

    const result = await request;
    if (result.error) return failure(result.error);
    const rows = (result.data ?? []) as InboxRow[];
    return { ok: true, value: rows.map(mapInboxRow) };
  }

  async listProjectOptions(actor: AuthenticatedActor): Promise<RepositoryResult<InboxProjectOptionRecord[]>> {
    const result = await this.supabase
      .from("projects")
      .select("id, name")
      .eq("owner_user_id", actor.userId)
      .order("name", { ascending: true });
    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: ((result.data ?? []) as Array<{ id: string; name: string }>).map((row) => ({
        id: String(row.id),
        name: String(row.name),
      })),
    };
  }

  async getInboxItem(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<InboxRecord | null>> {
    const result = await this.supabase
      .from("idea_notes")
      .select(INBOX_SELECT)
      .eq("id", id)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }

  async getInboxItemByIdempotencyKey(
    actor: AuthenticatedActor,
    key: string,
  ): Promise<RepositoryResult<InboxRecord | null>> {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return { ok: true, value: null };
    const lookup = await this.supabase
      .from("inbox_idempotency_keys")
      .select("inbox_item_id")
      .eq("owner_user_id", actor.userId)
      .eq("key", trimmed)
      .maybeSingle();
    if (lookup.error) return failure(lookup.error);
    if (!lookup.data) return { ok: true, value: null };
    const inboxId = String(((lookup.data as unknown as { inbox_item_id?: string; inboxItemId?: string })?.inbox_item_id ?? (lookup.data as unknown as { inbox_item_id?: string; inboxItemId?: string })?.inboxItemId ?? ""));
    if (!inboxId) return { ok: true, value: null };
    return this.getInboxItem(actor, inboxId);
  }

  async getInboxIdempotencyEntry(
    actor: AuthenticatedActor,
    key: string,
  ): Promise<RepositoryResult<{ inboxItemId: string; fingerprint: string | null } | null>> {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return { ok: true, value: null };
    const lookup = await this.supabase
      .from("inbox_idempotency_keys")
      .select("inbox_item_id, fingerprint")
      .eq("owner_user_id", actor.userId)
      .eq("key", trimmed)
      .maybeSingle();
    if (lookup.error) return failure(lookup.error);
    if (!lookup.data) return { ok: true, value: null };
    const row = lookup.data as unknown as { inbox_item_id?: string; inboxItemId?: string; fingerprint?: string | null };
    const inboxItemId = String(row.inbox_item_id ?? row.inboxItemId ?? "");
    if (!inboxItemId) return { ok: true, value: null };
    return { ok: true, value: { inboxItemId, fingerprint: row.fingerprint ?? null } };
  }

  async createInboxItem(
    actor: AuthenticatedActor,
    input: CreateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>> {
    const idempotencyKey = (input as unknown as { idempotencyKey?: string | null }).idempotencyKey ? String((input as unknown as { idempotencyKey?: string | null }).idempotencyKey).trim() : null;
    const fingerprint = (input as unknown as { fingerprint?: string | null }).fingerprint ? String((input as unknown as { fingerprint?: string | null }).fingerprint).trim() : null;
    const deterministicId = (input as unknown as { id?: string | null }).id ? String((input as unknown as { id?: string | null }).id).trim() : null;

    const insertPayload: Record<string, unknown> = {
      owner_user_id: actor.userId,
      title: input.title,
      body: input.body,
      status: "inbox",
      type: input.type,
      project_id: input.projectId,
      priority: input.priority,
      tags: input.tags,
    };
    if (deterministicId) insertPayload.id = deterministicId;

    const result = await this.supabase
      .from("idea_notes")
      .insert(insertPayload)
      .select(INBOX_SELECT)
      .single();
    if (result.error || !result.data) {
      if (result.error) {
        const code = String((result.error as unknown as { code?: string })?.code ?? "");
        const msg = String((result.error as unknown as { message?: string })?.message ?? "");
        const isDuplicate = code.includes("23505") || /duplicate|unique/i.test(msg);
        if (isDuplicate && idempotencyKey) {
          return { ok: false, error: { code: "conflict" } };
        }
      }
      return failure(result.error);
    }
    const created = mapInboxRow(result.data as InboxRow);

    if (idempotencyKey) {
      const linkPayload: Record<string, unknown> = {
        owner_user_id: actor.userId,
        key: idempotencyKey,
        inbox_item_id: created.id,
      };
      if (fingerprint) linkPayload.fingerprint = fingerprint;
      const link = await this.supabase.from("inbox_idempotency_keys").insert(linkPayload);
      if (link.error) {
        const isDuplicate =
          String(link.error.code ?? "").includes("23505") ||
          /duplicate|unique/i.test(String(link.error.message ?? ""));
        if (isDuplicate) {
          const entry = await this.getInboxIdempotencyEntry(actor, idempotencyKey);
          if (entry.ok && entry.value) {
            if (entry.value.fingerprint && fingerprint && entry.value.fingerprint !== fingerprint) {
              // Fingerprint mismatch => conflict. Cleanup our orphan note if it differs from canonical
              if (created.id !== entry.value.inboxItemId) {
                try {
                  await this.supabase.from("idea_notes").delete().eq("id", created.id).eq("owner_user_id", actor.userId);
                } catch {}
              }
              return { ok: false, error: { code: "conflict" } };
            }
          }
          const retry = await this.getInboxItemByIdempotencyKey(actor, idempotencyKey);
          if (retry.ok && retry.value) {
            // Our insert was orphan if duplicate mapping means canonical already exists; delete our orphan if different id
            if (created.id !== retry.value.id) {
              try {
                await this.supabase.from("idea_notes").delete().eq("id", created.id).eq("owner_user_id", actor.userId);
              } catch {}
            }
            return { ok: true, value: retry.value };
          }
          return { ok: false, error: { code: "conflict" } };
        }
        // Non-duplicate mapping failure: cleanup orphan and return failure (proper error propagation)
        try {
          await this.supabase.from("idea_notes").delete().eq("id", created.id).eq("owner_user_id", actor.userId);
        } catch {}
        return failure(link.error);
      }
    }

    return { ok: true, value: created };
  }

  async updateInboxItem(
    actor: AuthenticatedActor,
    input: UpdateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>> {
    const result = await this.supabase
      .from("idea_notes")
      .update({
        title: input.title,
        body: input.body,
        status: input.status,
        type: input.type,
        project_id: input.projectId,
        priority: input.priority,
        tags: input.tags,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("owner_user_id", actor.userId)
      .select(INBOX_SELECT)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }

  async setInboxItemStatus(
    actor: AuthenticatedActor,
    input: Readonly<{ id: string; status: string }>,
  ): Promise<RepositoryResult<InboxRecord>> {
    const result = await this.supabase
      .from("idea_notes")
      .update({
        status: input.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("owner_user_id", actor.userId)
      .select(INBOX_SELECT)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }

  async getTaskIdForInboxItem(
    actor: AuthenticatedActor,
    inboxItemId: string,
  ): Promise<RepositoryResult<string | null>> {
    const trimmed = String(inboxItemId ?? "").trim();
    if (!trimmed) return { ok: true, value: null };
    const result = await this.supabase
      .from("task_external_refs")
      .select("task_id")
      .eq("owner_user_id", actor.userId)
      .eq("source", "inbox")
      .eq("source_id", trimmed)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    const taskId = String((result.data as { task_id?: string; taskId?: string } | null)?.task_id ?? (result.data as { task_id?: string; taskId?: string } | null)?.taskId ?? "");
    return { ok: true, value: taskId || null };
  }

  async createInboxTaskLink(
    actor: AuthenticatedActor,
    input: Readonly<{ inboxItemId: string; taskId: string }>,
  ): Promise<RepositoryResult<void>> {
    const inboxItemId = String(input.inboxItemId ?? "").trim();
    const taskId = String(input.taskId ?? "").trim();
    if (!inboxItemId || !taskId) return { ok: false, error: { code: "unknown" } };
    const result = await this.supabase.from("task_external_refs").insert({
      owner_user_id: actor.userId,
      task_id: taskId,
      source: "inbox",
      source_id: inboxItemId,
    });
    if (result.error) {
      const code = String((result.error as unknown as { code?: string })?.code ?? "");
      const msg = String((result.error as unknown as { message?: string })?.message ?? "");
      const isDuplicate = code.includes("23505") || /duplicate|unique/i.test(msg);
      if (isDuplicate) {
        return { ok: false, error: { code: "conflict" } };
      }
      return failure(result.error);
    }
    return { ok: true, value: undefined };
  }

  async markInboxItemConverted(
    actor: AuthenticatedActor,
    inboxItemId: string,
  ): Promise<RepositoryResult<InboxRecord>> {
    const id = String(inboxItemId ?? "").trim();
    if (!id) return { ok: false, error: { code: "unknown" } };
    const result = await this.supabase
      .from("idea_notes")
      .update({
        status: "converted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_user_id", actor.userId)
      .select(INBOX_SELECT)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }
}
