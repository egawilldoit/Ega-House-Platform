export type ShortcutRouteId =
  | "today"
  | "tasks"
  | "projects"
  | "goals"
  | "timer"
  | "review"
  | "backlog"
  | "notifications"
  | "settings"
  | "apps";

export type ShortcutDefinition = {
  id: string;
  description: string;
  combo: string;
  group: "Navigation" | "Actions" | "Task actions" | "Help";
};

export const SHORTCUT_ROUTE_MAP: Record<ShortcutRouteId, `/${string}`> = {
  today: "/today",
  tasks: "/tasks",
  projects: "/tasks/projects",
  goals: "/goals",
  timer: "/timer",
  review: "/review",
  backlog: "/backlog",
  notifications: "/notifications",
  settings: "/settings/account",
  apps: "/apps",
};

export const SHORTCUT_HELP_SECTIONS: Array<{
  title: ShortcutDefinition["group"];
  shortcuts: ShortcutDefinition[];
}> = [
  {
    title: "Navigation",
    shortcuts: [
      { id: "go-today", description: "Go to Today", combo: "G then D", group: "Navigation" },
      { id: "go-tasks", description: "Go to Tasks", combo: "G then T", group: "Navigation" },
      { id: "go-goals", description: "Go to Goals", combo: "G then O", group: "Navigation" },
      { id: "go-timer", description: "Go to Timer", combo: "G then I", group: "Navigation" },
      { id: "go-review", description: "Go to Review", combo: "G then R", group: "Navigation" },
      { id: "go-projects", description: "Go to Projects", combo: "G then P", group: "Navigation" },
      { id: "go-backlog", description: "Go to Backlog", combo: "G then B", group: "Navigation" },
      {
        id: "go-notifications",
        description: "Go to Notifications",
        combo: "G then N",
        group: "Navigation",
      },
      { id: "go-settings", description: "Go to Settings", combo: "G then S", group: "Navigation" },
      { id: "go-apps", description: "Open Apps launcher", combo: "G then A", group: "Navigation" },
    ],
  },
  {
    title: "Task actions",
    shortcuts: [
      { id: "task-todo", description: "Set status: To do", combo: "1", group: "Task actions" },
      {
        id: "task-in-progress",
        description: "Set status: In progress",
        combo: "2",
        group: "Task actions",
      },
      { id: "task-review", description: "Set status: In review", combo: "3", group: "Task actions" },
      { id: "task-done", description: "Set status: Done", combo: "4", group: "Task actions" },
      { id: "task-blocked", description: "Set status: Blocked", combo: "5", group: "Task actions" },
      {
        id: "task-priority",
        description: "Set priority (then 1–4)",
        combo: "P",
        group: "Task actions",
      },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { id: "open-search", description: "Search workspace", combo: "Ctrl/Cmd + K", group: "Actions" },
      { id: "open-apps", description: "Open Apps launcher", combo: "Ctrl/Cmd + Shift + A", group: "Actions" },
      { id: "open-quick-task", description: "Open Quick task", combo: "Ctrl/Cmd + Shift + N", group: "Actions" },
      { id: "open-inbox-capture", description: "Add to Backlog", combo: "Ctrl/Cmd + Shift + I", group: "Actions" },
      { id: "open-timer", description: "Go to Timer", combo: "Ctrl/Cmd + Shift + T", group: "Actions" },
    ],
  },
  {
    title: "Help",
    shortcuts: [
      { id: "open-shortcuts", description: "Open shortcut help", combo: "?", group: "Help" },
      { id: "close-surface", description: "Close open sheet or dialog", combo: "Esc", group: "Help" },
    ],
  },
];

export const SHORTCUT_ROUTE_SEQUENCE = "g";
export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1200;
export const SHORTCUT_NAV_KEY_MAP: Record<string, ShortcutRouteId> = {
  a: "apps",
  b: "backlog",
  d: "today",
  g: "goals",
  i: "timer",
  n: "notifications",
  o: "goals",
  p: "projects",
  r: "review",
  s: "settings",
  t: "tasks",
};

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === "textarea") {
    return true;
  }

  if (tagName !== "input") {
    return false;
  }

  const input = target as HTMLInputElement;
  return input.type !== "checkbox" && input.type !== "radio" && input.type !== "button";
}

export function shouldOpenShortcutHelp(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey;
}

export function getShortcutRouteFromSequenceKey(key: string): ShortcutRouteId | null {
  return SHORTCUT_NAV_KEY_MAP[key.toLowerCase()] ?? null;
}

export function isExactShortcutCombo(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  config: {
    key: string;
    metaOrCtrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  },
): boolean {
  const normalizedKey = event.key.toLowerCase();
  const expectedKey = config.key.toLowerCase();
  const expectsMetaOrCtrl = config.metaOrCtrl ?? false;
  const expectsShift = config.shift ?? false;
  const expectsAlt = config.alt ?? false;

  return (
    normalizedKey === expectedKey
    && (!expectsMetaOrCtrl || event.metaKey || event.ctrlKey)
    && (expectsMetaOrCtrl || (!event.metaKey && !event.ctrlKey))
    && event.shiftKey === expectsShift
    && event.altKey === expectsAlt
  );
}

// ---------------------------------------------------------------------------
// Task actions (EGA-788)
//
// Number keys are the only character shortcuts that mutate data, so they live
// behind an owner-scoped enable/disable preference (WCAG 2.2 character-key
// shortcuts) and only apply while the task drawer owns focus.
// ---------------------------------------------------------------------------

export const TASK_STATUS_KEY_MAP = {
  "1": "todo",
  "2": "in_progress",
  "3": "review",
  "4": "done",
  "5": "blocked",
} as const;

export const TASK_PRIORITY_SEQUENCE = "p";

export const TASK_PRIORITY_KEY_MAP = {
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "urgent",
} as const;

export type TaskStatusKey = keyof typeof TASK_STATUS_KEY_MAP;
export type TaskPriorityKey = keyof typeof TASK_PRIORITY_KEY_MAP;

export const CHARACTER_SHORTCUTS_STORAGE_PREFIX = "ega:shortcuts:character-enabled";

export function characterShortcutsStorageKey(ownerId: string | null): string {
  return `${CHARACTER_SHORTCUTS_STORAGE_PREFIX}:${ownerId ?? "anonymous"}`;
}

/** Default on, but the stored owner preference always wins. */
export function readCharacterShortcutsEnabled(
  storage: Pick<Storage, "getItem"> | null,
  ownerId: string | null,
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(characterShortcutsStorageKey(ownerId)) !== "false";
  } catch {
    return true;
  }
}

export function writeCharacterShortcutsEnabled(
  storage: Pick<Storage, "setItem"> | null,
  ownerId: string | null,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(characterShortcutsStorageKey(ownerId), enabled ? "true" : "false");
  } catch {
    // Private mode / disabled storage: keep the in-memory preference only.
  }
}

/**
 * A single-character shortcut is only honoured outside editable controls, with
 * no modifier, no IME composition, and not while a nested menu/dialog owns the
 * keyboard.
 */
export function canHandleCharacterShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing" | "target"
  >,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing) return false;
  if (event.key.length !== 1) return false;
  if (isEditableShortcutTarget(event.target)) return false;

  const target = event.target;
  if (typeof Element !== "undefined" && target instanceof Element) {
    if (target.closest("[role='menu'], [role='dialog'], [role='listbox']")) {
      // The drawer itself is a dialog; its own editor handles these keys.
      if (target.closest("[data-task-shortcut-scope]")) return true;
      return false;
    }
  }

  return true;
}
