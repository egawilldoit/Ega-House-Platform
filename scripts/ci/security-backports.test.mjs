import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { verifySecurityBackports, verifyBraces, verifyForge } from './security-backports.mjs';
import { evaluateAuditReport } from './audit-production.mjs';
const require = createRequire(import.meta.url);
const report = source => ({ vulnerabilities: { braces: { severity: 'high', via: [{ source, name: 'braces', severity: 'high' }] } } });

test('audit still blocks an unverified backport and unknown advisories', () => {
  assert.equal(evaluateAuditReport(report(1240992), { checkWs: false }).blockingHighCritical.length, 1);
  const verifiedBackports = new Map([[1240992, 'braces']]);
  assert.equal(evaluateAuditReport(report(1240992), { checkWs: false, verifiedBackports }).blockingHighCritical.length, 0);
  assert.equal(evaluateAuditReport(report(9999999), { checkWs: false, verifiedBackports }).blockingHighCritical.length, 1);
  assert.equal(evaluateAuditReport(report(1240992), { checkWs: false, verifiedBackports: new Map([[1240992, 'another-package']]) }).blockingHighCritical.length, 1);
});

test('installed backports match source pins, hashes and regression probes', () => {
  assert.deepEqual([...verifySecurityBackports()], [[1240992, 'braces'], [1240912, 'node-forge']]);
});

test('backport proof rejects a registry copy substituted for the source pin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-backport-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), fs.readFileSync('package.json'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    lock.packages['node_modules/braces'].resolved = 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz';
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.throws(() => verifySecurityBackports(root), /resolved drift/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('braces rejects excessive parser and AST depth while ordinary globs work', () => {
  verifyBraces(require('braces'));
  const braces = require('braces');
  assert.throws(() => braces.parse('('.repeat(101) + ')'.repeat(101)), /exceeds max depth/);
  assert.doesNotThrow(() => braces.parse('{'.repeat(100) + 'x' + '}'.repeat(100)));
  assert.throws(() => braces.parse('{{x}}', { maxDepth: 1.5 }), /exceeds max depth/);
  for (const pattern of ['{{a}}', '{a,{b}}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  const ast = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] };
  ast.parent = ast;
  assert.throws(() => braces.expand(ast), /parent chain contains a cycle/);
});

test('forge rejects nested DigestAlgorithm garbage and accepts valid signatures', () => {
  verifyForge(require('node-forge'));
});


test('backport proof rejects changed installed code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-backport-tamper-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(file, path.join(root, file));
    }
    const records = JSON.parse(fs.readFileSync(new URL('./security-backports.json', import.meta.url), 'utf8'));
    const installed = path.join(root, 'node_modules/braces');
    fs.mkdirSync(path.join(installed, 'lib'), { recursive: true });
    for (const file of ['package.json', ...Object.keys(records[0].sha256)]) {
      fs.copyFileSync(path.join('node_modules/braces', file), path.join(installed, file));
    }
    fs.appendFileSync(path.join(installed, 'lib/parse.js'), '\n// changed installed source\n');
    assert.throws(() => verifySecurityBackports(root), /unverified code/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
