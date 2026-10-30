import type { TokenRecord, NewTokenRecord } from "@/lib/contracts/agent";
import {
  describeAgentEvent,
  isAgentAvatarColor,
  isAgentKind,
  mergeAgentCapabilities,
  validateAgentCredential,
  validateAgentIdentity,
  type AgentActorDetail,
  type AgentActorSummary,
  type AgentCredentialSummary,
  type AgentEventSummary,
} from "@/lib/agent-registry";
import { parseBearerToken } from "@/lib/crypto/agent-token";
import { createClient } from "@/lib/supabase/server";
import { generateAgentToken } from "./agent-token-service";
import { getAuthenticatedUserId } from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Credential operations the registry needs. `DrizzleTokenRepository` implements
 * this; tests can provide an in-memory store. Credentials stay server-side: the
 * tokens table denies client roles in RLS, so the UI never queries it directly.
 */
export interface AgentCredentialStore {
  listByOwner(ownerUserId: string): Promise<TokenRecord[]>;
  findByIdForOwner(id: string, ownerUserId: string): Promise<TokenRecord | null>;
  revokeToken(id: string): Promise<void>;
  revokeActiveForAgent(agentId: string, ownerUserId: string): Promise<number>;
  insertToken(record: NewTokenRecord): Promise<string>;
  findByPrefix(prefix: string): Promise<TokenRecord | null>;
  updateLastUsedAt(id: string): Promise<void>;
}

type Resolved = {
  client: SupabaseServerClient;
  ownerUserId: string;
  credentials: AgentCredentialStore;
};

async function defaultCredentialStore(): Promise<AgentCredentialStore> {
  const [{ db }, { DrizzleTokenRepository }] = await Promise.all([
    import("@/db/client"),
    import("./agent-token-repository"),
  ]);
  return new DrizzleTokenRepository(db);
}

async function resolve(options?: {
  client?: SupabaseServerClient;
  credentials?: AgentCredentialStore;
}): Promise<Resolved | null> {
  const client = options?.client ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(client);
  if (!ownerUserId) return null;
  const credentials = options?.credentials ?? (await defaultCredentialStore());
  return { client, ownerUserId, credentials };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAgentId(value: string): boolean {
  return UUID_RE.test(value);
}

type ActorRow = {
  id: string;
  display_name: string;
  kind: string;
  role: string | null;
  avatar_color: string;
  archived_at: string | null;
  created_at: string;
};

function normalizeActorRow(row: ActorRow): {
  id: string;
  displayName: string;
  kind: AgentActorSummary["kind"];
  role: string | null;
  avatarColor: AgentActorSummary["avatarColor"];
  archivedAt: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    displayName: row.display_name,
    kind: isAgentKind(row.kind) ? row.kind : "custom",
    role: row.role,
    avatarColor: isAgentAvatarColor(row.avatar_color) ? row.avatar_color : "slate",
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}

function normalizeCredential(record: TokenRecord): AgentCredentialSummary {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

type EventRow = {
  id: string;
  agent_id: string | null;
  action: string;
  outcome: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
};

function normalizeEvent(row: EventRow): AgentEventSummary {
  return {
    id: row.id,
    action: row.action,
    label: describeAgentEvent(row.action, row.outcome),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

function buildSummary(
  actor: ReturnType<typeof normalizeActorRow>,
  credentials: AgentCredentialSummary[],
  events: AgentEventSummary[],
): AgentActorSummary {
  const active = credentials.filter((credential) => credential.revokedAt === null);
  const lastEvent = events[0] ?? null;
  return {
    ...actor,
    credentials,
    capabilities: mergeAgentCapabilities(active.map((credential) => credential.scopes)),
    lastObservedAt: lastEvent?.createdAt ?? null,
    lastObservedLabel: lastEvent?.label ?? null,
    eventCount: events.length,
  };
}

export type AgentRegistryList = {
  actors: AgentActorSummary[];
  unassignedCredentials: AgentCredentialSummary[];
  errorMessage: string | null;
};

/**
 * Owner-scoped registry. Actor identity and activity are read through RLS;
 * credentials are read server-side because that table denies client roles.
 */
export async function listAgentRegistry(options?: {
  client?: SupabaseServerClient;
  credentials?: AgentCredentialStore;
}): Promise<AgentRegistryList> {
  const resolved = await resolve(options);
  if (!resolved) return { actors: [], unassignedCredentials: [], errorMessage: "Sign in to view agents." };

  const { data: actorRows, error: actorError } = await resolved.client
    .from("agent_actors")
    .select("id, display_name, kind, role, avatar_color, archived_at, created_at")
    .eq("owner_user_id", resolved.ownerUserId)
    .order("created_at", { ascending: true });

  if (actorError) {
    return { actors: [], unassignedCredentials: [], errorMessage: "Unable to load agents right now." };
  }

  let rawCredentials: TokenRecord[] = [];
  let credentialError: string | null = null;
  try {
    rawCredentials = await resolved.credentials.listByOwner(resolved.ownerUserId);
  } catch {
    credentialError = "Unable to load agent credentials right now.";
  }

  const { data: eventRows, error: eventError } = await resolved.client
    .from("agent_integration_events")
    .select("id, agent_id, action, outcome, resource_type, resource_id, created_at")
    .eq("owner_user_id", resolved.ownerUserId)
    .not("agent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const events = (eventRows ?? []).map((row) => ({
    agentId: row.agent_id,
    event: normalizeEvent(row as EventRow),
  }));

  const credentialsByAgent = new Map<string, AgentCredentialSummary[]>();
  for (const record of rawCredentials) {
    if (!record.agentId) continue;
    const list = credentialsByAgent.get(record.agentId) ?? [];
    list.push(normalizeCredential(record));
    credentialsByAgent.set(record.agentId, list);
  }

  const eventsByAgent = new Map<string, AgentEventSummary[]>();
  for (const item of events) {
    if (!item.agentId) continue;
    const list = eventsByAgent.get(item.agentId) ?? [];
    list.push(item.event);
    eventsByAgent.set(item.agentId, list);
  }

  const actors = ((actorRows ?? []) as ActorRow[]).map((row) => {
    const actor = normalizeActorRow(row);
    return buildSummary(
      actor,
      credentialsByAgent.get(actor.id) ?? [],
      eventsByAgent.get(actor.id) ?? [],
    );
  });

  return {
    actors,
    unassignedCredentials: rawCredentials
      .filter((record) => !record.agentId)
      .map(normalizeCredential),
    errorMessage: credentialError ?? (eventError ? "Unable to load agent activity right now." : null),
  };
}

export type AgentDetailResult =
  | { kind: "found"; agent: AgentActorDetail }
  | { kind: "unavailable" }
  | { kind: "error"; errorMessage: string };

export async function getAgentActor(
  agentId: string,
  options?: { client?: SupabaseServerClient; credentials?: AgentCredentialStore },
): Promise<AgentDetailResult> {
  if (!isAgentId(agentId)) return { kind: "unavailable" };
  const resolved = await resolve(options);
  if (!resolved) return { kind: "unavailable" };

  const { data: actorRow, error: actorError } = await resolved.client
    .from("agent_actors")
    .select("id, display_name, kind, role, avatar_color, archived_at, created_at")
    .eq("id", agentId)
    .eq("owner_user_id", resolved.ownerUserId)
    .maybeSingle();

  if (actorError) return { kind: "error", errorMessage: "Unable to load this agent right now." };
  if (!actorRow) return { kind: "unavailable" };

  let rawCredentials: TokenRecord[];
  try {
    rawCredentials = (await resolved.credentials.listByOwner(resolved.ownerUserId)).filter(
      (record) => record.agentId === agentId,
    );
  } catch {
    return { kind: "error", errorMessage: "Unable to load agent credentials right now." };
  }

  const { data: eventRows, error: eventError } = await resolved.client
    .from("agent_integration_events")
    .select("id, agent_id, action, outcome, resource_type, resource_id, created_at")
    .eq("owner_user_id", resolved.ownerUserId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (eventError) return { kind: "error", errorMessage: "Unable to load agent activity right now." };

  const actor = normalizeActorRow(actorRow as ActorRow);
  const events = (eventRows ?? []).map((row) => normalizeEvent(row as EventRow));
  return {
    kind: "found",
    agent: {
      ...buildSummary(actor, rawCredentials.map(normalizeCredential), events),
      events,
    },
  };
}

export type AgentMutationResult =
  | { ok: true; agentId: string }
  | { ok: false; errorMessage: string };

export async function createAgentActor(
  input: { displayName: unknown; kind: unknown; role?: unknown; avatarColor?: unknown },
  options?: { client?: SupabaseServerClient },
): Promise<AgentMutationResult> {
  const parsed = validateAgentIdentity(input);
  if (!parsed.ok) return { ok: false, errorMessage: parsed.error };

  const resolved = await resolve(options);
  if (!resolved) return { ok: false, errorMessage: "Sign in to register an agent." };

  const { data, error } = await resolved.client
    .from("agent_actors")
    .insert({
      owner_user_id: resolved.ownerUserId,
      display_name: parsed.value.displayName,
      kind: parsed.value.kind,
      role: parsed.value.role,
      avatar_color: parsed.value.avatarColor,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, errorMessage: "An agent with that name already exists." };
    }
    return { ok: false, errorMessage: "Unable to register the agent right now." };
  }

  return { ok: true, agentId: data.id };
}

export async function updateAgentActor(
  agentId: string,
  input: { displayName: unknown; kind: unknown; role?: unknown; avatarColor?: unknown },
  options?: { client?: SupabaseServerClient },
): Promise<AgentMutationResult> {
  if (!isAgentId(agentId)) return { ok: false, errorMessage: "Agent was not found." };
  const parsed = validateAgentIdentity(input);
  if (!parsed.ok) return { ok: false, errorMessage: parsed.error };

  const resolved = await resolve(options);
  if (!resolved) return { ok: false, errorMessage: "Sign in to update an agent." };

  const { data, error } = await resolved.client
    .from("agent_actors")
    .update({
      display_name: parsed.value.displayName,
      kind: parsed.value.kind,
      role: parsed.value.role,
      avatar_color: parsed.value.avatarColor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId)
    .eq("owner_user_id", resolved.ownerUserId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, errorMessage: "An agent with that name already exists." };
    }
    return { ok: false, errorMessage: "Unable to update the agent right now." };
  }
  if (!data) return { ok: false, errorMessage: "Agent was not found." };

  return { ok: true, agentId };
}

export type AgentArchiveResult = {
  ok: boolean;
  errorMessage: string | null;
  revokedCredentials: number;
};

/**
 * Archive/reactivate an identity. Archiving also revokes every active credential
 * of that actor; the UI states that explicitly. A single credential revoke does
 * not touch the actor's other credentials.
 */
export async function setAgentActorArchived(
  agentId: string,
  archived: boolean,
  options?: { client?: SupabaseServerClient; credentials?: AgentCredentialStore },
): Promise<AgentArchiveResult> {
  if (!isAgentId(agentId)) {
    return { ok: false, errorMessage: "Agent was not found.", revokedCredentials: 0 };
  }

  const resolved = await resolve(options);
  if (!resolved) {
    return { ok: false, errorMessage: "Sign in to update an agent.", revokedCredentials: 0 };
  }

  const { data, error } = await resolved.client
    .from("agent_actors")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId)
    .eq("owner_user_id", resolved.ownerUserId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, errorMessage: "Unable to update the agent right now.", revokedCredentials: 0 };
  }
  if (!data) {
    return { ok: false, errorMessage: "Agent was not found.", revokedCredentials: 0 };
  }

  let revokedCredentials = 0;
  if (archived) {
    try {
      revokedCredentials = await resolved.credentials.revokeActiveForAgent(
        agentId,
        resolved.ownerUserId,
      );
    } catch {
      return {
        ok: false,
        errorMessage: "Agent archived, but its credentials could not be revoked.",
        revokedCredentials: 0,
      };
    }
  }

  return { ok: true, errorMessage: null, revokedCredentials };
}

export type AgentCredentialIssueResult =
  | { ok: true; token: string; tokenPrefix: string }
  | { ok: false; errorMessage: string };

/**
 * Issue a credential for one configured identity. The raw token is returned to
 * the caller once; only its HMAC hash is persisted. Re-issuing never changes
 * historical attribution because activity rows reference the actor id.
 */
export async function issueAgentCredential(
  input: { agentId: string; name: unknown; scopes: unknown },
  options?: { client?: SupabaseServerClient; credentials?: AgentCredentialStore },
): Promise<AgentCredentialIssueResult> {
  if (!isAgentId(input.agentId)) {
    return { ok: false, errorMessage: "Agent was not found." };
  }

  const parsed = validateAgentCredential({ name: input.name, scopes: input.scopes });
  if (!parsed.ok) return { ok: false, errorMessage: parsed.error };

  const resolved = await resolve(options);
  if (!resolved) return { ok: false, errorMessage: "Sign in to issue a credential." };

  const { data: actor, error: actorError } = await resolved.client
    .from("agent_actors")
    .select("id, archived_at")
    .eq("id", input.agentId)
    .eq("owner_user_id", resolved.ownerUserId)
    .maybeSingle();

  if (actorError) return { ok: false, errorMessage: "Unable to load this agent right now." };
  if (!actor) return { ok: false, errorMessage: "Agent was not found." };
  if (actor.archived_at !== null) {
    return { ok: false, errorMessage: "Reactivate this agent before issuing a credential." };
  }

  try {
    const token = await generateAgentToken(
      resolved.ownerUserId,
      parsed.value.name,
      parsed.value.scopes,
      resolved.credentials,
      input.agentId,
    );
    const parsedToken = parseBearerToken(`Bearer ${token}`);
    return { ok: true, token, tokenPrefix: parsedToken?.prefix ?? "" };
  } catch {
    return { ok: false, errorMessage: "Unable to issue a credential right now." };
  }
}

export type AgentCredentialRevokeResult = { ok: boolean; errorMessage: string | null };

/**
 * Revoke exactly one credential. Authentication resolves the token on every
 * request, so the next request with this credential fails immediately.
 */
export async function revokeAgentCredential(
  credentialId: string,
  options?: { client?: SupabaseServerClient; credentials?: AgentCredentialStore },
): Promise<AgentCredentialRevokeResult> {
  if (!isAgentId(credentialId)) {
    return { ok: false, errorMessage: "Credential was not found." };
  }

  const resolved = await resolve(options);
  if (!resolved) return { ok: false, errorMessage: "Sign in to revoke a credential." };

  const record = await resolved.credentials.findByIdForOwner(
    credentialId,
    resolved.ownerUserId,
  );
  if (!record) return { ok: false, errorMessage: "Credential was not found." };
  if (record.revokedAt !== null) return { ok: true, errorMessage: null };

  await resolved.credentials.revokeToken(credentialId);
  return { ok: true, errorMessage: null };
}
