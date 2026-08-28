import {
  applyApprovedOperatorProposal,
  approveOperatorProposal,
  createAuthenticatedActor,
  createOperatorProposal,
  dismissOperatorProposal,
  getOperatorStoredProposal,
  resolveTimeContext,
} from "@ega/application";
import {
  SupabaseOperatorProposalRepository,
  SupabaseTasksRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";

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
  proposedTaskIds: string[];
  idempotencyKey: string;
  parentProposalId?: string | null;
  aiRef?: string | null;
  requestedTimezone?: string;
  now?: Date;
}) {
  const supabase = input.supabase ?? (await createClient());
  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null as unknown, errorMessage: "Authentication required." };
  }
  const actor = createAuthenticatedActor(user.id);
  // Resolve canonical Time Context: evidence-based localDate/timeContextId
  const timeContextRepo = new SupabaseTimeContextRepository(supabase as never);
  const tcResult = await resolveTimeContext(actor, timeContextRepo, {
    requestedTimezone: input.requestedTimezone,
    now: input.now ?? new Date(),
  });
  if (!tcResult.ok) return { data: null, errorMessage: tcResult.errorMessage };
  const tc = tcResult.data;
  const localDate = tc.localDate;
  const timezone = tc.timezone;
  const timeContextId = `${localDate}::${timezone}::${tc.dayWindow.startUtcIso}`;
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const lookup = taskLookup(supabase);
  const result = await createOperatorProposal(actor, repo, lookup, {
    localDate,
    timeContextId,
    proposedTaskIds: input.proposedTaskIds,
    idempotencyKey: input.idempotencyKey,
    parentProposalId: input.parentProposalId ?? null,
    aiRef: input.aiRef ?? null,
    timezone,
  });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function approveOperatorProposalData(input: { supabase?: SupabaseServerClient; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null, errorMessage: "Authentication required." };
  }
  const actor = createAuthenticatedActor(user.id);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const lookup = taskLookup(supabase);
  const result = await approveOperatorProposal(actor, repo, lookup, { proposalId: input.proposalId });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function applyApprovedOperatorProposalData(input: {
  supabase?: SupabaseServerClient;
  proposalId: string;
  taskIds?: string[];
}) {
  const supabase = input.supabase ?? (await createClient());
  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null, errorMessage: "Authentication required." };
  }
  const actor = createAuthenticatedActor(user.id);
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

export async function dismissOperatorProposalData(input: { supabase?: SupabaseServerClient; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null, errorMessage: "Authentication required." };
  }
  const actor = createAuthenticatedActor(user.id);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const result = await dismissOperatorProposal(actor, repo, { proposalId: input.proposalId });
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}

export async function getOperatorProposalData(input: { supabase?: SupabaseServerClient; proposalId: string }) {
  const supabase = input.supabase ?? (await createClient());
  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null, errorMessage: "Authentication required." };
  }
  const actor = createAuthenticatedActor(user.id);
  const repo = new SupabaseOperatorProposalRepository(supabase as never);
  const result = await getOperatorStoredProposal(actor, repo, input.proposalId);
  if (!result.ok) return { data: null, errorMessage: result.errorMessage };
  return { data: result.data, errorMessage: null };
}
