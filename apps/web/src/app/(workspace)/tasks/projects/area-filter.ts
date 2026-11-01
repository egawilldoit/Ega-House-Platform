import type { AreaFilter, AreaRecord } from "@ega/application";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectAreaQuery =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "unassigned" }>
  | Readonly<{ kind: "area"; areaId: string }>;

export const ALL_PROJECT_AREAS: ProjectAreaQuery = { kind: "all" };
export const UNASSIGNED_PROJECT_AREA = "unassigned";

/**
 * Parse the untrusted `area` query parameter. Unknown/malformed values fall
 * back to "all" so a legacy project URL keeps its previous flat behaviour.
 */
export function parseProjectAreaQuery(raw: string | undefined | null): ProjectAreaQuery {
  const value = String(raw ?? "").trim();

  if (!value) return ALL_PROJECT_AREAS;
  if (value === UNASSIGNED_PROJECT_AREA) return { kind: "unassigned" };
  if (UUID_PATTERN.test(value)) return { kind: "area", areaId: value };

  return ALL_PROJECT_AREAS;
}

export function toRepositoryAreaFilter(query: ProjectAreaQuery): AreaFilter {
  if (query.kind === "unassigned") return { kind: "unassigned" };
  if (query.kind === "area") return { kind: "area", areaId: query.areaId };
  return null;
}

export function buildProjectsHref(
  view: string,
  query: ProjectAreaQuery,
): string {
  const params = new URLSearchParams();
  if (view !== "active") params.set("view", view);
  if (query.kind === "unassigned") params.set("area", UNASSIGNED_PROJECT_AREA);
  if (query.kind === "area") params.set("area", query.areaId);
  const search = params.toString();
  return search ? `/tasks/projects?${search}` : "/tasks/projects";
}

export type ProjectAreaGroup<TProject extends { areaId?: string | null }> = {
  key: string;
  name: string;
  icon: string | null;
  color: string | null;
  unassigned: boolean;
  projects: TProject[];
};

/**
 * Group an already-authorized project list by Area for display. Areas keep
 * their repository order; projects with no Area appear in one explicit
 * "Unassigned" group. No project is dropped.
 */
export function groupProjectsByArea<
  TProject extends {
    areaId?: string | null;
    areaName?: string | null;
    areaIcon?: string | null;
    areaColor?: string | null;
  },
>(projects: TProject[], areas: AreaRecord[]): ProjectAreaGroup<TProject>[] {
  const groups = new Map<string, ProjectAreaGroup<TProject>>();

  for (const area of areas) {
    groups.set(area.id, {
      key: area.id,
      name: area.name,
      icon: area.icon,
      color: area.color,
      unassigned: false,
      projects: [],
    });
  }

  const unassigned: ProjectAreaGroup<TProject> = {
    key: "unassigned",
    name: "Unassigned",
    icon: null,
    color: null,
    unassigned: true,
    projects: [],
  };

  for (const project of projects) {
    if (!project.areaId) {
      unassigned.projects.push(project);
      continue;
    }

    const existing = groups.get(project.areaId);
    if (existing) {
      existing.projects.push(project);
      continue;
    }

    // Defensive: an embedded relation can lag the area list. Keep the project
    // visible under its named Area instead of dropping it.
    groups.set(project.areaId, {
      key: project.areaId,
      name: project.areaName ?? "Area",
      icon: project.areaIcon ?? null,
      color: project.areaColor ?? null,
      unassigned: false,
      projects: [project],
    });
  }

  const result = Array.from(groups.values()).filter((group) => group.projects.length > 0);
  if (unassigned.projects.length > 0) {
    result.push(unassigned);
  }

  return result;
}
