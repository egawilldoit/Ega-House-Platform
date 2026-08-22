#!/usr/bin/env node
/**
 * workspace-proofs.mjs — unified workspace / lockfile integrity proofs.
 *
 * Extracted from the inline node proofs in the temporary per-stage workflows
 * (pr2-workspace-validation.yml, pr3-contracts-domain-validation.yml,
 * pr4-project-goal-application-validation.yml) so there is a single source of
 * truth, runnable locally (`node scripts/ci/workspace-proofs.mjs`) and in the
 * unified validation workflow.
 *
 * Covers:
 *  1. Root lockfile authority (single root lock, no nested workspace locks,
 *     tracked standalone runner lock).
 *  2. Root workspaces declaration and shared workspace dependencies.
 *  3. Framework pins (Expo / React Native / React / Next / Expo Router /
 *     babel-preset-expo) in manifests.
 *  4. Per-workspace identity + dependency expectations (WORKSPACES table —
 *     PR5/PR6/PR7 extend this table rather than the proofs).
 *  5. Manifest ↔ lock edges for every workspace and the root.
 *  6. Installed-resolution proofs (post `npm ci`): workspace entry points
 *     resolve to the workspace source, single React Native version under
 *     mobile, React/ReactDOM 19.1.0 at the root, babel-preset-expo 54.0.12,
 *     Expo Router hoisted once at 6.0.24.
 *
 * The manifest/lock section (1–5) runs before `npm ci`; the resolution
 * section (6) requires `npm ci` to have run.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// ESM modules have no `require`; create one rooted at this script so
// workspace package specifiers resolve through the workspace root node_modules.
const require = createRequire(import.meta.url);

const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const cwd = process.cwd();

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok   - ${message}`);
  }
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(cwd, relative), 'utf8'));
}

/**
 * Workspace expectations. `dependencies` is asserted by exact-object
 * equality (these packages are owned by the migration and drift must be
 * deliberate); `entry` is the package export entry asserted by the
 * installed-resolution proof (null = no resolution proof).
 */
const WORKSPACES = [
  {
    dir: 'packages/domain',
    name: '@ega/domain',
    version: '0.1.0',
    dependencies: {},
    entry: './src/index.ts',
  },
  {
    dir: 'packages/contracts',
    name: '@ega/contracts',
    version: '0.1.0',
    dependencies: { '@ega/domain': '0.1.0' },
    entry: './src/index.ts',
  },
  {
    dir: 'packages/application',
    name: '@ega/application',
    version: '0.1.0',
    dependencies: { '@ega/domain': '0.1.0' },
    entry: './src/index.ts',
  },
  {
    dir: 'packages/data-access',
    name: '@ega/data-access',
    version: '0.1.0',
    dependencies: { '@ega/application': '0.1.0', '@supabase/supabase-js': '^2.103.0' },
    entry: './src/index.ts',
  },
  {
    dir: 'packages/api-client',
    name: '@ega/api-client',
    version: '0.1.0',
    dependencies: { '@ega/contracts': '0.1.0' },
    entry: './src/index.ts',
  },
  {
    dir: 'apps/server',
    name: '@ega/server',
    version: '0.1.0',
    dependencies: {
      '@ega/application': '0.1.0',
      '@ega/contracts': '0.1.0',
      '@ega/data-access': '0.1.0',
      '@ega/domain': '0.1.0',
      '@hono/node-server': '^2.0.11',
      '@supabase/supabase-js': '^2.103.0',
      hono: '^4',
    },
    entry: './src/index.ts',
  },
];

// ---------------------------------------------------------------------------
// 1. Root lockfile authority
// ---------------------------------------------------------------------------
console.log('\n[1] root lockfile authority');
assert(fs.existsSync('package-lock.json'), 'root package-lock.json exists');
const nestedLocks = execFileSync('git', ['ls-files', 'apps/*/package-lock.json', 'packages/*/package-lock.json'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
assert(nestedLocks.length === 0, `no nested workspace lockfiles tracked (${nestedLocks.length} found)`);
assert(fs.existsSync('scripts/ega-runner/package-lock.json'), 'standalone runner lockfile remains tracked');
assert(fs.existsSync('apps/mobile/babel.config.js'), 'mobile babel.config.js exists');

// ---------------------------------------------------------------------------
// 2. Root workspaces + shared dependencies
// ---------------------------------------------------------------------------
console.log('\n[2] root workspace declaration');
assert(
  JSON.stringify(root.workspaces) === JSON.stringify(['apps/*', 'packages/*']),
  'root workspaces is exactly ["apps/*", "packages/*"]'
);
const sharedWorkspaceDeps = [
  '@ega/contracts',
  '@ega/domain',
  '@ega/application',
  '@ega/data-access',
  '@ega/api-client',
  '@ega/server',
];
for (const dep of sharedWorkspaceDeps) {
  assert(root.dependencies?.[dep] === '0.1.0', `root shares ${dep}@0.1.0`);
}

// ---------------------------------------------------------------------------
// 3. Framework pins
// ---------------------------------------------------------------------------
console.log('\n[3] framework pins');
const mobile = readJson('apps/mobile/package.json');
assert(mobile.name === '@ega/mobile', 'mobile workspace name is @ega/mobile');
assert(mobile.dependencies?.expo === '~54.0.34', 'Expo pin ~54.0.34');
assert(mobile.dependencies?.react === '19.1.0', 'mobile React pin 19.1.0');
assert(mobile.dependencies?.['react-native'] === '0.81.5', 'React Native pin 0.81.5');
assert(mobile.dependencies?.['expo-router'] === '~6.0.23', 'mobile Expo Router pin ~6.0.23');
assert(mobile.dependencies?.['@react-navigation/bottom-tabs'] === '^7.4.0', 'mobile bottom-tabs direct dependency');
assert(mobile.devDependencies?.['babel-preset-expo'] === '~54.0.12', 'mobile Expo Babel preset ownership');
// The web app owns next/react/react-dom on the post-PR7 topology; pre-PR7
// branches declare them at the root. Accept whichever manifest owns the web
// app so the proof stays valid across the stack.
const webOwnerManifest = root.dependencies?.next ? root : readJson('apps/web/package.json');
assert(webOwnerManifest.dependencies?.next === '16.2.12', 'Next pin 16.2.12');
assert(
  webOwnerManifest.dependencies?.react === '19.1.0' &&
    webOwnerManifest.dependencies?.['react-dom'] === '19.1.0',
  'web React/ReactDOM 19.1.0',
);
assert(root.devDependencies?.['expo-router'] === '~6.0.23', 'root Expo Router tooling range ~6.0.23');

// ---------------------------------------------------------------------------
// 4. Per-workspace identity + dependency expectations
// ---------------------------------------------------------------------------
console.log('\n[4] workspace identities and dependency expectations');
for (const spec of WORKSPACES) {
  const manifest = readJson(`${spec.dir}/package.json`);
  assert(manifest.name === spec.name && manifest.version === spec.version, `${spec.dir} identity ${spec.name}@${spec.version}`);
  assert(
    JSON.stringify(manifest.dependencies || {}) === JSON.stringify(spec.dependencies),
    `${spec.dir} dependencies exactly ${JSON.stringify(spec.dependencies)}`
  );
}

// ---------------------------------------------------------------------------
// 5. Manifest ↔ lock edges
// ---------------------------------------------------------------------------
console.log('\n[5] manifest ↔ lock edges');
for (const spec of WORKSPACES) {
  const lockEntry = lock.packages?.[spec.dir];
  assert(lockEntry?.name === spec.name, `lock owns ${spec.dir} (${spec.name})`);
  assert(lockEntry?.version === spec.version, `lock records ${spec.dir} version ${spec.version}`);
  for (const dep of Object.keys(spec.dependencies)) {
    assert(lockEntry?.dependencies?.[dep] === spec.dependencies[dep], `lock records ${spec.dir} -> ${dep} edge`);
  }
}
const lockMobile = lock.packages?.['apps/mobile'];
assert(lockMobile?.dependencies?.['@ega/contracts'] === '0.1.0', 'lock records mobile -> @ega/contracts');
assert(lockMobile?.dependencies?.['@ega/domain'] === '0.1.0', 'lock records mobile -> @ega/domain');
assert(lockMobile?.dependencies?.['@react-navigation/bottom-tabs'] === '^7.4.0', 'lock records mobile bottom-tabs');
assert(lockMobile?.devDependencies?.['babel-preset-expo'] === '~54.0.12', 'lock records mobile babel-preset-expo');
const lockWebOwner = lock.packages?.['']?.dependencies?.react
  ? lock.packages?.['']
  : lock.packages?.['apps/web'];
assert(lockWebOwner?.dependencies?.react === '19.1.0', 'lock records web React 19.1.0');
assert(lockWebOwner?.dependencies?.['react-dom'] === '19.1.0', 'lock records web ReactDOM 19.1.0');
assert(lock.packages?.['']?.devDependencies?.['expo-router'] === '~6.0.23', 'lock records root Expo Router tooling');
assert(lock.packages?.['node_modules/expo-router']?.version === '6.0.24', 'Expo Router hoisted at root 6.0.24');
assert(!lock.packages?.['apps/mobile/node_modules/expo-router'], 'no nested Expo Router under mobile');

// ---------------------------------------------------------------------------
// 6. Installed-resolution proofs (requires `npm ci`)
// ---------------------------------------------------------------------------
console.log('\n[6] installed resolution');
for (const spec of WORKSPACES) {
  if (!spec.entry) continue;
  try {
    const resolved = require.resolve(spec.name);
    assert(
      resolved.endsWith(path.join(spec.dir, spec.entry)),
      `${spec.name} resolves to workspace source (${resolved.replace(cwd + '/', '')})`
    );
  } catch (error) {
    assert(false, `${spec.name} resolution failed: ${error.message}`);
  }
}

// mobile resolves a single React Native version
const mobileTree = JSON.parse(
  execFileSync('npm', ['ls', 'react-native', '--workspace', '@ega/mobile', '--json'], { encoding: 'utf8' })
);
const rnVersions = new Set();
function walk(node) {
  if (!node || typeof node !== 'object') return;
  const rn = node.dependencies?.['react-native'];
  if (rn?.version) rnVersions.add(rn.version);
  for (const dep of Object.values(node.dependencies || {})) walk(dep);
}
walk(mobileTree);
assert(rnVersions.size === 1 && rnVersions.has('0.81.5'), `mobile resolves single RN 0.81.5 (got ${[...rnVersions].join(', ') || 'none'})`);

const reactVersion = JSON.parse(fs.readFileSync('node_modules/react/package.json', 'utf8')).version;
const reactDomVersion = JSON.parse(fs.readFileSync('node_modules/react-dom/package.json', 'utf8')).version;
assert(reactVersion === '19.1.0' && reactDomVersion === '19.1.0', `root resolves React ${reactVersion} / ReactDOM ${reactDomVersion}`);

const mobileRoot = path.resolve('apps/mobile');
const presetPath = require.resolve('babel-preset-expo/package.json', { paths: [mobileRoot] });
const presetVersion = JSON.parse(fs.readFileSync(presetPath, 'utf8')).version;
assert(presetVersion === '54.0.12', `mobile resolves babel-preset-expo ${presetVersion} (expected 54.0.12)`);

const rootRouterPath = require.resolve('expo-router/package.json');
const mobileRouterPath = require.resolve('expo-router/package.json', { paths: [mobileRoot] });
const presetRouterPath = createRequire(presetPath).resolve('expo-router/package.json');
const rootRouterVersion = JSON.parse(fs.readFileSync(rootRouterPath, 'utf8')).version;
const mobileRouterVersion = JSON.parse(fs.readFileSync(mobileRouterPath, 'utf8')).version;
const presetRouterVersion = JSON.parse(fs.readFileSync(presetRouterPath, 'utf8')).version;
assert(
  rootRouterVersion === '6.0.24' && mobileRouterVersion === '6.0.24' && presetRouterVersion === '6.0.24',
  `Expo Router resolves 6.0.24 everywhere (root=${rootRouterVersion}, mobile=${mobileRouterVersion}, preset=${presetRouterVersion})`
);
assert(
  rootRouterPath === mobileRouterPath && rootRouterPath === presetRouterPath,
  'Expo Router is hoisted once across resolution roots'
);

console.log('\n' + (failures === 0 ? 'workspace-proofs: ALL CHECKS PASSED' : `workspace-proofs: ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
