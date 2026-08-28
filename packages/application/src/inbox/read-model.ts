import { isInboxType, isManualInboxStatus, normalizeInboxPriority, normalizeOptionalProjectId, parseInboxTags } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { InboxProjectOptionRecord, InboxQuery, InboxRecord, InboxRepository } from "./ports";

export type ParsedInboxListQuery = InboxQuery & {
  // raw parsed filters for echo back
};

export function parseInboxListQuery(
  query: (name: string) => string | undefined | null,
): { ok: true; data: InboxQuery } | { ok: false; message: string } {
  const viewParam = (query("view") ?? "active").trim().toLowerCase();
  const view = (["active", "archived", "all"] as readonly string[]).includes(viewParam) ? (viewParam as "active" | "archived" | "all") : "active";

  const searchParam = (query("search") ?? query("q") ?? "").trim();
  const search = searchParam || null;

  const typeParam = (query("type") ?? "all").trim().toLowerCase();
  let type: InboxQuery["type"] = null;
  if (typeParam && typeParam !== "all") {
    if (!isInboxType(typeParam)) return { ok: false, message: "Invalid type filter." };
    type = typeParam as unknown as typeof type;
  }

  const statusParam = (query("status") ?? "all").trim().toLowerCase();
  let status: InboxQuery["status"] = null;
  if (statusParam && statusParam !== "all") {
    if (!isManualInboxStatus(statusParam)) return { ok: false, message: "Invalid status filter." };
    status = statusParam as unknown as typeof status;
  }

  const projectParam = (query("project") ?? query("projectId") ?? "all").trim();
  let projectId: string | null = null;
  let projectFilter: InboxQuery["projectFilter"] = null;
  if (projectParam === "none") {
    projectFilter = "none";
  } else if (projectParam && projectParam !== "all") {
    const normalized = normalizeOptionalProjectId(projectParam);
    if (normalized === "") return { ok: false, message: "Invalid project filter." };
    projectId = normalized;
    projectFilter = null;
  } else {
    projectFilter = "all";
  }

  const priorityParam = (query("priority") ?? "all").trim().toLowerCase();
  let priority: InboxQuery["priority"] = null;
  let priorityFilter: InboxQuery["priorityFilter"] = null;
  if (priorityParam === "none") {
    priorityFilter = "none";
  } else if (priorityParam && priorityParam !== "all") {
    const normalized = normalizeInboxPriority(priorityParam);
    if (!normalized) return { ok: false, message: "Invalid priority filter." };
    priority = normalized;
  } else {
    priorityFilter = "all";
  }

  const tagParam = (query("tag") ?? "").trim();
  let tag: string | null = null;
  if (tagParam) {
    try {
      const parsed = parseInboxTags(tagParam);
      tag = parsed[0] ?? null;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Invalid tag filter." };
    }
  }

  return {
    ok: true,
    data: {
      view: view as unknown as typeof view,
      search,
      type,
      status,
      projectId,
      projectFilter,
      priority,
      priorityFilter,
      tag,
    },
  };
}

export async function getInboxReadModel(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  rawQuery?: Record<string, string | undefined>,
): Promise<ApplicationResult<{ items: InboxRecord[]; projects: InboxProjectOptionRecord[]; total: number }>> {
  let query: InboxQuery | undefined;
  if (rawQuery) {
    const parsed = parseInboxListQuery((name) => rawQuery[name]);
    if (!parsed.ok) return applicationFailure(parsed.message);
    query = parsed.data;
  }

  const [itemsResult, projectsResult] = await Promise.all([
    repository.listInboxItems(actor, query),
    repository.listProjectOptions(actor),
  ]);

  if (!itemsResult.ok || !projectsResult.ok) {
    return applicationFailure("Unable to load ideas right now.");
  }

  return applicationSuccess({
    items: itemsResult.value,
    projects: projectsResult.value,
    total: itemsResult.value.length,
  });
}
