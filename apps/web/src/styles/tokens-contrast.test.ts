import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Contrast contract for the workspace text ramp.
 *
 * The values were previously chosen by eye and two of them measured below
 * WCAG AA on the surfaces they are actually used on. This test computes the
 * ratios from the token file itself so a future palette tweak cannot silently
 * reintroduce unreadable text.
 */

const tokensCss = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

function token(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
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

const SURFACES = [
  "--ega-surface",
  "--ega-bg",
  "--ega-surface-subtle",
  "--ega-surface-hover",
  "--ega-surface-muted",
] as const;

const TEXT_TOKENS = ["--ega-text", "--ega-text-secondary", "--ega-text-tertiary"] as const;

test("every text-ramp token meets WCAG AA on every surface it is used on", () => {
  const failures: string[] = [];

  for (const textToken of TEXT_TOKENS) {
    const foreground = token(textToken);
    for (const surfaceToken of SURFACES) {
      const ratio = contrast(foreground, token(surfaceToken));
      if (ratio < AA_NORMAL) {
        failures.push(
          `${textToken} (${foreground}) on ${surfaceToken}: ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }

  assert.deepEqual(failures, [], `contrast failures:\n${failures.join("\n")}`);
});

test("the text ramp keeps a visible step between levels", () => {
  const primary = luminance(token("--ega-text"));
  const secondary = luminance(token("--ega-text-secondary"));
  const tertiary = luminance(token("--ega-text-tertiary"));

  assert.ok(primary < secondary, "secondary must be lighter than primary text");
  assert.ok(secondary < tertiary, "tertiary must be lighter than secondary text");
  // A step of at least ~10% relative luminance keeps the levels distinguishable.
  assert.ok((secondary - primary) / secondary > 0.5);
  assert.ok((tertiary - secondary) / tertiary > 0.1);
});

test("status text colours meet AA on their own tinted backgrounds", () => {
  const pairs: Array<[string, string]> = [
    ["--status-healthy", "--status-healthy-bg"],
    ["--status-risk", "--status-risk-bg"],
    ["--status-overdue", "--status-overdue-bg"],
    ["--status-pending", "--status-pending-bg"],
    ["--status-info", "--status-info-bg"],
    ["--priority-high", "--priority-high-bg"],
    ["--priority-medium", "--priority-medium-bg"],
    ["--priority-low", "--priority-low-bg"],
  ];

  const failures: string[] = [];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(token(foreground), token(background));
    if (ratio < AA_NORMAL) {
      failures.push(`${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }

  assert.deepEqual(failures, [], `status contrast failures:\n${failures.join("\n")}`);
});
