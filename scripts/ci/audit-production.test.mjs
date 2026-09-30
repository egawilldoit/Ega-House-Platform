import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_ATTEMPTS,
  AUDIT_TIMEOUT_MS,
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

test('evaluateAuditReport succeeds with zero vulnerabilities', () => {
  const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  const evalResult = evaluateAuditReport(report, { checkWs: false });
  assert.equal(evalResult.blockingHighCritical.length, 0);
  assert.equal(evalResult.allowedHighCritical.length, 0);
});
