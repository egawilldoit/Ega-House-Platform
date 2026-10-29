/**
 * Durable workspace preferences (EGA-798).
 *
 * Pure parsing/resolution rules shared by the application layer, server
 * components, client controls and tests. There is exactly one definition of
 * the supported values and the defaults that keep pre-existing owners on the
 * behaviour they had before preferences existed.
 */

export const USER_THEME_VALUES = ["system", "light", "dark"] as const;
export type UserTheme = (typeof USER_THEME_VALUES)[number];

export const USER_ACCENT_VALUES = ["neutral", "blue", "green", "violet", "amber"] as const;
export type UserAccent = (typeof USER_ACCENT_VALUES)[number];

export const USER_DENSITY_VALUES = ["comfortable", "compact"] as const;
export type UserDensity = (typeof USER_DENSITY_VALUES)[number];

export const USER_LAUNCH_PAGE_VALUES = ["home", "today", "tasks"] as const;
export type UserLaunchPage = (typeof USER_LAUNCH_PAGE_VALUES)[number];

/**
 * Task layouts with an implemented web view. Table and Calendar are listed by
 * the product brief but have no renderer yet, so they are not offered as a
 * durable default until their capabilities ship.
 */
export const USER_TASK_LAYOUT_VALUES = ["list", "kanban"] as const;
export type UserTaskLayout = (typeof USER_TASK_LAYOUT_VALUES)[number];

export const USER_TASK_OPEN_MODE_VALUES = ["panel", "full"] as const;
export type UserTaskOpenMode = (typeof USER_TASK_OPEN_MODE_VALUES)[number];

export type UserPreferences = Readonly<{
  theme: UserTheme;
  accent: UserAccent;
  density: UserDensity;
  /** Explicit app-level reduction; the OS setting always applies on top. */
  reducedMotion: boolean;
  launchPage: UserLaunchPage;
  taskLayout: UserTaskLayout;
  taskOpenMode: UserTaskOpenMode;
}>;

/**
 * Defaults reproduce the workspace as it behaved before preferences existed:
 * System theme, neutral accent, comfortable density, no extra motion
 * reduction, Home launch, List layout and the side-panel task detail.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  theme: "system",
  accent: "neutral",
  density: "comfortable",
  reducedMotion: false,
  launchPage: "home",
  taskLayout: "list",
  taskOpenMode: "panel",
});

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isUserTheme(value: unknown): value is UserTheme {
  return isOneOf(USER_THEME_VALUES, value);
}

export function isUserAccent(value: unknown): value is UserAccent {
  return isOneOf(USER_ACCENT_VALUES, value);
}

export function isUserDensity(value: unknown): value is UserDensity {
  return isOneOf(USER_DENSITY_VALUES, value);
}

export function isUserLaunchPage(value: unknown): value is UserLaunchPage {
  return isOneOf(USER_LAUNCH_PAGE_VALUES, value);
}

export function isUserTaskLayout(value: unknown): value is UserTaskLayout {
  return isOneOf(USER_TASK_LAYOUT_VALUES, value);
}

export function isUserTaskOpenMode(value: unknown): value is UserTaskOpenMode {
  return isOneOf(USER_TASK_OPEN_MODE_VALUES, value);
}

/** The launch preference is a policy alias; routes stay owned by the router. */
export const LAUNCH_PAGE_PATHS: Readonly<Record<UserLaunchPage, `/${string}`>> = Object.freeze({
  home: "/home",
  today: "/today",
  tasks: "/tasks",
});

export function getLaunchPagePath(page: UserLaunchPage): `/${string}` {
  return LAUNCH_PAGE_PATHS[page];
}

/** Column/attribute spelling used by the SSR document and CSS. */
export function getUserThemeAttribute(theme: UserTheme): "light" | "dark" {
  return theme === "dark" ? "dark" : "light";
}

/**
 * Normalises a persisted or partially known record. Missing or unsupported
 * values fall back per field, so a future enum addition cannot break an older
 * client and an old row keeps today's behaviour.
 */
export function normalizeUserPreferences(input: unknown): UserPreferences {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    theme: isUserTheme(value.theme) ? value.theme : DEFAULT_USER_PREFERENCES.theme,
    accent: isUserAccent(value.accent) ? value.accent : DEFAULT_USER_PREFERENCES.accent,
    density: isUserDensity(value.density) ? value.density : DEFAULT_USER_PREFERENCES.density,
    reducedMotion:
      typeof value.reducedMotion === "boolean"
        ? value.reducedMotion
        : DEFAULT_USER_PREFERENCES.reducedMotion,
    launchPage: isUserLaunchPage(value.launchPage)
      ? value.launchPage
      : DEFAULT_USER_PREFERENCES.launchPage,
    taskLayout: isUserTaskLayout(value.taskLayout)
      ? value.taskLayout
      : DEFAULT_USER_PREFERENCES.taskLayout,
    taskOpenMode: isUserTaskOpenMode(value.taskOpenMode)
      ? value.taskOpenMode
      : DEFAULT_USER_PREFERENCES.taskOpenMode,
  };
}

export type UserPreferencesPatch = {
  -readonly [K in keyof UserPreferences]?: UserPreferences[K];
};

export type UserPreferencesPatchParseResult =
  | Readonly<{ ok: true; value: UserPreferencesPatch }>
  | Readonly<{ ok: false; field: string; message: string }>;

const PATCH_FIELDS = [
  "theme",
  "accent",
  "density",
  "reducedMotion",
  "launchPage",
  "taskLayout",
  "taskOpenMode",
] as const satisfies readonly (keyof UserPreferences)[];

/**
 * Validates submitted preferences at the trust boundary.
 *
 * Only recognised keys are read; a recognised key with an unsupported value is
 * rejected instead of silently coerced, so a tampered form cannot appear to
 * save. Absent keys are left untouched (patch semantics).
 */
export function parseUserPreferencesPatch(input: unknown): UserPreferencesPatchParseResult {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const patch: UserPreferencesPatch = {};

  for (const field of PATCH_FIELDS) {
    if (!(field in value) || value[field] === undefined || value[field] === null) continue;
    const raw = value[field];

    switch (field) {
      case "reducedMotion":
        if (typeof raw !== "boolean") {
          return { ok: false, field, message: "Reduced motion must be on or off." };
        }
        patch.reducedMotion = raw;
        break;
      case "theme":
        if (!isUserTheme(raw)) {
          return { ok: false, field, message: "Choose Light, Dark or System." };
        }
        patch.theme = raw;
        break;
      case "accent":
        if (!isUserAccent(raw)) {
          return { ok: false, field, message: "Choose a supported accent." };
        }
        patch.accent = raw;
        break;
      case "density":
        if (!isUserDensity(raw)) {
          return { ok: false, field, message: "Choose Comfortable or Compact density." };
        }
        patch.density = raw;
        break;
      case "launchPage":
        if (!isUserLaunchPage(raw)) {
          return { ok: false, field, message: "Choose Home, Today or Tasks on launch." };
        }
        patch.launchPage = raw;
        break;
      case "taskLayout":
        if (!isUserTaskLayout(raw)) {
          return { ok: false, field, message: "Choose List or Kanban as the task layout." };
        }
        patch.taskLayout = raw;
        break;
      case "taskOpenMode":
        if (!isUserTaskOpenMode(raw)) {
          return { ok: false, field, message: "Choose Side panel or Full page." };
        }
        patch.taskOpenMode = raw;
        break;
    }
  }

  return { ok: true, value: patch };
}
