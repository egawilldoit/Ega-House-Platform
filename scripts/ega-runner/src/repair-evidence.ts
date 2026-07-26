import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { writeEvidenceFile } from "./evidence.js";
import type { RepairRunRecord } from "./repair-types.js";

const MAX_UNTRACKED_EVIDENCE_FILES = 100;
const MAX_UNTRACKED_EVIDENCE_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_UNTRACKED_FILE_BYTES = 5 * 1024 * 1024;

export function git(cwd: string, args: string[], timeout = 60_000): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function gitNul(cwd: string, args: string[]): string[] {
  const output = execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}
export function productStatus(worktreePath: string): string[] {
  return git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).replace(/^"|"$/g, "");
      return file !== ".ega-runner" && !file.startsWith(".ega-runner/");
    });
}

export function isAncestor(worktreePath: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function preserveUntrackedFiles(
  run: RepairRunRecord,
  attemptNumber: number,
  evidenceDir: string,
): void {
  const untracked = gitNul(run.worktree_path, ["ls-files", "--others", "--exclude-standard", "-z"])
    .filter((file) => file !== ".ega-runner" && !file.startsWith(".ega-runner/"));
  writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-untracked-files.txt`, untracked.join("\n"));
  if (untracked.length > MAX_UNTRACKED_EVIDENCE_FILES) {
    throw new Error(`Untracked evidence exceeds ${MAX_UNTRACKED_EVIDENCE_FILES} files`);
  }

  const root = path.resolve(run.worktree_path);
  const evidenceRoot = path.resolve(evidenceDir, `repair-${attemptNumber}-untracked`);
  let copiedBytes = 0;
  for (const relative of untracked) {
    const source = path.resolve(root, relative);
    if (source !== root && !source.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Untracked evidence path escaped worktree: ${relative}`);
    }
    const stat = lstatSync(source);
    const destination = path.resolve(evidenceRoot, relative);
    if (destination !== evidenceRoot && !destination.startsWith(`${evidenceRoot}${path.sep}`)) {
      throw new Error(`Untracked evidence destination escaped evidence root: ${relative}`);
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    if (stat.isSymbolicLink()) {
      writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-untracked-symlink-${Buffer.from(relative).toString("hex")}.txt`, `${relative} -> ${readlinkSync(source)}`);
    } else if (stat.isFile()) {
      if (stat.size > MAX_SINGLE_UNTRACKED_FILE_BYTES) {
        throw new Error(`Untracked evidence file is too large: ${relative} (${stat.size} bytes)`);
      }
      copiedBytes += stat.size;
      if (copiedBytes > MAX_UNTRACKED_EVIDENCE_BYTES) {
        throw new Error(`Untracked evidence exceeds ${MAX_UNTRACKED_EVIDENCE_BYTES} bytes`);
      }
      copyFileSync(source, destination);
    }
  }
}

export function preserveAndResetRepair(
  run: RepairRunRecord,
  beforeHead: string,
  attemptNumber: number,
  evidenceDir: string,
): void {
  mkdirSync(evidenceDir, { recursive: true });
  let evidenceError: Error | null = null;
  try {
    preserveUntrackedFiles(run, attemptNumber, evidenceDir);
    let patch = "";
    try {
      patch = git(run.worktree_path, ["diff", "--binary", beforeHead]);
    } catch {
      patch = "";
    }
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-failed.patch`, patch);
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-failed-status.txt`, productStatus(run.worktree_path).join("\n"));
  } catch (error) {
    evidenceError = error instanceof Error ? error : new Error(String(error));
  }

  git(run.worktree_path, ["reset", "--hard", beforeHead]);
  git(run.worktree_path, ["clean", "-fd", "-e", ".ega-runner/"]);
  if (git(run.worktree_path, ["rev-parse", "HEAD"]) !== beforeHead || productStatus(run.worktree_path).length > 0) {
    throw new Error("Rejected repair could not be reset to the observed PR head");
  }
  if (evidenceError) {
    throw new Error(`Rejected repair was reset but evidence preservation was incomplete: ${evidenceError.message}`);
  }
}
