#!/usr/bin/env node
/**
 * security-proofs.mjs — actor-identity and repository-trust proofs.
 *
 * Extracted verbatim from the inline node proofs in the temporary PR4 workflow
 * (pr4-project-goal-application-validation.yml) so the platform's two
 * security proofs are permanent and run on EVERY unified validation, not only
 * while PR4's branch exists. Runnable locally:
 * `node scripts/ci/security-proofs.mjs`.
 *
 * Covers:
 *  1. Actor identity cannot be chosen by request data — every
 *     `createAuthenticatedActor(` construction requires
 *     `requireAuthenticatedUser` and passes `user.id`, never formData/body/
 *     request payloads.
 *  2. Repository trust — repositories scope by `owner_user_id` +
 *     `actor.userId`, consume a request-scoped `SupabaseClient`, never use a
 *     service-role client, and construction sites require
 *     `requireAuthenticatedUser`.
 *
 * Path note (PR7): the actor-identity scan targets the web app's route
 * actions under `src/app/**`. When PR7 moves the web app to `apps/web/src/**`,
 * the path list in section 1 must be updated in the same PR (see the unified
 * workflow's header comment for the path-awareness contract).
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

// ---------------------------------------------------------------------------
// 1. Actor identity cannot be chosen by request data
// ---------------------------------------------------------------------------
console.log('\n[1] actor identity proof');
const actorFiles = execFileSync(
  'git',
  ['ls-files', 'src/app/tasks/projects/**/*.ts', 'src/app/tasks/projects/**/*.tsx', 'src/app/goals/**/*.ts', 'src/app/goals/**/*.tsx'],
  { encoding: 'utf8' }
)
  .split(/\r?\n/)
  .filter(Boolean);

let actorFilesChecked = 0;
for (const file of actorFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = source.match(/createAuthenticatedActor\(/g) ?? [];
  if (occurrences.length === 0) continue;
  actorFilesChecked += 1;

  assert(source.includes('requireAuthenticatedUser'), `${file}: constructs AuthenticatedActor inside a requireAuthenticatedUser guard`);
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('createAuthenticatedActor(') && !line.includes('user.id')) {
      assert(false, `${file}:${index + 1}: actor identity must come from the verified session user, never request data`);
    }
  });
}
assert(true, `scanned ${actorFiles.length} actor route files (${actorFilesChecked} construct actors)`);

const allTracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
let requestDataLeaks = 0;
for (const file of allTracked) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    if (/createAuthenticatedActor\(\s*formData/.test(line) || /createAuthenticatedActor\(\s*body/.test(line) || /createAuthenticatedActor\(\s*request/.test(line)) {
      requestDataLeaks += 1;
      assert(false, `${file}: actor identity derived from request/body data`);
    }
  }
}
assert(requestDataLeaks === 0, `no actor identity derived from request data across ${allTracked.length} tracked files`);

// ---------------------------------------------------------------------------
// 2. Repository trust
// ---------------------------------------------------------------------------
console.log('\n[2] repository trust proof');
const repositoryFiles = [
  'packages/data-access/src/projects/repository.ts',
  'packages/data-access/src/goals/repository.ts',
];
for (const file of repositoryFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert(source.includes('owner_user_id'), `${file}: must scope reads/writes by owner_user_id`);
  assert(source.includes('actor.userId'), `${file}: must scope by the trusted actor userId`);
  assert(
    source.includes('constructor(private readonly supabase: SupabaseClient)'),
    `${file}: must consume a request-scoped Supabase client`
  );
  assert(
    !source.includes('getSupabaseServiceClient') && !source.includes('SERVICE_ROLE'),
    `${file}: must not use a service-role client`
  );
}

let constructionSitesChecked = 0;
for (const file of allTracked) {
  if (!/\.(ts|tsx)$/.test(file) || !file.startsWith('src/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('new SupabaseProjectsRepository(') && !source.includes('new SupabaseGoalsRepository(')) continue;
  constructionSitesChecked += 1;
  assert(source.includes('requireAuthenticatedUser'), `${file}: repository construction site requires requireAuthenticatedUser`);
  assert(
    !source.includes('getSupabaseServiceClient') && !source.includes('SERVICE_ROLE'),
    `${file}: no service-role authorization path`
  );
}
assert(true, `checked ${constructionSitesChecked} repository construction site(s)`);

console.log('\n' + (failures === 0 ? 'security-proofs: ALL CHECKS PASSED' : `security-proofs: ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
