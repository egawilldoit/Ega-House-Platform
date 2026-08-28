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

export class SupabaseInboxRepository implements InboxRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getScope(actor: AuthenticatedActor): Promise<RepositoryResult<InboxScopeRecord>> {
    const projects = await (this.supabase as any)
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
    let request = (this.supabase as any)
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
      const pattern = `%${escapePostgrestPattern(query.search)}%`;
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
    const result = await (this.supabase as any)
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
    const result = await (this.supabase as any)
      .from("idea_notes")
      .select(INBOX_SELECT)
      .eq("id", id)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }

  async createInboxItem(
    actor: AuthenticatedActor,
    input: CreateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>> {
    const result = await (this.supabase as any)
      .from("idea_notes")
      .insert({
        owner_user_id: actor.userId,
        title: input.title,
        body: input.body,
        status: "inbox",
        type: input.type,
        project_id: input.projectId,
        priority: input.priority,
        tags: input.tags,
      })
      .select(INBOX_SELECT)
      .single();
    if (result.error || !result.data) return failure(result.error);
    return { ok: true, value: mapInboxRow(result.data as InboxRow) };
  }

  async updateInboxItem(
    actor: AuthenticatedActor,
    input: UpdateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>> {
    const result = await (this.supabase as any)
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
    const result = await (this.supabase as any)
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
}
