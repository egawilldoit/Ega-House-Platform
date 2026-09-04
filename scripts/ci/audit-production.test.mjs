import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIT_ATTEMPTS, AUDIT_TIMEOUT_MS, runAuditCommand } from './audit-production.mjs';

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
