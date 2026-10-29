import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Contrast contract for the workspace palettes.
 *
 * The test reads the light `:root` block and the scoped dark block from
 * `styles/tokens.css` separately. Finding a token by name alone would always
 * return the light declaration and silently validate the same palette twice.
 */

const tokensCss = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

const LIGHT_SELECTOR = ":root {";
const DARK_SELECTOR = 'html[data-theme="dark"]:has([data-workspace-theme="workspace"]) {';

function blockFor(selector: string): string {
  const start = tokensCss.indexOf(selector);
  assert.ok(start >= 0, `missing token block: ${selector}`);

  const opening = tokensCss.indexOf("{", start);
  assert.ok(opening >= 0, `incomplete token block: ${selector}`);

  let depth = 0;
  for (let index = opening; index < tokensCss.length; index += 1) {
    if (tokensCss[index] === "{") depth += 1;
    if (tokensCss[index] === "}") {
      depth -= 1;
      if (depth === 0) return tokensCss.slice(opening + 1, index);
    }
  }

  throw new Error(`unterminated token block: ${selector}`);
}

const LIGHT = blockFor(LIGHT_SELECTOR);
const DARK = blockFor(DARK_SELECTOR);

function token(block: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escaped}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token ${name} must be a hex colour`);
  return match[1] as string;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
  const [r, g, b] = channels.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_NORMAL = 4.5;
const AA_NON_TEXT = 3;

const SURFACES = [
  "--ega-surface",
  "--ega-bg",
  "--ega-surface-subtle",
  "--ega-surface-hover",
  "--ega-surface-selected",
  "--ega-surface-muted",
  "--ega-surface-elevated",
] as const;

const TEXT_TOKENS = ["--ega-text", "--ega-text-secondary", "--ega-text-tertiary"] as const;

const STATUS_PAIRS: Array<[string, string]> = [
  ["--status-healthy", "--status-healthy-bg"],
  ["--status-risk", "--status-risk-bg"],
  ["--status-overdue", "--status-overdue-bg"],
  ["--status-pending", "--status-pending-bg"],
  ["--status-info", "--status-info-bg"],
  ["--priority-high", "--priority-high-bg"],
  ["--priority-medium", "--priority-medium-bg"],
  ["--priority-low", "--priority-low-bg"],
];

for (const [paletteName, block] of [
  ["light", LIGHT],
  ["dark", DARK],
] as const) {
  test(`${paletteName}: every text-ramp token meets WCAG AA on every workspace surface`, () => {
    const failures: string[] = [];

    for (const textToken of TEXT_TOKENS) {
      const foreground = token(block, textToken);
      for (const surfaceToken of SURFACES) {
        const ratio = contrast(foreground, token(block, surfaceToken));
        if (ratio < AA_NORMAL) {
          failures.push(
            `${textToken} (${foreground}) on ${surfaceToken}: ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }

    assert.deepEqual(failures, [], `${paletteName} contrast failures:\n${failures.join("\n")}`);
  });

  test(`${paletteName}: the text ramp keeps a visible step between levels`, () => {
    const primary = luminance(token(block, "--ega-text"));
    const secondary = luminance(token(block, "--ega-text-secondary"));
    const tertiary = luminance(token(block, "--ega-text-tertiary"));

    if (paletteName === "light") {
      assert.ok(primary < secondary, "secondary must be lighter than primary text");
      assert.ok(secondary < tertiary, "tertiary must be lighter than secondary text");
      assert.ok((secondary - primary) / secondary > 0.5);
      assert.ok((tertiary - secondary) / tertiary > 0.1);
      return;
    }

    assert.ok(primary > secondary, "secondary must be darker than primary text");
    assert.ok(secondary > tertiary, "tertiary must be darker than secondary text");
    assert.ok((primary - secondary) / primary > 0.3);
    assert.ok((secondary - tertiary) / secondary > 0.2);
  });

  test(`${paletteName}: status and priority text meets AA on its own tinted background`, () => {
    const failures: string[] = [];
    for (const [foreground, background] of STATUS_PAIRS) {
      const ratio = contrast(token(block, foreground), token(block, background));
      if (ratio < AA_NORMAL) {
        failures.push(`${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(failures, [], `${paletteName} status failures:\n${failures.join("\n")}`);
  });

  test(`${paletteName}: form-control boundaries meet non-text contrast`, () => {
    const border = token(block, "--ega-control-border");
    const failures: string[] = [];

    for (const surfaceToken of ["--ega-surface", "--ega-surface-subtle", "--ega-surface-hover"] as const) {
      const ratio = contrast(border, token(block, surfaceToken));
      if (ratio < AA_NON_TEXT) {
        failures.push(`${surfaceToken}: ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(
      failures,
      [],
      `${paletteName} control-border failures:\n${failures.join("\n")}`,
    );
  });
}

const ACCENTS = ["blue", "green", "violet", "amber"] as const;

for (const accent of ACCENTS) {
  const lightAccent = blockFor(
    `html[data-accent="${accent}"]:has([data-workspace-theme="workspace"]) {`,
  );
  const darkAccent = blockFor(
    `html[data-theme="dark"][data-accent="${accent}"]:has([data-workspace-theme="workspace"]) {`,
  );

  test(`${accent} accent: primary labels meet AA in both themes`, () => {
    const lightRatio = contrast(
      token(lightAccent, "--ega-on-ink"),
      token(lightAccent, "--ega-ink"),
    );
    const darkRatio = contrast(
      token(darkAccent, "--ega-on-ink"),
      token(darkAccent, "--ega-ink"),
    );

    assert.ok(lightRatio >= AA_NORMAL, `light on-ink/ink ${lightRatio.toFixed(2)}:1`);
    assert.ok(darkRatio >= AA_NORMAL, `dark on-ink/ink ${darkRatio.toFixed(2)}:1`);
    // The accent is also used as a text/border colour on the workspace surface.
    assert.ok(
      contrast(token(lightAccent, "--ega-ink"), token(LIGHT, "--ega-surface")) >= AA_NORMAL,
      "light accent ink on light surface",
    );
    assert.ok(
      contrast(token(darkAccent, "--ega-ink"), token(DARK, "--ega-surface")) >= AA_NORMAL,
      "dark accent ink on dark surface",
    );
    assert.equal(token(lightAccent, "--ega-accent"), token(lightAccent, "--ega-ink"));
    assert.equal(token(darkAccent, "--ega-accent"), token(darkAccent, "--ega-ink"));
  });
}

test("every dark selector is scoped to the authenticated workspace marker", () => {
  const darkSelectorLines = tokensCss
    .split("\n")
    .filter((line) => line.includes('[data-theme="dark"]'));

  assert.ok(darkSelectorLines.length > 0, "expected at least one dark selector");
  for (const line of darkSelectorLines) {
    assert.match(
      line,
      /:has\(\[data-workspace-theme="workspace"\]\)/,
      `unscoped dark selector would leak into public surfaces: ${line.trim()}`,
    );
  }
});
