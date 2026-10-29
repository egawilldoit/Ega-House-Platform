import type { WorkspaceSearchResults } from "@/lib/services/workspace-search-service";
import type { WorkspaceSearchScope } from "@/lib/workspace-search";
import { WORKSPACE_COMMANDS, filterWorkspaceCommands } from "@/lib/workspace-commands";

export type CommandPaletteGroupId = "go-to" | "tasks" | "projects" | "goals" | "ideas" | "quick-actions";

export type CommandPaletteMode = "search" | "commands" | "recents";

export const COMMAND_PALETTE_MODES: Array<{ id: CommandPaletteMode; label: string; hint: string }> = [
  { id: "search", label: "Search", hint: "Alt+1" },
  { id: "commands", label: "Commands", hint: "Alt+2" },
  { id: "recents", label: "Recents", hint: "Alt+3" },
];

export const COMMAND_PALETTE_SCOPE_LABELS: Record<WorkspaceSearchScope, string> = {
  all: "All",
  tasks: "Tasks",
  projects: "Projects",
  goals: "Goals",
  ideas: "Ideas",
};

export type CommandPaletteItem = {
  id: string;
  group: CommandPaletteGroupId;
  label: string;
  hint: string | null;
  href: `/${string}`;
  action?: "capture" | "quick-task";
};

export type CommandPaletteSection = {
  id: CommandPaletteGroupId;
  title: string;
  items: CommandPaletteItem[];
};

/** A locally remembered entity, scoped to the signed-in owner. */
export type RecentCommandEntity = {
  id: string;
  kind: "task" | "project" | "goal" | "idea";
  label: string;
  href: `/${string}`;
};

const GROUP_TITLES: Record<CommandPaletteGroupId, string> = {
  "go-to": "Go to",
  tasks: "Tasks",
  projects: "Projects",
  goals: "Goals",
  ideas: "Ideas",
  "quick-actions": "Quick actions",
};

export const RECENTS_STORAGE_PREFIX = "ega:command-palette:recents";
const RECENTS_LIMIT = 8;

export function recentsStorageKey(ownerId: string | null): string {
  return `${RECENTS_STORAGE_PREFIX}:${ownerId ?? "anonymous"}`;
}

/**
 * Parse stored recents defensively. A payload written for another owner is
 * ignored instead of being shown to the next account on the same browser.
 */
export function parseStoredRecents(raw: string | null, ownerId: string | null): RecentCommandEntity[] {
  if (!raw || !ownerId) return [];
  try {
    const parsed = JSON.parse(raw) as { ownerId?: unknown; items?: unknown };
    if (parsed.ownerId !== ownerId || !Array.isArray(parsed.items)) return [];
    return parsed.items
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: String(item.id ?? ""),
        kind: item.kind as RecentCommandEntity["kind"],
        label: String(item.label ?? ""),
        href: String(item.href ?? "/") as `/${string}`,
      }))
      .filter((item) => item.id && item.label && item.href.startsWith("/"))
      .slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

export function serializeRecents(items: RecentCommandEntity[], ownerId: string | null): string {
  return JSON.stringify({ ownerId, items: items.slice(0, RECENTS_LIMIT) });
}

export function rememberRecent(
  items: RecentCommandEntity[],
  next: RecentCommandEntity,
): RecentCommandEntity[] {
  return [next, ...items.filter((item) => !(item.kind === next.kind && item.id === next.id))].slice(
    0,
    RECENTS_LIMIT,
  );
}

/** Split a label into plain and matched segments; callers render text nodes. */
export function highlightMatch(
  label: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text: label, match: false }];

  const haystack = label.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;

  while (cursor < label.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      segments.push({ text: label.slice(cursor), match: false });
      break;
    }
    if (hit > cursor) segments.push({ text: label.slice(cursor, hit), match: false });
    segments.push({ text: label.slice(hit, hit + needle.length), match: true });
    cursor = hit + needle.length;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function commandItems(group: "navigate" | "create", query: string): CommandPaletteItem[] {
  return filterWorkspaceCommands(query, group).map((command) => ({
    id: command.id,
    group: group === "navigate" ? "go-to" : "quick-actions",
    label: command.label,
    hint: command.hint,
    href: command.href ?? "/tasks",
    action: command.event ?? undefined,
  }));
}

export function filterNavigationItems(query: string): CommandPaletteItem[] {
  return commandItems("navigate", query);
}

export function filterQuickActionItems(query: string): CommandPaletteItem[] {
  return commandItems("create", query);
}

export function buildWorkspaceSections(results: WorkspaceSearchResults): CommandPaletteSection[] {
  const sections: CommandPaletteSection[] = [];

  if (results.tasks.length > 0) {
    sections.push({
      id: "tasks",
      title: GROUP_TITLES.tasks,
      items: results.tasks.map((task) => ({
        id: `task-${task.id}`,
        group: "tasks",
        // The drawer is the canonical task detail (EGA-781 URL contract).
        href: `/tasks?task=${task.id}`,
        label: task.title,
        hint: task.projectName,
      })),
    });
  }

  if (results.projects.length > 0) {
    sections.push({
      id: "projects",
      title: GROUP_TITLES.projects,
      items: results.projects.map((project) => ({
        id: `project-${project.id}`,
        group: "projects",
        label: project.name,
        hint: null,
        href: project.slug ? `/tasks/projects/${project.slug}` : "/tasks/projects",
      })),
    });
  }

  if (results.goals.length > 0) {
    sections.push({
      id: "goals",
      title: GROUP_TITLES.goals,
      items: results.goals.map((goal) => ({
        id: `goal-${goal.id}`,
        group: "goals",
        label: goal.title,
        hint: null,
        href: "/goals",
      })),
    });
  }

  if (results.ideas.length > 0) {
    sections.push({
      id: "ideas",
      title: GROUP_TITLES.ideas,
      items: results.ideas.map((idea) => ({
        id: `idea-${idea.id}`,
        group: "ideas",
        label: idea.title,
        hint: idea.status,
        href: "/backlog",
      })),
    });
  }

  return sections;
}

export function recentsSection(items: RecentCommandEntity[]): CommandPaletteSection | null {
  if (items.length === 0) return null;
  return {
    id: "go-to",
    title: "Recent",
    items: items.map((item) => ({
      id: `recent-${item.kind}-${item.id}`,
      group: "go-to",
      label: item.label,
      hint: item.kind,
      href: item.href,
    })),
  };
}

/**
 * Recover the entity behind a result href so recents can dedupe and re-open it.
 * Only unambiguous entity routes are remembered; static pages are not.
 */
export function recentEntityFromHref(
  href: string,
  label: string,
): RecentCommandEntity | null {
  try {
    const url = new URL(href, "https://ega.invalid");
    const taskId = url.searchParams.get("task");
    if (url.pathname === "/tasks" && taskId) {
      return { id: taskId, kind: "task", label, href: `/tasks?task=${taskId}` };
    }
    const projectMatch = url.pathname.match(/^\/tasks\/projects\/([^/]+)$/);
    if (projectMatch && projectMatch[1] !== "new") {
      return {
        id: projectMatch[1],
        kind: "project",
        label,
        href: `/tasks/projects/${projectMatch[1]}` as `/${string}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function flattenPaletteSections(sections: CommandPaletteSection[]): CommandPaletteItem[] {
  return sections.flatMap((section) => section.items);
}

export function nextActiveIndex(current: number, count: number, delta: number): number {
  if (count <= 0) {
    return -1;
  }

  if (current < 0 || current >= count) {
    return delta < 0 ? count - 1 : 0;
  }

  return (current + delta + count) % count;
}

export { WORKSPACE_COMMANDS };
