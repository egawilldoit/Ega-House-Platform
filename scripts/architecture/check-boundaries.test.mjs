import assert from "node:assert/strict";
import test from "node:test";

import { checkSourceText } from "./check-boundaries.mjs";

function diagnostics(filePath, sourceText) {
  return checkSourceText(filePath, sourceText);
}

test("mobile may import shared contracts", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/api.ts", 'import type { MobileTask } from "@ega/contracts";'),
    [],
  );
});

test("mobile may import shared api client", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/api.ts", 'import { createEgaApiClient } from "@ega/api-client";'),
    [],
  );
});

test("mobile may not import application", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/api.ts", 'import { listProjects } from "@ega/application";'),
    ['apps/mobile/features/tasks/api.ts: forbidden import "@ega/application" [mobile-no-application]'],
  );
});

test("contracts may not import Next", () => {
  assert.deepEqual(
    diagnostics("packages/contracts/src/mobile.ts", 'export { NextResponse } from "next/server";'),
    ['packages/contracts/src/mobile.ts: forbidden import "next/server" [contracts-platform-neutral]'],
  );
});

test("contracts may not import Supabase", () => {
  assert.deepEqual(
    diagnostics("packages/contracts/src/mobile.ts", 'import type { User } from "@supabase/supabase-js";'),
    ['packages/contracts/src/mobile.ts: forbidden import "@supabase/supabase-js" [contracts-platform-neutral]'],
  );
});

test("domain may not import Drizzle through require", () => {
  assert.deepEqual(
    diagnostics("packages/domain/src/tasks/status.ts", 'const drizzle = require("drizzle-orm");'),
    ['packages/domain/src/tasks/status.ts: forbidden import "drizzle-orm" [domain-platform-neutral]'],
  );
});

test("server may import application", () => {
  assert.deepEqual(
    diagnostics("apps/server/src/routes/projects.ts", 'import { ProjectService } from "@ega/application";'),
    [],
  );
});

test("application may import domain", () => {
  assert.deepEqual(
    diagnostics("packages/application/src/projects/service.ts", 'import { PROJECT_STATUS_VALUES } from "@ega/domain";'),
    [],
  );
});

test("dynamic imports are checked", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/api.ts", 'await import("@ega/data-access");'),
    ['apps/mobile/features/tasks/api.ts: forbidden import "@ega/data-access" [mobile-no-data-access]'],
  );
});

test("import equals is checked", () => {
  assert.deepEqual(
    diagnostics("packages/domain/src/tasks/status.ts", 'import drizzle = require("drizzle-orm");'),
    ['packages/domain/src/tasks/status.ts: forbidden import "drizzle-orm" [domain-platform-neutral]'],
  );
});
