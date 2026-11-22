export const PROJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "list", label: "List" },
  { value: "files", label: "Files" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

/**
 * Server-safe tab normalization. Keep this module free of `"use client"` so the
 * project detail Server Component can call it without crossing the RSC
 * boundary; the tab navigation component imports the same values.
 */
export function normalizeProjectTab(value: string | null | undefined): ProjectTab {
  if (value === "list") return "list";
  if (value === "files") return "files";
  return "overview";
}
