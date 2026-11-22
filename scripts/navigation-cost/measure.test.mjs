import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectFirstLoadJs,
  median,
  normalizeManifestRoute,
} from "./measure.mjs";

test("normalizes app-router manifest keys to route paths", () => {
  assert.equal(normalizeManifestRoute("/(workspace)/today/page"), "/today");
  assert.equal(normalizeManifestRoute("/(workspace)/tasks/projects/[slug]/page"), "/tasks/projects/[slug]");
  assert.equal(normalizeManifestRoute("/login/page"), "/login");
  assert.equal(normalizeManifestRoute("/(workspace)/layout"), "/layout");
});

test("sums route and workspace layout JavaScript without double counting", async () => {
  const buildDir = await mkdtemp(path.join(tmpdir(), "nav-cost-"));
  try {
    await mkdir(path.join(buildDir, "static/chunks"), { recursive: true });
    await writeFile(path.join(buildDir, "static/chunks/shared.js"), Buffer.alloc(1000));
    await writeFile(path.join(buildDir, "static/chunks/layout.js"), Buffer.alloc(500));
    await writeFile(path.join(buildDir, "static/chunks/today.js"), Buffer.alloc(250));
    await writeFile(path.join(buildDir, "static/chunks/today.css"), Buffer.alloc(9999));
    await writeFile(
      path.join(buildDir, "app-build-manifest.json"),
      JSON.stringify({
        pages: {
          "/layout": ["static/chunks/shared.js"],
          "/(workspace)/layout": ["static/chunks/layout.js"],
          "/(workspace)/today/page": [
            "static/chunks/today.js",
            "static/chunks/today.css",
          ],
        },
      }),
    );

    const result = await collectFirstLoadJs(buildDir, ["/today"]);
    assert.equal(result.available, true);
    assert.deepEqual(result.routes["/today"], {
      bytes: 1750,
      kib: 1.7,
      chunkCount: 3,
      files: [
        { file: "static/chunks/shared.js", bytes: 1000 },
        { file: "static/chunks/layout.js", bytes: 500 },
        { file: "static/chunks/today.js", bytes: 250 },
      ],
    });
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test("prefers Next Turbopack route bundle stats and matches dynamic detail routes", async () => {
  const buildDir = await mkdtemp(path.join(tmpdir(), "nav-cost-"));
  try {
    await mkdir(path.join(buildDir, "diagnostics"), { recursive: true });
    await writeFile(
      path.join(buildDir, "diagnostics/route-bundle-stats.json"),
      JSON.stringify([
        { route: "/today", firstLoadUncompressedJsBytes: 2048, firstLoadChunkPaths: ["a.js", "b.js"] },
        {
          route: "/tasks/projects/[slug]",
          firstLoadUncompressedJsBytes: 4096,
          firstLoadChunkPaths: ["c.js"],
        },
      ]),
    );

    const result = await collectFirstLoadJs(buildDir, [
      "/today",
      "/tasks/projects/nav-cost-fixture",
    ]);
    assert.equal(result.source, ".next/diagnostics/route-bundle-stats.json");
    assert.equal(result.routes["/today"].kib, 2);
    assert.equal(result.routes["/tasks/projects/nav-cost-fixture"].bytes, 4096);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test("reports an unavailable build instead of inventing a size", async () => {
  const result = await collectFirstLoadJs("/nonexistent-build-dir", ["/today"]);
  assert.equal(result.available, false);
  assert.deepEqual(result.routes, {});
});

test("median handles odd and even sample counts", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([9, 1, 5, 3]), 4);
});
