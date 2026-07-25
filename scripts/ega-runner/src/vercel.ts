/**
 * Vercel Verifier — validates deployments by exact SHA.
 *
 * OWNERSHIP: Vercel is the deployment truth.
 * Runner verifies that the expected SHA is deployed to preview/production.
 */

import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────────

export interface VercelDeployment {
  sha: string;
  url: string;
  state: string;
  createdAt: string;
  inspectorUrl: string;
}

export interface VercelVerificationResult {
  ok: boolean;
  preview: VercelDeployment | null;
  production: VercelDeployment | null;
  findings: string[];
}

// ── Get latest deployment for SHA ──────────────────────────────────────────

/**
 * Check if a specific commit SHA is deployed to Vercel.
 * Uses the Vercel CLI if available, otherwise falls back to the Vercel API.
 */
export function getDeploymentBySha(
  sha: string,
  projectName?: string,
): VercelDeployment | null {
  const vercelToken = process.env.VERCEL_TOKEN;

  if (!vercelToken && !process.env.VERCEL_CLI_TOKEN) {
    return null;
  }

  const token = vercelToken || process.env.VERCEL_CLI_TOKEN;

  try {
    // Try Vercel CLI first
    const output = execSync(
      `npx vercel list ${projectName ?? ""} --token "${token}" --json 2>/dev/null || true`,
      { stdio: "pipe", timeout: 30_000, encoding: "utf8" },
    ).toString().trim();

    if (output) {
      const deployments = JSON.parse(output);
      const items: Record<string, unknown>[] = Array.isArray(deployments) ? deployments : [];
      const match = items.find((d) => {
        const meta = d.meta as Record<string, unknown> | undefined;
        const dUrl = d.url as string | undefined;
        return (d.sha256 === sha || meta?.githubCommitSha === sha || meta?.commitSha === sha) ||
          (typeof dUrl === "string" && dUrl.includes(sha.substring(0, 8)));
      });

      if (match) {
        return {
          sha,
          url: `https://${match.url}`,
          state: match.state as string,
          createdAt: match.createdAt as string,
          inspectorUrl: `https://vercel.com/${match.owner ?? "_"}/${match.project ?? "_"}/${match.id ?? "_"}`,
        };
      }
    }
  } catch {
    // Fallback to API
  }

  // Fallback: Vercel API direct call
  try {
    const apiOutput = execSync(
      `curl -s -H 'Authorization: Bearer ${token}' ` +
        `"https://api.vercel.com/v6/deployments?limit=20&target=preview"`,
      { stdio: "pipe", timeout: 30_000, encoding: "utf8" },
    ).toString().trim();

    const data = JSON.parse(apiOutput);
    const deployments: Record<string, unknown>[] = data.deployments ?? [];
    const match = deployments.find((d) => {
      const meta = d.meta as Record<string, unknown> | undefined;
      return meta?.githubCommitSha === sha;
    });

    if (match) {
      return {
        sha,
        url: `https://${match.url}`,
        state: match.state as string,
        createdAt: match.createdAt as string,
        inspectorUrl: `https://vercel.com/${match.owner ?? "_"}/${match.project ?? "_"}/${match.uid ?? "_"}`,
      };
    }
  } catch {
    // Not available
  }

  return null;
}

// ── Verify deployment ──────────────────────────────────────────────────────

/**
 * Verify that a specific commit SHA is deployed to Vercel preview.
 * Returns the deployment info if verified.
 */
export async function verifyVercelDeployment(
  sha: string,
  projectName?: string,
): Promise<VercelVerificationResult> {
  const findings: string[] = [];

  if (!process.env.VERCEL_TOKEN && !process.env.VERCEL_CLI_TOKEN) {
    return {
      ok: false,
      preview: null,
      production: null,
      findings: ["Vercel not configured — set VERCEL_TOKEN or VERCEL_CLI_TOKEN"],
    };
  }

  const preview = getDeploymentBySha(sha, projectName);

  if (preview) {
    findings.push(
      `Preview deployment found: ${preview.url} (state: ${preview.state})`,
    );
  } else {
    findings.push(
      `No preview deployment found for SHA ${sha.substring(0, 12)}`,
    );
  }

  // Try production too
  let production: VercelDeployment | null = null;
  try {
    const token = process.env.VERCEL_TOKEN || process.env.VERCEL_CLI_TOKEN;
    const apiOutput = execSync(
      `curl -s -H 'Authorization: Bearer ${token}' ` +
        `"https://api.vercel.com/v6/deployments?limit=5&target=production"`,
      { stdio: "pipe", timeout: 30_000, encoding: "utf8" },
    ).toString().trim();

    const data = JSON.parse(apiOutput);
    const deployments: Record<string, unknown>[] = data.deployments ?? [];
    const prodMatch = deployments.find((d) => {
      const meta = d.meta as Record<string, unknown> | undefined;
      return meta?.githubCommitSha === sha;
    });

    if (prodMatch) {
      production = {
        sha,
        url: `https://${prodMatch.url}`,
        state: prodMatch.state as string,
        createdAt: prodMatch.createdAt as string,
        inspectorUrl: `https://vercel.com/${prodMatch.owner ?? "_"}/${prodMatch.project ?? "_"}/${prodMatch.uid ?? "_"}`,
      };
      findings.push(
        `Production deployment found: ${production.url} (state: ${production.state})`,
      );
    }
  } catch {
    // Production check is best-effort
  }

  const ok = preview !== null && preview.state === "READY";

  return { ok, preview, production, findings };
}
