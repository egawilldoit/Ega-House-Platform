import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import fs from "node:fs";
import test from "node:test";

import { serve } from "@hono/node-server";

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const entrypointPath = path.join(serverRoot, "api", "index.ts");

// Production contract: the deployed module refuses to initialize without the
// Supabase env pair. Proven in a child process because env vars are read at
// module scope and must be absent there.
test("api/index.ts fails fast without SUPABASE_URL/SUPABASE_ANON_KEY", async () => {
  const tsxBin = path.join(serverRoot, "..", "..", "node_modules", ".bin", "tsx");
  await assert.rejects(
    () =>
      execFileAsync(tsxBin, ["--eval", `import("./${path.relative(serverRoot, entrypointPath)}")`], {
        cwd: serverRoot,
        env: { PATH: process.env.PATH ?? "" },
      }),
    (error) => {
      const combined = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
      assert.match(combined, /SUPABASE_URL/);
      return true;
    },
  );
});

const SUPABASE_PLACEHOLDER_URL = "https://example.supabase.co";
const SUPABASE_PLACEHOLDER_KEY = "sb_publishable_boot_proof_placeholder";

let listener: ReturnType<typeof serve> | null = null;
let baseUrl = "";

test("boot the actual Vercel Hono default export on a local port", async () => {
  // Set placeholders BEFORE importing; this mirrors Vercel injecting project
  // environment variables before the function cold-starts.
  process.env.SUPABASE_URL = SUPABASE_PLACEHOLDER_URL;
  process.env.SUPABASE_ANON_KEY = SUPABASE_PLACEHOLDER_KEY;

  const entrypoint = await import(entrypointPath);
  const app = entrypoint.default;

  assert.ok(app);
  assert.equal(typeof app.fetch, "function");

  listener = serve({ fetch: app.fetch.bind(app), port: 0 }, (info) => {
    baseUrl = `http://127.0.0.1:${info.port}`;
  });

  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (baseUrl) return resolve();
      if (Date.now() - started > 5000) return reject(new Error("entrypoint did not start"));
      setTimeout(poll, 25);
    };
    poll();
  });
});

test("GET /health answers 200 {status:ok} through the deployed module", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /ready probes dependencies and reports 503 with placeholder credentials", async () => {
  const response = await fetch(`${baseUrl}/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("canonical API route requires bearer auth (401 without Authorization)", async () => {
  const response = await fetch(`${baseUrl}/api/goals`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHENTICATED", message: "Authentication required." },
  });
});

test("unknown paths answer the JSON 404 shape", async () => {
  const response = await fetch(`${baseUrl}/nope`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("stop the local boot listener", () => {
  listener?.close();
});

test("apps/server/vercel.json routes everything to the single function", () => {
  const configPath = path.join(serverRoot, "vercel.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    functions?: Record<string, { maxDuration?: number }>;
    rewrites?: Array<{ source?: string; destination?: string }>;
  };

  assert.equal(config.rewrites?.[0]?.source, "/(.*)");
  assert.equal(config.rewrites?.[0]?.destination, "/api/index");
  assert.equal(
    config.functions?.["api/index.ts"]?.maxDuration,
    30,
  );
});
