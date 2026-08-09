// Scope parsing and normalization for agent tokens.
// normalizeStoredScopes: deny-by-default for database values.
// parseRequestedScopes: strict validation for CLI/token creation.

import type { AgentTokenScopes } from "@/lib/contracts/agent";

// ---- Database value normalization (deny-by-default, never throws) ----

export function normalizeStoredScopes(raw: unknown): AgentTokenScopes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const s = raw as Record<string, unknown>;

  return {
    tasks: coerceTaskScopes(s.tasks),
    projects: coerceProjectScopes(s.projects),
    goals: coerceGoalScopes(s.goals),
  };
}

function coerceTaskScopes(raw: unknown): AgentTokenScopes["tasks"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const s = raw as Record<string, unknown>;
  const out: NonNullable<AgentTokenScopes["tasks"]> = {};

  if (s.read === true) out.read = true;
  if (s.create === true) out.create = true;
  if (s.updateAny === true) out.updateAny = true;
  if (s.archive === true) out.archive = true;
  if (s.bulk === true) out.bulk = true;

  // Preserve valid bulkLimit (integer 1-50), omit invalid values
  if (typeof s.bulkLimit === "number" && Number.isInteger(s.bulkLimit)) {
    if (s.bulkLimit >= 1 && s.bulkLimit <= 50) {
      out.bulkLimit = s.bulkLimit;
    }
  }

  // Preserve valid idempotency literal, omit invalid values
  if (s.idempotency === "source+sourceId") {
    out.idempotency = s.idempotency;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function coerceProjectScopes(raw: unknown): AgentTokenScopes["projects"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  if (s.read === true) return { read: true };
  return undefined;
}

function coerceGoalScopes(raw: unknown): AgentTokenScopes["goals"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  if (s.read === true) return { read: true };
  return undefined;
}

// ---- CLI/token-creation input validation (strict, rejects unknown keys) ----

export type ScopesValidationResult =
  | { ok: true; scopes: AgentTokenScopes }
  | { ok: false; error: string };

export function parseRequestedScopes(raw: unknown): ScopesValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "scopes are required" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "scopes must be a JSON object" };
  }

  const s = raw as Record<string, unknown>;
  const allowedTopLevel = new Set(["tasks", "projects", "goals"]);

  for (const key of Object.keys(s)) {
    if (!allowedTopLevel.has(key)) {
      return { ok: false, error: `unknown scope key: "${key}"` };
    }
  }

  // Validate each section independently
  const tasksResult = validateTaskSection(s.tasks);
  if (tasksResult && "error" in tasksResult) {
    return { ok: false as const, error: tasksResult.error };
  }

  const projectsResult = validateSimpleSection(s.projects, "projects");
  if (projectsResult && "error" in projectsResult) {
    return { ok: false as const, error: projectsResult.error };
  }

  const goalsResult = validateSimpleSection(s.goals, "goals");
  if (goalsResult && "error" in goalsResult) {
    return { ok: false as const, error: goalsResult.error };
  }

  return {
    ok: true,
    scopes: {
      ...(tasksResult?.scopes ? { tasks: tasksResult.scopes } : {}),
      ...(projectsResult?.scopes ? { projects: projectsResult.scopes } : {}),
      ...(goalsResult?.scopes ? { goals: goalsResult.scopes } : {}),
    },
  };
}

function validateTaskSection(
  raw: unknown,
): { scopes: Record<string, unknown> } | { error: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "tasks must be an object" };
  }

  const s = raw as Record<string, unknown>;
  const allowed = new Set([
    "read",
    "create",
    "updateAny",
    "archive",
    "bulk",
    "bulkLimit",
    "idempotency",
  ]);

  for (const key of Object.keys(s)) {
    if (!allowed.has(key)) {
      return { error: `unknown tasks scope key: "${key}"` };
    }
  }

  if (s.read !== undefined && typeof s.read !== "boolean") {
    return { error: "tasks.read must be a boolean" };
  }
  if (s.create !== undefined && typeof s.create !== "boolean") {
    return { error: "tasks.create must be a boolean" };
  }
  if (s.updateAny !== undefined && typeof s.updateAny !== "boolean") {
    return { error: "tasks.updateAny must be a boolean" };
  }
  if (s.archive !== undefined && typeof s.archive !== "boolean") {
    return { error: "tasks.archive must be a boolean" };
  }
  if (s.bulk !== undefined && typeof s.bulk !== "boolean") {
    return { error: "tasks.bulk must be a boolean" };
  }

  if (s.bulkLimit !== undefined) {
    if (typeof s.bulkLimit !== "number" || !Number.isInteger(s.bulkLimit)) {
      return { error: "tasks.bulkLimit must be an integer" };
    }
    if (s.bulkLimit < 1 || s.bulkLimit > 50) {
      return { error: "tasks.bulkLimit must be between 1 and 50" };
    }
  }

  if (s.idempotency !== undefined && s.idempotency !== "source+sourceId") {
    return {
      error: 'tasks.idempotency must be "source+sourceId"',
    };
  }

  return { scopes: s };
}

function validateSimpleSection(
  raw: unknown,
  name: string,
): { scopes: Record<string, unknown> } | { error: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${name} must be an object` };
  }

  const s = raw as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (key !== "read") {
      return { error: `unknown ${name} scope key: "${key}"` };
    }
  }

  if (s.read !== undefined && typeof s.read !== "boolean") {
    return { error: `${name}.read must be a boolean` };
  }

  return { scopes: s };
}
