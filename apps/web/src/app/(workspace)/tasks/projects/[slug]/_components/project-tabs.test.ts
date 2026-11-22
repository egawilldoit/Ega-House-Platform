import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { normalizeProjectTab } from "./project-tabs";

test("normalizes known project tabs and falls back to overview", () => {
  assert.equal(normalizeProjectTab("overview"), "overview");
  assert.equal(normalizeProjectTab("list"), "list");
  assert.equal(normalizeProjectTab("files"), "files");
  assert.equal(normalizeProjectTab("unknown"), "overview");
  assert.equal(normalizeProjectTab(null), "overview");
});

test("keeps tab normalization outside the client boundary", () => {
  const serverModule = readFileSync(resolve(import.meta.dirname, "./project-tabs.ts"), "utf8");
  const clientModule = readFileSync(resolve(import.meta.dirname, "./project-tab-nav.tsx"), "utf8");
  const page = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8");

  assert.doesNotMatch(serverModule, /^"use client";/m);
  assert.match(clientModule, /^"use client";/m);
  assert.match(page, /from "\.\/_components\/project-tabs"/);
  assert.doesNotMatch(
    page,
    /normalizeProjectTab.*from "\.\/_components\/project-tab-nav"/,
    "the server page must not call a function exported by a client component",
  );
});
