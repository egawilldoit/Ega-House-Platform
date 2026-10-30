import type { AgentCapabilities, AgentTokenScopes } from "@/lib/contracts/agent";

/**
 * Presentation + validation contract for the agent registry (EGA-800).
 *
 * This module is deliberately pure: server services, server actions and client
 * components share these rules without importing persistence. `kind` and `role`
 * are owner-declared labels, never authorization grants.
 */

export const AGENT_KINDS = ["t3", "opencode", "codex", "runner", "custom"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  t3: "T3",
  opencode: "OpenCode",
  codex: "Codex",
  runner: "Runner",
  custom: "Custom",
};

export const AGENT_AVATAR_COLORS = [
  "blue",
  "violet",
  "green",
  "amber",
  "slate",
  "rose",
] as const;
export type AgentAvatarColor = (typeof AGENT_AVATAR_COLORS)[number];

export type AgentCredentialSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: AgentTokenScopes;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type AgentEventSummary = {
  id: string;
  action: string;
  label: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string;
  createdAt: string;
};

export type AgentActorSummary = {
  id: string;
  displayName: string;
  kind: AgentKind;
  role: string | null;
  avatarColor: AgentAvatarColor;
  archivedAt: string | null;
  createdAt: string;
  credentials: AgentCredentialSummary[];
  capabilities: AgentCapabilities;
  lastObservedAt: string | null;
  lastObservedLabel: string | null;
  eventCount: number;
};

export type AgentActorDetail = AgentActorSummary & {
  events: AgentEventSummary[];
};

export type AgentIdentityInput = {
  displayName: string;
  kind: AgentKind;
  role: string | null;
  avatarColor: AgentAvatarColor;
};

export type AgentIdentityValidation =
  | { ok: true; value: AgentIdentityInput }
  | { ok: false; error: string };

export type AgentCredentialInput = {
  name: string;
  scopes: AgentTokenScopes;
};

export type AgentCredentialValidation =
  | { ok: true; value: AgentCredentialInput }
  | { ok: false; error: string };

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

export function isAgentAvatarColor(value: unknown): value is AgentAvatarColor {
  return (
    typeof value === "string" &&
    (AGENT_AVATAR_COLORS as readonly string[]).includes(value)
  );
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function readBoundedText(
  value: unknown,
  label: string,
  maximum: number,
  options?: { optional?: boolean },
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    if (options?.optional) return { ok: true, value: null };
    return { ok: false, error: `${label} is required.` };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be text.` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options?.optional) return { ok: true, value: null };
    return { ok: false, error: `${label} is required.` };
  }
  if (trimmed.length > maximum) {
    return { ok: false, error: `${label} must be ${maximum} characters or fewer.` };
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    return { ok: false, error: `${label} contains unsupported characters.` };
  }

  return { ok: true, value: trimmed };
}

export function validateAgentIdentity(input: {
  displayName: unknown;
  kind: unknown;
  role?: unknown;
  avatarColor?: unknown;
}): AgentIdentityValidation {
  const displayName = readBoundedText(input.displayName, "Display name", 80);
  if (!displayName.ok) return displayName;

  if (!isAgentKind(input.kind)) {
    return { ok: false, error: "Choose a supported agent kind." };
  }

  const role = readBoundedText(input.role, "Role", 64, { optional: true });
  if (!role.ok) return role;

  const avatarColor = input.avatarColor ?? "slate";
  if (!isAgentAvatarColor(avatarColor)) {
    return { ok: false, error: "Choose a supported avatar colour." };
  }

  return {
    ok: true,
    value: {
      displayName: displayName.value as string,
      kind: input.kind,
      role: role.value,
      avatarColor,
    },
  };
}

export function validateAgentCredential(input: {
  name: unknown;
  scopes: unknown;
}): AgentCredentialValidation {
  const name = readBoundedText(input.name, "Credential name", 120);
  if (!name.ok) return name;

  const scopes = parseCredentialScopes(input.scopes);
  if (!scopes.ok) return scopes;

  return {
    ok: true,
    value: { name: name.value as string, scopes: scopes.value },
  };
}

function parseCredentialScopes(
  raw: unknown,
): { ok: true; value: AgentTokenScopes } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Choose at least one capability." };
  }

  const input = raw as Record<string, unknown>;
  const tasksRaw =
    input.tasks && typeof input.tasks === "object" && !Array.isArray(input.tasks)
      ? (input.tasks as Record<string, unknown>)
      : {};
  const projectsRaw =
    input.projects && typeof input.projects === "object" && !Array.isArray(input.projects)
      ? (input.projects as Record<string, unknown>)
      : {};
  const goalsRaw =
    input.goals && typeof input.goals === "object" && !Array.isArray(input.goals)
      ? (input.goals as Record<string, unknown>)
      : {};

  const allowedTaskKeys = new Set([
    "read",
    "create",
    "updateAny",
    "archive",
    "bulk",
    "comment",
    "bulkLimit",
    "idempotency",
  ]);
  for (const key of Object.keys(tasksRaw)) {
    if (!allowedTaskKeys.has(key)) {
      return { ok: false, error: "A credential scope is not supported." };
    }
  }

  const taskScopes: NonNullable<AgentTokenScopes["tasks"]> = {};
  for (const key of ["read", "create", "updateAny", "archive", "bulk", "comment"] as const) {
    if (tasksRaw[key] === true) taskScopes[key] = true;
  }
  if (typeof tasksRaw.bulkLimit === "number" && Number.isInteger(tasksRaw.bulkLimit)) {
    if (tasksRaw.bulkLimit < 1 || tasksRaw.bulkLimit > 50) {
      return { ok: false, error: "Bulk limit must be between 1 and 50." };
    }
    taskScopes.bulkLimit = tasksRaw.bulkLimit;
  }
  if (tasksRaw.idempotency === "source+sourceId") {
    taskScopes.idempotency = tasksRaw.idempotency;
  }

  const projectScopes = projectsRaw.read === true ? { read: true as const } : undefined;
  const goalScopes = goalsRaw.read === true ? { read: true as const } : undefined;

  if (
    Object.keys(taskScopes).length === 0 &&
    projectScopes === undefined &&
    goalScopes === undefined
  ) {
    return { ok: false, error: "Choose at least one capability." };
  }

  return {
    ok: true,
    value: {
      ...(Object.keys(taskScopes).length > 0 ? { tasks: taskScopes } : {}),
      ...(projectScopes ? { projects: projectScopes } : {}),
      ...(goalScopes ? { goals: goalScopes } : {}),
    },
  };
}

/**
 * Active credentials are additive: a capability is granted when any active
 * credential grants it. Revoked credentials contribute nothing.
 */
export function mergeAgentCapabilities(scopesList: AgentTokenScopes[]): AgentCapabilities {
  const capabilities: AgentCapabilities = {
    tasks: {
      read: false,
      create: false,
      updateAny: false,
      archive: false,
      bulk: false,
      comment: false,
    },
    projects: { read: false },
    goals: { read: false },
  };

  for (const scopes of scopesList) {
    const tasks = scopes.tasks ?? {};
    if (tasks.read === true) capabilities.tasks.read = true;
    if (tasks.create === true) capabilities.tasks.create = true;
    if (tasks.updateAny === true) capabilities.tasks.updateAny = true;
    if (tasks.archive === true) capabilities.tasks.archive = true;
    if (tasks.bulk === true) capabilities.tasks.bulk = true;
    if (tasks.comment === true) capabilities.tasks.comment = true;
    if (typeof tasks.bulkLimit === "number") {
      capabilities.tasks.bulkLimit = Math.max(capabilities.tasks.bulkLimit ?? 0, tasks.bulkLimit);
    }
    if (tasks.idempotency === "source+sourceId") {
      capabilities.tasks.idempotency = tasks.idempotency;
    }
    if (scopes.projects?.read === true) capabilities.projects.read = true;
    if (scopes.goals?.read === true) capabilities.goals.read = true;
  }

  return capabilities;
}

export function formatAgentCapabilities(capabilities: AgentCapabilities): string[] {
  const lines: string[] = [];
  const taskLabels: string[] = [];
  if (capabilities.tasks.read) taskLabels.push("read");
  if (capabilities.tasks.create) taskLabels.push("create");
  if (capabilities.tasks.updateAny) taskLabels.push("update");
  if (capabilities.tasks.archive) taskLabels.push("archive");
  if (capabilities.tasks.bulk) taskLabels.push("bulk");
  if (capabilities.tasks.comment) taskLabels.push("comment");
  if (taskLabels.length > 0) {
    const limit = capabilities.tasks.bulkLimit
      ? ` (up to ${capabilities.tasks.bulkLimit} per request)`
      : "";
    lines.push(`Tasks: ${taskLabels.join(", ")}${limit}`);
  }
  if (capabilities.projects.read) lines.push("Projects: read");
  if (capabilities.goals.read) lines.push("Goals: read");
  return lines.length > 0 ? lines : ["No active capability"];
}

export function describeAgentEvent(action: string, outcome?: string | null): string {
  const labels: Record<string, string> = {
    "task.created": "Created a task",
    "task.updated": "Updated a task",
    archive: "Archived a task",
    unarchive: "Restored a task",
    mcp_tool_call: "Used an MCP tool",
  };
  const base = labels[action] ?? action.replace(/[._]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  if (outcome === "failure" || outcome === "error") return `${base} — failed`;
  if (outcome === "denied") return `${base} — denied`;
  return base;
}

export function agentInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return "?";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}
