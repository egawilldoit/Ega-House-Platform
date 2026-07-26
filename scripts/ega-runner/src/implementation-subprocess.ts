import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import type { PipelineOutcome } from "./implementation-pipeline.js";

const MAX_CAPTURE_CHARS = 100_000;
const OUTCOME_PREFIX = "EGA_PIPELINE_OUTCOME:";

export interface AbortableChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface AbortableChildOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(signal.reason ? String(signal.reason) : "Execution aborted");
}

function descendantPids(rootPid: number): number[] {
  try {
    const output = execFileSync("ps", ["-eo", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const children = new Map<number, number[]>();
    for (const line of output.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const existing = children.get(ppid) ?? [];
      existing.push(pid);
      children.set(ppid, existing);
    }
    const result: number[] = [];
    const stack = [...(children.get(rootPid) ?? [])];
    while (stack.length > 0) {
      const pid = stack.pop();
      if (pid === undefined) continue;
      result.push(pid);
      stack.push(...(children.get(pid) ?? []));
    }
    return result.reverse();
  } catch {
    return [];
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or is not visible to this user.
  }
}

export function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  const rootPid = child.pid;
  const targets = [...descendantPids(rootPid), rootPid];
  for (const pid of targets) signalPid(pid, "SIGTERM");
  try {
    process.kill(-rootPid, "SIGTERM");
  } catch {
    // The child may not be a process-group leader on every platform.
  }
  setTimeout(() => {
    const remaining = [...descendantPids(rootPid), rootPid];
    for (const pid of remaining) signalPid(pid, "SIGKILL");
    try {
      process.kill(-rootPid, "SIGKILL");
    } catch {
      // Process tree already exited.
    }
  }, 5_000).unref();
}

export function runAbortableChildProcess(options: AbortableChildOptions): Promise<AbortableChildResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(abortError(options.signal));
      return;
    }

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = (): void => {
      options.signal.removeEventListener("abort", onAbort);
    };
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      terminateProcessTree(child);
    };

    options.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-MAX_CAPTURE_CHARS);
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-MAX_CAPTURE_CHARS);
    });
    child.on("error", (error) => finishReject(error));
    child.on("close", (exitCode, childSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.signal.aborted) {
        reject(abortError(options.signal));
        return;
      }
      resolve({ stdout, stderr, exitCode, signal: childSignal });
    });
  });
}

export async function executeImplementationSubprocess(
  config: Config,
  runId: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PipelineOutcome> {
  const scriptPath = fileURLToPath(new URL("./implementation-child.ts", import.meta.url));
  const result = await runAbortableChildProcess({
    command: process.execPath,
    args: ["--import", "tsx", scriptPath],
    cwd: dirname(scriptPath),
    env: {
      ...process.env,
      EGA_RUNNER_CHILD_CONFIG: Buffer.from(JSON.stringify(config), "utf8").toString("base64"),
      EGA_RUNNER_CHILD_RUN_ID: runId,
      EGA_RUNNER_CHILD_PAYLOAD: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    },
    signal,
  });

  if (result.exitCode !== 0 || result.signal) {
    throw new Error(
      `Implementation subprocess failed (exit=${result.exitCode ?? "null"}, signal=${result.signal ?? "none"}): ` +
      result.stderr.slice(-20_000),
    );
  }
  const marker = result.stdout.lastIndexOf(OUTCOME_PREFIX);
  if (marker < 0) throw new Error("Implementation subprocess returned no structured outcome");
  const encoded = result.stdout.slice(marker + OUTCOME_PREFIX.length).trim().split(/\r?\n/, 1)[0];
  const outcome = JSON.parse(encoded) as Partial<PipelineOutcome>;
  if (typeof outcome.archiveMessage !== "boolean" || typeof outcome.status !== "string") {
    throw new Error("Implementation subprocess returned an invalid outcome");
  }
  return outcome as PipelineOutcome;
}
