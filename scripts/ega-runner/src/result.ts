import { execSync } from "node:child_process";
import type { HermesResult } from "./hermes-executor.js";

export interface VerificationResult {
  ok: boolean;
  findings: VerificationFinding[];
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  prHeadShaMatch: boolean;
}

export interface VerificationFinding {
  check: string;
  passed: boolean;
  detail: string;
}

export function verifyResult(
  repoRoot: string,
  result: HermesResult,
  baseSha: string,
): VerificationResult {
  const findings: VerificationFinding[] = [];
  let ok = true;

  // 1. Verify result structure
  if (!result.status || !["completed", "failed"].includes(result.status)) {
    findings.push({
      check: "result_status",
      passed: false,
      detail: `Invalid status: ${result.status}`,
    });
    ok = false;
  } else {
    findings.push({
      check: "result_status",
      passed: true,
      detail: `Status: ${result.status}`,
    });
  }

  if (!result.run_id || typeof result.run_id !== "string") {
    findings.push({
      check: "run_id",
      passed: false,
      detail: "run_id missing or invalid",
    });
    ok = false;
  } else {
    findings.push({
      check: "run_id",
      passed: true,
      detail: `run_id: ${result.run_id}`,
    });
  }

  if (!result.commit || typeof result.commit !== "string") {
    findings.push({
      check: "commit",
      passed: false,
      detail: "commit SHA missing or invalid type",
    });
    ok = false;
  }

  if (!result.branch || typeof result.branch !== "string") {
    findings.push({
      check: "branch",
      passed: false,
      detail: "branch name missing or invalid type",
    });
    ok = false;
  }

  if (!Array.isArray(result.validations)) {
    findings.push({
      check: "validations_type",
      passed: false,
      detail: "validations must be an array",
    });
    ok = false;
  }

  if (typeof result.standardsReview !== "string" && result.standardsReview !== null) {
    findings.push({
      check: "standards_review_type",
      passed: false,
      detail: "standardsReview must be a string or null",
    });
    ok = false;
  }

  if (typeof result.specReview !== "string" && result.specReview !== null) {
    findings.push({
      check: "spec_review_type",
      passed: false,
      detail: "specReview must be a string or null",
    });
    ok = false;
  }

  if (!Array.isArray(result.risks)) {
    findings.push({
      check: "risks_type",
      passed: false,
      detail: "risks must be an array",
    });
    ok = false;
  }

  let branch: string | null = result.branch || null;
  let commitSha: string | null = result.commit || null;
  let prNumber: number | null = result.pr || null;

  if (branch) {
    try {
      const branchExists = execSync(
        `git branch --list ${branch}`,
        { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
      ).toString().trim();

      if (branchExists) {
        const ancestryCheck = execSync(
          `git merge-base --is-ancestor ${baseSha} ${branch} 2>/dev/null && echo "yes" || echo "no"`,
          { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
        ).toString().trim();

        if (ancestryCheck === "yes") {
          findings.push({
            check: "branch_ancestry",
            passed: true,
            detail: `Branch ${branch} contains base SHA ${baseSha.substring(0, 12)}`,
          });
        } else {
          findings.push({
            check: "branch_ancestry",
            passed: false,
            detail: `Branch ${branch} does NOT contain base SHA ${baseSha.substring(0, 12)}`,
          });
          ok = false;
        }
      } else {
        findings.push({
          check: "branch_exists",
          passed: false,
          detail: `Branch ${branch} not found in repo`,
        });
        ok = false;
        branch = null;
      }
    } catch (err) {
      findings.push({
        check: "branch_check",
        passed: false,
        detail: `Branch check error: ${err instanceof Error ? err.message : String(err)}`,
      });
      ok = false;
    }
  }

  if (commitSha && branch) {
    try {
      const commitOnBranch = execSync(
        `git branch --contains ${commitSha}`,
        { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
      ).toString().trim();

      if (commitOnBranch.includes(branch)) {
        findings.push({
          check: "commit_on_branch",
          passed: true,
          detail: `Commit ${commitSha.substring(0, 12)} is on branch ${branch}`,
        });
      } else {
        findings.push({
          check: "commit_on_branch",
          passed: false,
          detail: `Commit ${commitSha.substring(0, 12)} NOT on branch ${branch}`,
        });
        ok = false;
      }
    } catch {
      findings.push({
        check: "commit_on_branch",
        passed: false,
        detail: `Commit ${commitSha?.substring(0, 12) ?? "?"} not found`,
      });
      ok = false;
    }
  }

  let prHeadShaMatch = false;
  if (prNumber && branch) {
    try {
      const prInfo = execSync(
        `gh pr view ${prNumber} --json headRefName,headRefOid,baseRefName,url,title,body 2>/dev/null || true`,
        { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
      ).toString().trim();

      if (prInfo) {
        const prData = JSON.parse(prInfo);
        const headRefMatch = prData.headRefName === branch;
        prHeadShaMatch = commitSha ? prData.headRefOid === commitSha : false;

        if (headRefMatch) {
          findings.push({
            check: "pr_head_ref",
            passed: true,
            detail: `PR #${prNumber} head ref matches branch ${branch}`,
          });
        } else {
          findings.push({
            check: "pr_head_ref",
            passed: false,
            detail: `PR #${prNumber} head ref ${prData.headRefName} !== ${branch}`,
          });
          ok = false;
        }

        if (prHeadShaMatch && commitSha) {
          findings.push({
            check: "pr_head_sha",
            passed: true,
            detail: `PR #${prNumber} head SHA matches commit ${commitSha.substring(0, 12)}`,
          });
        } else if (commitSha) {
          findings.push({
            check: "pr_head_sha",
            passed: false,
            detail: `PR #${prNumber} head SHA does not match commit`,
          });
          ok = false;
        }

        const bodyOrTitle = `${prData.title ?? ""} ${prData.body ?? ""}`;
        const ticketRef = result.run_id || "";
        if (ticketRef && bodyOrTitle.includes(ticketRef.substring(0, 8))) {
          findings.push({
            check: "pr_ticket_reference",
            passed: true,
            detail: `PR references issue/run context`,
          });
        } else {
          findings.push({
            check: "pr_ticket_reference",
            passed: false,
            detail: `PR may not reference the ticket`,
          });
        }
      } else {
        findings.push({
          check: "pr_exists",
          passed: false,
          detail: `PR #${prNumber} not found (expected in full pipeline mode)`,
        });
      }
    } catch {
      findings.push({
        check: "pr_check",
        passed: false,
        detail: `Could not verify PR #${prNumber} (gh CLI may not be configured)`,
      });
    }
  }

  if (result.validations && result.validations.length > 0) {
    const allPassed = result.validations.every((v) => v.passed);
    const passedCount = result.validations.filter((v) => v.passed).length;

    findings.push({
      check: "validations",
      passed: allPassed,
      detail: `${passedCount}/${result.validations.length} validations passed`,
    });

    if (!allPassed) {
      ok = false;
      for (const v of result.validations) {
        if (!v.passed) {
          findings.push({
            check: `validation_${v.command.substring(0, 40)}`,
            passed: false,
            detail: `Exit code ${v.exitCode}: ${v.stderr.substring(0, 200) || v.stdout.substring(0, 200)}`,
          });
        }
      }
    }
  } else {
    findings.push({
      check: "validations",
      passed: false,
      detail: "No validations reported in result",
    });
    ok = false;
  }

  if (result.standardsReview) {
    findings.push({
      check: "standards_review",
      passed: true,
      detail: "Standards review present",
    });
  } else {
    findings.push({
      check: "standards_review",
      passed: false,
      detail: "Standards review missing",
    });
    ok = false;
  }

  return {
    ok,
    findings,
    branch,
    commitSha,
    prNumber,
    prHeadShaMatch,
  };
}

export function validateHermesResultSchema(data: unknown): { ok: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Result must be a JSON object" };
  }

  const r = data as Record<string, unknown>;

  if (r.status !== "completed" && r.status !== "failed") {
    return { ok: false, error: `Invalid status: ${r.status}. Must be "completed" or "failed"` };
  }

  if (typeof r.run_id !== "string" || !r.run_id) {
    return { ok: false, error: "run_id must be a non-empty string" };
  }

  if (typeof r.branch !== "string" || !r.branch) {
    return { ok: false, error: "branch must be a non-empty string" };
  }

  if (typeof r.commit !== "string" || !r.commit) {
    return { ok: false, error: "commit must be a non-empty string" };
  }

  if (r.pr !== null && typeof r.pr !== "number") {
    return { ok: false, error: "pr must be a number or null" };
  }

  if (!Array.isArray(r.validations)) {
    return { ok: false, error: "validations must be an array" };
  }

  for (const [i, v] of r.validations.entries()) {
    if (!v || typeof v !== "object") {
      return { ok: false, error: `validations[${i}] must be an object` };
    }
    const vc = v as Record<string, unknown>;
    if (typeof vc.command !== "string") {
      return { ok: false, error: `validations[${i}].command must be a string` };
    }
    if (typeof vc.exitCode !== "number") {
      return { ok: false, error: `validations[${i}].exitCode must be a number` };
    }
    if (typeof vc.passed !== "boolean") {
      return { ok: false, error: `validations[${i}].passed must be a boolean` };
    }
  }

  if (r.standardsReview !== null && typeof r.standardsReview !== "string") {
    return { ok: false, error: "standardsReview must be a string or null" };
  }

  if (r.specReview !== null && typeof r.specReview !== "string") {
    return { ok: false, error: "specReview must be a string or null" };
  }

  if (!Array.isArray(r.risks)) {
    return { ok: false, error: "risks must be an array" };
  }

  if (typeof r.executionLog !== "string") {
    return { ok: false, error: "executionLog must be a string" };
  }

  return { ok: true };
}

export function verifyImplementationCommit(
  repoRoot: string,
  baseSha: string,
  expectedBranch: string,
  allowedPaths: string[],
): VerificationResult {
  const findings: VerificationFinding[] = [];
  let ok = true;

  try {
    const headSha = execSync(
      `git rev-parse HEAD`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    ).toString().trim();

    const currentBranch = execSync(
      `git rev-parse --abbrev-ref HEAD`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    ).toString().trim();

    if (headSha === baseSha) {
      findings.push({
        check: "implementation_commit_exists",
        passed: false,
        detail: "HEAD equals base SHA — no implementation change made",
      });
      ok = false;
      return { ok, findings, branch: null, commitSha: null, prNumber: null, prHeadShaMatch: false };
    }

    const ancestorCheck = execSync(
      `git merge-base --is-ancestor ${baseSha} HEAD 2>/dev/null && echo "yes" || echo "no"`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    ).toString().trim();

    if (ancestorCheck !== "yes") {
      findings.push({
        check: "implementation_ancestor",
        passed: false,
        detail: `base_sha ${baseSha.substring(0, 12)} is not an ancestor of HEAD ${headSha.substring(0, 12)}`,
      });
      ok = false;
    } else {
      findings.push({
        check: "implementation_ancestor",
        passed: true,
        detail: `base_sha ${baseSha.substring(0, 12)} is ancestor of HEAD ${headSha.substring(0, 12)}`,
      });
    }

    if (currentBranch !== expectedBranch) {
      findings.push({
        check: "implementation_branch",
        passed: false,
        detail: `Expected branch ${expectedBranch}, current branch is ${currentBranch}`,
      });
      ok = false;
    } else {
      findings.push({
        check: "implementation_branch",
        passed: true,
        detail: `On expected branch ${expectedBranch}`,
      });
    }

    const diffWithBase = execSync(
      `git diff --name-only ${baseSha} HEAD`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    ).toString().trim();

    const changedFiles = diffWithBase ? diffWithBase.split("\n").filter(Boolean) : [];

    if (changedFiles.length === 0) {
      findings.push({
        check: "implementation_diff",
        passed: false,
        detail: "No product files changed between base SHA and HEAD",
      });
      ok = false;
    } else {
      const unauthorized = changedFiles.filter((f) => {
        if (f.startsWith(".ega-runner/")) return false;
        return !allowedPaths.some((a) => a === f || (a.endsWith("/") && f.startsWith(a)));
      });

      if (unauthorized.length > 0) {
        findings.push({
          check: "implementation_diff_scope",
          passed: false,
          detail: `Unauthorized files committed: ${unauthorized.join(", ")}`,
        });
        ok = false;
      } else {
        findings.push({
          check: "implementation_diff_scope",
          passed: true,
          detail: `All changed files are in authorized scope (${changedFiles.length} file(s))`,
        });
      }

      findings.push({
        check: "implementation_diff",
        passed: true,
        detail: `${changedFiles.length} product file(s) changed`,
      });
    }

    const uncommitted = execSync(
      `git status --porcelain`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    ).toString().trim();

    const outstandingProductChanges = uncommitted
      ? uncommitted.split("\n").filter((l) => {
          const file = l.trim().slice(2);
          return file && !file.startsWith(".ega-runner/");
        })
      : [];

    if (outstandingProductChanges.length > 0) {
      findings.push({
        check: "implementation_uncommitted",
        passed: false,
        detail: `${outstandingProductChanges.length} uncommitted product change(s): ${outstandingProductChanges.join(", ")}`,
      });
      ok = false;
    } else {
      findings.push({
        check: "implementation_uncommitted",
        passed: true,
        detail: "No uncommitted product changes",
      });
    }

    if (ok) {
      return {
        ok,
        findings,
        branch: currentBranch,
        commitSha: headSha,
        prNumber: null,
        prHeadShaMatch: false,
      };
    }

    return { ok, findings, branch: currentBranch, commitSha: headSha, prNumber: null, prHeadShaMatch: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    findings.push({
      check: "implementation_commit_error",
      passed: false,
      detail: msg,
    });
    return { ok: false, findings, branch: null, commitSha: null, prNumber: null, prHeadShaMatch: false };
  }
}
