import {
  applyApprovedOperatorProposal,
  approveOperatorProposal,
  createAuthenticatedActor,
  createOperatorProposal,
  dismissOperatorProposal,
  getOperatorStoredProposal,
} from "@ega/application";
import { SupabaseOperatorProposalRepository, SupabaseTasksRepository } from "@ega/data-access";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function taskLookup(client: SupabaseServerClient) {
  const repo = new SupabaseTasksRepository(client as never);
  return {
    getTask: (actor: Parameters<typeof repo.getTask>[0], taskId: string) => repo.getTask(actor, taskId),
  } as unknown as Parameters<typeof createOperatorProposal>[2];
}

function todayMutation(client: SupabaseServerClient) {
  const repo = new SupabaseTasksRepository(client as never);
  return {
    setPlannedDate: (actor: Parameters<typeof repo.setPlannedDate>[0], input: Parameters<typeof repo.setPlannedDate>[1]) =>
      repo.setPlannedDate(actor, input),
  } as unknown as Parameters<typeof applyApprovedOperatorProposal>[3];
}

// Web calls application directly server-side — thin composition, no HTTP hop to Hono.
// Mobile uses authenticated Hono/api-client. Both preserve shared validation (LLM cannot bypass).

export async function createOperatorProposalData(input: {
  supabase?: SupabaseServerClient;
  actorId?: string;
  localDate: string;
  timeContextId: string;
  proposedTaskIds: string[];
  idempotencyKey: string;
  parentProposalId?: string | null;
  aiRef?: string | null;
  timezone?: string;
}) {
  const supabase = input.supabase ?? (await createClient());
  let actorId = input.actorId ?? null;
  if (!actorId) {
    const { data } = await supabase.auth.getUser();
    actorId = data.user?.id ?? null;
  }
  if (!actorId) return { data: null as unknown, errorMessage: "Authentication required." };
  const actor = createAuthenticatedActor(actorId);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const lookup = taskLookup(supabase);
  const result = await createOperatorProposal(actor, repo, lookup, {
    localDate: input.localDate,
    timeContextId: input.timeContextId,
    proposedTaskIds: input.proposedTaskIds,
    idempotencyKey: input.idempotencyKey,
    parentProposalId: input.parentProposalId ?? null,
    aiRef: input.aiRef ?? null,
    timezone: input.timezone,
  });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function approveOperatorProposalData(input: { supabase?: SupabaseServerClient; actorId?: string; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let actorId = input.actorId ?? null;
  if (!actorId) {
    const { data } = await supabase.auth.getUser();
    actorId = data.user?.id ?? null;
  }
  if (!actorId) return { data: null, errorMessage: "Authentication required." };
  const actor = createAuthenticatedActor(actorId);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const lookup = taskLookup(supabase);
  const result = await approveOperatorProposal(actor, repo, lookup, { proposalId: input.proposalId });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function applyApprovedOperatorProposalData(input: {
  supabase?: SupabaseServerClient;
  actorId?: string;
  proposalId: string;
  taskIds?: string[];
}) {
  const supabase = input.supabase ?? (await createClient());
  let actorId = input.actorId ?? null;
  if (!actorId) {
    const { data } = await supabase.auth.getUser();
    actorId = data.user?.id ?? null;
  }
  if (!actorId) return { data: null, errorMessage: "Authentication required." };
  const actor = createAuthenticatedActor(actorId);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const lookup = taskLookup(supabase);
  const mutation = todayMutation(supabase);
  const result = await applyApprovedOperatorProposal(actor, repo, lookup, mutation, {
    proposalId: input.proposalId,
    taskIds: input.taskIds,
  });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function dismissOperatorProposalData(input: { supabase?: SupabaseServerClient; actorId?: string; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let actorId = input.actorId ?? null;
  if (!actorId) {
    const { data } = await supabase.auth.getUser();
    actorId = data.user?.id ?? null;
  }
  if (!actorId) return { data: null, errorMessage: "Authentication required." };
  const actor = createAuthenticatedActor(actorId);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const result = await dismissOperatorProposal(actor, repo, { proposalId: input.proposalId });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function getOperatorProposalData(input: { supabase?: SupabaseServerClient; actorId?: string; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let actorId = input.actorId ?? null;
  if (!actorId) {
    const { data } = await supabase.auth.getUser();
    actorId = data.user?.id ?? null;
  }
  if (!actorId) return { data: null, errorMessage: "Authentication required." };
  const actor = createAuthenticatedActor(actorId);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const result = await getOperatorStoredProposal(actor, repo, input.proposalId);
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}
