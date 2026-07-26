import type { Config } from "./config.js";
import { closeDb, getDb } from "./db.js";
import { executeImplementationRun } from "./implementation-pipeline.js";

const OUTCOME_PREFIX = "EGA_PIPELINE_OUTCOME:";

function decodeJson<T>(name: string): T {
  const encoded = process.env[name];
  if (!encoded) throw new Error(`${name} is required`);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as T;
}

async function main(): Promise<void> {
  const config = decodeJson<Config>("EGA_RUNNER_CHILD_CONFIG");
  const runId = process.env.EGA_RUNNER_CHILD_RUN_ID;
  if (!runId) throw new Error("EGA_RUNNER_CHILD_RUN_ID is required");
  const payload = decodeJson<Record<string, unknown>>("EGA_RUNNER_CHILD_PAYLOAD");
  const db = getDb(config);
  try {
    const outcome = await executeImplementationRun(db, config, runId, payload);
    console.log(`${OUTCOME_PREFIX}${JSON.stringify(outcome)}`);
  } finally {
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error(`[ega-runner-child] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
