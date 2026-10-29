export const AREA_NAME_MAX_LENGTH = 80;
export const AREA_DESCRIPTION_MAX_LENGTH = 500;

export const AREA_COLOR_VALUES = [
  "blue",
  "orange",
  "purple",
  "green",
  "yellow",
  "slate",
  "red",
  "teal",
] as const;

export type AreaColor = (typeof AREA_COLOR_VALUES)[number];

export const DEFAULT_AREA_COLOR: AreaColor = "slate";

export const AREA_ICON_VALUES = [
  "folder",
  "briefcase",
  "dumbbell",
  "compass",
  "sparkles",
  "home",
  "heart-pulse",
  "book-open",
  "target",
] as const;

export type AreaIcon = (typeof AREA_ICON_VALUES)[number];

export const DEFAULT_AREA_ICON: AreaIcon = "folder";

export type AreaFormValues = {
  name: string;
  icon: AreaIcon;
  color: AreaColor;
  description: string;
};

export type AreaFormValidation =
  | Readonly<{ ok: true; values: AreaFormValues }>
  | Readonly<{ ok: false; errorMessage: string; values: AreaFormValues }>;

export function isAreaColor(value: unknown): value is AreaColor {
  return (AREA_COLOR_VALUES as readonly string[]).includes(String(value ?? ""));
}

export function isAreaIcon(value: unknown): value is AreaIcon {
  return (AREA_ICON_VALUES as readonly string[]).includes(String(value ?? ""));
}

/**
 * Validate and normalize untrusted Area form input at the boundary. Invalid
 * presentation tokens fall back to the documented defaults; the name and
 * description are bounded so persisted rows cannot exceed the column sizes.
 */
export function normalizeAreaFormValues(input: {
  name: unknown;
  icon: unknown;
  color: unknown;
  description: unknown;
}): AreaFormValidation {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const icon = isAreaIcon(input.icon) ? input.icon : DEFAULT_AREA_ICON;
  const color = isAreaColor(input.color) ? input.color : DEFAULT_AREA_COLOR;
  const values: AreaFormValues = { name, icon, color, description };

  if (!name) {
    return { ok: false, errorMessage: "Area name is required.", values };
  }

  if (name.length > AREA_NAME_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `Area name must be ${AREA_NAME_MAX_LENGTH} characters or fewer.`,
      values,
    };
  }

  if (description.length > AREA_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `Area description must be ${AREA_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      values,
    };
  }

  return { ok: true, values };
}
