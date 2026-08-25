#!/usr/bin/env node
/**
 * feature-delivery-map.mjs — Feature Delivery Map (Mobile Delivery V1).
 *
 * Classifies a list of changed files into domain buckets (WEB, API, etc.)
 * and computes AFFECTED propagation via the real package dependency graph.
 *
 * Code truth (2026-08-25):
 *   apps/mobile/package.json depends on @ega/api-client, @ega/contracts, @ega/domain
 *   packages/api-client depends on @ega/contracts
 *   packages/contracts depends on @ega/domain
 *   packages/application depends on @ega/contracts, @ega/domain
 *   packages/data-access depends on @ega/application
 *   apps/server depends on @ega/application, @ega/contracts, @ega/data-access, @ega/domain
 *   apps/web depends on @ega/application, @ega/contracts, @ega/data-access, @ega/domain
 *
 * For the delivery question ("did mobile consume the change?"), the critical
 * propagation is:
 *   contracts / domain / api-client  ->  MOBILE AFFECTED
 *
 * The script is intentionally conservative: it does not claim every packages/**
 * change affects everything — only the dependency edges above propagate.
 *
 * Usage (CLI):
 *   node scripts/ci/feature-delivery-map.mjs --files "apps/web/a.ts\npackages/api-client/src/x.ts"
 *   node scripts/ci/feature-delivery-map.mjs --base origin/main --head HEAD
 *   node scripts/ci/feature-delivery-map.mjs --base <sha> --head <sha> --json
 *
 * As a library, import classifyChanged / computeDeliveryMap / DELIVERY_DOMAINS.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const DELIVERY_DOMAINS = [
  'WEB',
  'API',
  'DATABASE',
  'CONTRACTS',
  'DOMAIN',
  'APPLICATION',
  'DATA_ACCESS',
  'API_CLIENT',
  'MOBILE',
];

export const DOMAIN_LABELS = {
  WEB: 'Web',
  API: 'API',
  DATABASE: 'Database',
  CONTRACTS: 'Contracts',
  DOMAIN: 'Domain',
  APPLICATION: 'Application',
  DATA_ACCESS: 'Data Access',
  API_CLIENT: 'API Client',
  MOBILE: 'Mobile',
};

/**
 * Glob-like matchers. Each domain owns its source tree. Shared infra files
 * (package.json, .github/workflows) are treated as potential cross-cutting but
 * only mark DATABASE/WEB etc when they directly touch those domains; for the
 * delivery map we keep ownership strict so the summary stays actionable.
 *
 * Note: unified-platform-validation.yml path filters already decide which CI
 * jobs run; this map is the human-readable companion.
 */
export const DOMAIN_PATTERNS = {
  WEB: [/^apps\/web\//, /^src\//],
  API: [/^apps\/server\//],
  DATABASE: [/^drizzle\//, /^src\/db\//, /^scripts\/db\//],
  CONTRACTS: [/^packages\/contracts\//],
  DOMAIN: [/^packages\/domain\//],
  APPLICATION: [/^packages\/application\//],
  DATA_ACCESS: [/^packages\/data-access\//],
  API_CLIENT: [/^packages\/api-client\//],
  MOBILE: [/^apps\/mobile\//],
};

/**
 * Dependency graph: key depends on values (key consumes value).
 * Only edges that are backed by real imports/package.json dependencies.
 */
export const DEPENDENCY_GRAPH = {
  MOBILE: ['API_CLIENT', 'CONTRACTS', 'DOMAIN'],
  API_CLIENT: ['CONTRACTS', 'DOMAIN'],
  CONTRACTS: ['DOMAIN'],
  APPLICATION: ['CONTRACTS', 'DOMAIN'],
  DATA_ACCESS: ['APPLICATION', 'CONTRACTS', 'DOMAIN'],
  API: ['APPLICATION', 'DATA_ACCESS', 'CONTRACTS', 'DOMAIN'],
  WEB: ['APPLICATION', 'DATA_ACCESS', 'CONTRACTS', 'DOMAIN'],
  DATABASE: [],
  DOMAIN: [],
};

/**
 * Classify which domains have directly changed files.
 * @param {string[]} files
 * @returns {Record<string, boolean>}
 */
export function classifyChanged(files) {
  const changed = {};
  for (const d of DELIVERY_DOMAINS) changed[d] = false;
  for (const raw of files) {
    const f = String(raw).trim();
    if (!f) continue;
    for (const domain of DELIVERY_DOMAINS) {
      const patterns = DOMAIN_PATTERNS[domain] || [];
      if (patterns.some((re) => re.test(f))) {
        changed[domain] = true;
      }
    }
  }
  return changed;
}

/**
 * Compute CHANGED / AFFECTED / NO_CHANGE for every domain.
 * AFFECTED means not directly changed but a transitive dependency changed.
 * @param {string[]} files
 * @returns {Record<string, 'CHANGED'|'AFFECTED'|'NO_CHANGE'>}
 */
export function computeDeliveryMap(files) {
  const changed = classifyChanged(files);
  const result = {};
  for (const d of DELIVERY_DOMAINS) {
    result[d] = changed[d] ? 'CHANGED' : 'NO_CHANGE';
  }

  // Propagate AFFECTED transitively until fixed point.
  let progress = true;
  while (progress) {
    progress = false;
    for (const domain of DELIVERY_DOMAINS) {
      if (result[domain] !== 'NO_CHANGE') continue;
      const deps = DEPENDENCY_GRAPH[domain] || [];
      const affectedByDep = deps.some((dep) => result[dep] === 'CHANGED' || result[dep] === 'AFFECTED');
      if (affectedByDep) {
        result[domain] = 'AFFECTED';
        progress = true;
      }
    }
  }
  return result;
}

/**
 * Convenience: check if mobile was affected (directly or transitively).
 */
export function isMobileAffected(files) {
  const map = computeDeliveryMap(files);
  return map.MOBILE === 'CHANGED' || map.MOBILE === 'AFFECTED';
}

export function formatMarkdown(map, { commit = null } = {}) {
  const lines = [];
  lines.push('### EGA Feature Delivery Map');
  lines.push('');
  if (commit) lines.push(`Commit: \`${commit}\``);
  lines.push('');
  lines.push('| Domain | Status |');
  lines.push('|---|---|');
  for (const d of DELIVERY_DOMAINS) {
    lines.push(`| ${DOMAIN_LABELS[d]} | ${map[d]} |`);
  }
  lines.push('');
  const mobileNote =
    map.MOBILE === 'CHANGED'
      ? 'Mobile: CHANGED (direct change)'
      : map.MOBILE === 'AFFECTED'
        ? 'Mobile: AFFECTED (consumes changed shared package)'
        : 'Mobile: NOT AFFECTED';
  lines.push(mobileNote);
  if (map.API_CLIENT === 'CHANGED' && map.MOBILE === 'AFFECTED') {
    lines.push('Note: `packages/api-client/**` change correctly propagates to Mobile (mobile consumes `@ega/api-client`).');
  }
  return lines.join('\n');
}

export function formatStepSummary(map, commit) {
  const lines = [];
  lines.push('## EGA FEATURE DELIVERY MAP');
  lines.push('');
  if (commit) lines.push(`Commit: ${commit}`);
  lines.push('');
  for (const d of DELIVERY_DOMAINS) {
    lines.push(`${DOMAIN_LABELS[d]}: ${map[d]}`);
  }
  lines.push('');
  lines.push('Verification:');
  lines.push('Web CI: (see unified-platform-validation workflow)');
  lines.push('Server CI: (see unified-platform-validation workflow)');
  lines.push('API Client CI: (see unified-platform-validation workflow)');
  lines.push('Mobile JS CI: (see unified-platform-validation workflow)');
  lines.push('Android binary: NOT BUILT (binaries are generated only by Mobile Delivery)');
  return lines.join('\n');
}

function getChangedFilesBetween(base, head) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function parseArgs(argv) {
  let filesArg = null;
  let base = null;
  let head = null;
  let json = false;
  let markdown = false;
  let summary = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') filesArg = argv[++i];
    else if (a.startsWith('--files=')) filesArg = a.slice('--files='.length);
    else if (a === '--base') base = argv[++i];
    else if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else if (a === '--head') head = argv[++i];
    else if (a.startsWith('--head=')) head = a.slice('--head='.length);
    else if (a === '--json') json = true;
    else if (a === '--markdown') markdown = true;
    else if (a === '--summary') summary = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/ci/feature-delivery-map.mjs [--files <list>] [--base <sha> --head <sha>] [--json|--markdown|--summary]');
      process.exit(0);
    }
  }
  return { filesArg, base, head, json, markdown, summary };
}

async function main(argv) {
  const { filesArg, base, head, json, markdown, summary } = parseArgs(argv);
  let files = [];
  if (filesArg !== null) {
    if (filesArg.includes('\n') || filesArg.includes(',')) {
      files = filesArg.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    } else if (fs.existsSync(filesArg)) {
      // Could be a single source file path or a file containing a list. Heuristic:
      // if the file content has multiple lines and looks like a path list, treat as list file.
      const content = fs.readFileSync(filesArg, 'utf8');
      const lines = content.split('\n').map((s) => s.trim()).filter(Boolean);
      const looksLikeList = lines.length > 1 && lines.every((l) => l.includes('/') || l.includes('.'));
      if (looksLikeList) {
        files = content.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      } else {
        files = [filesArg];
      }
    } else {
      files = [filesArg];
    }
  } else if (base && head) {
    files = getChangedFilesBetween(base, head);
  } else if (base || head) {
    console.error('Both --base and --head must be provided together');
    process.exit(2);
  } else {
    // Default: diff against origin/main if available, else HEAD~1
    try {
      const baseRef = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
      files = getChangedFilesBetween(baseRef, 'HEAD');
    } catch {
      files = getChangedFilesBetween('HEAD~1', 'HEAD');
    }
  }

  const map = computeDeliveryMap(files);
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', head || 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })();

  if (json) {
    console.log(JSON.stringify({ files, map, commit }, null, 2));
  } else if (markdown) {
    console.log(formatMarkdown(map, { commit }));
  } else if (summary) {
    console.log(formatStepSummary(map, commit));
  } else {
    console.log(JSON.stringify(map, null, 2));
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  });
}
