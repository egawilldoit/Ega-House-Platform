import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ALLOWED_LEAF_SOURCES = new Map([
  [1130720, 'fast-uri via upstream AJV v3 contract'],
  [1123911, 'js-yaml via upstream v4 tooling contract'],
  [1138115, 'js-yaml via upstream v4 tooling contract'],
  // GitHub's reviewed nanoid advisory kept the same GHSA but npm audit
  // refreshed its source id on 2026-08-22. The exception remains the
  // already-approved transitive Expo Router v3 line documented in
  // docs/architecture/dependency-audit-exceptions.md.
  [1139427, 'nanoid via Expo Router v3 contract'],
  [1138808, 'image-size via Metro/Expo toolchain'],
  [1138809, 'image-size via Metro/Expo toolchain'],
]);
const REVIEW_BY = '2026-09-09';
export const AUDIT_TIMEOUT_MS = 120_000;
export const AUDIT_ATTEMPTS = 2;

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

export function main() {
  if (new Date().toISOString().slice(0, 10) > REVIEW_BY) {
    throw new Error(`dependency-audit: exception review deadline ${REVIEW_BY} has passed`);
  }

  let result;
  try {
    result = runAuditCommand();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(result.stdout);
  const all = report.vulnerabilities ?? {};

  function leafAdvisories(name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const value = all[name];
    if (!value) return [];
    const leaves = [];
    for (const via of value.via ?? []) {
      if (typeof via === 'string') leaves.push(...leafAdvisories(via, new Set(seen)));
      else if (via.severity === 'high' || via.severity === 'critical') leaves.push(via);
    }
    return leaves;
  }

  const allowed = [];
  const blocking = [];
  for (const [name, value] of Object.entries(all)) {
    if (value.severity !== 'high' && value.severity !== 'critical') continue;
    const leaves = leafAdvisories(name);
    if (leaves.length === 0) {
      blocking.push({ name, reason: 'high/critical entry has no resolvable leaf advisory' });
      continue;
    }
    const rejected = leaves.filter((leaf) => {
      if (!ALLOWED_LEAF_SOURCES.has(leaf.source)) return true;
      const leafPackage = all[leaf.name];
      return Boolean(leafPackage?.isDirect);
    });
    if (rejected.length > 0) {
      blocking.push({ name, direct: value.isDirect, rejected: rejected.map((x) => ({ source: x.source, name: x.name, url: x.url })) });
    } else {
      allowed.push({ name, direct: value.isDirect, leaves: [...new Set(leaves.map((x) => x.source))] });
    }
  }

  const ws = JSON.parse(fs.readFileSync('node_modules/ws/package.json', 'utf8')).version;
  if (ws !== '8.21.3') blocking.push({ name: 'ws', reason: `expected remediated ws@8.21.3, got ${ws}` });
  console.log(JSON.stringify({ counts: report.metadata?.vulnerabilities, reviewBy: REVIEW_BY, allowedHighCritical: allowed, blockingHighCritical: blocking }, null, 2));
  if (blocking.length > 0) process.exitCode = 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl === import.meta.url) main();
