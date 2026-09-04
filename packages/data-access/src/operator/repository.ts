import {
  OPERATOR_PROPOSAL_LIST_DEFAULT_LIMIT,
  OPERATOR_PROPOSAL_LIST_MAX_LIMIT,
} from "@ega/application";
import type {
  AuthenticatedActor,
  OperatorProposalRecord,
  OperatorProposalRepository,
  RepositoryResult,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value as Row;
}
function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}
function asString(v: unknown): string {
  return String(v ?? "");
}
function asNullableString(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((e) => String(e));
  return [];
}
function asTaskVersions(v: unknown): OperatorProposalRecord["taskVersions"] {
  if (Array.isArray(v)) return v as OperatorProposalRecord["taskVersions"];
  return [];
}
function asResult(v: unknown): OperatorProposalRecord["result"] {
  if (!v || typeof v !== "object") return null;
  return v as OperatorProposalRecord["result"];
}

function mapRow(row: Row): OperatorProposalRecord {
  return {
    id: asString(row.id),
    revision: Number(row.revision),
    ownerUserId: asString(row.owner_user_id),
    localDate: asString(row.local_date),
    timeContextId: asString(row.time_context_id),
    baselineHash: asString(row.baseline_hash),
    proposedTaskIds: asStringArray(row.proposed_task_ids),
    taskVersions: asTaskVersions(row.task_versions),
    parentProposalId: asNullableString(row.parent_proposal_id),
    idempotencyKey: asString(row.idempotency_key),
    status: asString(row.status) as OperatorProposalRecord["status"],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    approvedAt: asNullableString(row.approved_at),
    appliedAt: asNullableString(row.applied_at),
    dismissedAt: asNullableString(row.dismissed_at),
    result: asResult(row.result),
    aiRef: asNullableString(row.ai_ref),
  };
}

function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

export class SupabaseOperatorProposalRepository implements OperatorProposalRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createProposal(
    actor: AuthenticatedActor,
    data: Parameters<OperatorProposalRepository["createProposal"]>[1],
  ): Promise<RepositoryResult<OperatorProposalRecord>> {
    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        insert: (payload: unknown) => {
          select: (cols: string) => {
            single: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
          };
        };
      };
    })
      .from("operator_proposals")
      .insert({
        revision: data.revision,
        owner_user_id: actor.userId,
        local_date: data.localDate,
        time_context_id: data.timeContextId,
        baseline_hash: data.baselineHash,
        proposed_task_ids: data.proposedTaskIds,
        task_versions: data.taskVersions,
        parent_proposal_id: data.parentProposalId,
        idempotency_key: data.idempotencyKey,
        status: data.status,
        ai_ref: data.aiRef,
      })
      .select("*")
      .single();

    if (result.error || !result.data) return failure(result.error);
    return { ok: true, value: mapRow(asRow(result.data)) };
  }

  async findById(actor: AuthenticatedActor, id: string): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: unknown) => {
            eq: (col2: string, val2: unknown) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown | null }>;
            };
          };
        };
      };
    })
      .from("operator_proposals")
      .select("*")
      .eq("id", id)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();

    if ((result as unknown as { error: unknown }).error) return failure(result.error as never);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapRow(asRow(result.data)) };
  }

  async findByIdempotencyKey(actor: AuthenticatedActor, key: string): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: unknown) => {
            eq: (col2: string, val2: unknown) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown | null }>;
            };
          };
        };
      };
    })
      .from("operator_proposals")
      .select("*")
      .eq("owner_user_id", actor.userId)
      .eq("idempotency_key", key)
      .maybeSingle();

    if ((result as unknown as { error: unknown }).error) return failure(result.error as never);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapRow(asRow(result.data)) };
  }

  async updateProposal(
    actor: AuthenticatedActor,
    id: string,
    patch: Parameters<OperatorProposalRepository["updateProposal"]>[2],
  ): Promise<RepositoryResult<OperatorProposalRecord>> {
    const payload: Record<string, unknown> = { updated_at: patch.updatedAt ?? new Date().toISOString() };
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.approvedAt !== undefined) payload.approved_at = patch.approvedAt;
    if (patch.appliedAt !== undefined) payload.applied_at = patch.appliedAt;
    if (patch.dismissedAt !== undefined) payload.dismissed_at = patch.dismissedAt;
    if (patch.result !== undefined) payload.result = patch.result;

    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        update: (payload: unknown) => {
          eq: (col: string, val: unknown) => {
            eq: (col2: string, val2: unknown) => {
              select: (cols: string) => {
                single: () => Promise<{ data: unknown; error: unknown | null }>;
              };
            };
          };
        };
      };
    })
      .from("operator_proposals")
      .update(payload)
      .eq("id", id)
      .eq("owner_user_id", actor.userId)
      .select("*")
      .single();

    if ((result as unknown as { error: unknown }).error || !result.data) return failure((result as unknown as { error: unknown }).error as never);
    return { ok: true, value: mapRow(asRow(result.data)) };
  }

  async claimApprovedProposalForApply(
    actor: AuthenticatedActor,
    proposalId: string,
  ): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const nowIso = new Date().toISOString();
    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        update: (payload: unknown) => {
          eq: (col: string, val: unknown) => {
            eq: (col2: string, val2: unknown) => {
              eq: (col3: string, val3: unknown) => {
                select: (cols: string) => {
                  maybeSingle: () => Promise<{ data: unknown; error: unknown | null }>;
                };
              };
            };
          };
        };
      };
    })
      .from("operator_proposals")
      .update({ status: "applying", updated_at: nowIso } as never)
      .eq("id", proposalId)
      .eq("owner_user_id", actor.userId)
      .eq("status", "approved")
      .select("*")
      .maybeSingle();

    if ((result as unknown as { error: unknown }).error) return failure((result as unknown as { error: unknown }).error as never);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapRow(asRow(result.data)) };
  }

  async listProposals(
    actor: AuthenticatedActor,
    filter?: { localDate?: string; status?: string; limit?: number },
  ): Promise<RepositoryResult<OperatorProposalRecord[]>> {
    const supabaseAny = this.supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => unknown;
      };
    };
    let builder: unknown = supabaseAny.from("operator_proposals").select("*");
    builder = (builder as { eq: (c: string, v: unknown) => unknown }).eq("owner_user_id", actor.userId);
    if (filter?.localDate) {
      builder = (builder as { eq: (c: string, v: unknown) => unknown }).eq("local_date", filter.localDate);
    }
    if (filter?.status) {
      builder = (builder as { eq: (c: string, v: unknown) => unknown }).eq("status", filter.status);
    }
    const requestedLimit = filter?.limit;
    const limit =
      typeof requestedLimit === "number" &&
      Number.isSafeInteger(requestedLimit) &&
      requestedLimit >= 1 &&
      requestedLimit <= OPERATOR_PROPOSAL_LIST_MAX_LIMIT
        ? requestedLimit
        : OPERATOR_PROPOSAL_LIST_DEFAULT_LIMIT;
    builder = (builder as { limit: (n: number) => unknown }).limit(limit);
    builder = (builder as { order: (c: string, opts: unknown) => unknown }).order("created_at", { ascending: false });
    const result = (await (builder as Promise<{ data: unknown; error: unknown | null }>)) as { data: unknown; error: unknown | null };
    if (result.error) return failure(result.error as never);
    return { ok: true, value: asRows(result.data).map(mapRow) };
  }

  async deleteOlderThan(actor: AuthenticatedActor, cutoffIso: string): Promise<RepositoryResult<number>> {
    const result = await (this.supabase as unknown as {
      from: (table: string) => {
        delete: () => {
          eq: (col: string, val: unknown) => {
            lt: (col: string, val: unknown) => Promise<{ count: number | null; error: unknown | null }>;
          };
        };
      };
    })
      .from("operator_proposals")
      .delete()
      .eq("owner_user_id", actor.userId)
      .lt("created_at", cutoffIso);

    if ((result as unknown as { error: unknown }).error) return failure((result as unknown as { error: unknown }).error as never);
    return { ok: true, value: (result as unknown as { count: number | null }).count ?? 0 };
  }
}
