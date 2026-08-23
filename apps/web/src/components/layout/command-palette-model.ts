import { SHORTCUT_ROUTE_MAP } from "@/lib/keyboard-shortcuts";
import type { WorkspaceSearchResults } from "@/lib/services/workspace-search-service";

export type CommandPaletteGroupId = "go-to" | "tasks" | "projects" | "goals";

export type CommandPaletteItem = {
  id: string;
  group: CommandPaletteGroupId;
  label: string;
  hint: string | null;
  href: `/${string}`;
};

export type CommandPaletteSection = {
  id: CommandPaletteGroupId;
  title: string;
  items: CommandPaletteItem[];
};

const GROUP_TITLES: Record<CommandPaletteGroupId, string> = {
  "go-to": "Go to",
  tasks: "Tasks",
  projects: "Projects",
  goals: "Goals",
};

const NAVIGATION_ITEMS: Array<Pick<CommandPaletteItem, "label" | "href">> = [
  { label: "Dashboard", href: SHORTCUT_ROUTE_MAP.dashboard },
  { label: "Today", href: "/today" },
  { label: "Tasks", href: SHORTCUT_ROUTE_MAP.tasks },
  { label: "Goals", href: SHORTCUT_ROUTE_MAP.goals },
  { label: "Timer", href: SHORTCUT_ROUTE_MAP.timer },
  { label: "Review", href: SHORTCUT_ROUTE_MAP.review },
  { label: "Apps", href: SHORTCUT_ROUTE_MAP.apps },
];

function navigationItems(): CommandPaletteItem[] {
  return NAVIGATION_ITEMS.map((item) => ({
    id: `nav-${item.label.toLowerCase()}`,
    group: "go-to",
    label: item.label,
    hint: null,
    href: item.href,
  }));
}

export function filterNavigationItems(query: string): CommandPaletteItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return navigationItems();
  }

  return navigationItems().filter((item) => item.label.toLowerCase().includes(normalizedQuery));
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
        label: task.title,
        hint: task.projectName,
        href: `/tasks#task-${task.id}`,
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

  return sections;
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
