import { spawnSync } from "node:child_process";

export interface CommandValidationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  startedAt: string;
  finishedAt: string;
}

export interface ValidationSuiteResult {
  ok: boolean;
  results: CommandValidationResult[];
}

const MAX_OUTPUT_CHARS = 50_000;

export function runValidationCommands(
  cwd: string,
  commands: string[],
  timeoutMs = 15 * 60 * 1000,
): ValidationSuiteResult {
  const results: CommandValidationResult[] = [];

  for (const command of commands) {
    const startedAt = new Date().toISOString();
    const result = spawnSync("/bin/bash", ["-lc", command], {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CI: process.env.CI ?? "1" },
    });
    const finishedAt = new Date().toISOString();
    const exitCode = result.status ?? (result.error ? 1 : 0);
    results.push({
      command,
      exitCode,
      stdout: (result.stdout ?? "").slice(-MAX_OUTPUT_CHARS),
      stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.slice(-MAX_OUTPUT_CHARS),
      passed: exitCode === 0 && !result.signal,
      startedAt,
      finishedAt,
    });

    if (exitCode !== 0 || result.signal) break;
  }

  return { ok: results.length === commands.length && results.every((item) => item.passed), results };
}
