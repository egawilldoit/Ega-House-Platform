/**
 * Hermes Executor — bounded, non-shell execution inside a Runner-owned worktree.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

export interface HermesExecutionConfig {
  worktreePath: string;
  timeoutMs: number;
  maxTurns: number;
  runId: string;
  issueId: string;
  issueIdentifier: string;
  baseSha: string;
  validationCommands: string[];
  extraEnv: Record<string, string>;
  authorizedPaths: string[];
  resultFilePath: string;
  hermesRunId: string;
  isRecovery: boolean;
}

export interface HermesResult {
  status: "completed" | "failed";
  run_id: string;
  branch: string;
  commit: string;
  pr: number | null;
  validations: ValidationResult[];
  standardsReview: string | null;
  specReview: string | null;
  risks: string[];
  executionLog: string;
}

export interface ValidationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
}

export interface ExecutionOutput {
  result: HermesResult | null;
  rawStdout: string;
  rawStderr: string;
  recoveryStdout: string | null;
  recoveryStderr: string | null;
  exitCode: number | null;
  timedOut: boolean;
  signal: string | null;
  recoveryAttempted: boolean;
}

interface SingleExecutionOutput {
  result: HermesResult | null;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  timedOut: boolean;
  signal: string | null;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_RECOVERY_MAX_TURNS = 10;
const MAX_CAPTURE_CHARS = 100_000;

export function buildHermesArgs(
  config: HermesExecutionConfig,
): { args: string[]; childEnv: Record<string, string> } {
  const maxTurns = config.maxTurns || (config.isRecovery ? DEFAULT_RECOVERY_MAX_TURNS : DEFAULT_MAX_TURNS);
  const args = [
    "chat",
    "--quiet",
    "--query",
    buildHermesPrompt(config),
    "--source",
    config.isRecovery ? "ega-runner-recovery" : "ega-runner",
    "--max-turns",
    String(maxTurns),
    "--accept-hooks",
  ];
  const childEnv: Record<string, string> = {
    ...process.env,
    ...config.extraEnv,
    HERMES_MAX_ITERATIONS: String(maxTurns),
    HERMES_YOLO_MODE: "0",
    HERMES_RUN_ID: config.runId,
    HERMES_ISSUE_ID: config.issueId,
    HERMES_BASE_SHA: config.baseSha,
    HERMES_RESULT_FILE: config.resultFilePath,
    HERMES_RUN_CORRELATION_ID: config.hermesRunId,
    HERMES_AUTHORIZED_PATHS: JSON.stringify(config.authorizedPaths),
    HERMES_IS_RECOVERY: config.isRecovery ? "1" : "0",
  };
  delete childEnv.HERMES_YOLO;
  childEnv.HERMES_YOLO_MODE = "0";
  return { args, childEnv };
}

function buildHermesPrompt(config: HermesExecutionConfig): string {
  const authorized = config.authorizedPaths.length > 0
    ? config.authorizedPaths.map((item, index) => `${index + 1}. \`${item}\``).join("\n")
    : "No product files are authorized; stop and report failure.";
  const recovery = config.isRecovery
    ? [
        "## Recovery mode",
        "Inspect the existing Git state and write only the required result JSON.",
        "Do not change product files, run validations, create commits, push, or open a PR.",
      ].join("\n")
    : [
        "## Required work",
        "1. Inspect the current implementation and issue contract.",
        "2. Modify only the authorized product files.",
        "3. Add or update focused tests when required.",
        "4. Run useful local validation.",
        "5. Create one descriptive implementation commit on the existing branch.",
        "6. Do not push, create a PR, merge, or modify `.ega-runner/**`; the Runner owns those actions.",
      ].join("\n");

  return [
    "# Autonomous implementation task",
    "",
    `Run ID: ${config.runId}`,
    `Issue: ${config.issueIdentifier} (${config.issueId})`,
    `Base SHA: ${config.baseSha}`,
    `Hermes correlation ID: ${config.hermesRunId}`,
    "",
    "## Authorized product files",
    authorized,
    "",
    recovery,
    "",
    "## Validation commands",
    ...config.validationCommands.map((command) => `- ${command}`),
    "",
    "## Result contract",
    `Write valid JSON to ${config.resultFilePath}.`,
    `Use run_id=${config.runId}; set branch and commit to the actual Git values; set pr to null.`,
    "Include status, validations, standardsReview, specReview, risks, and executionLog.",
    "No Markdown fences and no secrets.",
  ].join("\n");
}

function executeHermesInternal(config: HermesExecutionConfig): Promise<SingleExecutionOutput> {
  return new Promise((resolvePromise) => {
    const timeoutMs = config.timeoutMs || (config.isRecovery ? 60_000 : DEFAULT_TIMEOUT_MS);
    mkdirSync(resolve(config.worktreePath, ".ega-runner"), { recursive: true });
    const { args, childEnv } = buildHermesArgs(config);
    const child: ChildProcess = spawn("hermes", args, {
      cwd: config.worktreePath,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });

    let rawStdout = "";
    let rawStderr = "";
    let timedOut = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    let settled = false;

    child.stdout?.on("data", (data: Buffer) => {
      rawStdout = (rawStdout + data.toString()).slice(-MAX_CAPTURE_CHARS);
    });
    child.stderr?.on("data", (data: Buffer) => {
      rawStderr = (rawStderr + data.toString()).slice(-MAX_CAPTURE_CHARS);
    });

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      let result: HermesResult | null = null;
      if (existsSync(config.resultFilePath)) {
        try {
          result = JSON.parse(readFileSync(config.resultFilePath, "utf8")) as HermesResult;
        } catch (error) {
          rawStderr = `${rawStderr}\nFailed to parse result: ${error instanceof Error ? error.message : String(error)}`.slice(-MAX_CAPTURE_CHARS);
        }
      }
      resolvePromise({ result, rawStdout, rawStderr, exitCode, timedOut, signal });
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.on("exit", (code, childSignal) => {
      exitCode = code;
      signal = childSignal;
    });
    child.on("close", finish);
    child.on("error", (error) => {
      rawStderr = `${rawStderr}\nSpawn error: ${error.message}`.slice(-MAX_CAPTURE_CHARS);
      finish();
    });
  });
}

export async function executeHermes(config: HermesExecutionConfig): Promise<ExecutionOutput> {
  const first = await executeHermesInternal(config);
  if (first.result !== null) {
    return {
      ...first,
      recoveryStdout: null,
      recoveryStderr: null,
      recoveryAttempted: false,
    };
  }

  try {
    if (existsSync(config.resultFilePath)) unlinkSync(config.resultFilePath);
  } catch {
    // Recovery will fail closed if it cannot replace the invalid result.
  }
  const recovery = await executeHermesInternal({
    ...config,
    maxTurns: DEFAULT_RECOVERY_MAX_TURNS,
    isRecovery: true,
    extraEnv: {
      ...config.extraEnv,
      HERMES_RECOVERY_STDOUT: first.rawStdout.slice(-50_000),
      HERMES_RECOVERY_STDERR: first.rawStderr.slice(-50_000),
    },
  });

  return {
    result: recovery.result,
    rawStdout: first.rawStdout,
    rawStderr: first.rawStderr,
    recoveryStdout: recovery.rawStdout,
    recoveryStderr: recovery.rawStderr,
    exitCode: recovery.exitCode,
    timedOut: first.timedOut || recovery.timedOut,
    signal: recovery.signal ?? first.signal,
    recoveryAttempted: true,
  };
}

function killProcessTree(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  setTimeout(() => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Process already exited.
    }
  }, 5_000).unref();
}
