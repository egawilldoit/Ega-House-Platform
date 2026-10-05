import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Structured security audit exceptions under active governance.
 *
 * Each record represents a temporary risk acceptance for an unpatched transitive
 * dependency pending an upstream fix. Bare advisory IDs are strictly prohibited.
 * Every exception must define an explicit expiry date (reviewBy) in YYYY-MM-DD format.
 *
 * An entry belongs here only while no patched release exists. When a patch does
 * appear, the advisory is remediated (upgrade or scoped override) and the entry is
 * deleted rather than given a later `reviewBy`.
 */
export const SECURITY_AUDIT_EXCEPTIONS = [
  // ---------------------------------------------------------------------------
  // Added 2026-10-05. Both advisories carried here were published AFTER this
  // registry was last written, which is why they blocked a red `workspace` job on
  // origin/main as well as on the MCP hardening branch. Neither is a defect
  // introduced by that branch.
  //
  // For both, the newest version ever published is the affected one
  // (braces: 3.0.3; node-forge: 1.4.0) and the GitHub advisory records no
  // patched version, so there is no upgrade and no override that fixes them.
  // Both are accepted as build-time-only transitive risk until upstream ships a
  // release. These are NOT a catch-all: an entry matches one advisory id on one
  // package, and any other advisory still blocks.
  // ---------------------------------------------------------------------------
  {
    source: 1240992,
    advisory: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    reason:
      'Temporary risk acceptance: braces stack-exhaustion DoS via deeply nested glob patterns. No patched ' +
      'release exists - 3.0.3 is the newest version ever published and the advisory lists no patched version. ' +
      'Reached only through micromatch, itself only a build/test-time dependency of jest, metro and ' +
      '@expo/metro*. No shipped application code imports braces or micromatch, and the trigger requires an ' +
      'attacker-supplied glob pattern compiled at build time, which this repository does not do. Removable by ' +
      'dropping braces@3.0.3 the moment upstream publishes a fix.',
    affectedSurface: 'mobile build/test toolchain only (jest, metro, @expo/metro); absent from the shipped app bundle',
    whyNotFixableNow: 'no patched braces release exists; micromatch requires ^3.0.3',
    // The script attributes a leaf advisory to the DIRECT package that reaches it,
    // so reaching braces through the direct `expo` / `react-native` /
    // `react-native-reanimated` deps trips the direct-dependency gate. The
    // vulnerable package is still the transitive braces, not those direct
    // packages. allowDirect widens the accepted set only for THIS advisory id on
    // THIS package; any other advisory on a direct dependency still blocks.
    allowDirect: true,
    owner: 'platform (mobile build toolchain)',
    reviewBy: '2026-11-05',
    upstream: 'expo > metro/jest > micromatch',
  },
  {
    source: 1240912,
    advisory: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    reason:
      'Temporary risk acceptance: node-forge accepts extra nested DigestAlgorithm elements when verifying an ' +
      'RSA PKCS#1 v1.5 signature. No patched release exists - 1.4.0 is the newest version ever published and ' +
      'the advisory lists no patched version. Reached only through @expo/cli and ' +
      '@expo/code-signing-certificates, both of which use node-forge to verify EAS build artifacts rather than ' +
      'to serve untrusted input. No shipped application code imports node-forge. Removable by dropping ' +
      'node-forge@1.4.0 the moment upstream publishes a fix.',
    affectedSurface: 'Expo CLI build-artifact signature verification only; absent from the shipped app bundle',
    whyNotFixableNow: 'no patched node-forge release exists; @expo/code-signing-certificates requires ^1.3.3',
    // Same reasoning as the braces entry above: the direct package is only the
    // parent, the vulnerable package is the transitive node-forge.
    allowDirect: true,
    owner: 'platform (mobile release tooling)',
    reviewBy: '2026-11-05',
    upstream: 'expo > @expo/cli / @expo/code-signing-certificates',
  },
  // ---------------------------------------------------------------------------
  // Removed 2026-10-05 (remediated, not renewed): the seven entries that used to
  // expire on 2026-10-15 — brace-expansion sources 1240104/1240105/1240107
  // (GHSA-qhr7-859c-m2p7), brace-expansion sources 1240108/1240109/1240111
  // (GHSA-6j4f-fj2g-mc7p), and undici source 1240042 (GHSA-rfgv-xxqx-mfg5).
  //
  // Their recorded reason ("no patched release") was wrong. Every affected range
  // has a published release outside it, and each of those releases sits INSIDE the
  // range the package's own parent already declares, so no out-of-range override
  // is needed. Scoped root `overrides` in package.json now force:
  //
  //   brace-expansion@^1 -> 1.1.21  (minimatch@^1.1.7 under glob@7, jest,
  //                                 react-native, rimraf, test-exclude)
  //   brace-expansion@^2 -> 2.1.7   (minimatch@^2.0.2 under expo > @expo/cli)
  //   brace-expansion@^5 -> 5.0.12  (minimatch@^5.0.8 at the workspace root)
  //   undici@^6          -> 6.29.0  (@expo/cli declares ^6.18.2)
  //
  // `npm audit --omit=dev` reports none of the seven after that change.
  // `audit-production.test.mjs` holds both halves of the claim: the registry must
  // never name these sources again, and a report carrying them must block on the
  // shipped registry rather than inherit any acceptance.
  // ---------------------------------------------------------------------------
];

export const ALLOWED_LEAF_EXCEPTIONS = SECURITY_AUDIT_EXCEPTIONS;
export const ALLOWED_LEAF_SOURCES = new Map(
  SECURITY_AUDIT_EXCEPTIONS.map((e) => [e.source, `${e.advisory}: ${e.package} (${e.upstream})`]),
);

export const AUDIT_TIMEOUT_MS = 120_000;
export const AUDIT_ATTEMPTS = 2;

export function isValidReviewByFormat(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function isExpired(exception, now = new Date()) {
  const reviewDate = new Date(exception.reviewBy);
  const nowDate = now instanceof Date ? now : new Date(now);
  return nowDate > reviewDate;
}

export function runAuditCommand({ spawn = spawnSync, npm = process.platform === 'win32' ? 'npm.cmd' : 'npm' } = {}) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
    const result = spawn(npm, ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: AUDIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    if (result.error?.code === 'ETIMEDOUT') {
      lastFailure = new Error(`dependency-audit: npm audit timed out after ${AUDIT_TIMEOUT_MS}ms (attempt ${attempt}/${AUDIT_ATTEMPTS})`);
      continue;
    }

    if (result.error) {
      throw new Error(`dependency-audit: npm audit failed to start: ${result.error.message}`);
    }

    if (!result.stdout?.trim()) {
      lastFailure = new Error(result.stderr || `dependency-audit: npm audit returned no JSON (attempt ${attempt}/${AUDIT_ATTEMPTS})`);
      continue;
    }

    return result;
  }

  throw lastFailure ?? new Error('dependency-audit: npm audit failed without evidence');
}

export function evaluateAuditReport(report, options = {}) {
  const {
    exceptions = SECURITY_AUDIT_EXCEPTIONS,
    now = new Date(),
    wsPackageJsonPath = 'node_modules/ws/package.json',
    checkWs = true,
    fsModule = fs,
  } = options;

  const blocking = [];
  const allowed = [];

  // Validate configured exceptions
  for (const exception of exceptions) {
    if (!isValidReviewByFormat(exception?.reviewBy)) {
      blocking.push({
        name: exception?.package ?? 'unknown',
        source: exception?.source,
        reason: `malformed reviewBy date format: ${exception?.reviewBy}`,
      });
    }
  }

  const all = report.vulnerabilities ?? {};

  function leafAdvisories(name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const value = all[name];
    if (!value) return [];
    const leaves = [];
    for (const via of value.via ?? []) {
      if (typeof via === 'string') {
        leaves.push(...leafAdvisories(via, new Set(seen)));
      } else if (via.severity === 'high' || via.severity === 'critical') {
        leaves.push(via);
      }
    }
    return leaves;
  }

  for (const [name, value] of Object.entries(all)) {
    if (value.severity !== 'high' && value.severity !== 'critical') continue;

    const leaves = leafAdvisories(name);
    if (leaves.length === 0) {
      blocking.push({ name, reason: 'high/critical entry has no resolvable leaf advisory' });
      continue;
    }

    const rejected = [];
    const allowedLeafSources = [];

    for (const leaf of leaves) {
      const exception = exceptions.find((ex) => {
        if (ex.source !== undefined && ex.source === leaf.source) return true;
        if (ex.advisory && ((leaf.url && leaf.url.includes(ex.advisory)) || leaf.advisory === ex.advisory)) {
          return true;
        }
        return false;
      });

      if (!exception) {
        rejected.push({
          source: leaf.source,
          name: leaf.name,
          url: leaf.url,
          reason: `unknown high/critical advisory not in exception registry (source: ${leaf.source})`,
        });
        continue;
      }

      if (!isValidReviewByFormat(exception.reviewBy)) {
        rejected.push({
          source: leaf.source,
          name: leaf.name,
          url: leaf.url,
          reason: `malformed reviewBy date format: "${exception.reviewBy}"`,
        });
        continue;
      }

      if (isExpired(exception, now)) {
        rejected.push({
          source: leaf.source,
          name: leaf.name,
          url: leaf.url,
          reason: `temporary risk acceptance expired on ${exception.reviewBy} (reviewed until ${exception.reviewBy})`,
        });
        continue;
      }

      if (exception.package && leaf.name !== exception.package) {
        rejected.push({
          source: leaf.source,
          name: leaf.name,
          url: leaf.url,
          reason: `exception package mismatch: expected "${exception.package}", got "${leaf.name}"`,
        });
        continue;
      }

      const leafPackage = all[leaf.name];
      const isDirect = Boolean(value.isDirect || leafPackage?.isDirect);
      if (isDirect && !exception.allowDirect) {
        rejected.push({
          source: leaf.source,
          name: leaf.name,
          url: leaf.url,
          reason: `direct high/critical advisory not permitted by policy for "${name}"`,
        });
        continue;
      }

      allowedLeafSources.push(leaf.source);
    }

    if (rejected.length > 0) {
      blocking.push({
        name,
        direct: value.isDirect,
        rejected: rejected.map((x) => ({
          source: x.source,
          name: x.name,
          url: x.url,
          reason: x.reason,
        })),
      });
    } else {
      allowed.push({
        name,
        direct: value.isDirect,
        leaves: [...new Set(allowedLeafSources)],
      });
    }
  }

  if (checkWs && fsModule && wsPackageJsonPath) {
    try {
      if (fsModule.existsSync(wsPackageJsonPath)) {
        const ws = JSON.parse(fsModule.readFileSync(wsPackageJsonPath, 'utf8')).version;
        if (ws !== '8.21.3') {
          blocking.push({ name: 'ws', reason: `expected remediated ws@8.21.3, got ${ws}` });
        }
      } else {
        blocking.push({ name: 'ws', reason: `expected remediated ws@8.21.3, file not found: ${wsPackageJsonPath}` });
      }
    } catch (err) {
      blocking.push({ name: 'ws', reason: `failed reading ws package.json: ${err.message}` });
    }
  }

  return {
    allowedHighCritical: allowed,
    blockingHighCritical: blocking,
  };
}

export function main() {
  let result;
  try {
    result = runAuditCommand();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(result.stdout);
  const evaluation = evaluateAuditReport(report);

  console.log(
    JSON.stringify(
      {
        counts: report.metadata?.vulnerabilities,
        allowedHighCritical: evaluation.allowedHighCritical,
        blockingHighCritical: evaluation.blockingHighCritical,
      },
      null,
      2,
    ),
  );

  if (evaluation.blockingHighCritical.length > 0) {
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl === import.meta.url) main();
