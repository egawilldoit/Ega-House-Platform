import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

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
if (new Date().toISOString().slice(0, 10) > REVIEW_BY) {
  throw new Error(`dependency-audit: exception review deadline ${REVIEW_BY} has passed`);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (!result.stdout?.trim()) {
  process.stderr.write(result.stderr || 'dependency-audit: npm audit returned no JSON\n');
  process.exit(1);
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
if (blocking.length > 0) process.exit(1);
