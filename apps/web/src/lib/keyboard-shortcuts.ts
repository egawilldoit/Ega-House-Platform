export type ShortcutRouteId = "dashboard" | "tasks" | "goals" | "timer" | "review" | "apps";

export type ShortcutDefinition = {
  id: string;
  description: string;
  combo: string;
  group: "Navigation" | "Actions" | "Help";
};

export const SHORTCUT_ROUTE_MAP: Record<ShortcutRouteId, `/${string}`> = {
  dashboard: "/dashboard",
  tasks: "/tasks",
  goals: "/goals",
  timer: "/timer",
  review: "/review",
  apps: "/apps",
};

export const SHORTCUT_HELP_SECTIONS: Array<{
  title: ShortcutDefinition["group"];
  shortcuts: ShortcutDefinition[];
}> = [
  {
    title: "Navigation",
    shortcuts: [
      { id: "go-dashboard", description: "Go to Dashboard", combo: "G then D", group: "Navigation" },
      { id: "go-tasks", description: "Go to Tasks", combo: "G then T", group: "Navigation" },
      { id: "go-goals", description: "Go to Goals", combo: "G then O", group: "Navigation" },
      { id: "go-timer", description: "Go to Timer", combo: "G then I", group: "Navigation" },
      { id: "go-review", description: "Go to Review", combo: "G then R", group: "Navigation" },
      { id: "go-apps", description: "Open Apps launcher", combo: "G then A", group: "Navigation" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { id: "open-apps", description: "Open Apps launcher", combo: "Ctrl/Cmd + Shift + A", group: "Actions" },
      { id: "open-quick-task", description: "Open Quick task", combo: "Ctrl/Cmd + Shift + N", group: "Actions" },
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
  d: "dashboard",
  g: "goals",
  i: "timer",
  o: "goals",
  r: "review",
  t: "tasks",
};

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
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
