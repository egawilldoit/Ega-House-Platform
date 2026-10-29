import type { AreaRecord } from "@ega/application";

import { AreaColorDot, AreaIconView } from "@/components/projects/area-icon";

export type SidebarAreaProject = {
  id: string;
  areaId?: string | null;
  areaName?: string | null;
  areaColor?: string | null;
  areaIcon?: string | null;
};

export type SidebarProjectGroup<TProject extends SidebarAreaProject> = {
  key: string;
  name: string;
  icon: string | null;
  color: string | null;
  unassigned: boolean;
  projects: TProject[];
};

/**
 * Group the compact sidebar project list by Area without changing the
 * existing visible-project cap. Projects without an Area stay in one explicit
 * "No area" group, so no project silently disappears from navigation.
 */
export function groupSidebarProjects<TProject extends SidebarAreaProject>(
  projects: TProject[],
): SidebarProjectGroup<TProject>[] {
  const groups = new Map<string, SidebarProjectGroup<TProject>>();
  const unassigned: SidebarProjectGroup<TProject> = {
    key: "unassigned",
    name: "No area",
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

    groups.set(project.areaId, {
      key: project.areaId,
      name: project.areaName ?? "Area",
      icon: project.areaIcon ?? null,
      color: project.areaColor ?? null,
      unassigned: false,
      projects: [project],
    });
  }

  const result = Array.from(groups.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  if (unassigned.projects.length > 0) {
    result.push(unassigned);
  }

  return result;
}

export function SidebarAreaHeading({
  name,
  icon,
  color,
  projectCount,
  headingId,
}: {
  name: string;
  icon: string | null;
  color: string | null;
  projectCount: number;
  headingId?: string;
}) {
  return (
    <div className="sidebar-area-heading" id={headingId}>
      <AreaColorDot color={color} />
      <AreaIconView icon={icon} />
      <span className="sidebar-area-name">{name}</span>
      <span className="sidebar-area-count" aria-hidden="true">
        {projectCount}
      </span>
    </div>
  );
}

/** Area list for settings surfaces, kept here so one grouping rule is shared. */
export function sortAreasByName(areas: AreaRecord[]): AreaRecord[] {
  return [...areas].sort((left, right) => left.name.localeCompare(right.name));
}
