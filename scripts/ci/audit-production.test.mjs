import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

import {
  AUDIT_ATTEMPTS,
  AUDIT_TIMEOUT_MS,
  SECURITY_AUDIT_EXCEPTIONS,
  runAuditCommand,
  evaluateAuditReport,
  isValidReviewByFormat,
  isExpired,
} from './audit-production.mjs';

function timeoutResult() {
  return {
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  };
}

test('dependency audit retries a timeout with a bounded child-process timeout', () => {
  const calls = [];
  const result = runAuditCommand({
    npm: 'npm-test',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length === 1) return timeoutResult();
      return { stdout: '{"vulnerabilities":{},"metadata":{"vulnerabilities":{}}}', stderr: '', error: undefined };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'npm-test');
  assert.deepEqual(calls[0].args, ['audit', '--omit=dev', '--json']);
  assert.equal(calls[0].options.timeout, AUDIT_TIMEOUT_MS);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
  assert.match(result.stdout, /vulnerabilities/);
});

test('dependency audit fails closed after bounded timeout retries', () => {
  let calls = 0;
  assert.throws(
    () => runAuditCommand({ spawn() { calls += 1; return timeoutResult(); } }),
    /npm audit timed out/,
  );
  assert.equal(calls, AUDIT_ATTEMPTS);
});

test('dependency audit retries an empty response instead of treating missing evidence as success', () => {
  let calls = 0;
  const result = runAuditCommand({
    spawn() {
      calls += 1;
      if (calls === 1) return { stdout: '', stderr: 'registry unavailable', error: undefined };
      return { stdout: '{"vulnerabilities":{},"metadata":{"vulnerabilities":{}}}', stderr: '', error: undefined };
    },
  });

  assert.equal(calls, 2);
  assert.match(result.stdout, /vulnerabilities/);
});

test('isValidReviewByFormat validates YYYY-MM-DD format strictly', () => {
  assert.equal(isValidReviewByFormat('2026-10-15'), true);
  assert.equal(isValidReviewByFormat('2026-02-28'), true);
  assert.equal(isValidReviewByFormat('2026-13-01'), false);
  assert.equal(isValidReviewByFormat('2026-10-32'), false);
  assert.equal(isValidReviewByFormat('2026/10/15'), false);
  assert.equal(isValidReviewByFormat('invalid'), false);
  assert.equal(isValidReviewByFormat(null), false);
});

test('isExpired detects past review dates correctly', () => {
  const exception = { reviewBy: '2026-10-01' };
  assert.equal(isExpired(exception, new Date('2026-09-30T12:00:00Z')), false);
  assert.equal(isExpired(exception, new Date('2026-10-02T12:00:00Z')), true);
});

test('evaluateAuditReport allows valid structured exception before reviewBy', () => {
  const report = {
    vulnerabilities: {
      'brace-expansion': {
        name: 'brace-expansion',
        severity: 'high',
        isDirect: false,
        via: [{ source: 1240104, name: 'brace-expansion', severity: 'high', url: 'https://github.com/advisories/GHSA-qhr7-859c-m2p7' }],
      },
    },
  };
  const exceptions = [
    {
      source: 1240104,
      advisory: 'GHSA-qhr7-859c-m2p7',
      package: 'brace-expansion',
      reason: 'test exception',
      reviewBy: '2026-10-15',
      upstream: 'expo',
    },
  ];

  const evalResult = evaluateAuditReport(report, {
    exceptions,
    now: new Date('2026-09-30'),
    checkWs: false,
  });

  assert.equal(evalResult.blockingHighCritical.length, 0);
  assert.equal(evalResult.allowedHighCritical.length, 1);
});

test('evaluateAuditReport blocks expired exceptions', () => {
  const report = {
    vulnerabilities: {
      'brace-expansion': {
        name: 'brace-expansion',
        severity: 'high',
        isDirect: false,
        via: [{ source: 1240104, name: 'brace-expansion', severity: 'high', url: 'https://github.com/advisories/GHSA-qhr7-859c-m2p7' }],
      },
    },
  };
  const exceptions = [
    {
      source: 1240104,
      advisory: 'GHSA-qhr7-859c-m2p7',
      package: 'brace-expansion',
      reason: 'test exception',
      reviewBy: '2026-09-15', // Expired
      upstream: 'expo',
    },
  ];

  const evalResult = evaluateAuditReport(report, {
    exceptions,
    now: new Date('2026-09-30'),
    checkWs: false,
  });

  assert.equal(evalResult.blockingHighCritical.length, 1);
  assert.match(evalResult.blockingHighCritical[0].rejected[0].reason, /expired/);
});

test('evaluateAuditReport blocks unknown high/critical advisories', () => {
  const report = {
    vulnerabilities: {
      'unknown-vuln-pkg': {
        name: 'unknown-vuln-pkg',
        severity: 'high',
        isDirect: false,
        via: [{ source: 9999999, name: 'unknown-vuln-pkg', severity: 'high', url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx' }],
      },
    },
  };

  const evalResult = evaluateAuditReport(report, {
    exceptions: [],
    now: new Date('2026-09-30'),
    checkWs: false,
  });

  assert.equal(evalResult.blockingHighCritical.length, 1);
  assert.match(evalResult.blockingHighCritical[0].rejected[0].reason, /unknown high\/critical/);
});

test('evaluateAuditReport blocks package mismatch in exception', () => {
  const report = {
    vulnerabilities: {
      'malicious-pkg': {
        name: 'malicious-pkg',
        severity: 'critical',
        isDirect: false,
        via: [{ source: 1240104, name: 'malicious-pkg', severity: 'critical', url: 'https://github.com/advisories/GHSA-qhr7-859c-m2p7' }],
      },
    },
  };
  const exceptions = [
    {
      source: 1240104,
      advisory: 'GHSA-qhr7-859c-m2p7',
      package: 'brace-expansion', // Doesn't match malicious-pkg
      reason: 'test exception',
      reviewBy: '2026-10-15',
      upstream: 'expo',
    },
  ];

  const evalResult = evaluateAuditReport(report, {
    exceptions,
    now: new Date('2026-09-30'),
    checkWs: false,
  });

  assert.equal(evalResult.blockingHighCritical.length, 1);
  assert.match(evalResult.blockingHighCritical[0].rejected[0].reason, /package mismatch/);
});

test('evaluateAuditReport blocks direct high/critical dependencies unless allowDirect is true', () => {
  const report = {
    vulnerabilities: {
      'direct-vuln': {
        name: 'direct-vuln',
        severity: 'high',
        isDirect: true,
        via: [{ source: 5555, name: 'direct-vuln', severity: 'high', url: 'https://github.com/advisories/GHSA-direct' }],
      },
    },
  };
  const exceptions = [
    {
      source: 5555,
      advisory: 'GHSA-direct',
      package: 'direct-vuln',
      reason: 'test direct exception',
      reviewBy: '2026-10-15',
      allowDirect: false,
    },
  ];

  const evalResult = evaluateAuditReport(report, {
    exceptions,
    now: new Date('2026-09-30'),
    checkWs: false,
  });

  assert.equal(evalResult.blockingHighCritical.length, 1);
  assert.match(evalResult.blockingHighCritical[0].rejected[0].reason, /direct high\/critical/);
});

// --- 2026-10-05: the advisories published after this registry was last written.
// `next` is the one that had a compatible fix and was upgraded rather than
// accepted. braces and node-forge have no patched release at all, so they are
// carried as narrow expiring entries. The tests below pin the properties that
// make those entries safe to keep rather than merely convenient.

test('evaluateAuditReport blocks the pre-upgrade next advisory even when it is direct', () => {
  // Guards the actual fix: GHSA-vcvr-r3jv-pc5j must never be accepted by an
  // exception. `next` 16.3.8 is pinned in apps/web/package.json instead, so if
  // someone tries to silence this advisory with an exception the gate refuses.
  const report = {
    vulnerabilities: {
      next: {
        name: 'next',
        severity: 'critical',
        isDirect: true,
        via: [
          {
            source: 1240609,
            name: 'next',
            severity: 'critical',
            url: 'https://github.com/advisories/GHSA-vcvr-r3jv-pc5j',
          },
        ],
      },
    },
  };

  const blocked = evaluateAuditReport(report, { exceptions: [], now: new Date('2026-10-05'), checkWs: false });
  assert.equal(blocked.blockingHighCritical.length, 1);

  // An exception keyed on a DIFFERENT advisory must not accidentally cover it.
  const wrongKey = evaluateAuditReport(report, {
    exceptions: [
      {
        source: 1240992,
        advisory: 'GHSA-vfj7-8cjw-p6xm',
        package: 'braces',
        reason: 'mismatched advisory',
        reviewBy: '2026-11-05',
        allowDirect: true,
      },
    ],
    now: new Date('2026-10-05'),
    checkWs: false,
  });
  assert.equal(wrongKey.blockingHighCritical.length, 1, 'a braces exception must not accept a next advisory');
});

test('the shipped exception registry accepts only the two advisories it names', () => {
  // Structural guard against the registry growing into a catch-all. Every entry
  // must name exactly one concrete advisory and one concrete package; anything
  // that looks like a wildcard or an aggregate is a policy failure.
  for (const exception of SECURITY_AUDIT_EXCEPTIONS) {
    assert.equal(typeof exception.advisory, 'string', 'exception names an advisory id');
    assert.match(exception.advisory, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/, 'advisory id is concrete, not a wildcard');
    assert.equal(typeof exception.package, 'string', 'exception names a package');
    assert.doesNotMatch(exception.package, /[*]/, 'package is not a wildcard');
    assert.equal(typeof exception.source, 'number', 'exception pins one advisory source id');
    assert.equal(typeof exception.reason, 'string', 'exception carries a reason');
    assert.ok(exception.reason.length > 20, 'reason is substantive');
    assert.ok(isValidReviewByFormat(exception.reviewBy), `exception ${exception.package} has a reviewBy date`);
  }
  // The two advisories carried after the 2026-10-05 publication carry the extra
  // governance fields a temporary acceptance must have.
  for (const source of [1240992, 1240912]) {
    const entry = SECURITY_AUDIT_EXCEPTIONS.find((e) => e.source === source);
    assert.ok(entry, `exception for source ${source} exists`);
    assert.ok(entry.affectedSurface, 'exception states the affected surface');
    assert.ok(entry.whyNotFixableNow, 'exception states why it cannot be fixed now');
    assert.ok(entry.owner, 'exception names an owner');
  }
});

test('the registry does not accept the next critical RCE advisory', () => {
  // The single most important property of this remediation: the one fixable
  // critical was UPGRADED, not excepted.
  const nextSources = SECURITY_AUDIT_EXCEPTIONS.filter(
    (e) => e.package === 'next' || e.advisory === 'GHSA-vcvr-r3jv-pc5j',
  );
  assert.equal(nextSources.length, 0, 'next/GHSA-vcvr-r3jv-pc5j must never be excepted');

  const manifest = JSON.parse(readFileSync(new URL('../../apps/web/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies.next, '16.3.8', 'web pins the patched next release');
});

test('evaluateAuditReport blocks an expired 2026-10-05 registry entry', () => {
  // Sensitivity: the temporary acceptances must actually expire. Simulate the
  // reviewBy date passing and prove the gate re-blocks rather than accepting
  // indefinitely.
  const bracesException = SECURITY_AUDIT_EXCEPTIONS.find((e) => e.source === 1240992);
  const report = {
    vulnerabilities: {
      micromatch: {
        name: 'micromatch',
        severity: 'high',
        isDirect: false,
        via: [
          {
            source: 1240992,
            name: 'braces',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
          },
        ],
      },
    },
  };

  const before = evaluateAuditReport(report, {
    exceptions: [bracesException],
    now: new Date('2026-10-05'),
    checkWs: false,
  });
  assert.equal(before.blockingHighCritical.length, 0, 'accepted while within reviewBy');

  const after = evaluateAuditReport(report, {
    exceptions: [bracesException],
    now: new Date('2026-11-06'),
    checkWs: false,
  });
  assert.equal(after.blockingHighCritical.length, 1, 're-blocks once reviewBy passes');
  assert.match(after.blockingHighCritical[0].rejected[0].reason, /expired/);
});

test('evaluateAuditReport blocks a direct advisory when allowDirect is absent', () => {
  // Sensitivity: allowDirect:true is what admits braces/node-forge through the
  // direct `expo` / `react-native` parents. Remove it and the same report must
  // block, proving the flag is load-bearing rather than decorative.
  const bracesException = { ...SECURITY_AUDIT_EXCEPTIONS.find((e) => e.source === 1240992) };
  delete bracesException.allowDirect;
  const report = {
    vulnerabilities: {
      expo: {
        name: 'expo',
        severity: 'high',
        isDirect: true,
        via: [
          {
            source: 1240992,
            name: 'braces',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
          },
        ],
      },
    },
  };

  const result = evaluateAuditReport(report, {
    exceptions: [bracesException],
    now: new Date('2026-10-05'),
    checkWs: false,
  });
  assert.equal(result.blockingHighCritical.length, 1);
  assert.match(result.blockingHighCritical[0].rejected[0].reason, /direct high\/critical/);
});

test('evaluateAuditReport succeeds with zero vulnerabilities', () => {
  const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  const evalResult = evaluateAuditReport(report, { checkWs: false });
  assert.equal(evalResult.blockingHighCritical.length, 0);
  assert.equal(evalResult.allowedHighCritical.length, 0);
});

test('the documented audit-exception count matches the registry', () => {
  // The count in ARCHITECTURE.md is a point-in-time fact about a registry that
  // changes: entries are added, re-reviewed or retired, and the two 2026-10-15
  // entries that predate the hardening program will block CI when they expire.
  // Prose about that number rots silently, so it is checked against the registry
  // the gate actually reads.
  const architecture = readFileSync(
    new URL('../../ARCHITECTURE.md', import.meta.url),
    'utf8',
  );

  const stated = architecture.match(/(\w+) carried audit exceptions/);
  assert.ok(stated, 'ARCHITECTURE.md states how many audit exceptions are carried');

  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const statedCount = words[String(stated[1]).toLowerCase()] ?? Number(stated[1]);
  assert.equal(
    statedCount,
    SECURITY_AUDIT_EXCEPTIONS.length,
    `ARCHITECTURE.md states ${stated[1]} carried audit exceptions but the registry holds ${SECURITY_AUDIT_EXCEPTIONS.length}`,
  );

  // Each expiry cohort must also be stated, because the two cohorts are governed
  // differently and expire on different dates.
  const byReviewBy = new Map();
  for (const entry of SECURITY_AUDIT_EXCEPTIONS) {
    byReviewBy.set(entry.reviewBy, (byReviewBy.get(entry.reviewBy) ?? 0) + 1);
  }
  for (const [reviewBy, count] of byReviewBy) {
    assert.ok(
      architecture.includes(reviewBy),
      `ARCHITECTURE.md does not mention the reviewBy date ${reviewBy} carried by ${count} exception(s)`,
    );
  }
});

test('ARCHITECTURE.md does not attribute the live audit gate to ci:workspace', () => {
  // ci:workspace runs `node --test audit-production.test.mjs && node
  // workspace-proofs.mjs`. Neither executes the live audit; the workflow runs
  // `node scripts/ci/audit-production.mjs` as its own step. Attributing the
  // blocking behaviour to ci:workspace sent an operator to the wrong command.
  const architecture = readFileSync(
    new URL('../../ARCHITECTURE.md', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(
    architecture,
    /ci:workspace[^\n]{0,120}runs[^\n]{0,80}audit-production\.mjs/i,
    'ci:workspace does not run scripts/ci/audit-production.mjs; the workflow runs it as a separate step',
  );
});

test('the documented scripts/db verifier inventory matches the directory', () => {
  // ARCHITECTURE.md names each verifier and what it proves. A new verifier that is
  // not named there would leave the document claiming a complete set that is not
  // complete.
  const architecture = readFileSync(
    new URL('../../ARCHITECTURE.md', import.meta.url),
    'utf8',
  );

  const dir = new URL('../../scripts/db/', import.meta.url);
  const verifiers = readdirSync(dir).filter((name) => name.endsWith('.mjs'));

  assert.ok(verifiers.length > 0, 'no verifiers found in scripts/db');
  for (const name of verifiers) {
    assert.ok(
      architecture.includes(name),
      `scripts/db/${name} exists but ARCHITECTURE.md does not mention it; the documented verifier set is incomplete`,
    );
  }
});
