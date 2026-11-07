/**
 * Presentation colour for each of the seven stored guidance types.
 *
 * These are display hues mixed from the existing data-category tokens, not new
 * preference values or design tokens. Unknown names (an older or hand-edited
 * record) fall back to a neutral slate so the planner never invents a category.
 */
const GUIDANCE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  Startup: "var(--ega-data-yellow)",
  "Job search": "var(--ega-data-blue)",
  Lunch: "var(--ega-data-green)",
  Leisure: "var(--ega-data-purple)",
  Chess: "var(--ega-data-slate)",
  Cooking: "var(--ega-data-orange)",
  Run: "color-mix(in srgb, var(--ega-data-blue) 55%, var(--ega-data-green))",
});

export function getGuidanceColor(name: string): string {
  return GUIDANCE_COLORS[name] ?? "var(--ega-data-slate)";
}
