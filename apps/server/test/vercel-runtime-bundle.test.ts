import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const generatedEntrypoint = path.join(serverRoot, "index.js");
const configPath = path.join(serverRoot, "vercel.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const SUPABASE_PLACEHOLDER_URL = "https://example.supabase.co";
const SUPABASE_PLACEHOLDER_KEY = "sb_publishable_bundle_proof_placeholder";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("Vercel production build emits a self-contained JavaScript entrypoint", async () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "ega-server-vercel-bundle-"));
  const isolatedEntrypoint = path.join(isolatedDir, "index.mjs");
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;

  try {
    fs.rmSync(generatedEntrypoint, { force: true });

    await execFileAsync(npmCommand, ["run", "build:vercel"], {
      cwd: serverRoot,
      env: process.env,
    });

    assert.equal(
      fs.existsSync(generatedEntrypoint),
      true,
      "apps/server/index.js must be generated before Vercel traces the Hono entrypoint",
    );

    const bundle = fs.readFileSync(generatedEntrypoint, "utf8");
    assert.doesNotMatch(
      bundle,
      /(?:from\s+|import\s*\()["']@ega\//,
      "the production bundle must not retain runtime imports of internal @ega workspaces",
    );

    fs.copyFileSync(generatedEntrypoint, isolatedEntrypoint);
    process.env.SUPABASE_URL = SUPABASE_PLACEHOLDER_URL;
    process.env.SUPABASE_ANON_KEY = SUPABASE_PLACEHOLDER_KEY;

    const deployedModule = await import(
      `${pathToFileURL(isolatedEntrypoint).href}?t=${Date.now()}`
    );
    const app = deployedModule.default;

    assert.ok(app);
    assert.equal(typeof app.fetch, "function");

    const response = await app.fetch(new Request("http://bundle.test/health"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_ANON_KEY", previousAnon);
    fs.rmSync(generatedEntrypoint, { force: true });
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test("Vercel config runs the production bundle step before Hono entrypoint detection", () => {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    buildCommand?: string;
  };

  assert.equal(config.buildCommand, "npm run build:vercel");
});
