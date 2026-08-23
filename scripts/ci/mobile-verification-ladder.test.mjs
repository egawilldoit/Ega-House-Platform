import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LEVELS,
  checkDeployedHono,
  classifyAdbDevices,
  classifyRuntimeChain,
  discoverApkArtifacts,
  discoverIntegrationSuites,
  findAdb,
  formatSummary,
  highestProven,
  parseLevelSpec,
  resolveAndroidAppConfig,
  runAppRuntimeChain,
  toJsonSummary,
} from './mobile-verification-ladder.mjs';

test('parseLevelSpec accepts single levels, ranges, and mixed lists', () => {
  assert.deepEqual(parseLevelSpec('3'), [3]);
  assert.deepEqual(parseLevelSpec('1-5'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseLevelSpec('1,3,5'), [1, 3, 5]);
  assert.deepEqual(parseLevelSpec('2-4,7'), [2, 3, 4, 7]);
  assert.deepEqual(parseLevelSpec('1-8'), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('parseLevelSpec rejects out-of-range and malformed specs', () => {
  for (const bad of ['0', '9', '0-8', '1-9', '5-1', 'abc', '1..3', '-1', '']) {
    assert.throws(() => parseLevelSpec(bad), undefined, `expected "${bad}" to throw`);
  }
});

test('level table defines exactly the eight contract levels in order', () => {
  assert.deepEqual(
    LEVELS.map((level) => level.id),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test('classifyAdbDevices separates emulators from physical devices', () => {
  const output = [
    'List of devices attached',
    'emulator-5554\tdevice',
    'emulator-5556\toffline',
    'AEDK123456\tdevice',
    '192.168.1.10:5555\tunauthorized',
    '',
    '',
  ].join('\n');

  const devices = classifyAdbDevices(output);
  assert.equal(devices.length, 4);
  assert.deepEqual(
    devices.filter((device) => device.kind === 'emulator').map((device) => device.serial),
    ['emulator-5554', 'emulator-5556'],
  );
  assert.deepEqual(
    devices.filter((device) => device.kind === 'physical').map((device) => device.serial),
    ['AEDK123456', '192.168.1.10:5555'],
  );
  const states = Object.fromEntries(devices.map((device) => [device.serial, device.state]));
  assert.equal(states['emulator-5556'], 'offline');
  assert.equal(states['192.168.1.10:5555'], 'unauthorized');
});

test('classifyAdbDevices returns empty list when no devices are attached', () => {
  const output = ['List of devices attached', '', ''].join('\n');
  assert.deepEqual(classifyAdbDevices(output), []);
});

test('highestProven reports the top PASS level and null when nothing passed', () => {
  const results = [
    { id: 1, status: 'PASS' },
    { id: 2, status: 'PASS' },
    { id: 3, status: 'FAIL' },
    { id: 4, status: 'NOT PROVEN' },
  ];
  assert.equal(highestProven(results), 2);
  assert.equal(highestProven([{ id: 1, status: 'FAIL' }, { id: 2, status: 'SKIPPED' }]), null);
  assert.equal(highestProven([]), null);
});

test('discoverIntegrationSuites finds only integration suites outside skip dirs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-suites-'));
  try {
    fs.mkdirSync(path.join(tmp, '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'features'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.expo'));
    fs.writeFileSync(path.join(tmp, '__tests__', 'integration.test.ts'), '');
    fs.writeFileSync(path.join(tmp, 'features', 'today.integration.test.tsx'), '');
    fs.writeFileSync(path.join(tmp, 'unit.test.ts'), '');
    fs.writeFileSync(path.join(tmp, 'node_modules', 'pkg', 'integration.test.ts'), '');

    assert.deepEqual(discoverIntegrationSuites(tmp).map((suite) => path.basename(suite)), [
      'integration.test.ts',
      'today.integration.test.tsx',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findAdb prefers EGA_MOBILE_ADB and reports absence honestly', () => {
  const probed = [];
  const probe = (candidate) => {
    probed.push(candidate);
    return candidate === '/opt/adb';
  };
  const found = findAdb({ EGA_MOBILE_ADB: '/opt/adb' }, probe);
  assert.equal(found, '/opt/adb');
  assert.deepEqual(probed, ['/opt/adb']);

  assert.equal(findAdb({}, () => false), null);
});

test('checkDeployedHono passes only on HTTP 200 and classifies failures', async () => {
  const ok = await checkDeployedHono(
    { baseUrl: 'https://prod.example/', healthPath: '/health' },
    async () => ({ status: 200 }),
  );
  assert.equal(ok.ok, true);

  const serverError = await checkDeployedHono(
    { baseUrl: 'https://prod.example', healthPath: '/health' },
    async () => ({ status: 503 }),
  );
  assert.equal(serverError.ok, false);
  assert.match(serverError.detail, /HTTP 503/);

  const networkError = await checkDeployedHono(
    { baseUrl: 'https://prod.example', healthPath: '/health' },
    async () => {
      throw new Error('ECONNREFUSED');
    },
  );
  assert.equal(networkError.ok, false);
  assert.match(networkError.detail, /failed: ECONNREFUSED/);
});

test('resolveAndroidAppConfig reads the real package identity from apps/mobile/app.json', () => {
  const config = resolveAndroidAppConfig();
  assert.ok(config, 'apps/mobile/app.json must expose expo.android.package');
  assert.equal(config.packageName, 'com.ega_house.mobile');
  assert.equal(config.scheme, 'mobile');

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-appcfg-'));
  try {
    assert.equal(resolveAndroidAppConfig(empty), null);
    fs.writeFileSync(path.join(empty, 'app.json'), JSON.stringify({ expo: { android: {} } }));
    assert.equal(resolveAndroidAppConfig(empty), null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('discoverApkArtifacts prefers EGA_MOBILE_APK and scans known output dirs honestly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-apks-'));
  try {
    assert.deepEqual(discoverApkArtifacts({}, tmp), []);

    const debugDir = path.join(tmp, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, 'app-debug.apk'), 'apk');
    fs.writeFileSync(path.join(debugDir, 'notes.txt'), 'not an apk');
    const artifactsDir = path.join(tmp, 'artifacts');
    fs.mkdirSync(artifactsDir);
    fs.writeFileSync(path.join(artifactsDir, 'ega-house-debug-42.apk'), 'apk');

    const found = discoverApkArtifacts({}, tmp);
    assert.equal(found.length, 2);
    assert.match(found[0], /app-debug\.apk$/);

    const explicit = path.join(tmp, 'explicit.apk');
    fs.writeFileSync(explicit, 'apk');
    assert.deepEqual(discoverApkArtifacts({ EGA_MOBILE_APK: explicit }, tmp), [explicit]);
    assert.deepEqual(
      discoverApkArtifacts({ EGA_MOBILE_APK: path.join(tmp, 'missing.apk') }, tmp),
      [],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyRuntimeChain decides in execution order: FAIL beats later steps, missing is NOT PROVEN', () => {
  const allOk = classifyRuntimeChain([
    { step: 'install', status: 'ok' },
    { step: 'launch', status: 'ok' },
  ]);
  assert.equal(allOk.status, 'PASS');

  const blocked = classifyRuntimeChain([
    { step: 'adb', status: 'missing', detail: 'no adb tooling found' },
    { step: 'install', status: 'ok' },
  ]);
  assert.equal(blocked.status, 'NOT PROVEN');
  assert.match(blocked.reason, /no adb tooling found/);

  const executedFailure = classifyRuntimeChain([
    { step: 'install', status: 'ok' },
    { step: 'launch', status: 'failed', detail: 'am start exited 1' },
    { step: 'process-alive', status: 'missing', detail: 'never reached' },
  ]);
  assert.equal(executedFailure.status, 'FAIL');
  assert.match(executedFailure.reason, /am start exited 1/);
});

function fakeExec(responses) {
  const calls = [];
  const matchers = responses.map((entry) =>
    Array.isArray(entry) ? (cmd) => (entry[0](cmd) ? entry[1]() : null) : entry,
  );
  return {
    calls,
    exec(args) {
      const cmd = args.join(' ');
      calls.push(cmd);
      for (const matcher of matchers) {
        const outcome = matcher(cmd);
        if (outcome) return outcome;
      }
      return { ok: false, stdout: '', stderr: 'unexpected command' };
    },
  };
}

const HAPPY_SERIAL = 'emulator-5554';
const PKG = 'com.ega_house.mobile';

function baseResponses({ uiText = `<node package="${PKG}"`, fatal = false, pid = '4242' } = {}) {
  return [
    [(cmd) => cmd.includes('install -r'), () => ({ ok: true, stdout: 'Success\n', stderr: '' })],
    [(cmd) => cmd.includes('resolve-activity'), () => ({ ok: true, stdout: `priority=0 preferredOrder=0\n  ${PKG}/.MainActivity\n`, stderr: '' })],
    [(cmd) => cmd.endsWith('logcat -c'), () => ({ ok: true, stdout: '', stderr: '' })],
    [(cmd) => cmd.includes('am start'), () => ({ ok: true, stdout: `Starting: Intent { cmp=${PKG}/.MainActivity }\n`, stderr: '' })],
    [(cmd) => cmd.includes(`pidof ${PKG}`), () => ({ ok: Boolean(pid), stdout: `${pid}\n`, stderr: '' })],
    [(cmd) => cmd.includes('uiautomator dump'), () => ({ ok: true, stdout: 'UI hierchary dumped to: /sdcard/ega-window-dump.xml\n', stderr: '' })],
    [(cmd) => cmd.startsWith('-s emulator-5554 exec-out cat'), () => ({ ok: true, stdout: uiText, stderr: '' })],
    [(cmd) => cmd.endsWith('logcat -d'), () => ({ ok: true, stdout: `${fatal ? 'FATAL EXCEPTION: main\n' : ''}ActivityTaskManager: START u0 {cmp=${PKG}/.MainActivity}\n`, stderr: '' })],
  ].map(([match, respond]) => (cmd) => (match(cmd) ? respond() : null));
}

test('runAppRuntimeChain proves install -> launch -> alive -> UI and passes only then', async () => {
  const delays = [];
  const fake = fakeExec(baseResponses());
  const outcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 3,
    exec: fake.exec,
    delay: async (ms) => delays.push(ms),
  });
  assert.equal(outcome.status, 'PASS');
  assert.match(outcome.reason, /APP-runtime chain proven/);
  assert.match(outcome.reason, /uiautomator dump contains "com\.ega_house\.mobile"/);
  assert.deepEqual(delays, [3000], 'must actually wait before the pidof liveness probe');
  assert.ok(fake.calls.some((call) => call.endsWith('install -r /tmp/ega-house-debug.apk')));
  assert.ok(fake.calls.some((call) => call.includes(`am start -n ${PKG}/.MainActivity`)));
});

test('runAppRuntimeChain fails when the process dies before the liveness window ends', async () => {
  const fake = fakeExec(baseResponses({ pid: '' }));
  const outcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 0,
    exec: fake.exec,
    delay: async () => {},
  });
  assert.equal(outcome.status, 'FAIL');
  assert.match(outcome.reason, /process-alive: pidof .* no process after 0s/);
});

test('runAppRuntimeChain falls back to a clean logcat window when the dump lacks probe text', async () => {
  const fake = fakeExec(baseResponses({ uiText: '<node package="com.android.launcher"' }));
  const outcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 0,
    exec: fake.exec,
    delay: async () => {},
  });
  assert.equal(outcome.status, 'PASS');
  assert.match(outcome.reason, /logcat shows app started without fatal crash/);
});

test('runAppRuntimeChain reports a fatal crash instead of passing on logcat evidence', async () => {
  const fake = fakeExec(
    baseResponses({ uiText: '<node package="com.android.launcher"', fatal: true }),
  );
  const outcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 0,
    exec: fake.exec,
    delay: async () => {},
  });
  assert.equal(outcome.status, 'FAIL');
  assert.match(outcome.reason, /FATAL EXCEPTION/);
});

test('runAppRuntimeChain fails honestly when install or launcher resolution breaks', async () => {
  const installBroken = fakeExec([
    [(cmd) => cmd.includes('install -r'), () => ({ ok: false, stdout: 'Performing Streamed Install\n', stderr: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE\n' })],
  ]);
  const installOutcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 0,
    exec: installBroken.exec,
    delay: async () => {},
  });
  assert.equal(installOutcome.status, 'FAIL');
  assert.match(installOutcome.reason, /install: adb -s .* INSTALL_FAILED_UPDATE_INCOMPATIBLE/);

  const resolverBroken = fakeExec([
    [(cmd) => cmd.includes('install -r'), () => ({ ok: true, stdout: 'Success\n', stderr: '' })],
    [(cmd) => cmd.includes('resolve-activity'), () => ({ ok: true, stdout: '(no activities)\n', stderr: '' })],
  ]);
  const resolveOutcome = await runAppRuntimeChain({
    serial: HAPPY_SERIAL,
    packageName: PKG,
    apkPath: '/tmp/ega-house-debug.apk',
    aliveAfterSeconds: 0,
    exec: resolverBroken.exec,
    delay: async () => {},
  });
  assert.equal(resolveOutcome.status, 'FAIL');
  assert.match(resolveOutcome.reason, /resolve-launcher: could not resolve a LAUNCHER activity/);
});

test('summary always names the highest proven level explicitly', () => {
  const passing = [
    { id: 1, title: 'static/type proof', status: 'PASS', reason: 'green', durationMs: 100 },
    { id: 2, title: 'mobile unit tests', status: 'PASS', reason: 'green', durationMs: 200 },
    { id: 6, title: 'android emulator runtime', status: 'NOT PROVEN', reason: 'no adb tooling found', durationMs: 0 },
  ];
  const summary = formatSummary(passing);
  assert.match(summary, /HIGHEST LEVEL PROVEN: L2\n/);
  assert.match(summary, /NOT PROVEN means infrastructure was absent/);

  const nothing = [{ id: 1, title: 'static/type proof', status: 'FAIL', reason: 'tsc failed', durationMs: 5 }];
  assert.match(formatSummary(nothing), /HIGHEST LEVEL PROVEN: NONE/);
});

test('json summary exposes machine-readable classification', () => {
  const results = [
    { id: 1, key: 'static-type', title: 'static/type proof', status: 'PASS', reason: 'green', durationMs: 10 },
    { id: 8, key: 'deployed-hono-connectivity', title: 'deployed Hono production connectivity', status: 'NOT PROVEN', reason: 'env unset', durationMs: 0 },
  ];
  const parsed = JSON.parse(toJsonSummary(results));
  assert.equal(parsed.highestLevelProven, 1);
  assert.equal(parsed.levels.length, 2);
  assert.equal(parsed.levels[1].status, 'NOT PROVEN');
});
