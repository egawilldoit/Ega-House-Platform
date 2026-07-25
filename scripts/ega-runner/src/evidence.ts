import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface EvidenceArtifact {
  path: string;
  sha256: string;
  size: number;
}

export interface EvidenceArchive {
  runId: string;
  issueIdentifier: string;
  attemptNumber: number;
  artifacts: EvidenceArtifact[];
  createdAt: string;
}

export interface FailureSummary {
  failureCode: string;
  message: string;
  timestamp: string;
  attemptNumber: number;
}

export function createEvidenceDir(
  repoRoot: string,
  issueIdentifier: string,
  runId: string,
  attemptNumber: number,
): string {
  const evidenceDir = resolve(
    repoRoot,
    "evidence",
    issueIdentifier,
    runId,
    `attempt-${attemptNumber}`,
  );

  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  return evidenceDir;
}

export function writeEvidenceFile(
  evidenceDir: string,
  filename: string,
  content: string,
  maxSizeBytes = 10 * 1024 * 1024,
): EvidenceArtifact | null {
  const truncated = content.length > maxSizeBytes ? content.slice(0, maxSizeBytes) + "\n...[TRUNCATED]" : content;
  const filePath = resolve(evidenceDir, filename);

  try {
    writeFileSync(filePath, truncated, "utf8");
  } catch (err) {
    console.error(`[evidence] Failed to write ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const stats = getFileStats(filePath);
  if (!stats) return null;

  return { path: filePath, sha256: stats.sha256, size: stats.size };
}

export function writeBinaryEvidenceFile(
  evidenceDir: string,
  filename: string,
  buffer: Buffer,
  maxSizeBytes = 10 * 1024 * 1024,
): EvidenceArtifact | null {
  const truncated = buffer.length > maxSizeBytes ? buffer.slice(0, maxSizeBytes) : buffer;
  const filePath = resolve(evidenceDir, filename);

  try {
    writeFileSync(filePath, truncated);
  } catch (err) {
    console.error(`[evidence] Failed to write ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const stats = getFileStats(filePath);
  if (!stats) return null;

  return { path: filePath, sha256: stats.sha256, size: stats.size };
}

function getFileStats(filePath: string): { sha256: string; size: number } | null {
  try {
    const content = readFileSync(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    return { sha256: hash, size: content.length };
  } catch {
    return null;
  }
}

export function writeFailureSummary(
  evidenceDir: string,
  failureCode: string,
  message: string,
  attemptNumber: number,
): EvidenceArtifact | null {
  const summary: FailureSummary = {
    failureCode,
    message,
    timestamp: new Date().toISOString(),
    attemptNumber,
  };
  return writeEvidenceFile(evidenceDir, "failure-summary.json", JSON.stringify(summary, null, 2));
}

export function writeEvidenceManifest(
  evidenceDir: string,
  runId: string,
  issueIdentifier: string,
  attemptNumber: number,
  artifacts: EvidenceArtifact[],
): EvidenceArtifact | null {
  const manifest: EvidenceArchive = {
    runId,
    issueIdentifier,
    attemptNumber,
    artifacts,
    createdAt: new Date().toISOString(),
  };
  return writeEvidenceFile(evidenceDir, "evidence-manifest.json", JSON.stringify(manifest, null, 2));
}

export function copyWorktreeEvidence(
  worktreePath: string,
  evidenceDir: string,
): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];

  const resultFile = resolve(worktreePath, ".ega-runner", "hermes-result.json");
  if (existsSync(resultFile)) {
    const artifact = writeEvidenceFile(evidenceDir, "hermes-result.json", readFileSync(resultFile, "utf8"));
    if (artifact) artifacts.push(artifact);
  }

  return artifacts;
}

export function preserveHermesOutput(
  evidenceDir: string,
  stdout: string,
  stderr: string,
  isRecovery: boolean,
): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];

  const prefix = isRecovery ? "hermes-recovery" : "hermes";

  const stdoutArtifact = writeEvidenceFile(evidenceDir, `${prefix}.stdout.log`, stdout);
  if (stdoutArtifact) artifacts.push(stdoutArtifact);

  const stderrArtifact = writeEvidenceFile(evidenceDir, `${prefix}.stderr.log`, stderr);
  if (stderrArtifact) artifacts.push(stderrArtifact);

  return artifacts;
}

export function preserveGitEvidence(
  evidenceDir: string,
  repoRoot: string,
  baseSha: string,
  headBefore: string,
  headAfter: string,
  changedFiles: string[],
): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];

  const changedFilesArtifact = writeEvidenceFile(evidenceDir, "changed-files.txt", changedFiles.join("\n"));
  if (changedFilesArtifact) artifacts.push(changedFilesArtifact);

  const headBeforeArtifact = writeEvidenceFile(evidenceDir, "head-before.txt", headBefore);
  if (headBeforeArtifact) artifacts.push(headBeforeArtifact);

  const headAfterArtifact = writeEvidenceFile(evidenceDir, "head-after.txt", headAfter);
  if (headAfterArtifact) artifacts.push(headAfterArtifact);

  const patch = getUncommittedPatch(repoRoot);
  const patchArtifact = writeEvidenceFile(evidenceDir, "uncommitted.patch", patch);
  if (patchArtifact) artifacts.push(patchArtifact);

  return artifacts;
}

function getUncommittedPatch(repoRoot: string): string {
  try {
    return execSync(`git diff HEAD --no-color 2>/dev/null || true`, {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    }).toString();
  } catch {
    return "";
  }
}

function execSync(command: string, options: { cwd: string; stdio: "pipe"; encoding: "utf8" }): string {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("bash", ["-c", command], {
    cwd: options.cwd,
    stdio: options.stdio,
    encoding: options.encoding,
    timeout: 30000,
  });
  if (result.error) throw result.error;
  return result.stdout?.toString() ?? "";
}