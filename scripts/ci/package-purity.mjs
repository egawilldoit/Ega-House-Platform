#!/usr/bin/env node
/**
 * package-purity.mjs — shared-package purity and duplicate-authority proofs.
 *
 * Extracted from the inline node proofs in the temporary per-stage workflows
 * (pr3-contracts-domain-validation.yml, pr4-project-goal-application-validation.yml)
 * so there is a single source of truth, runnable locally
 * (`node scripts/ci/package-purity.mjs`) and in the unified validation workflow.
 *
 * Covers:
 *  1. Contracts + domain purity scan (no supabase / react / react-native /
 *     expo / next / drizzle / node: imports; no Supabase user-mapping leak
 *     into contracts).
 *  2. Application purity scan (no next / react / react-native / expo /
 *     supabase / drizzle / src/db / @/lib/supabase).
 *  3. Data-access scan (no next / @/lib/supabase / src/db).
 *  4. Compat-file duplicate-authority proof (legacy DTO files must re-export
 *     the shared contracts/domain, never redefine them).
 *
 * Api-client neutrality is enforced by the architecture checker rule
 * `api-client-platform-neutral` (see scripts/architecture/check-boundaries.mjs),
 * not duplicated here.
 *
 * Path note (PR7): the compat files below live at `src/lib/**` on the
 * pre-PR7 topology. When PR7 moves the web app to `apps/web/src/lib/**`, the
 * path lists in section 4 must be updated in the same PR (the architecture
 * checker already resolves both topologies).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok   - ${message}`);
  }
}

function trackedFiles(patterns) {
  return execFileSync('git', ['ls-files', ...patterns], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

function scan(files, forbidden, label) {
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        assert(false, `${label}: ${file} matched ${pattern}`);
        continue;
      }
    }
    checked += 1;
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 1. Contracts + domain purity
// ---------------------------------------------------------------------------
console.log('\n[1] contracts + domain purity');
const sharedFiles = trackedFiles(['packages/contracts/src/**/*.ts', 'packages/domain/src/**/*.ts']);
const sharedForbidden = [
  /@supabase\//,
  /from\s+["']react(?:["'/])/,
  /from\s+["']react-native(?:["'/])/,
  /from\s+["']expo(?:["'/])/,
  /from\s+["']next(?:["'/])/,
  /drizzle/,
  /src\/db/,
  /from\s+["']node:/,
  /require\(["']node:/,
];
const sharedChecked = scan(sharedFiles, sharedForbidden, 'shared');
assert(sharedChecked === sharedFiles.length, `scanned ${sharedChecked}/${sharedFiles.length} contracts+domain files`);

const contractsFiles = sharedFiles.filter((file) => file.startsWith('packages/contracts/'));
let contractsLeakChecked = 0;
for (const file of contractsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/mapUserToMobileAuthenticatedUser|Supabase.*User|\btype\s+User\b/.test(source)) {
    assert(false, `${file}: Supabase user mapping leaked into contracts`);
    continue;
  }
  contractsLeakChecked += 1;
}
assert(contractsLeakChecked === contractsFiles.length, `scanned ${contractsLeakChecked}/${contractsFiles.length} contracts files for user-mapping leak`);

// ---------------------------------------------------------------------------
// 2. Application purity
// ---------------------------------------------------------------------------
console.log('\n[2] application purity');
const applicationFiles = trackedFiles(['packages/application/src/**/*.ts']);
const applicationForbidden = [
  /from\s+["']next(?:["'/])/,
  /from\s+["']react(?:["'/])/,
  /from\s+["']react-native(?:["'/])/,
  /from\s+["']expo(?:["'/])/,
  /@supabase\//,
  /drizzle/,
  /src\/db/,
  /@\/lib\/supabase/,
];
const applicationChecked = scan(applicationFiles, applicationForbidden, 'application');
assert(applicationChecked === applicationFiles.length, `scanned ${applicationChecked}/${applicationFiles.length} application files`);

// ---------------------------------------------------------------------------
// 3. Data-access scan (no Next)
// ---------------------------------------------------------------------------
console.log('\n[3] data-access purity');
const dataAccessFiles = trackedFiles(['packages/data-access/src/**/*.ts']);
const dataAccessForbidden = [/from\s+["']next(?:["'/])/, /@\/lib\/supabase/, /src\/db/];
const dataAccessChecked = scan(dataAccessFiles, dataAccessForbidden, 'data-access');
assert(dataAccessChecked === dataAccessFiles.length, `scanned ${dataAccessChecked}/${dataAccessFiles.length} data-access files`);

// ---------------------------------------------------------------------------
// 4. Compat-file duplicate-authority proof
// ---------------------------------------------------------------------------
console.log('\n[4] compat files re-export, not redefine');
const requiredImports = new Map([
  ['src/lib/contracts/mobile.ts', '@ega/contracts/mobile'],
  ['src/lib/contracts/agent.ts', '@ega/contracts/agent'],
  ['apps/mobile/types/auth.ts', '@ega/contracts/mobile'],
  ['apps/mobile/types/tasks.ts', '@ega/contracts/mobile'],
  ['apps/mobile/types/today.ts', '@ega/contracts/mobile'],
  ['src/lib/task-domain.ts', '@ega/domain'],
  ['src/lib/task-recurrence.ts', '@ega/domain'],
]);
for (const [file, expected] of requiredImports) {
  if (!fs.existsSync(file)) {
    assert(false, `${file}: compat file missing`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  assert(source.includes(expected), `${file}: contains compatibility link to ${expected}`);
}

const legacyDtoFiles = [
  'src/lib/contracts/mobile.ts',
  'src/lib/contracts/agent.ts',
  'apps/mobile/types/auth.ts',
  'apps/mobile/types/tasks.ts',
  'apps/mobile/types/today.ts',
];
const duplicate = /^export\s+type\s+(MobileTaskListItem|MobileTodayResponse|AgentTaskResponse|AgentTokenScopes)\s*=\s*\{/m;
for (const file of legacyDtoFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!duplicate.test(source), `${file}: no legacy DTO definition competing with shared contracts`);
}

console.log('\n' + (failures === 0 ? 'package-purity: ALL CHECKS PASSED' : `package-purity: ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
