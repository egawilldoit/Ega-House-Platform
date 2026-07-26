import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const LOCAL_ENV_PATH = resolve(PROJECT_ROOT, ".env.local");

export interface Config {
  databaseUrl: string;
  runnerId: string;
  queueName: string;
  pollSeconds: number;
  visibilityTimeoutSeconds: number;
  heartbeatSeconds: number;
  leaseSeconds: number;
  smokeMode: boolean;
  maxTurns: number;
  repairMaxTurns: number;
  hermesTimeoutMs: number;
  slackChannel: string;
  repoRoot: string;
  prMonitorIntervalSeconds: number;
  prMonitorBatchSize: number;
  maxRepairAttempts: number;
  requireVercelPreview: boolean;
  autoMerge: boolean;
}

function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) values[key] = value;
  }
  return values;
}

function positiveInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const parsed = Number.parseInt(env[key] ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const env: Record<string, string | undefined> = { ...loadEnvFile(LOCAL_ENV_PATH), ...process.env };
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const visibilityTimeoutSeconds = positiveInt(env, "EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS", 300);
  const heartbeatSeconds = positiveInt(env, "EGA_RUNNER_HEARTBEAT_SECONDS", 60);
  const leaseSeconds = positiveInt(env, "EGA_RUNNER_LEASE_SECONDS", 300);
  if (heartbeatSeconds >= visibilityTimeoutSeconds || heartbeatSeconds >= leaseSeconds) {
    throw new Error("EGA_RUNNER_HEARTBEAT_SECONDS must be lower than both VT and lease duration");
  }

  return {
    databaseUrl,
    runnerId: env.EGA_RUNNER_ID || `ega-runner-${hostname()}-${process.pid}`,
    queueName: env.EGA_RUNNER_QUEUE_NAME || "hermes_implementation_jobs",
    pollSeconds: positiveInt(env, "EGA_RUNNER_POLL_SECONDS", 10),
    visibilityTimeoutSeconds,
    heartbeatSeconds,
    leaseSeconds,
    smokeMode: env.EGA_RUNNER_SMOKE_MODE === "true",
    maxTurns: positiveInt(env, "EGA_RUNNER_MAX_TURNS", 50),
    repairMaxTurns: positiveInt(env, "EGA_RUNNER_REPAIR_MAX_TURNS", 25),
    hermesTimeoutMs: positiveInt(env, "EGA_RUNNER_HERMES_TIMEOUT_MS", 1_800_000),
    slackChannel: env.EGA_RUNNER_SLACK_CHANNEL || "#hermes-today",
    repoRoot: resolve(env.EGA_RUNNER_REPO_ROOT || PROJECT_ROOT),
    prMonitorIntervalSeconds: positiveInt(env, "EGA_RUNNER_PR_MONITOR_INTERVAL_SECONDS", 60),
    prMonitorBatchSize: positiveInt(env, "EGA_RUNNER_PR_MONITOR_BATCH_SIZE", 5),
    maxRepairAttempts: positiveInt(env, "EGA_RUNNER_MAX_REPAIR_ATTEMPTS", 3),
    requireVercelPreview: env.EGA_RUNNER_REQUIRE_VERCEL_PREVIEW === "true",
    autoMerge: env.EGA_RUNNER_AUTO_MERGE === "true",
  };
}

export function printConfigVariables(): void {
  console.log("Configuration file:", LOCAL_ENV_PATH);
  console.log("Known variables: DATABASE_URL, EGA_RUNNER_*, LINEAR_API_KEY, VERCEL_TOKEN, SLACK_BOT_TOKEN");
}
