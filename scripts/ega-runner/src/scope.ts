import { execSync } from "node:child_process";

export interface AllowedPaths {
  paths: string[];
}

export interface ScopeViolation {
  unauthorizedPaths: string[];
  message: string;
}

export function extractAllowedPathsFromDescription(description: string | null): string[] {
  if (!description) return [];

  const scopeSection = extractScopeSection(description);
  if (!scopeSection) return [];

  const paths = parsePathsFromScope(scopeSection);
  return normalizeAndValidatePaths(paths);
}

function extractScopeSection(description: string): string | null {
  const lines = description.split("\n");
  let inScopeSection = false;
  const scopeLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      /^##?\s*(scope|expected files?|files? to (change|modify|edit)|authorized paths?)/i.test(trimmed)
    ) {
      inScopeSection = true;
      continue;
    }

    if (inScopeSection && /^##?\s/.test(trimmed)) {
      break;
    }

    if (inScopeSection && trimmed) {
      scopeLines.push(trimmed);
    }
  }

  return scopeLines.length > 0 ? scopeLines.join("\n") : null;
}

function parsePathsFromScope(scopeText: string): string[] {
  const paths: string[] = [];

  const bulletRegex = /^[\-\*\•]\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = bulletRegex.exec(scopeText)) !== null) {
    const candidate = match[1].trim();
    if (candidate) paths.push(candidate);
  }

  if (paths.length === 0) {
    for (const line of scopeText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        paths.push(trimmed);
      }
    }
  }

  return paths;
}

function normalizeAndValidatePaths(paths: string[]): string[] {
  const normalized: string[] = [];

  for (const rawPath of paths) {
    let path = rawPath.trim();

    if (path.startsWith("`") && path.endsWith("`")) {
      path = path.slice(1, -1).trim();
    }

    if (path.startsWith("~") || path.startsWith("/") || path.includes("..")) {
      continue;
    }

    const cleanPath = path.replace(/^(\.\/)+/, "").replace(/\\/g, "/");

    if (!cleanPath || cleanPath === ".") {
      continue;
    }

    normalized.push(cleanPath);
  }

  return [...new Set(normalized)];
}

export function collectChangedProductPaths(repoRoot: string, baseSha: string): string[] {
  const opts = { cwd: repoRoot, stdio: "pipe" as const, encoding: "utf8" as const };

  const changed: string[] = [];

  try {
    const diffOutput = execSync(
      `git diff --name-only -z ${baseSha} HEAD 2>/dev/null || true`,
      opts,
    ).toString();
    for (const file of diffOutput.split("\0")) {
      if (file && !file.startsWith(".ega-runner/")) {
        changed.push(file);
      }
    }
  } catch {}

  try {
    const stagedOutput = execSync(
      `git diff --name-only -z --cached 2>/dev/null || true`,
      opts,
    ).toString();
    for (const file of stagedOutput.split("\0")) {
      if (file && !file.startsWith(".ega-runner/")) {
        changed.push(file);
      }
    }
  } catch {}

  try {
    const untrackedOutput = execSync(
      `git ls-files --others --exclude-standard -z 2>/dev/null || true`,
      opts,
    ).toString();
    for (const file of untrackedOutput.split("\0")) {
      if (file && !file.startsWith(".ega-runner/")) {
        changed.push(file);
      }
    }
  } catch {}

  try {
    const deletedOutput = execSync(
      `git diff --name-only -z --diff-filter=D ${baseSha} HEAD 2>/dev/null || true`,
      opts,
    ).toString();
    for (const file of deletedOutput.split("\0")) {
      if (file && !file.startsWith(".ega-runner/")) {
        changed.push(file);
      }
    }
  } catch {}

  try {
    const renamedOutput = execSync(
      `git diff --name-only -z --diff-filter=R ${baseSha} HEAD 2>/dev/null || true`,
      opts,
    ).toString();
    for (const file of renamedOutput.split("\0")) {
      if (file && !file.startsWith(".ega-runner/")) {
        changed.push(file);
      }
    }
  } catch {}

  return [...new Set(changed)];
}

export function enforceScope(
  allowedPaths: string[],
  changedPaths: string[],
  repoRoot: string,
  baseSha: string,
): ScopeViolation | null {
  const violations: string[] = [];

  for (const changed of changedPaths) {
    const isAllowed = allowedPaths.some((allowed) => {
      if (allowed === changed) return true;
      if (allowed.endsWith("/") && changed.startsWith(allowed)) return true;
      return false;
    });

    if (!isAllowed) {
      violations.push(changed);
    }
  }

  if (violations.length > 0) {
    return {
      unauthorizedPaths: violations,
      message: `Scope violation: ${violations.length} unauthorized file(s) modified: ${violations.join(", ")}`,
    };
  }

  return null;
}

export function getUncommittedPatch(repoRoot: string): string {
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