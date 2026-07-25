import { readFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const LOCAL_ENV_PATH = resolve(PROJECT_ROOT, ".env.local");

export interface Config {
  /** Postgres connection string */
  databaseUrl: string;

  /** Unique identity for this runner instance */
  runnerId: string;

  /** pgmq queue name */
  queueName: string;

  /** Seconds to wait between poll cycles when queue is empty */
  pollSeconds: number;

  /** Initial visibility timeout for queue messages (seconds) */
  visibilityTimeoutSeconds: number;

  /** Interval between heartbeats (seconds) */
  heartbeatSeconds: number;

  /** Duration of the execution lease (seconds) */
  leaseSeconds: number;

  /** When true, stop after first completed smoke cycle */
  smokeMode: boolean;

  /** Maximum Hermes execution turns */
  maxTurns: number;

  /** Hermes execution timeout (ms) */
  hermesTimeoutMs: number;

  /** Slack channel for notifications */
  slackChannel: string;
}

function loadEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};

  if (!existsSync(path)) {
    return vars;
  }

  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value) {
      vars[key] = value;
    }
  }

  return vars;
}

export function loadConfig(): Config {
  const env: Record<string, string | undefined> = {
    ...loadEnvFile(LOCAL_ENV_PATH),
    ...process.env,
  };

  const databaseUrl = env["DATABASE_URL"] as string | undefined;
  if (!databaseUrl) {
    console.error("FATAL: DATABASE_URL is required");
    process.exit(1);
  }

  const runnerId =
    (env["EGA_RUNNER_ID"] as string | undefined) || `ega-runner-${hostname()}-${process.pid}`;

  const queueName = (env["EGA_RUNNER_QUEUE_NAME"] as string | undefined) || "hermes_implementation_jobs";
  const pollSeconds = parseInt(env["EGA_RUNNER_POLL_SECONDS"] as string || "10", 10);
  const visibilityTimeoutSeconds = parseInt(
    (env["EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS"] as string) || "300",
    10,
  );
  const heartbeatSeconds = parseInt(
    (env["EGA_RUNNER_HEARTBEAT_SECONDS"] as string) || "60",
    10,
  );
  const leaseSeconds = parseInt(
    (env["EGA_RUNNER_LEASE_SECONDS"] as string) || "300",
    10,
  );
  const smokeMode = (env["EGA_RUNNER_SMOKE_MODE"] as string | undefined) === "true";
  const maxTurns = parseInt(
    (env["EGA_RUNNER_MAX_TURNS"] as string) || "50",
    10,
  );
  const hermesTimeoutMs = parseInt(
    (env["EGA_RUNNER_HERMES_TIMEOUT_MS"] as string) || "1800000",
    10,
  );
  const slackChannel =
    (env["EGA_RUNNER_SLACK_CHANNEL"] as string | undefined) || "#hermes-today";

  if (heartbeatSeconds >= visibilityTimeoutSeconds) {
    console.error(
      `FATAL: EGA_RUNNER_HEARTBEAT_SECONDS (${heartbeatSeconds}) must be less than EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS (${visibilityTimeoutSeconds})`,
    );
    process.exit(1);
  }

  return {
    databaseUrl: databaseUrl as string,
    runnerId,
    queueName,
    pollSeconds,
    visibilityTimeoutSeconds,
    heartbeatSeconds,
    leaseSeconds,
    smokeMode,
    maxTurns,
    hermesTimeoutMs,
    slackChannel,
  };
}

// Print known variable names only — never values
export function printConfigVariables(): void {
  console.log("Configuration sources:");
  console.log("  .env.local expected at:", LOCAL_ENV_PATH);
  console.log(
    "  Expected vars: DATABASE_URL, EGA_RUNNER_ID (optional), EGA_RUNNER_QUEUE_NAME (optional), etc.",
  );
}
