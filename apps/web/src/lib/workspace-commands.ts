import { SHORTCUT_ROUTE_MAP } from "@/lib/keyboard-shortcuts";

/**
 * One command registry for the command palette (and, from EGA-788, the keyboard
 * shortcut help). `href` commands navigate; `event` commands dispatch an
 * existing workspace event rather than inventing a second action path.
 */
export type WorkspaceCommand = {
  id: string;
  label: string;
  group: "navigate" | "create";
  href: `/${string}` | null;
  event: "capture" | "quick-task" | null;
  hint: string | null;
};

export const WORKSPACE_COMMANDS: readonly WorkspaceCommand[] = [
  { id: "nav-today", label: "Today", group: "navigate", href: SHORTCUT_ROUTE_MAP.today, event: null, hint: null },
  { id: "nav-tasks", label: "Tasks", group: "navigate", href: SHORTCUT_ROUTE_MAP.tasks, event: null, hint: null },
  { id: "nav-goals", label: "Goals", group: "navigate", href: SHORTCUT_ROUTE_MAP.goals, event: null, hint: null },
  { id: "nav-timer", label: "Timer", group: "navigate", href: SHORTCUT_ROUTE_MAP.timer, event: null, hint: null },
  { id: "nav-review", label: "Review", group: "navigate", href: SHORTCUT_ROUTE_MAP.review, event: null, hint: null },
  { id: "nav-analytics", label: "Analytics", group: "navigate", href: "/work-analytics", event: null, hint: null },
  { id: "nav-backlog", label: "Backlog", group: "navigate", href: "/backlog", event: null, hint: null },
  {
    id: "nav-notifications",
    label: "Notifications",
    group: "navigate",
    href: "/notifications",
    event: null,
    hint: null,
  },
  { id: "nav-startup", label: "Startup", group: "navigate", href: "/startup", event: null, hint: null },
  { id: "nav-shutdown", label: "Shutdown", group: "navigate", href: "/shutdown", event: null, hint: null },
  { id: "nav-apps", label: "Apps", group: "navigate", href: SHORTCUT_ROUTE_MAP.apps, event: null, hint: null },
  { id: "nav-help", label: "Help", group: "navigate", href: "/help", event: null, hint: null },
  {
    id: "nav-settings",
    label: "Settings",
    group: "navigate",
    href: "/settings/account",
    event: null,
    hint: null,
  },
  {
    id: "create-backlog",
    label: "Add to Backlog",
    group: "create",
    href: null,
    event: "capture",
    hint: "Capture",
  },
  {
    id: "create-task",
    label: "New task",
    group: "create",
    href: null,
    event: "quick-task",
    hint: "Task",
  },
  {
    id: "create-project",
    label: "New Project",
    group: "create",
    href: "/tasks/projects/new",
    event: null,
    hint: "Project",
  },
] as const;

export function filterWorkspaceCommands(
  query: string,
  group?: WorkspaceCommand["group"],
): WorkspaceCommand[] {
  const normalized = query.trim().toLowerCase();
  return WORKSPACE_COMMANDS.filter((command) => {
    if (group && command.group !== group) return false;
    return normalized ? command.label.toLowerCase().includes(normalized) : true;
  });
}
