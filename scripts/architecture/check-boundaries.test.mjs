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

test("api client may import shared contracts", () => {
  assert.deepEqual(
    diagnostics("packages/api-client/src/client.ts", 'import type { MobileApiErrorCode } from "@ega/contracts";'),
    [],
  );
});

test("api client may not import Supabase", () => {
  assert.deepEqual(
    diagnostics("packages/api-client/src/http.ts", 'import { createClient } from "@supabase/supabase-js";'),
    ['packages/api-client/src/http.ts: forbidden import "@supabase/supabase-js" [api-client-platform-neutral]'],
  );
});

test("api client may not import application or data access", () => {
  assert.deepEqual(
    diagnostics(
      "packages/api-client/src/projects.ts",
      'import { createProject } from "@ega/application";\nimport { SupabaseProjectsRepository } from "@ega/data-access";',
    ),
    [
      'packages/api-client/src/projects.ts: forbidden import "@ega/application" [api-client-platform-neutral]',
      'packages/api-client/src/projects.ts: forbidden import "@ega/data-access" [api-client-platform-neutral]',
    ],
  );
});

test("api client may not import app internals through repo paths", () => {
  assert.deepEqual(
    diagnostics(
      "packages/api-client/src/goals.ts",
      'import { readJsonBody } from "../../../apps/server/src/app";',
    ),
    ['packages/api-client/src/goals.ts: forbidden import "../../../apps/server/src/app" [api-client-platform-neutral]'],
  );
});

test("mobile workspace alias remains mobile-local", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/query.ts", 'import { api } from "@/lib/api/tasks";'),
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

test("server may import data access and domain", () => {
  assert.deepEqual(
    diagnostics(
      "apps/server/src/routes/goals.ts",
      'import { SupabaseGoalsRepository } from "@ega/data-access";\nimport { normalizeGoalViewFilter } from "@ega/domain";',
    ),
    [],
  );
});

test("server may not import web internals", () => {
  assert.deepEqual(
    diagnostics(
      "apps/server/src/auth.ts",
      'import { createClient } from "@/lib/supabase/server";',
    ),
    ['apps/server/src/auth.ts: forbidden import "@/lib/supabase/server" [server-platform]'],
  );
});

test("server may not import mobile", () => {
  assert.deepEqual(
    diagnostics(
      "apps/server/src/routes/projects.ts",
      'import { session } from "../../../mobile/lib/auth/auth-context";',
    ),
    ['apps/server/src/routes/projects.ts: forbidden import "../../../mobile/lib/auth/auth-context" [server-platform]'],
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

test("web workspace alias resolves to apps/web/src", () => {
  assert.deepEqual(
    diagnostics("apps/web/src/app/tasks/projects/page.tsx", 'import { ProjectService } from "@/features/projects/service";'),
    [],
  );
});

test("web files never fall back to the root src alias", () => {
  assert.deepEqual(
    diagnostics("apps/web/src/lib/supabase/server.ts", 'import { createClient } from "@/lib/supabase/client";'),
    [],
  );
});

test("mobile may not import web source through a web workspace alias", () => {
  assert.deepEqual(
    diagnostics("apps/mobile/features/tasks/api.ts", 'import { rewrite } from "@/app/tasks/projects/route";'),
    [],
  );
});
