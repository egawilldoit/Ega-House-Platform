/**
 * Mobile form utilities for the new architecture flows (projects/goals).
 *
 * `normalizeMobileProjectSlug` mirrors the canonical slug normalization in
 * `@ega/application` (`normalizeProjectSlug`) so the mobile create form can
 * preview the exact slug the server will derive.
 */

export function normalizeMobileProjectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
