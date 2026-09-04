import { SHORTCUT_ROUTE_MAP } from "@/lib/keyboard-shortcuts";
import type { WorkspaceSearchResults } from "@/lib/services/workspace-search-service";

export type CommandPaletteGroupId = "go-to" | "tasks" | "projects" | "goals" | "quick-actions";

export type CommandPaletteItem = {
  id: string;
  group: CommandPaletteGroupId;
  label: string;
  hint: string | null;
  href: `/${string}`;
  action?: "capture";
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
  "quick-actions": "Quick actions",
};

const NAVIGATION_ITEMS: Array<Pick<CommandPaletteItem, "label" | "href">> = [
  { label: "Today", href: SHORTCUT_ROUTE_MAP.today },
  { label: "Tasks", href: SHORTCUT_ROUTE_MAP.tasks },
  { label: "Goals", href: SHORTCUT_ROUTE_MAP.goals },
  { label: "Timer", href: SHORTCUT_ROUTE_MAP.timer },
  { label: "Review", href: SHORTCUT_ROUTE_MAP.review },
  { label: "Analytics", href: "/work-analytics" },
  { label: "Ideas", href: "/ideas" },
  { label: "Notifications", href: "/notifications" },
  { label: "Startup", href: "/startup" },
  { label: "Shutdown", href: "/shutdown" },
  { label: "Apps", href: SHORTCUT_ROUTE_MAP.apps },
  { label: "Help", href: "/help" },
  { label: "Settings", href: "/settings/account" },
];

const QUICK_ACTION_ITEMS: Array<Pick<CommandPaletteItem, "label" | "href" | "hint" | "action">> = [
  { label: "Capture to Inbox", href: "/ideas", hint: "Capture", action: "capture" },
  { label: "Open Tasks", href: "/tasks", hint: "Tasks" },
  { label: "New Project", href: "/tasks/projects/new", hint: "Project" },
  { label: "Open Goals", href: "/goals", hint: "Goals" },
  { label: "Open Timer", href: "/timer", hint: "Timer" },
  { label: "Open Today", href: "/today", hint: "Today" },
  { label: "Open Review", href: "/review", hint: "Review" },
];

function navigationItems(): CommandPaletteItem[] {
  return NAVIGATION_ITEMS.map((item) => ({
    id: `nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`,
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

function quickActionItems(): CommandPaletteItem[] {
  return QUICK_ACTION_ITEMS.map((item) => ({
    id: `qa-${item.label.toLowerCase().replace(/\s+/g, "-")}`,
    group: "quick-actions",
    label: item.label,
    hint: item.hint ?? null,
    href: item.href,
    action: item.action,
  }));
}

export function filterQuickActionItems(query: string): CommandPaletteItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return quickActionItems();
  }

  return quickActionItems().filter((item) => item.label.toLowerCase().includes(normalizedQuery));
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
