#!/usr/bin/env node
/**
 * security-proofs.mjs — executable actor-identity and repository-trust proofs.
 *
 * Covers the current monorepo topology:
 *  1. apps/web actor construction must be guarded by verified Supabase user lookup.
 *  2. apps/server bearer identity must be verified before actor/client construction.
 *  3. Projects/Goals/Tasks repositories must be request-scoped, owner-scoped,
 *     and must never use service-role authorization for normal user traffic.
 *  4. No tracked TypeScript source may construct AuthenticatedActor directly
 *     from request/body/FormData data.
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

const allTracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

// ---------------------------------------------------------------------------
// 1. Web actor identity cannot be chosen by request data
// ---------------------------------------------------------------------------
console.log('\n[1] web actor identity proof');
const actorFiles = execFileSync(
  'git',
  [
    'ls-files',
    'apps/web/src/app/tasks/projects/**/*.ts',
    'apps/web/src/app/tasks/projects/**/*.tsx',
    'apps/web/src/app/goals/**/*.ts',
    'apps/web/src/app/goals/**/*.tsx',
    'apps/web/src/app/tasks/**/*.ts',
    'apps/web/src/app/tasks/**/*.tsx',
  ],
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean);

let actorFilesChecked = 0;
for (const file of actorFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = source.match(/createAuthenticatedActor\(/g) ?? [];
  if (occurrences.length === 0) continue;
  actorFilesChecked += 1;
  assert(source.includes('requireAuthenticatedUser'), `${file}: actor construction is guarded by requireAuthenticatedUser`);
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.includes('createAuthenticatedActor(') && !line.includes('user.id')) {
      assert(false, `${file}:${index + 1}: web actor identity must come from verified session user.id`);
    }
  }
}
assert(actorFilesChecked > 0, `scanned current apps/web actor construction sites (${actorFilesChecked} file(s))`);

const webAuthService = fs.readFileSync('apps/web/src/lib/services/auth-service.ts', 'utf8');
assert(webAuthService.includes('AuthenticatedIdentity'), 'apps/web auth service exposes shared verified identity');
assert(webAuthService.includes('supabase.auth.getUser()'), 'apps/web shared identity originates from verified Supabase getUser');

let requestDataLeaks = 0;
for (const file of allTracked) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    if (
      /createAuthenticatedActor\(\s*formData/.test(line) ||
      /createAuthenticatedActor\(\s*body/.test(line) ||
      /createAuthenticatedActor\(\s*request/.test(line) ||
      /createAuthenticatedActor\(\s*c\.req/.test(line) ||
      /createAuthenticatedActorFromIdentity\(\s*(formData|body|request|c\.req)/.test(line)
    ) {
      requestDataLeaks += 1;
      assert(false, `${file}: actor identity derived from request/body data`);
    }
  }
}
assert(requestDataLeaks === 0, `no actor identity derived from request data across ${allTracked.length} tracked files`);

// ---------------------------------------------------------------------------
// 2. Standalone server bearer verification chain
// ---------------------------------------------------------------------------
console.log('\n[2] standalone server bearer proof');
const serverApp = fs.readFileSync('apps/server/src/app.ts', 'utf8');
assert(serverApp.includes('extractBearerToken'), 'apps/server: extracts bearer token');
assert(serverApp.includes('dependencies.verifyToken(token)'), 'apps/server: verifies bearer token server-side');
assert(serverApp.includes('createAuthenticatedActorFromIdentity({ id: userId })'), 'apps/server: actor derives from verified identity');
assert(serverApp.includes('dependencies.createRequestClient(token)'), 'apps/server: request-scoped client carries the same bearer token');
assert(!/createAuthenticatedActor(FromIdentity)?\([^)]*(body|query|param|header)/.test(serverApp), 'apps/server: actor is not selected by payload/query/path/header values');

// ---------------------------------------------------------------------------
// 3. Repository trust
// ---------------------------------------------------------------------------
console.log('\n[3] repository trust proof');
const repositoryFiles = [
  'packages/data-access/src/projects/repository.ts',
  'packages/data-access/src/goals/repository.ts',
  'packages/data-access/src/tasks/repository.ts',
];
for (const file of repositoryFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert(source.includes('owner_user_id'), `${file}: scopes reads/writes by owner_user_id`);
  assert(source.includes('actor.userId'), `${file}: scopes by trusted actor userId`);
  assert(source.includes('constructor(private readonly supabase: SupabaseClient)'), `${file}: consumes a request-scoped Supabase client`);
  assert(!source.includes('getSupabaseServiceClient') && !source.includes('SERVICE_ROLE'), `${file}: has no service-role authorization path`);
}

let webConstructionSitesChecked = 0;
for (const file of allTracked) {
  if (!/\.(ts|tsx)$/.test(file) || !file.startsWith('apps/web/src/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (
    !source.includes('new SupabaseProjectsRepository(') &&
    !source.includes('new SupabaseGoalsRepository(') &&
    !source.includes('new SupabaseTasksRepository(')
  ) continue;
  webConstructionSitesChecked += 1;
  assert(source.includes('requireAuthenticatedUser'), `${file}: web repository construction site verifies session user`);
  assert(!source.includes('getSupabaseServiceClient') && !source.includes('SERVICE_ROLE'), `${file}: no web service-role authorization path`);
}
assert(webConstructionSitesChecked > 0, `checked current apps/web repository construction sites (${webConstructionSitesChecked})`);

const serverRouteFiles = allTracked.filter((file) => file.startsWith('apps/server/src/routes/') && file.endsWith('.ts'));
let serverRepositorySitesChecked = 0;
for (const file of serverRouteFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (!/new Supabase(Projects|Goals|Tasks)Repository\(client\)/.test(source)) continue;
  serverRepositorySitesChecked += 1;
  assert(source.includes('c.var'), `${file}: server repository consumes middleware-provided actor/client`);
  assert(!source.includes('SERVICE_ROLE'), `${file}: server user route has no service-role path`);
}
assert(serverRepositorySitesChecked > 0, `checked apps/server request-scoped repository construction sites (${serverRepositorySitesChecked})`);

console.log('\n' + (failures === 0 ? 'security-proofs: ALL CHECKS PASSED' : `security-proofs: ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
