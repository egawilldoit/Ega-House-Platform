import { execFileSync } from "node:child_process";

export function runGh(repoRoot: string, args: string[], timeout = 30_000): string {
  return execFileSync("gh", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

export function runGit(repoRoot: string, args: string[], timeout = 30_000): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

export function getRepoFullName(repoRoot: string): string {
  const remote = runGit(repoRoot, ["remote", "get-url", "origin"], 10_000);
  const match = remote.match(/(?:github\.com[:/])([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Unable to resolve GitHub repository from origin: ${remote}`);
  }
  return `${match[1]}/${match[2]}`;
}
