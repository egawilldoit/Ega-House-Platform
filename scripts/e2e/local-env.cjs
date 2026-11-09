/* eslint-disable @typescript-eslint/no-require-imports -- Shared by Node ESM scripts and Playwright's CommonJS TypeScript loader. */
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");

const stateDirectory = new URL("../../.e2e-local/", pathToFileURL(__filename));

function validateLocalEnvironment(value) {
  if (value?.E2E_DISPOSABLE !== "local-supabase-v1" || !/^ega-e2e-[a-f0-9]{12}$/.test(value.E2E_RUN_ID ?? "")) {
    throw new Error("Start a disposable backend with scripts/e2e/local-backend.mjs first.");
  }
  for (const [key, expected] of Object.entries({
    E2E_AUTH_BASE_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  })) {
    if (value[key] !== expected) throw new Error(`Unsafe ${key}: only the disposable loopback target is supported.`);
  }
  let db;
  try { db = new URL(value.DATABASE_URL); } catch { throw new Error("Invalid disposable database target."); }
  if (db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "55322" || db.pathname !== "/postgres" || db.search) {
    throw new Error("Unsafe disposable database target.");
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (typeof value[key] !== "string" || value[key].length < 20) throw new Error(`Missing local ${key}.`);
  }
  return value;
}

function readLocalEnvironment() {
  let value;
  try { value = JSON.parse(readFileSync(new URL("environment.json", stateDirectory), "utf8")); }
  catch { throw new Error("Cannot read disposable environment. Start the local backend first."); }
  return validateLocalEnvironment(value);
}

exports.stateDirectory = stateDirectory;
exports.validateLocalEnvironment = validateLocalEnvironment;
exports.readLocalEnvironment = readLocalEnvironment;
