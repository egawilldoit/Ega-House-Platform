/**
 * Hermes Executor — spawns Hermes CLI in the worktree with bounded execution.
 *
 * OWNERSHIP: Runner owns the process lifecycle (spawn, kill, monitor).
 * Hermes owns the code generation. We never trust Hermes exit code alone.
 *
 * Rules:
 *  - cwd must be the worktree
 *  - No shell interpolation
 *  - Bounded env, max-turns, timeout
 *  - Own process group for clean tree termination
 *  - Never enable YOLO mode silently
 *  - Requires `.ega-runner/hermes-result.json` on completion
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface HermesExecutionConfig {
  /** Absolute path to the worktree */
  worktreePath: string;
  /** Maximum execution time (ms) */
  timeoutMs: number;
  /** Maximum Hermes turns */
  maxTurns: number;
  /** Run ID for context injection */
  runId: string;
  /** Issue ID for agenda */
  issueId: string;
  issueIdentifier: string;
  /** Base SHA to pin */
  baseSha: string;
  /** Validation commands to run */
  validationCommands: string[];
  /** Additional env vars */
  extraEnv: Record<string, string>;
  /** Authorized product file paths Hermes may modify */
  authorizedPaths: string[];
  /** Absolute path to result file */
  resultFilePath: string;
  /** Hermes execution correlation ID */
  hermesRunId: string;
  /** Whether this is a recovery attempt */
  isRecovery: boolean;
}

export interface HermesResult {
  /** Must be exactly 'completed' or 'failed' */
  status: "completed" | "failed";
  /** The run_id this result belongs to */
  run_id: string;
  /** Branch the PR was created from */
  branch: string;
  /** Commit SHA of the implementation */
  commit: string;
  /** PR number (if created) */
  pr: number | null;
  /** Validation results */
  validations: ValidationResult[];
  /** Standard/spec review */
  standardsReview: string | null;
  /** Spec review */
  specReview: string | null;
  /** Risks identified */
  risks: string[];
  /** Hermes execution log (stripped of secrets) */
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
  exitCode: number | null;
  timedOut: boolean;
  signal: string | null;
  recoveryAttempted: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_RECOVERY_MAX_TURNS = 10;

// ── Arg / env builder (exported for testing) ────────────────────────────────

export function buildHermesArgs(config: HermesExecutionConfig): { args: string[]; childEnv: Record<string, string> } {
  const args = [
    "chat",
    "--quiet",
    "--query",
    buildHermesPrompt(config),
    "--source",
    "ega-runner",
    "--max-turns",
    String(config.maxTurns || (config.isRecovery ? DEFAULT_RECOVERY_MAX_TURNS : DEFAULT_MAX_TURNS)),
    "--accept-hooks",
  ];

  const childEnv: Record<string, string> = {
    ...process.env,
    ...config.extraEnv,
    HERMES_MAX_ITERATIONS: String(config.maxTurns || (config.isRecovery ? DEFAULT_RECOVERY_MAX_TURNS : DEFAULT_MAX_TURNS)),
    HERMES_YOLO_MODE: "0",
    HERMES_RUN_ID: config.runId,
    HERMES_ISSUE_ID: config.issueId,
    HERMES_BASE_SHA: config.baseSha,
    HERMES_RESULT_FILE: config.resultFilePath,
    HERMES_RUN_CORRELATION_ID: config.hermesRunId,
    HERMES_AUTHORIZED_PATHS: JSON.stringify(config.authorizedPaths),
    HERMES_IS_RECOVERY: config.isRecovery ? "1" : "0",
  };

  // Strip any legacy YOLO env var that sneaked in
  delete childEnv.HERMES_YOLO;
  // Double-enforce: extraEnv cannot re-enable YOLO
  childEnv.HERMES_YOLO_MODE = "0";

  return { args, childEnv };
}

// ── Hermes prompt template ─────────────────────────────────────────────────

function buildHermesPrompt(config: HermesExecutionConfig): string {
  const authorizedPathsBlock = config.authorizedPaths.length > 0
    ? [
        "## Authorized Product Files",
        "You may ONLY modify the following product files. No other product files may be changed:",
        "",
        config.authorizedPaths.map((p, i) => `${i + 1}. \`${p}\``).join("\n"),
        "",
        "Files under `.ega-runner/**` are Runner-owned evidence and are NOT product changes.",
        "Do not commit `.ega-runner/**` files.",
      ].join("\n")
    : "## Authorized Product Files\nNo specific files authorized — implement per issue requirements.\n";

  const recoveryBlock = config.isRecovery
    ? [
        "## Recovery Mode",
        "This is a RESULT RECOVERY attempt. Your task is to inspect the existing repository state",
        "and write ONLY the required `.ega-runner/hermes-result.json` file.",
        "Do NOT make any product code changes.",
        "Do NOT run validation commands.",
        "Do NOT create commits or branches.",
        "Read the current Git state and produce a valid result JSON.",
        "",
      ].join("\n")
    : "";

  return [
    `# Autonomous Implementation Task`,
    ``,
    `You are implementing a Linear issue in this repository.`,
    ``,
    `## Context`,
    `- Run ID: ${config.runId}`,
    `- Issue: ${config.issueIdentifier} (${config.issueId})`,
    `- Base SHA: ${config.baseSha}`,
    `- Max turns: ${config.maxTurns || (config.isRecovery ? DEFAULT_RECOVERY_MAX_TURNS : DEFAULT_MAX_TURNS)}`,
    `- Hermes Correlation ID: ${config.hermesRunId}`,
    ``,
    authorizedPathsBlock,
    ``,
    recoveryBlock,
    `## Requirements`,
    `1. Analyze the codebase and understand the issue.`,
    `2. Implement the changes.`,
    `3. Run validation commands after each change.`,
    `4. Commit changes with a descriptive message referencing the issue.`,
    `5. Create a PR if the changes are complete.`,
    ``,
    `## Validation commands`,
    config.validationCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n"),
    ``,
    `## Output requirement`,
    `After completing (success or failure), write the result to \`.ega-runner/hermes-result.json\` with:`,
    `- status: "completed" or "failed"`,
    `- run_id: "${config.runId}"`,
    `- branch: the branch name created`,
    `- commit: the commit SHA`,
    `- pr: PR number or null`,
    `- validations: array of {command, exitCode, stdout, stderr, passed}`,
    `- standardsReview: brief review of standards compliance`,
    `- specReview: review of whether spec was met`,
    `- risks: array of identified risks`,
    `- executionLog: brief log (no secrets)`,
    ``,
    `The result file MUST be valid JSON. No Markdown fences. No extra text.`,
    ``,
    `Begin.`,
  ].join("\n");
}

// ── Result Recovery ────────────────────────────────────────────────────────

async function attemptResultRecovery(
  config: HermesExecutionConfig,
  firstStdout: string,
  firstStderr: string,
): Promise<{ result: HermesResult | null; rawStdout: string; rawStderr: string; exitCode: number | null; timedOut: boolean; signal: string | null }> {
  console.log("[executor] Attempting result recovery...");

  const recoveryConfig: HermesExecutionConfig = {
    ...config,
    maxTurns: DEFAULT_RECOVERY_MAX_TURNS,
    isRecovery: true,
    extraEnv: {
      ...config.extraEnv,
      HERMES_RECOVERY_STDOUT: firstStdout.slice(0, 50000),
      HERMES_RECOVERY_STDERR: firstStderr.slice(0, 50000),
    },
  };

  return executeHermesInternal(recoveryConfig);
}

async function executeHermesInternal(config: HermesExecutionConfig): Promise<{
  result: HermesResult | null;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  timedOut: boolean;
  signal: string | null;
}> {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    const timeoutMs = config.timeoutMs || (config.isRecovery ? 60000 : DEFAULT_TIMEOUT_MS);
    const hermesPath = resolve(config.worktreePath, ".ega-runner");
    const resultFilePath = config.resultFilePath;

    try {
      mkdirSync(hermesPath, { recursive: true });
    } catch {
      // best effort
    }

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

    child.stdout?.on("data", (data: Buffer) => {
      rawStdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      rawStderr += data.toString();
    });

    let timedOut = false;
    let exitCode: number | null = null;
    let signal: string | null = null;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.on("exit", (code, sig) => {
      clearTimeout(timeoutHandle);
      exitCode = code;
      signal = sig;
    });

    child.on("close", () => {
      clearTimeout(timeoutHandle);

      let result: HermesResult | null = null;
      if (existsSync(resultFilePath)) {
        try {
          const raw = readFileSync(resultFilePath, "utf8");
          result = JSON.parse(raw) as HermesResult;
        } catch (err) {
          rawStderr += `\n[executor] Failed to parse ${resultFilePath}: ${err instanceof Error ? err.message : String(err)}\n`;
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `[executor] Hermes ${config.isRecovery ? "recovery " : ""}finished in ${elapsed}ms — exit=${exitCode} timedOut=${timedOut} signal=${signal} result=${result?.status ?? "none"}`,
      );

      resolvePromise({ result, rawStdout, rawStderr, exitCode, timedOut, signal });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      console.error(`[executor] Spawn error: ${err.message}`);
      resolvePromise({
        result: null,
        rawStdout,
        rawStderr: rawStderr + `\nSpawn error: ${err.message}`,
        exitCode: null,
        timedOut: false,
        signal: null,
      });
    });
  });
}

// ── Execute with Recovery ──────────────────────────────────────────────────

/**
 * Spawn Hermes CLI in the worktree and wait for completion.
 * If result file is missing/invalid, attempts ONE bounded recovery.
 *
 * Returns structured output including the parsed result file (if written).
 * Never throws — all failures are captured in ExecutionOutput.
 */
export async function executeHermes(config: HermesExecutionConfig): Promise<ExecutionOutput> {
  const firstExecution = await executeHermesInternal(config);

  if (firstExecution.result !== null) {
    return { ...firstExecution, recoveryAttempted: false };
  }

  console.log("[executor] No valid result file after first execution — attempting recovery");

  const recoveryExecution = await attemptResultRecovery(
    config,
    firstExecution.rawStdout,
    firstExecution.rawStderr,
  );

  if (recoveryExecution.result !== null) {
    return { ...recoveryExecution, recoveryAttempted: true };
  }

  return { ...firstExecution, recoveryAttempted: true };
}

// ── Process tree termination ────────────────────────────────────────────────

function killProcessTree(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 5_000);
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
}