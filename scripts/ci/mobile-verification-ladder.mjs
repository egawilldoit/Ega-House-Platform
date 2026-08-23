#!/usr/bin/env node
/**
 * mobile-verification-ladder.mjs — Mobile Verification Ladder (TASK 7, WS20 port).
 *
 * One entry point for all mobile verification evidence. Every level maps to
 * machinery that already exists in the repo; nothing here invents new heavy
 * infrastructure and nothing here claims runtime proof it did not run.
 *
 * Levels (highest honest ceiling first reported at the end):
 *   L1  static/type proof        npm run mobile:typecheck + npm run check:architecture
 *   L2  mobile unit tests        jest in apps/mobile excluding integration suites
 *   L3  mobile integration tests jest on apps/mobile integration.test.(ts|tsx) suites
 *   L4  expo doctor              npm run mobile:doctor
 *   L5  android bundle export    npm run mobile:bundle (expo export --platform android)
 *   L6  android emulator APP     EGA House APP verified ON an emulator: APK found ->
 *       runtime                 adb install -r -> am start -> pidof <package> alive after
 *                               N seconds -> initial UI rendered (uiautomator dump contains
 *                               expected text/node OR logcat shows start without fatal crash)
 *   L7  physical-device APP      same APP-runtime chain on a non-emulator serial
 *       runtime
 *   L8  deployed Hono connectivity
 *                                GET ${MOBILE_PRODUCTION_BASE_URL}${MOBILE_PRODUCTION_HEALTH_PATH:-/health}
 *
 * Honesty contract:
 *   - A level reports PASS only from a command that actually ran and exited 0.
 *   - Levels whose infrastructure is absent print NOT PROVEN with the exact
 *     missing piece. NOT PROVEN is never PASS by assumption.
 *   - A merely reachable, booted device NEVER passes L6/L7. Device availability
 *     alone classifies NOT PROVEN; only the completed APP-runtime chain above
 *     earns PASS. L6/L7 mean APP runtime, not device availability.
 *   - The final line always names the HIGHEST level actually proven by this run.
 *
 * Usage:
 *   node scripts/ci/mobile-verification-ladder.mjs [--levels <spec>] [--json] [--list]
 *     --levels 1-5 | 1,3,5 | 3   subset of levels (default 1-8)
 *     --json                     machine-readable summary instead of prose
 *     --list                     print level definitions and exit
 *
 * L6/L7 knobs:
 *   EGA_MOBILE_APK                 path to the APK to install (else auto-discovered
 *                                  under apps/mobile/android/app/build/outputs/apk/**
 *                                  and apps/mobile/artifacts)
 *   EGA_MOBILE_UI_PROBE_TEXT       text that must appear in the uiautomator dump
 *                                  (default: the app package name from app.json)
 *   EGA_MOBILE_ALIVE_AFTER_SECONDS seconds to wait before pidof (default 10)
 *
 * Exit code is 1 only when an executed level FAILS. NOT PROVEN and SKIPPED do
 * not fail the run; they are visible in the summary.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOBILE_DIR = path.join(REPO_ROOT, 'apps', 'mobile');

export const LEVEL_COUNT = 8;

/** Level metadata; runners are attached below so this file stays importable. */
export const LEVELS = [
  { id: 1, key: 'static-type', title: 'static/type proof' },
  { id: 2, key: 'mobile-unit', title: 'mobile unit tests' },
  { id: 3, key: 'mobile-integration', title: 'mobile integration tests' },
  { id: 4, key: 'expo-doctor', title: 'expo doctor' },
  { id: 5, key: 'android-bundle-export', title: 'android bundle export' },
  { id: 6, key: 'android-emulator-runtime', title: 'android emulator APP runtime' },
  { id: 7, key: 'android-device-runtime', title: 'physical-device APP runtime' },
  { id: 8, key: 'deployed-hono-connectivity', title: 'deployed Hono production connectivity' },
];

/**
 * Parse `--levels` input into a sorted unique list of level ids.
 * Accepts "3", "1-5", "1,3", "2-4,7". Throws on anything else.
 */
export function parseLevelSpec(spec) {
  if (!/^[0-9,\-]+$/.test(spec)) {
    throw new Error(`invalid --levels spec "${spec}"`);
  }
  const out = new Set();
  for (const part of spec.split(',')) {
    const range = part.match(/^([0-9]+)-([0-9]+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo < 1 || hi > LEVEL_COUNT || lo > hi) {
        throw new Error(`invalid --levels spec "${spec}"`);
      }
      for (let n = lo; n <= hi; n += 1) out.add(n);
      continue;
    }
    const single = Number(part);
    if (!Number.isInteger(single) || single < 1 || single > LEVEL_COUNT) {
      throw new Error(`invalid --levels spec "${spec}"`);
    }
    out.add(single);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Classify `adb devices` output into emulators vs physical devices.
 * Emulator serials are always "emulator-<port>"; everything else counts as a
 * physical device (including tcpip host:port serials).
 */
export function classifyAdbDevices(adbOutput) {
  const devices = [];
  const lines = String(adbOutput).split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('\t')) continue;
    const [serial, state] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    devices.push({
      serial,
      state,
      kind: serial.startsWith('emulator-') ? 'emulator' : 'physical',
    });
  }
  return devices;
}

/** Highest level id whose status is PASS, or null when none proved. */
export function highestProven(results) {
  let best = null;
  for (const result of results) {
    if (result.status === 'PASS' && (best === null || result.id > best)) best = result.id;
  }
  return best;
}

function notProven(id, reason, startedAt) {
  return { id, status: 'NOT PROVEN', reason, durationMs: Date.now() - startedAt };
}

function failed(id, reason, startedAt) {
  return { id, status: 'FAIL', reason, durationMs: Date.now() - startedAt };
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
}

function runNpmScript(script, extraArgs = []) {
  return runCommand('npm', ['run', script, '--workspace', '@ega/mobile', ...extraArgs]);
}

/** L1 — static/type proof: tsc over apps/mobile plus architecture boundaries. */
function runStaticTypeProof() {
  const startedAt = Date.now();
  const typecheck = runNpmScript('typecheck');
  if ((typecheck.status ?? 1) !== 0) {
    return failed(1, 'npm run mobile:typecheck failed', startedAt);
  }
  const architecture = runCommand('npm', ['run', 'check:architecture']);
  if ((architecture.status ?? 1) !== 0) {
    return failed(1, 'npm run check:architecture failed', startedAt);
  }
  return { id: 1, status: 'PASS', reason: 'tsc --noEmit and architecture boundaries green', durationMs: Date.now() - startedAt };
}

/**
 * Discover mobile integration suites: files named `integration.test.ts(x)` or
 * `*.integration.test.ts(x)` under apps/mobile, outside node_modules/.expo.
 */
export function discoverIntegrationSuites(mobileDir = MOBILE_DIR) {
  const suites = [];
  const skip = new Set(['node_modules', '.expo', 'android', 'ios']);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (/(^|\.)integration\.test\.(ts|tsx)$/.test(entry.name)) {
        suites.push(path.join(dir, entry.name));
      }
    }
  };
  if (fs.existsSync(mobileDir)) walk(mobileDir);
  return suites.sort();
}

/** L2/L3 — jest runs inside apps/mobile using the installed jest binary. */
function runJest(extraArgs, id, passReason) {
  const startedAt = Date.now();
  const localJest = path.join(REPO_ROOT, 'node_modules', '.bin', 'jest');
  const command = fs.existsSync(localJest) ? localJest : 'npx';
  const args = command === 'npx' ? ['jest', '--ci', '--runInBand', ...extraArgs] : ['--ci', '--runInBand', ...extraArgs];
  const result = spawnSync(command, args, {
    cwd: MOBILE_DIR,
    stdio: 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) {
    return failed(id, `jest ${extraArgs.join(' ')} failed`, startedAt);
  }
  return { id, status: 'PASS', reason: passReason, durationMs: Date.now() - startedAt };
}

function runMobileUnitTests() {
  return runJest(
    ['--testPathIgnorePatterns', '/node_modules/', '(^|\\.)integration\\.test\\.tsx?$'],
    2,
    'all non-integration mobile jest suites passed',
  );
}

function runMobileIntegrationTests() {
  const startedAt = Date.now();
  const suites = discoverIntegrationSuites();
  if (suites.length === 0) {
    return notProven(3, 'no integration.test.(ts|tsx) suite exists under apps/mobile', startedAt);
  }
  const relative = suites.map((suite) => path.relative(MOBILE_DIR, suite));
  const result = runJest(relative, 3, `${suites.length} integration suite(s): ${relative.join(', ')}`);
  return { ...result, id: 3 };
}

function runExpoDoctor() {
  const startedAt = Date.now();
  const result = runNpmScript('doctor');
  if ((result.status ?? 1) !== 0) {
    return failed(4, 'npm run mobile:doctor failed', startedAt);
  }
  return { id: 4, status: 'PASS', reason: 'expo-doctor green', durationMs: Date.now() - startedAt };
}

function runAndroidBundleExport() {
  const startedAt = Date.now();
  const result = runNpmScript('validate:bundle');
  if ((result.status ?? 1) !== 0) {
    return failed(5, 'npm run mobile:bundle failed', startedAt);
  }
  return {
    id: 5,
    status: 'PASS',
    reason: 'expo export --platform android produced apps/mobile/.expo/ci-export',
    durationMs: Date.now() - startedAt,
  };
}

/** Locate an executable adb without installing anything. */
export function findAdb(env = process.env, exec = runAdbVersionProbe) {
  const candidates = [];
  if (env.EGA_MOBILE_ADB) candidates.push(env.EGA_MOBILE_ADB);
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (env[key]) candidates.push(path.join(env[key], 'platform-tools', 'adb'));
  }
  candidates.push('adb');
  for (const candidate of candidates) {
    if (exec(candidate)) return candidate;
  }
  return null;
}

function runAdbVersionProbe(candidate) {
  const probe = spawnSync(candidate, ['version'], { stdio: 'ignore', timeout: 10_000 });
  return (probe.status ?? 1) === 0;
}

function adb(args, capture = true) {
  const adbPath = findAdb();
  if (!adbPath) return null;
  const result = spawnSync(adbPath, args, {
    cwd: REPO_ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    encoding: 'utf8',
    timeout: 15_000,
  });
  if ((result.status ?? 1) !== 0) return null;
  return result.stdout ?? '';
}

function booted(serial) {
  const bootCompleted = adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
  return bootCompleted !== null && bootCompleted.trim() === '1';
}

/**
 * Read the Android app identity straight from apps/mobile/app.json so the
 * runtime chain targets the real package, never a guess.
 */
export function resolveAndroidAppConfig(mobileDir = MOBILE_DIR) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(mobileDir, 'app.json'), 'utf8'));
    const packageName = parsed?.expo?.android?.package;
    if (typeof packageName === 'string' && packageName.trim()) {
      return {
        packageName: packageName.trim(),
        scheme: typeof parsed?.expo?.scheme === 'string' ? parsed.expo.scheme : null,
      };
    }
  } catch {
    // fall through to the honest "config unavailable" classification
  }
  return null;
}

const APK_DISCOVERY_DIRS = [
  path.join('android', 'app', 'build', 'outputs', 'apk', 'debug'),
  path.join('android', 'app', 'build', 'outputs', 'apk', 'release'),
  path.join('artifacts'),
];

/**
 * Locate an installable EGA House APK: EGA_MOBILE_APK wins when it exists,
 * otherwise known build-output directories are scanned. Returns [] when none
 * is available so the caller can classify NOT PROVEN with the exact gap.
 */
export function discoverApkArtifacts(env = process.env, mobileDir = MOBILE_DIR) {
  const explicit = env.EGA_MOBILE_APK?.trim();
  if (explicit) {
    const resolved = path.resolve(REPO_ROOT, explicit);
    return fs.existsSync(resolved) ? [resolved] : [];
  }
  const found = [];
  for (const dir of APK_DISCOVERY_DIRS) {
    const fullDir = path.join(mobileDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.apk')) {
        found.push(path.join(fullDir, entry.name));
      }
    }
  }
  return found.sort();
}

/**
 * Pure classifier for the ordered APP-runtime chain. The first step that is
 * not ok decides the outcome in execution order: an executed failure is FAIL,
 * missing infrastructure is NOT PROVEN, all-ok is PASS.
 */
export function classifyRuntimeChain(steps) {
  for (const step of steps) {
    if (step.status === 'failed') {
      return { status: 'FAIL', reason: `${step.step}: ${step.detail}` };
    }
    if (step.status === 'missing') {
      return { status: 'NOT PROVEN', reason: `${step.step}: ${step.detail}` };
    }
  }
  const summary = steps.map((step) => step.okDetail ?? `${step.step} ok`).join('; ');
  return { status: 'PASS', reason: `APP-runtime chain proven (${summary})` };
}

function defaultAdbExec(adbPath, args) {
  const result = spawnSync(adbPath, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { ok: (result.status ?? 1) === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastNonEmptyLine(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/**
 * L6/L7 APP-runtime chain against one booted serial:
 *   adb install -r -> resolve launcher activity -> am start -> pidof alive
 *   after N seconds -> initial UI rendered (uiautomator dump probe text OR a
 *   logcat window showing our package started without any fatal crash).
 * Every command actually executes; each step records what ran and what it
 * produced so PASS is never assumed.
 */
export async function runAppRuntimeChain({
  serial,
  packageName,
  apkPath,
  uiProbeText = packageName,
  aliveAfterSeconds = Number(process.env.EGA_MOBILE_ALIVE_AFTER_SECONDS ?? 10),
  exec = defaultAdbExec,
  delay = defaultDelay,
}) {
  const steps = [];

  const install = exec(['-s', serial, 'install', '-r', apkPath]);
  if (!install.ok) {
    steps.push({
      step: 'install',
      status: 'failed',
      detail: `adb -s ${serial} install -r ${path.basename(apkPath)} failed: ${(install.stderr || install.stdout || '').trim().slice(0, 200)}`,
    });
    return classifyRuntimeChain(steps);
  }
  steps.push({ step: 'install', status: 'ok', detail: '', okDetail: `adb install -r ${path.basename(apkPath)} exited 0` });

  const resolveOut = exec([
    '-s', serial, 'shell', 'cmd', 'package', 'resolve-activity',
    '--brief', '-c', 'android.intent.category.LAUNCHER', packageName,
  ]);
  const component = resolveOut.ok ? lastNonEmptyLine(resolveOut.stdout) : '';
  if (!/^[\w.$~]+\/[\w.$~]+$/.test(component)) {
    steps.push({
      step: 'resolve-launcher',
      status: 'failed',
      detail: `could not resolve a LAUNCHER activity for ${packageName}: "${component.slice(0, 120)}"`,
    });
    return classifyRuntimeChain(steps);
  }
  steps.push({ step: 'resolve-launcher', status: 'ok', detail: '', okDetail: `launcher activity ${component}` });

  const clearLog = exec(['-s', serial, 'shell', 'logcat', '-c']);
  if (!clearLog.ok) {
    steps.push({
      step: 'logcat-clear',
      status: 'missing',
      detail: 'adb logcat -c failed; fatal-crash evidence would be unreliable',
    });
    return classifyRuntimeChain(steps);
  }

  const start = exec(['-s', serial, 'shell', 'am', 'start', '-n', component]);
  if (!start.ok) {
    steps.push({
      step: 'launch',
      status: 'failed',
      detail: `am start -n ${component} failed: ${(start.stderr || start.stdout || '').trim().slice(0, 200)}`,
    });
    return classifyRuntimeChain(steps);
  }
  steps.push({ step: 'launch', status: 'ok', detail: '', okDetail: `am start -n ${component}` });

  await delay(Math.max(0, aliveAfterSeconds) * 1000);

  const pidof = exec(['-s', serial, 'shell', 'pidof', packageName]);
  if (!pidof.ok || !pidof.stdout.trim()) {
    steps.push({
      step: 'process-alive',
      status: 'failed',
      detail: `pidof ${packageName} found no process after ${aliveAfterSeconds}s (app died after launch)`,
    });
    return classifyRuntimeChain(steps);
  }
  steps.push({ step: 'process-alive', status: 'ok', detail: '', okDetail: `pid ${pidof.stdout.trim()} alive after ${aliveAfterSeconds}s` });

  const dumpWrite = exec(['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/ega-window-dump.xml']);
  const dumpRead = dumpWrite.ok
    ? exec(['-s', serial, 'exec-out', 'cat', '/sdcard/ega-window-dump.xml'])
    : { ok: false, stdout: '', stderr: '' };
  if (dumpRead.ok && dumpRead.stdout.includes(uiProbeText)) {
    steps.push({
      step: 'ui-rendered',
      status: 'ok',
      detail: '',
      okDetail: `uiautomator dump contains "${uiProbeText}"`,
    });
    return classifyRuntimeChain(steps);
  }

  const logcat = exec(['-s', serial, 'logcat', '-d']);
  const logText = logcat.ok ? logcat.stdout : '';
  const mentionsPackage = logText.includes(packageName);
  const hasFatal = logText.includes('FATAL EXCEPTION');
  if (mentionsPackage && !hasFatal) {
    steps.push({
      step: 'ui-rendered',
      status: 'ok',
      detail: '',
      okDetail: 'logcat shows app started without fatal crash',
    });
    return classifyRuntimeChain(steps);
  }

  steps.push({
    step: 'ui-rendered',
    status: 'failed',
    detail: hasFatal
      ? 'logcat recorded FATAL EXCEPTION during launch'
      : `uiautomator dump lacks "${uiProbeText}" and logcat shows no clean start for ${packageName}`,
  });
  return classifyRuntimeChain(steps);
}

/**
 * Shared APP-runtime probe for L6/L7. Reaching a booted target proves device
 * availability only — that classifies NOT PROVEN until the APP-runtime chain
 * (install -> launch -> alive -> UI) actually completes below.
 */
async function runAndroidRuntime(kind) {
  const id = kind === 'emulator' ? 6 : 7;
  const startedAt = Date.now();
  const adbPath = findAdb();
  if (!adbPath) {
    return notProven(id, 'no adb tooling found (set EGA_MOBILE_ADB or ANDROID_HOME, or install adb)', startedAt);
  }
  const listing = adb(['devices']);
  if (listing === null) {
    return notProven(id, 'adb present but "adb devices" failed', startedAt);
  }
  const targets = classifyAdbDevices(listing).filter((d) => d.kind === kind);
  const online = targets.filter((d) => d.state === 'device');
  if (online.length === 0) {
    const seen = targets.length > 0 ? `found ${targets.map((d) => `${d.serial}(${d.state})`).join(', ')}` : 'none attached';
    return notProven(id, `no ${kind} in state "device": ${seen}`, startedAt);
  }
  let target = null;
  for (const candidate of online) {
    if (booted(candidate.serial)) {
      target = candidate;
      break;
    }
  }
  if (!target) {
    return failed(id, `${kind} attached but never reported sys.boot_completed=1`, startedAt);
  }

  const appConfig = resolveAndroidAppConfig();
  if (!appConfig) {
    return notProven(id, 'apps/mobile/app.json exposes no expo.android.package; cannot identify the APP under test', startedAt);
  }

  const apks = discoverApkArtifacts(process.env);
  if (apks.length === 0) {
    const hint = process.env.EGA_MOBILE_APK
      ? `EGA_MOBILE_APK=${process.env.EGA_MOBILE_APK} does not exist`
      : 'no APK under android/app/build/outputs/apk/** or apps/mobile/artifacts; set EGA_MOBILE_APK';
    return notProven(
      id,
      `${kind} ${target.serial} reachable and booted, but no EGA House APK available to install (${hint}); booted-device availability alone never proves APP runtime`,
      startedAt,
    );
  }

  const outcome = await runAppRuntimeChain({
    serial: target.serial,
    packageName: appConfig.packageName,
    apkPath: apks[0],
    uiProbeText: process.env.EGA_MOBILE_UI_PROBE_TEXT || appConfig.packageName,
  });
  const prefix =
    outcome.status === 'PASS'
      ? `EGA House APP verified on ${kind} ${target.serial}`
      : `EGA House APP runtime unproven on ${kind} ${target.serial}`;
  return {
    id,
    status: outcome.status,
    reason: `${prefix}; using ${path.basename(apks[0])}${apks.length > 1 ? ` (+${apks.length - 1} more found)` : ''}. ${outcome.reason}`,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * L8 — deployed Hono connectivity. Requires an explicit base URL so local
 * runs never touch production implicitly. A 200 from the health route proves
 * deployed reachability; anything else is an executed FAIL.
 */
export async function checkDeployedHono(config, fetchImpl = fetch) {
  const url = `${config.baseUrl.replace(/\/+$/, '')}${config.healthPath}`;
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, detail: `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status !== 200) {
    return { ok: false, detail: `${url} answered HTTP ${response.status}, expected 200` };
  }
  return { ok: true, detail: `${url} answered HTTP 200` };
}

async function runDeployedHonoConnectivity() {
  const startedAt = Date.now();
  const baseUrl = process.env.MOBILE_PRODUCTION_BASE_URL;
  if (!baseUrl || !baseUrl.trim()) {
    return notProven(8, 'MOBILE_PRODUCTION_BASE_URL is not set; set it to the deployed backend origin to prove this level', startedAt);
  }
  const config = {
    baseUrl: baseUrl.trim(),
    healthPath: process.env.MOBILE_PRODUCTION_HEALTH_PATH?.trim() || '/health',
  };
  const outcome = await checkDeployedHono(config);
  if (!outcome.ok) {
    return failed(8, outcome.detail, startedAt);
  }
  return { id: 8, status: 'PASS', reason: outcome.detail, durationMs: Date.now() - startedAt };
}

const RUNNERS = {
  1: () => runStaticTypeProof(),
  2: () => Promise.resolve(runMobileUnitTests()),
  3: () => Promise.resolve(runMobileIntegrationTests()),
  4: () => Promise.resolve(runExpoDoctor()),
  5: () => Promise.resolve(runAndroidBundleExport()),
  6: () => Promise.resolve(runAndroidRuntime('emulator')),
  7: () => Promise.resolve(runAndroidRuntime('physical')),
  8: () => runDeployedHonoConnectivity(),
};

function skippedResult(levelId) {
  return { id: levelId, status: 'SKIPPED', reason: 'not requested (--levels)', durationMs: 0 };
}

/** Execute the requested ladder levels top-down and classify every level. */
export async function runLadder(requestedLevels) {
  const requested = new Set(requestedLevels);
  const results = [];
  for (const level of LEVELS) {
    if (!requested.has(level.id)) {
      results.push({ ...level, ...skippedResult(level.id), title: level.title });
      continue;
    }
    const outcome = await RUNNERS[level.id]();
    results.push({ ...level, ...outcome });
  }
  return results;
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatSummary(results) {
  const lines = ['', '=== Mobile Verification Ladder ==='];
  for (const result of results) {
    const label = `L${result.id} ${result.title}`;
    const detail =
      result.status === 'NOT PROVEN' || result.status === 'FAIL'
        ? `- ${result.reason}`
        : `- ${result.reason}`;
    lines.push(`${label.padEnd(42)} ${result.status.padEnd(11)} ${formatDuration(result.durationMs)}  ${detail}`);
  }
  const best = highestProven(results);
  lines.push('');
  if (best === null) {
    lines.push('HIGHEST LEVEL PROVEN: NONE');
  } else {
    lines.push(`HIGHEST LEVEL PROVEN: L${best}`);
  }
  lines.push('NOT PROVEN means infrastructure was absent or unproven in this run; it is never PASS.');
  return lines.join('\n');
}

export function toJsonSummary(results) {
  return JSON.stringify(
    {
      highestLevelProven: highestProven(results),
      levels: results.map(({ id, key, title, status, reason, durationMs }) => ({
        id,
        key,
        title,
        status,
        reason,
        durationMs,
      })),
    },
    null,
    2,
  );
}

function parseArgs(argv) {
  let levelsSpec = `1-${LEVEL_COUNT}`;
  let json = false;
  let help = false;
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--levels') {
      i += 1;
      levelsSpec = argv[i];
    } else if (arg.startsWith('--levels=')) {
      levelsSpec = arg.slice('--levels='.length);
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--list') {
      list = true;
    } else if (arg === '-h' || arg === '--help') {
      help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return { levels: parseLevelSpec(levelsSpec), json, help, list };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help || options.list) {
    console.log('Mobile verification ladder levels:');
    for (const level of LEVELS) {
      console.log(`  L${level.id}  ${level.title}`);
    }
    console.log('\nUsage: node scripts/ci/mobile-verification-ladder.mjs [--levels 1-5] [--json]');
    return 0;
  }

  const results = await runLadder(options.levels);
  if (options.json) {
    console.log(toJsonSummary(results));
  } else {
    console.log(formatSummary(results));
  }
  const anyFailed = results.some((result) => result.status === 'FAIL');
  return anyFailed ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    });
}
