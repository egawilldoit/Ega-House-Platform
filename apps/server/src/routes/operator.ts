import { Hono, type Context } from "hono";

import {
  approveOperatorProposal,
  applyApprovedOperatorProposal,
  createOperatorProposal,
  dismissOperatorProposal,
  getOperatorStoredProposal,
  parseOperatorProposalListLimit,
  resolveTimeContext,
  reviseOperatorProposal,
  type ApplicationErrorCode,
} from "@ega/application";
import {
  SupabaseOperatorProposalRepository,
  SupabaseTasksRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody, readOptionalJsonBody } from "../app";

function toTaskLookup(client: ServerVariables["client"]) {
  const repo = new SupabaseTasksRepository(client as never);
  return {
    getTask: (actor: Parameters<typeof repo.getTask>[0], taskId: string) => repo.getTask(actor, taskId),
  } as unknown as Parameters<typeof approveOperatorProposal>[2];
}

function toTodayMutation(client: ServerVariables["client"]) {
  const repo = new SupabaseTasksRepository(client as never);
  return {
    setPlannedDate: (actor: Parameters<typeof repo.setPlannedDate>[0], input: Parameters<typeof repo.setPlannedDate>[1]) =>
      repo.setPlannedDate(actor, input),
  } as unknown as Parameters<typeof applyApprovedOperatorProposal>[3];
}

function mapProposalResponse(proposal: unknown) {
  return proposal;
}

function mapOperatorFailure(
  c: Context<{ Variables: ServerVariables }>,
  result: Readonly<{ errorMessage: string; code?: ApplicationErrorCode }>,
) {
  if (result.code === "conflict") {
    return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
  }
  if (result.code === "notFound") {
    return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
  }
  if (result.code === "validation") {
    return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
  }
  return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
}

export function createOperatorRoutes(dependencies: ServerDependencies): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  // Create — thin: parse, validate, delegate to application (shared validation guards LLM bypass)
  // Canonical Time Context: derive localDate/timeContextId from resolved context, not client strings
  routes.post("/proposals", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const lookup = toTaskLookup(client);
    const timeContextRepo = new SupabaseTimeContextRepository(client as never);
    const now = dependencies.now?.() ?? new Date();
    const requestedTz =
      typeof body.requestedTimezone === "string"
        ? body.requestedTimezone
        : typeof body.timezone === "string"
          ? body.timezone
          : undefined;
    const tcResult = await resolveTimeContext(actor, timeContextRepo, { requestedTimezone: requestedTz, now });
    if (!tcResult.ok) {
      return mapOperatorFailure(c, tcResult);
    }
    const tc = tcResult.data;
    const localDate = tc.localDate;
    const timezone = tc.timezone;
    const timeContextId = `${localDate}::${timezone}::${tc.dayWindow.startUtcIso}`;
    const result = await createOperatorProposal(actor, proposalRepo, lookup, {
      localDate,
      timeContextId,
      proposedTaskIds: body.proposedTaskIds,
      idempotencyKey: body.idempotencyKey,
      parentProposalId: body.parentProposalId,
      aiRef: body.aiRef,
      timezone,
    });
    if (!result.ok) {
      return mapOperatorFailure(c, result);
    }
    return c.json({ ok: true, proposal: mapProposalResponse(result.data) }, 201);
  });

  // Revise
  routes.post("/proposals/:id/revise", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const lookup = toTaskLookup(client);
    const result = await reviseOperatorProposal(actor, proposalRepo, lookup, {
      proposalId: c.req.param("id"),
      proposedTaskIds: body.proposedTaskIds,
      idempotencyKey: body.idempotencyKey,
      aiRef: body.aiRef,
    });
    if (!result.ok) {
      return mapOperatorFailure(c, result);
    }
    return c.json({ ok: true, proposal: mapProposalResponse(result.data) }, 201);
  });

  // Approve — explicit approval before apply (nothing changes before this)
  routes.post("/proposals/:id/approve", async (c) => {
    const { actor, client } = c.var;
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const lookup = toTaskLookup(client);
    const result = await approveOperatorProposal(actor, proposalRepo, lookup, { proposalId: c.req.param("id") });
    if (!result.ok) {
      return mapOperatorFailure(c, result);
    }
    return c.json({ ok: true, proposal: mapProposalResponse(result.data) });
  });

  // Apply — safe plan application: validates ownership/state, skips invalid, partial explicit, idempotent
  routes.post("/proposals/:id/apply", async (c) => {
    const { actor, client } = c.var;
    const body = await readOptionalJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const lookup = toTaskLookup(client);
    const mutation = toTodayMutation(client);
    const result = await applyApprovedOperatorProposal(actor, proposalRepo, lookup, mutation, {
      proposalId: c.req.param("id"),
      taskIds: body.taskIds,
    });
    if (!result.ok) {
      return mapOperatorFailure(c, result);
    }
    const proposal = result.data;
    return c.json({
      ok: true,
      proposal: mapProposalResponse(proposal),
      appliedTaskIds: proposal.result?.appliedTaskIds ?? [],
      skippedTaskIds: proposal.result?.skippedTaskIds ?? [],
      failedTaskIds: proposal.result?.failedTaskIds ?? [],
    });
  });

  // Dismiss — no Today mutation
  routes.post("/proposals/:id/dismiss", async (c) => {
    const { actor, client } = c.var;
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const result = await dismissOperatorProposal(actor, proposalRepo, { proposalId: c.req.param("id") });
    if (!result.ok) {
      return mapOperatorFailure(c, result);
    }
    return c.json({ ok: true, proposal: mapProposalResponse(result.data) });
  });

  // Get single
  routes.get("/proposals/:id", async (c) => {
    const { actor, client } = c.var;
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const result = await getOperatorStoredProposal(actor, proposalRepo, c.req.param("id"));
    if (!result.ok) return mapOperatorFailure(c, result);
    return c.json({ ok: true, proposal: mapProposalResponse(result.data) });
  });

  // List
  routes.get("/proposals", async (c) => {
    const { actor, client } = c.var;
    const proposalRepo = new SupabaseOperatorProposalRepository(client as never);
    const filter: { localDate?: string; status?: string; limit?: number } = {};
    const localDate = c.req.query("localDate");
    const status = c.req.query("status");
    const limitRaw = c.req.query("limit");
    const limitResult = parseOperatorProposalListLimit(limitRaw);
    if (!limitResult.ok) return mapOperatorFailure(c, limitResult);
    if (localDate) filter.localDate = localDate;
    if (status) filter.status = status;
    filter.limit = limitResult.data;
    const result = await proposalRepo.listProposals(actor, filter as never);
    if (!result.ok) return c.json({ error: { code: "INTERNAL", message: "Unable to list proposals." } }, 500);
    return c.json({ ok: true, proposals: result.value.map(mapProposalResponse) });
  });

  return routes;
}
