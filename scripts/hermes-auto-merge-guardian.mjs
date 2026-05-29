#!/usr/bin/env node

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPO = 'egawilldoit/Ega-House-Platform';
const OWNER = 'egawilldoit';
const REPO_NAME = 'Ega-House-Platform';
const ENV_FILE = path.join(homedir(), '.hermes', '.env');
const LOG_FILE = path.join(homedir(), '.hermes', 'logs', 'auto-merge-guardian.log');
const AUTO_MERGE_LABEL = 'hermes-auto-merge';
const READY_MARKER_PREFIX = '<!-- slack-pr-ready-notified:';
const BLOCKED_MARKER_PREFIX = '<!-- hermes-auto-merge-blocked:';
const PR_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'baseRefName',
  'headRefName',
  'headRefOid',
  'mergeable',
  'reviewDecision',
  'statusCheckRollup',
  'files',
  'labels',
  'body',
].join(',');

const failConclusions = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'STARTUP_FAILURE',
  'STALE',
  'TIMED_OUT',
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);
const allowedCheckConclusions = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'success', 'neutral', 'skipped']);
const selfCheckPatterns = [
  /Slack PR Safe Merge Notification/i,
  /Notify Slack when PR readiness changes/i,
  /slack-pr-ready\.yml/i,
  /Slack PR Safe Merge Notification \/ Notify Slack when PR readiness changes/i,
];
const requiredOptionalChecks = [
  { key: 'vercel', label: 'Vercel', pattern: /vercel/i, allowed: new Set(['SUCCESS', 'success']) },
  { key: 'macroscope', label: 'Macroscope', pattern: /macroscope/i, allowed: new Set(['SUCCESS', 'NEUTRAL', 'success', 'neutral']) },
  { key: 'codeql', label: 'CodeQL', pattern: /codeql/i, allowed: new Set(['SUCCESS', 'success']) },
];

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--execute');
const once = args.has('--once') || true;

function timestamp() {
  return new Date().toISOString();
}

async function log(line) {
  const message = `[${timestamp()}] ${line}`;
  console.log(message);
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, `${message}\n`);
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = trimmed.match(/^export\s+([^=]+)=(.*)$/) || trimmed.match(/^([^=]+)=(.*)$/);
  if (!match) return null;
  const key = match[1].trim();
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

async function loadHermesEnv() {
  const raw = await readFile(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!process.env[key]) process.env[key] = value;
  }

  if (!process.env.GITHUB_TOKEN && process.env.GH_TOKEN) {
    process.env.GITHUB_TOKEN = process.env.GH_TOKEN;
  }
  if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) {
    process.env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  const missing = ['GITHUB_TOKEN', 'LINEAR_API_KEY', 'SLACK_WEBHOOK_URL'].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment values: ${missing.join(', ')}`);
  }
}

async function gh(argsForGh, options = {}) {
  const { stdout, stderr } = await execFileAsync('gh', argsForGh, {
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (stderr?.trim()) {
    await log(`gh stderr: ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function ghJson(argsForGh) {
  const output = await gh(argsForGh);
  return output ? JSON.parse(output) : null;
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : 'unknown';
}

function labels(pr) {
  return (pr.labels || []).map((label) => label.name || label).filter(Boolean);
}

function filePaths(pr) {
  return (pr.files || []).map((file) => file.path || file).filter(Boolean);
}

function extractLinearId(pr) {
  const source = `${pr.title || ''}\n${pr.body || ''}\n${pr.headRefName || ''}`;
  const match = source.match(/EGA-[0-9]+/i);
  return match ? match[0].toUpperCase() : null;
}

function isAllowedDocsFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  if (['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'].includes(normalized)) return true;
  if (normalized.startsWith('docs/')) return true;
  return normalized.toLowerCase().endsWith('.md');
}

function riskyFileReason(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);

  if (base === '.env' || base.startsWith('.env.')) return 'env file';
  if (lower.endsWith('.pem')) return 'pem file';
  if (lower.endsWith('.key')) return 'key file';
  if (lower.startsWith('.github/workflows/')) return 'GitHub workflow';
  if (lower === 'vercel.json') return 'deployment config';
  if (/^next\.config\./i.test(base)) return 'Next config';
  if (lower === 'package.json') return 'package manifest';
  if (lower === 'package-lock.json') return 'npm lockfile';
  if (lower === 'pnpm-lock.yaml') return 'pnpm lockfile';
  if (lower === 'yarn.lock') return 'yarn lockfile';
  if (lower === 'prisma/schema.prisma') return 'Prisma schema';
  if (lower.startsWith('supabase/')) return 'Supabase file';
  if (lower.startsWith('migrations/')) return 'migration file';
  if (lower.includes('/migration/')) return 'migration path';
  if (/(secret|auth|payment|deploy|credential|token|key)/i.test(normalized)) return 'sensitive keyword';
  return null;
}

function checkFileGates(files) {
  const blockers = [];
  for (const changedFile of files) {
    const risk = riskyFileReason(changedFile);
    if (risk) blockers.push(`${changedFile}: risky path (${risk})`);
    if (!isAllowedDocsFile(changedFile)) {
      blockers.push(`${changedFile}: outside Phase 1 docs-only allowlist`);
    }
  }
  return blockers;
}

function statusName(item) {
  return item.name || item.context || item.workflowName || item.__typename || 'unnamed status';
}

function statusState(item) {
  return item.conclusion || item.state || item.status || 'UNKNOWN';
}

function isSelfCheck(item) {
  return selfCheckPatterns.some((pattern) => pattern.test(statusName(item)));
}

function isStatusPending(item) {
  const state = statusState(item);
  return ['PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING', 'pending', 'queued', 'in_progress', 'requested', 'waiting'].includes(state);
}

function isStatusFailing(item) {
  return failConclusions.has(statusState(item));
}

function isStatusPassing(item) {
  return allowedCheckConclusions.has(statusState(item));
}

function checkOptionalState(checks, optionalCheck) {
  const matching = checks.filter((item) => optionalCheck.pattern.test(statusName(item)));
  if (matching.length === 0) return 'missing';
  if (matching.some(isStatusFailing)) return 'fail';
  if (matching.some(isStatusPending)) return 'pending';
  if (matching.some((item) => optionalCheck.allowed.has(statusState(item)))) return 'pass';
  return 'fail';
}

function summarizeChecks(pr) {
  const allChecks = pr.statusCheckRollup || [];
  const ignored = allChecks.filter(isSelfCheck);
  const checks = allChecks.filter((item) => !isSelfCheck(item));
  const pending = checks.filter(isStatusPending);
  const failing = checks.filter(isStatusFailing);
  const passing = checks.filter(isStatusPassing);
  const optional = Object.fromEntries(
    requiredOptionalChecks.map((check) => [check.key, checkOptionalState(checks, check)])
  );
  return {
    checks,
    ignored,
    pending,
    failing,
    passing,
    optional,
    text: `${passing.length} passing, ${pending.length} pending, ${failing.length} failing, ignored notifier checks: ${ignored.length}, Vercel: ${optional.vercel}, Macroscope: ${optional.macroscope}, CodeQL: ${optional.codeql}`,
  };
}

async function listCandidateNumbers() {
  const prs = await ghJson([
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--label',
    AUTO_MERGE_LABEL,
    '--json',
    'number',
  ]);
  return (prs || []).map((pr) => pr.number);
}

async function getPr(number) {
  return ghJson(['pr', 'view', String(number), '--repo', REPO, '--json', PR_JSON_FIELDS]);
}

async function getComments(number) {
  return ghJson([
    'api',
    `repos/${OWNER}/${REPO_NAME}/issues/${number}/comments?per_page=100`,
  ]);
}

async function hasReadyMarker(number, headSha) {
  const comments = await getComments(number);
  const marker = `${READY_MARKER_PREFIX}${headSha} -->`;
  return (comments || []).some((comment) => comment.body?.includes(marker));
}

async function hasRecentBlockedMarker(number, headSha, blockerKey) {
  const comments = await getComments(number);
  const marker = `${BLOCKED_MARKER_PREFIX}${headSha}:${blockerKey} -->`;
  return (comments || []).some((comment) => comment.body?.includes(marker));
}

function blockerKey(blockers) {
  return Buffer.from(blockers.join('|')).toString('base64url').slice(0, 32);
}

function evaluatePr(pr, readyMarkerPresent) {
  const blockers = [];
  const linearId = extractLinearId(pr);
  const checks = summarizeChecks(pr);
  const changedFiles = filePaths(pr);
  const prLabels = labels(pr);

  if (pr.number === 25) blockers.push('PR #25 is explicitly excluded from auto-merge');
  if (!prLabels.includes(AUTO_MERGE_LABEL)) blockers.push(`missing label ${AUTO_MERGE_LABEL}`);
  if (pr.state !== 'OPEN') blockers.push(`PR state is ${pr.state}`);
  if (pr.isDraft) blockers.push('PR is draft');
  if (pr.baseRefName !== 'main') blockers.push(`base branch is ${pr.baseRefName}`);
  if (!pr.headRefName?.startsWith('hermes/')) blockers.push(`head branch is ${pr.headRefName}`);
  if (!linearId) blockers.push('missing Linear issue ID');
  if (pr.mergeable !== 'MERGEABLE') blockers.push(`mergeable is ${pr.mergeable}`);
  if (pr.reviewDecision === 'CHANGES_REQUESTED') blockers.push('review decision is CHANGES_REQUESTED');
  if (changedFiles.length === 0) blockers.push('no changed files reported');
  blockers.push(...checkFileGates(changedFiles));
  if (checks.checks.length === 0) blockers.push('no real checks/statuses found');
  if (checks.pending.length > 0) {
    blockers.push(`pending checks/statuses: ${checks.pending.map(statusName).join(', ')}`);
  }
  if (checks.failing.length > 0) {
    blockers.push(`failing checks/statuses: ${checks.failing.map((item) => `${statusName(item)} (${statusState(item)})`).join(', ')}`);
  }
  for (const optionalCheck of requiredOptionalChecks) {
    const state = checks.optional[optionalCheck.key];
    if (state === 'fail' || state === 'pending') {
      blockers.push(`${optionalCheck.label} is present but not passing: ${state}`);
    }
  }
  if (!readyMarkerPresent) {
    blockers.push(`missing Slack READY marker for head SHA ${pr.headRefOid}`);
  }

  return { blockers, checks, linearId, changedFiles };
}

function slackText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendSlack(text, fields = []) {
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${slackText(text)}*` } },
        ...(fields.length > 0
          ? [{
              type: 'section',
              fields: fields.map((field) => ({
                type: 'mrkdwn',
                text: `*${slackText(field.label)}:*\n${slackText(field.value)}`,
              })),
            }]
          : []),
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack returned HTTP ${response.status}`);
  }
}

async function maybeSendBlockedSlack(pr, evaluation) {
  if (!evaluation.linearId) return;
  const serious = evaluation.blockers.filter((blocker) =>
    /risky path|outside Phase 1|CHANGES_REQUESTED|failing|PR #25|workflow|config/i.test(blocker)
  );
  if (serious.length === 0) return;
  const key = blockerKey(serious);
  if (await hasRecentBlockedMarker(pr.number, pr.headRefOid, key)) return;

  await sendSlack(`❌ AUTO-MERGE BLOCKED — ${evaluation.linearId}`, [
    { label: 'PR', value: pr.url },
    { label: 'Branch', value: pr.headRefName },
    { label: 'Blocker', value: serious[0] },
  ]);
  await gh([
    'api',
    `repos/${OWNER}/${REPO_NAME}/issues/${pr.number}/comments`,
    '-f',
    `body=${BLOCKED_MARKER_PREFIX}${pr.headRefOid}:${key} -->\nHermes auto-merge blocked: ${serious[0]}`,
  ]);
}

async function linearRequest(query, variables) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Linear API failed: ${message}`);
  }
  return payload.data;
}

async function updateLinearAfterMerge(linearId, prUrl) {
  const data = await linearRequest(
    `query Issue($id: String!) {
      issue(id: $id) {
        id
        team {
          states {
            nodes { id name type }
          }
        }
      }
    }`,
    { id: linearId }
  );
  const issue = data.issue;
  if (!issue) throw new Error(`Linear issue not found: ${linearId}`);

  await linearRequest(
    `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    {
      input: {
        issueId: issue.id,
        body: `Auto-merged PR: ${prUrl}\nQA/checks were green.\nStatus: merged.`,
      },
    }
  );

  const doneState = issue.team.states.nodes.find((state) => state.type === 'completed') ||
    issue.team.states.nodes.find((state) => /^done$/i.test(state.name));
  if (!doneState) throw new Error(`No Linear Done/completed state found for ${linearId}`);

  await linearRequest(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issue.id, input: { stateId: doneState.id } }
  );
}

async function mergePr(pr, evaluation) {
  const latest = await getPr(pr.number);
  if (latest.headRefOid !== pr.headRefOid) {
    throw new Error(`head SHA changed before merge: ${pr.headRefOid} -> ${latest.headRefOid}`);
  }
  const output = await gh([
    'pr',
    'merge',
    String(pr.number),
    '--repo',
    REPO,
    '--squash',
    '--delete-branch',
    '--match-head-commit',
    pr.headRefOid,
  ]);

  await sendSlack(`✅ AUTO-MERGED — ${evaluation.linearId}`, [
    { label: 'PR', value: pr.url },
    { label: 'Branch', value: pr.headRefName },
    { label: 'Head SHA', value: shortSha(pr.headRefOid) },
    { label: 'Checks', value: evaluation.checks.text },
    { label: 'Merge output', value: output || 'Merge command completed.' },
  ]);
  await updateLinearAfterMerge(evaluation.linearId, pr.url);
  return output;
}

async function main() {
  await loadHermesEnv();
  await log(`Hermes auto-merge guardian start mode=${dryRun ? 'dry-run' : 'execute'} once=${once}`);

  const candidateNumbers = await listCandidateNumbers();
  await log(`Candidate PRs with ${AUTO_MERGE_LABEL}: ${candidateNumbers.length ? candidateNumbers.join(', ') : 'none'}`);

  const results = [];
  for (const number of candidateNumbers) {
    const pr = await getPr(number);
    const readyMarkerPresent = await hasReadyMarker(pr.number, pr.headRefOid);
    const evaluation = evaluatePr(pr, readyMarkerPresent);
    results.push({ pr, evaluation });

    if (evaluation.blockers.length > 0) {
      await log(`PR #${pr.number} blocked: ${evaluation.blockers.join('; ')}`);
      if (!dryRun) await maybeSendBlockedSlack(pr, evaluation);
      continue;
    }

    await log(`PR #${pr.number} passed all gates for ${evaluation.linearId}: ${pr.url}`);
    if (dryRun) {
      await log(`DRY RUN: would squash merge PR #${pr.number} at ${pr.headRefOid}`);
      continue;
    }

    const mergeOutput = await mergePr(pr, evaluation);
    await log(`PR #${pr.number} merged. ${mergeOutput || 'gh merge completed.'}`);
  }

  const blockedCount = results.filter((result) => result.evaluation.blockers.length > 0).length;
  const readyCount = results.length - blockedCount;
  await log(`Summary: candidates=${results.length}, ready=${readyCount}, blocked=${blockedCount}, mode=${dryRun ? 'dry-run' : 'execute'}`);
}

main().catch(async (error) => {
  await log(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
