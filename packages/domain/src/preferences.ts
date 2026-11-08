import {
  DAYS,
  DEFAULT_PERSONAL_OPERATIONS,
  clonePersonalOperations,
  getPersonalOperationsDayPlan,
  getPersonalOperationsWeekTotals,
  isPersonalOperations,
  type Day,
  type PersonalOperations,
  type PersonalOperationsDayPlan,
  type PersonalOperationsDayPlanResult,
} from "./personal-operations";

export {
  DAYS,
  DEFAULT_PERSONAL_OPERATIONS,
  getPersonalOperationsDayPlan,
  getPersonalOperationsWeekTotals,
  isPersonalOperations,
};
export type { Day, PersonalOperations, PersonalOperationsDayPlan, PersonalOperationsDayPlanResult };

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

/**
 * Stable job-search task reference.
 *
 * Task-only by design. Project references and per-session project/reference
 * snapshots are deliberately deferred: `task_sessions` has no immutable
 * project snapshot (Track B owns session mutations), so changing the reference
 * intentionally reclassifies historical totals. That is the documented open
 * integration blocker, not a claim of historical project stability.
 */
export type JobSearchReference = Readonly<{
  kind: "task";
  id: string;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the stable job-search reference shape (kind=task + UUID id). */
export function isJobSearchReference(value: unknown): value is JobSearchReference {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    (value as Record<string, unknown>).kind === "task" &&
    typeof (value as Record<string, unknown>).id === "string" &&
    UUID_RE.test((value as Record<string, unknown>).id as string)
  );
}

export type UserPreferences = Readonly<{
  personalOperations: PersonalOperations;
  jobSearchReference: JobSearchReference | null;
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
  personalOperations: DEFAULT_PERSONAL_OPERATIONS,
  jobSearchReference: null,
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
    // Always detached: callers edit drafts and the global defaults are frozen.
    personalOperations: clonePersonalOperations(
      isPersonalOperations(value.personalOperations)
        ? value.personalOperations
        : DEFAULT_PERSONAL_OPERATIONS,
    ),
    jobSearchReference: isJobSearchReference(value.jobSearchReference) ? value.jobSearchReference : null,
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
  "personalOperations",
  "jobSearchReference",
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, field: "preferences", message: "Preferences must be an object." };
  }
  const value = input as Record<string, unknown>;
  const patch: UserPreferencesPatch = {};

  for (const field of PATCH_FIELDS) {
    if (!(field in value) || value[field] === undefined || (value[field] === null && field !== "personalOperations" && field !== "jobSearchReference")) continue;
    const raw = value[field];

    switch (field) {
      case "personalOperations":
        if (!isPersonalOperations(raw)) return { ok: false, field, message: "Check schedule targets and guidance; enabled blocks cannot overlap." };
        patch.personalOperations = raw;
        break;
      case "jobSearchReference":
        if (raw === null) {
          patch.jobSearchReference = null;
          break;
        }
        if (!isJobSearchReference(raw)) {
          return { ok: false, field, message: "Choose a valid task for job search." };
        }
        patch.jobSearchReference = raw;
        break;
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
