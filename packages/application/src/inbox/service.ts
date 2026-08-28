import {
  DEFAULT_INBOX_TYPE,
  isInboxType,
  isManualInboxStatus,
  normalizeInboxPriority,
  normalizeOptionalProjectId,
  parseInboxTags,
  validateInboxType,
  validateManualInboxStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type {
  CreateInboxRecordInput,
  InboxQuery,
  InboxRecord,
  InboxRepository,
  UpdateInboxRecordInput,
} from "./ports";

function optionalTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeTitle(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBody(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeTagsInput(value: unknown): string[] {
  try {
    return parseInboxTags(value ?? "");
  } catch (error) {
    // rethrow with consistent message; caller will map to failure
    throw error;
  }
}

async function ensureProjectVisible(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  const scope = await repository.getScope(actor);
  if (!scope.ok) return "Unable to validate idea scope right now.";
  if (!scope.value.projectIds.includes(projectId)) {
    return "Selected project is unavailable.";
  }
  return null;
}

export async function createInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: {
    title: unknown;
    body?: unknown;
    type?: unknown;
    projectId?: unknown;
    priority?: unknown;
    tags?: unknown;
    tagsInput?: unknown;
  },
): Promise<ApplicationResult<InboxRecord>> {
  const title = normalizeTitle(input.title);
  if (!title) return applicationFailure("Title is required.");

  const body = normalizeBody(input.body);
  const type = validateInboxType(input.type);
  if (type === null) return applicationFailure("Choose a valid idea type.");

  const rawProjectId = String(input.projectId ?? "").trim();
  const projectId = normalizeOptionalProjectId(rawProjectId);
  if (projectId === "") return applicationFailure("Project is invalid.");

  const priority = normalizeInboxPriority(input.priority);
  if (String(input.priority ?? "").trim() && priority === null) {
    return applicationFailure("Choose a valid priority.");
  }

  let tags: string[];
  try {
    tags = parseInboxTags(input.tags ?? input.tagsInput ?? "");
  } catch (error) {
    return applicationFailure(error instanceof Error ? error.message : "Tags are invalid.");
  }

  const scopeError = await ensureProjectVisible(actor, repository, projectId);
  if (scopeError) return applicationFailure(scopeError);

  const record: CreateInboxRecordInput = {
    title,
    body,
    type: type ?? DEFAULT_INBOX_TYPE,
    projectId,
    priority,
    tags,
  };

  const result = await repository.createInboxItem(actor, record);
  return result.ok ? applicationSuccess(result.value) : applicationFailure("Unable to create idea right now.");
}

export async function updateInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: {
    id: unknown;
    title: unknown;
    body?: unknown;
    type?: unknown;
    projectId?: unknown;
    priority?: unknown;
    tags?: unknown;
    tagsInput?: unknown;
    status: unknown;
  },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");

  const title = normalizeTitle(input.title);
  if (!title) return applicationFailure("Title is required.");

  const body = normalizeBody(input.body);
  const type = validateInboxType(input.type);
  if (type === null) return applicationFailure("Choose a valid idea type.");

  const rawProjectId = String(input.projectId ?? "").trim();
  const projectId = normalizeOptionalProjectId(rawProjectId);
  if (projectId === "") return applicationFailure("Project is invalid.");

  const priority = normalizeInboxPriority(input.priority);
  if (String(input.priority ?? "").trim() && priority === null) {
    return applicationFailure("Choose a valid priority.");
  }

  let tags: string[];
  try {
    tags = parseInboxTags(input.tags ?? input.tagsInput ?? "");
  } catch (error) {
    return applicationFailure(error instanceof Error ? error.message : "Tags are invalid.");
  }

  const statusResult = validateManualInboxStatus(input.status);
  if (statusResult.status === null) {
    return applicationFailure(statusResult.errorMessage);
  }

  const scopeError = await ensureProjectVisible(actor, repository, projectId);
  if (scopeError) return applicationFailure(scopeError);

  const record: UpdateInboxRecordInput = {
    id,
    title,
    body,
    type: type ?? DEFAULT_INBOX_TYPE,
    projectId,
    priority,
    tags,
    status: statusResult.status,
  };

  const result = await repository.updateInboxItem(actor, record);
  if (!result.ok) return applicationFailure("Unable to update idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function archiveInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: { id: unknown },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.setInboxItemStatus(actor, { id, status: "archived" });
  if (!result.ok) return applicationFailure("Unable to archive idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function restoreInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: { id: unknown },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.setInboxItemStatus(actor, { id, status: "inbox" });
  if (!result.ok) return applicationFailure("Unable to restore idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function getInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  idInput: unknown,
): Promise<ApplicationResult<InboxRecord | null>> {
  const id = String(idInput ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.getInboxItem(actor, id);
  if (!result.ok) return applicationFailure("Unable to load idea right now.");
  return applicationSuccess(result.value);
}

export async function listInboxItems(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  query?: InboxQuery,
): Promise<ApplicationResult<InboxRecord[]>> {
  const result = await repository.listInboxItems(actor, query);
  if (!result.ok) return applicationFailure("Unable to load ideas right now.");
  return applicationSuccess(result.value);
}

// Helper for parsing list filters similar to web's normalizeIdeaNoteListFilters
// Used by server and potentially web adapter.

export function normalizeInboxListFilters(filters?: {
  view?: unknown;
  search?: unknown;
  type?: unknown;
  status?: unknown;
  project?: unknown;
  projectId?: unknown;
  priority?: unknown;
  tag?: unknown;
}): {
  view: "active" | "archived" | "all";
  search: string;
  type: string;
  status: string;
  project: string;
  priority: string;
  tag: string;
} {
  const viewRaw = String(filters?.view ?? "active").trim().toLowerCase();
  const view = (["active", "archived", "all"] as const).includes(viewRaw as any) ? (viewRaw as any) : "active";
  const search = String(filters?.search ?? "").trim();
  const typeRaw = String(filters?.type ?? "all").trim().toLowerCase();
  const type = typeRaw && typeRaw !== "all" && isInboxType(typeRaw) ? typeRaw : "all";
  const statusRaw = String(filters?.status ?? "all").trim().toLowerCase();
  const status = statusRaw && statusRaw !== "all" && isManualInboxStatus(statusRaw) ? statusRaw : "all";
  const projectRaw = String(filters?.project ?? filters?.projectId ?? "all").trim();
  const prj = normalizeOptionalProjectId(projectRaw);
  const project = projectRaw === "none" ? "none" : prj || "all";
  const priRaw = String(filters?.priority ?? "all").trim().toLowerCase();
  let priority: string;
  if (priRaw && priRaw !== "all" && priRaw !== "none") {
    priority = normalizeInboxPriority(priRaw) ?? "all";
  } else if (priRaw === "none") {
    priority = "none";
  } else {
    priority = "all";
  }
  let tag = "";
  try {
    const parsed = parseInboxTags(filters?.tag ?? "");
    tag = parsed[0] ?? "";
  } catch {
    tag = "";
  }
  return { view, search, type, status, project, priority, tag };
}
