import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUDIT_ATTEMPTS,
  AUDIT_TIMEOUT_MS,
  SECURITY_AUDIT_EXCEPTIONS,
  runAuditCommand,
  evaluateAuditReport,
  isValidReviewByFormat,
  isExpired,
  main,
} from './audit-production.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GATE_CLI = fileURLToPath(new URL('./audit-production.mjs', import.meta.url));

function timeoutResult() {
  return {
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  };
}

/** A report carrying one UNKNOWN high/critical advisory: nothing accepts it. */
function unknownHighReport() {
  return {
    vulnerabilities: {
      'unknown-vuln-pkg': {
        name: 'unknown-vuln-pkg',
        severity: 'high',
        isDirect: false,
        via: [
          {
            source: 9999999,
            name: 'unknown-vuln-pkg',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz',
          },
        ],
      },
    },
    metadata: { vulnerabilities: { total: 1, high: 1 } },
  };
}

function cleanReport() {
  return { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
}

/**
 * Drive `main()` with a stubbed audit report and record the exit code it
 * would leave the process with. `evaluate` and `exitCodeTarget` are the two
 * seams `main()` exposes for exactly this; neither is allowed to change what
 * the gate decides, which the process-level test below re-checks for real.
 */
function runMainWithReport(report) {
  const exitCodeTarget = {};
  const lines = [];
  const errors = [];
  const code = main({
    runAudit: () => ({ stdout: JSON.stringify(report), stderr: '', error: undefined }),
    // `checkWs: false` only drops the installed-ws version probe, which is a
    // separate assertion with its own fixture; the registry decision under
    // test is untouched.
    evaluate: (parsed) => evaluateAuditReport(parsed, { checkWs: false }),
    exitCodeTarget,
    log: (line) => lines.push(line),
    writeError: (line) => errors.push(line),
  });
  return { code, exitCodeTarget, stdout: lines.join('\n'), stderr: errors.join('\n') };
}

/**
 * A `npm` shim on PATH that answers `npm audit --omit=dev --json` with a
 * fixture report, so the gate can be run as a real child process without a
 * registry. On Windows the shim is `npm.cmd`, matching the command `main()`
 * itself selects.
 */
function makeNpmStub() {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-production-npm-stub-'));
  const reportPath = path.join(dir, 'report.json');
  const name = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  writeFileSync(
    path.join(dir, name),
    [
      process.platform === 'win32'
        ? `@node "%~dp0stub.mjs" %*`
        : '#!/bin/sh\nexec node "$(dirname "$0")/stub.mjs" "$@"',
      '',
    ].join('\n'),
  );
  chmodSync(path.join(dir, name), 0o755);
  writeFileSync(
    path.join(dir, 'stub.mjs'),
    [
      'import { readFileSync } from "node:fs";',
      'import { argv } from "node:process";',
      `const report = JSON.parse(readFileSync(${JSON.stringify(reportPath)}, "utf8"));`,
      'const expected = ["audit", "--omit=dev", "--json"];',
      'if (argv.slice(2).join(" ") !== expected.join(" ")) {',
      '  process.stderr.write(`stub npm called with ${argv.slice(2).join(" ")}\\n`);',
      '  process.exit(64);',
      '}',
      'process.stdout.write(JSON.stringify(report));',
      '',
    ].join('\n'),
  );

  return {
    dir,
    reportPath,
    setReport(report) {
      writeFileSync(reportPath, JSON.stringify(report));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Run the shipped gate CLI with the stub `npm` first on PATH. */
function runGateCli(stub, report) {
  stub.setReport(report);
  return spawnSync(process.execPath, [GATE_CLI], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub.dir}${path.delimiter}${process.env.PATH}`,
    },
  });
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

// --- 2026-10-05: the gate's BLOCKING behaviour was documented, not proven.
//
// `main()` ends by setting `process.exitCode = 1` when anything blocks, and the
// architecture map calls that failing exit code the gate's evidence ("The gate
// is a CI check with a failing exit code - that is the evidence"). Nothing in
// the repository executed that branch: `ci:workspace` runs this file plus
// `workspace-proofs.mjs`, neither of which spawns the live audit, and deleting
// the branch entirely left this file at 24/24 green. The tests below drive the
// real function and the real CLI so the branch is load-bearing.

test('the audit gate sets a failing exit code for an unknown high/critical advisory', () => {
  // No exceptions are injected, so `evaluateAuditReport` reads the SHIPPED
  // registry - the same one the workflow step reads. This is the decision the
  // gate exists to make.
  const { code, exitCodeTarget, stdout } = runMainWithReport(unknownHighReport());

  assert.equal(code, 1, 'main() must report the failing exit code it set');
  assert.equal(
    exitCodeTarget.exitCode,
    1,
    'a report carrying one unknown high/critical advisory must leave the process a failing exit code',
  );
  // The JSON it prints is the diagnosis an operator reads, so the blocking
  // finding has to be in it rather than only in the exit code.
  assert.match(stdout, /unknown high\/critical advisory/);
});

test('the audit gate exits zero for a clean report', () => {
  const { code, exitCodeTarget } = runMainWithReport(cleanReport());

  // A clean report must never write a failing exit code. It deliberately
  // leaves the default alone rather than writing 0, so this asserts the
  // absence of any assignment rather than the presence of a specific value.
  assert.notEqual(exitCodeTarget.exitCode, 1, 'a clean report must not fail the gate');
  assert.equal(exitCodeTarget.exitCode, undefined, 'a clean report writes no exit code at all');
  assert.equal(code, 0);
});

test('the audit gate fails closed when the audit command itself fails', () => {
  // The other exit path: no evidence at all is not evidence of no findings.
  const exitCodeTarget = {};
  const errors = [];
  const code = main({
    runAudit() { throw new Error('npm audit returned no JSON'); },
    exitCodeTarget,
    log: () => {},
    writeError: (line) => errors.push(line),
  });

  assert.equal(exitCodeTarget.exitCode, 1);
  assert.equal(code, 1);
  assert.match(errors.join(''), /npm audit returned no JSON/);
});

test('the audit gate CLI exits non-zero on an unknown advisory and zero on a clean report', () => {
  // Process-level, because that is the level CI observes. `main()` is only
  // reachable as a child process with a stubbed `npm` on PATH, which is the
  // only way to prove the shipped entry point (`process.argv[1] === this
  // file`) really maps a blocking report onto a non-zero process status
  // rather than onto a return value nobody reads.
  const stub = makeNpmStub();

  try {
    const blocked = runGateCli(stub, unknownHighReport());
    assert.equal(
      blocked.status,
      1,
      `the CLI must exit non-zero on an unknown high/critical advisory (stdout: ${blocked.stdout}, stderr: ${blocked.stderr})`,
    );
    assert.match(blocked.stdout, /unknown high\/critical advisory/);

    const clean = runGateCli(stub, cleanReport());
    assert.equal(clean.status, 0, `a clean report must exit 0 (stderr: ${clean.stderr})`);
  } finally {
    stub.cleanup();
  }
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
    // A non-empty concrete package, not merely "a string with no `*`": an
    // empty `package` is falsy, so the gate's own match treated it as "no
    // opinion" and accepted the advisory on ANY package, which turned one
    // entry into a blanket exemption this guard used to pass.
    assert.equal(typeof exception.package, 'string', 'exception names a package');
    assert.ok(
      exception.package.trim().length > 0,
      `exception ${exception.source} names an empty package; the gate would accept its advisory on any package`,
    );
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

test('evaluateAuditReport blocks an exception that names no concrete package', () => {
  // The falsy-package hole, proven end to end. `package: ''` passed the old
  // structural guard (`typeof === 'string'`, no `*`) and, because the gate's
  // own match was `exception.package && leaf.name !== exception.package`,
  // skipped the comparison entirely: the advisory below is CRITICAL and lands
  // on a package the exception never named, and it was accepted.
  const report = {
    vulnerabilities: {
      'malicious-pkg': {
        name: 'malicious-pkg',
        severity: 'critical',
        isDirect: false,
        via: [{ source: 1240992, name: 'malicious-pkg', severity: 'critical', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }],
      },
    },
  };
  const exceptions = [
    {
      source: 1240992,
      advisory: 'GHSA-vfj7-8cjw-p6xm',
      package: '',
      reason: 'empty package must not be honoured',
      reviewBy: '2026-11-05',
      allowDirect: true,
    },
  ];

  const evalResult = evaluateAuditReport(report, {
    exceptions,
    now: new Date('2026-10-05'),
    checkWs: false,
  });

  assert.equal(
    evalResult.allowedHighCritical.length,
    0,
    'an exception naming no concrete package must accept nothing, including an advisory on an unrelated package',
  );
  assert.equal(
    evalResult.blockingHighCritical.length,
    2,
    'the malformed package is a blocking finding in its own right AND the advisory it tried to carry is rejected',
  );
  assert.match(
    evalResult.blockingHighCritical[0].reason,
    /malformed exception package/,
    'an empty package is reported as a policy failure, not silently ignored',
  );
  assert.match(evalResult.blockingHighCritical[1].rejected[0].reason, /package mismatch/);
});

test('evaluateAuditReport reports a shipped entry with a blank package as blocking', () => {
  // Sensitivity: the same hole reached through the SHIPPED registry. A blank
  // package on a carried entry must block on its own, without any report
  // naming its advisory.
  const evalResult = evaluateAuditReport(cleanReport(), {
    exceptions: [{ ...SECURITY_AUDIT_EXCEPTIONS[0], package: '   ' }],
    checkWs: false,
  });

  assert.equal(
    evalResult.blockingHighCritical.length,
    1,
    'a carried exception with a blank package must block the gate by itself',
  );
  assert.match(evalResult.blockingHighCritical[0].reason, /malformed exception package/);
});

// --- 2026-10-05: the seven 2026-10-15 entries were REMEDIATED, not renewed.
//
// Their recorded reason claimed no patched release existed. That was wrong: each
// affected range has a published release outside it, and each of those releases
// is inside the range its own parent already declares. Scoped root overrides
// move them; the entries are deleted rather than given a later reviewBy. The
// tests below pin that outcome from both ends, so neither a silent re-acceptance
// nor a silent loss of the override can pass unnoticed.

const REMEDIATED_2026_10_05 = [
  { source: 1240104, package: 'brace-expansion', advisory: 'GHSA-qhr7-859c-m2p7', patched: '1.1.21' },
  { source: 1240105, package: 'brace-expansion', advisory: 'GHSA-qhr7-859c-m2p7', patched: '2.1.7' },
  { source: 1240107, package: 'brace-expansion', advisory: 'GHSA-qhr7-859c-m2p7', patched: '5.0.12' },
  { source: 1240108, package: 'brace-expansion', advisory: 'GHSA-6j4f-fj2g-mc7p', patched: '1.1.21' },
  { source: 1240109, package: 'brace-expansion', advisory: 'GHSA-6j4f-fj2g-mc7p', patched: '2.1.7' },
  { source: 1240111, package: 'brace-expansion', advisory: 'GHSA-6j4f-fj2g-mc7p', patched: '5.0.12' },
  { source: 1240042, package: 'undici', advisory: 'GHSA-rfgv-xxqx-mfg5', patched: '6.29.0' },
];

test('the registry does not carry any of the seven advisories remediated by override', () => {
  for (const remediated of REMEDIATED_2026_10_05) {
    const carried = SECURITY_AUDIT_EXCEPTIONS.find(
      (e) => e.source === remediated.source || (e.package === remediated.package && e.advisory === remediated.advisory),
    );
    assert.equal(
      carried,
      undefined,
      `source ${remediated.source} (${remediated.advisory} on ${remediated.package}) was remediated to ${remediated.patched}; it must not be excepted again`,
    );
  }
});

test('the overrides that remediate brace-expansion and undici are still declared', () => {
  // If the override is deleted, brace-expansion/undici reappear in the audit and
  // block on their own — but pinning the remediation here makes the intended
  // version explicit and fails at review time instead of at the next advisory
  // publication. Same shape as the `next` pin assertion above.
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const overrides = manifest.overrides ?? {};
  assert.equal(overrides['brace-expansion@^1'], '1.1.21', 'brace-expansion 1.x is pinned past GHSA-6j4f-fj2g-mc7p and GHSA-qhr7-859c-m2p7');
  assert.equal(overrides['brace-expansion@^2'], '2.1.7', 'brace-expansion 2.x is pinned past GHSA-6j4f-fj2g-mc7p and GHSA-qhr7-859c-m2p7');
  assert.equal(overrides['brace-expansion@^5'], '5.0.12', 'brace-expansion 5.x is pinned past GHSA-6j4f-fj2g-mc7p and GHSA-qhr7-859c-m2p7');
  assert.equal(overrides['undici@^6'], '6.29.0', 'undici 6.x is pinned past GHSA-rfgv-xxqx-mfg5');
});

/**
 * Resolve `dep` as Node would from `fromNode`, walking the lockfile's
 * `node_modules` chain outward: the package's own nested copy first, then each
 * ancestor's, ending at the hoisted root entry. This is the copy npm actually
 * installs, which is why asserting on it is not the same assertion as reading
 * the override out of package.json.
 */
function resolveFromLock(lock, fromNode, dep) {
  const segments = fromNode.split('/node_modules/');
  for (let end = segments.length; end > 0; end -= 1) {
    const prefix = segments.slice(0, end).join('/node_modules/');
    const candidate = `${prefix}/node_modules/${dep}`;
    if (lock.packages[candidate]) return candidate;
  }
  const hoisted = `node_modules/${dep}`;
  return lock.packages[hoisted] ? hoisted : null;
}

test('every scoped override for a remediated package sits inside the parent range it replaces', () => {
  // The remediation does not depend on npm tolerating an out-of-range override.
  // Each patched release must satisfy the range its own parent declares, read
  // from the committed lockfile rather than restated here, so these were
  // ordinary in-range upgrades the repo had not taken. If a parent later widens
  // or narrows its spec, this fails instead of the override silently becoming
  // out-of-range.
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const parents = [
    { node: 'node_modules/@react-native/codegen/node_modules/minimatch', dep: 'brace-expansion', override: '1.1.21' },
    { node: 'node_modules/react-native/node_modules/minimatch', dep: 'brace-expansion', override: '1.1.21' },
    { node: 'node_modules/rimraf/node_modules/minimatch', dep: 'brace-expansion', override: '1.1.21' },
    { node: 'node_modules/test-exclude/node_modules/minimatch', dep: 'brace-expansion', override: '1.1.21' },
    { node: 'node_modules/expo/node_modules/minimatch', dep: 'brace-expansion', override: '2.1.7' },
    { node: 'node_modules/minimatch', dep: 'brace-expansion', override: '5.0.12' },
    { node: 'node_modules/expo/node_modules/@expo/cli', dep: 'undici', override: '6.29.0' },
  ];

  for (const { node, dep, override } of parents) {
    const parentMeta = lock.packages[node];
    assert.ok(parentMeta, `lockfile still has ${node}`);
    const declared = parentMeta.dependencies?.[dep];
    assert.equal(typeof declared, 'string', `${node} declares ${dep}`);
    // Caret comparison inline rather than adding a semver dependency for seven
    // assertions: same major, and at least the declared floor.
    const caret = declared.startsWith('^');
    assert.ok(caret, `${node} declares ${declared} for ${dep}, which this check does not model`);
    const [declaredMajor, declaredMinor, declaredPatch] = declared.slice(1).split('.').map(Number);
    const [overrideMajor, overrideMinor, overridePatch] = override.split('.').map(Number);
    const sameMajor = overrideMajor === declaredMajor;
    const notBelowFloor =
      overrideMinor > declaredMinor ||
      (overrideMinor === declaredMinor && overridePatch >= declaredPatch);
    assert.ok(
      sameMajor && notBelowFloor,
      `${override} must satisfy the range ${node} declares for ${dep} (${declared}); an out-of-range override would be a compatibility risk`,
    );
  }
});

test('the lockfile RESOLVES the remediated versions, not only declares them', () => {
  // The declared override and the installed tree are two different facts, and
  // until now only the declared one was pinned: rewriting
  // package-lock.json's root `node_modules/brace-expansion` from the fixed
  // 5.0.12 back to the vulnerable 5.0.9 left both this file and
  // `workspace-proofs.mjs` green, because neither read the resolved version of
  // a remediated package.
  //
  // What the registry claims is that `npm audit --omit=dev` reports none of the
  // seven advisories. That claim is about the tree npm resolves, so it is
  // asserted here against the lockfile npm installs from, walked the way Node
  // resolves each parent's copy.
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const resolved = [
    { node: 'node_modules/@react-native/codegen/node_modules/minimatch', dep: 'brace-expansion', expect: '1.1.21' },
    { node: 'node_modules/react-native/node_modules/minimatch', dep: 'brace-expansion', expect: '1.1.21' },
    { node: 'node_modules/rimraf/node_modules/minimatch', dep: 'brace-expansion', expect: '1.1.21' },
    { node: 'node_modules/test-exclude/node_modules/minimatch', dep: 'brace-expansion', expect: '1.1.21' },
    { node: 'node_modules/expo/node_modules/minimatch', dep: 'brace-expansion', expect: '2.1.7' },
    { node: 'node_modules/minimatch', dep: 'brace-expansion', expect: '5.0.12' },
    { node: 'node_modules/expo/node_modules/@expo/cli', dep: 'undici', expect: '6.29.0' },
  ];

  for (const { node, dep, expect } of resolved) {
    const path = resolveFromLock(lock, node, dep);
    assert.ok(path, `the lockfile still resolves ${dep} for ${node}`);
    assert.equal(
      lock.packages[path].version,
      expect,
      `${node} resolves ${dep} from ${path}, which is the version ${dep} must be ` +
        `remediated to; a resolved vulnerable version means the advisory is present again`,
    );
  }

  // The two hoisted entries the other tests reason about directly, so a
  // downgrade of the root copy cannot hide behind a nested one.
  assert.equal(lock.packages['node_modules/brace-expansion'].version, '5.0.12');
  assert.equal(lock.packages['node_modules/undici'].version, '6.29.0');
});

test('no remediated package resolves anywhere in the lockfile to a vulnerable version', () => {
  // The seven advisories are remediated per parent, but a lockfile edit that
  // adds a NEW copy of brace-expansion or undici is not covered by the
  // per-parent walk above, because no parent in that list declares it. Sweep
  // every entry instead: each resolved copy must be one of the patched
  // versions, so any new copy arrives remediated or fails here.
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const patched = new Map([
    ['brace-expansion', new Set(['1.1.21', '2.1.7', '5.0.12'])],
    ['undici', new Set(['6.29.0'])],
  ]);

  const found = new Map([...patched.keys()].map((name) => [name, 0]));
  for (const [path, meta] of Object.entries(lock.packages)) {
    const name = path.replace(/^.*node_modules\//, '');
    if (!patched.has(name)) continue;
    found.set(name, found.get(name) + 1);
    assert.ok(
      patched.get(name).has(meta.version),
      `${path} resolves ${name}@${meta.version}, which no override remediates; one of the seven ` +
        'remediated advisories covers that version',
    );
  }

  // The sweep must not pass vacuously on an empty lockfile or a renamed path.
  for (const [name, count] of found) {
    assert.ok(count > 0, `no ${name} entry was found in the lockfile; the sweep above checked nothing`);
  }
});

test('a report carrying any remediated advisory blocks on the shipped registry', () => {
  // The stronger half: even if one of these advisories ever comes back (a
  // reverted override, a new affected range, an upstream bump), the shipped
  // registry must reject it rather than inherit a stale acceptance.
  for (const remediated of REMEDIATED_2026_10_05) {
    const report = {
      vulnerabilities: {
        [remediated.package]: {
          name: remediated.package,
          severity: 'high',
          isDirect: false,
          via: [
            {
              source: remediated.source,
              name: remediated.package,
              severity: 'high',
              url: `https://github.com/advisories/${remediated.advisory}`,
            },
          ],
        },
      },
    };
    const result = evaluateAuditReport(report, { now: new Date('2026-10-05'), checkWs: false });
    assert.equal(
      result.blockingHighCritical.length,
      1,
      `source ${remediated.source} must block on the shipped registry`,
    );
    assert.match(result.blockingHighCritical[0].rejected[0].reason, /unknown high\/critical/);
  }
});

test('no carried exception is already expired, and each has a usable reviewBy', () => {
  // A temporary acceptance that is already past its review date is not an
  // acceptance at all: `evaluateAuditReport` would report it as a blocking
  // finding, so leaving one in the registry ships a knowingly-red gate. Checked
  // against the real clock, not a fixture, so the failure lands on the day the
  // entry actually lapses.
  for (const exception of SECURITY_AUDIT_EXCEPTIONS) {
    assert.ok(isValidReviewByFormat(exception.reviewBy), `${exception.package} has a parsable reviewBy`);
    assert.equal(
      isExpired(exception, new Date()),
      false,
      `exception for source ${exception.source} (${exception.package}) expired on ${exception.reviewBy}; remediate it or re-review it rather than carrying it forward`,
    );
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
