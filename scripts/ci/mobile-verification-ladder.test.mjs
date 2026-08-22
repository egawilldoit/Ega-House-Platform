import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LEVELS,
  checkDeployedHono,
  classifyAdbDevices,
  discoverIntegrationSuites,
  findAdb,
  formatSummary,
  highestProven,
  parseLevelSpec,
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
