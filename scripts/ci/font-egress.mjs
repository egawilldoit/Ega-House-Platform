#!/usr/bin/env node
/**
 * font-egress.mjs — proves the web build does not depend on font-host egress.
 *
 * EGA-778 replaced `next/font/google` with `next/font/local` so that a
 * restricted-network or locked-down build still compiles. That guarantee is
 * invisible in a normal green build (the hosted runner has egress), so this
 * lightweight source check fails when a font-host dependency comes back:
 *
 *  1. No `next/font/google` import under `apps/web/src`.
 *  2. No `fonts.googleapis.com` / `fonts.gstatic.com` URL under `apps/web/src`.
 *  3. Every family declared in `apps/web/src/app/fonts/` still has its
 *     committed WOFF2 binary and its SIL OFL licence file.
 *
 * Not a test suite: it does not re-derive the layout edit, only the boundary
 * that the build must keep.
 *
 * Run: `node scripts/ci/font-egress.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const webSrc = path.join(repoRoot, 'apps', 'web', 'src');
const fontDir = path.join(webSrc, 'app', 'fonts');

// [font binary, licence file] pairs that must ship with the local build.
const REQUIRED_FONTS = [
  ['instrument-sans-latin-var.woff2', 'OFL-instrument-sans.txt'],
  ['sora-latin-var.woff2', 'OFL-sora.txt'],
  ['jetbrains-mono-latin-var.woff2', 'OFL-jetbrains-mono.txt'],
];

const FORBIDDEN = [
  { pattern: /next\/font\/google/, label: 'next/font/google import' },
  { pattern: /fonts\.googleapis\.com/, label: 'fonts.googleapis.com reference' },
  { pattern: /fonts\.gstatic\.com/, label: 'fonts.gstatic.com reference' },
];

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.md',
  '.mdx',
  '.html',
]);

let failures = 0;

function ok(message) {
  console.log(`ok   - ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(webSrc)) {
    fail(`web source tree not found at ${path.relative(repoRoot, webSrc)}`);
    return;
  }

  const files = walk(webSrc);
  const hits = [];

  for (const file of files) {
    // The provenance notes intentionally name the hosts in prose; only
    // executable source can reintroduce a runtime dependency.
    if (path.dirname(file) === fontDir) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const { pattern, label } of FORBIDDEN) {
      if (pattern.test(text)) {
        hits.push(`${path.relative(repoRoot, file)} — ${label}`);
      }
    }
  }

  if (hits.length > 0) {
    fail('web source depends on Google Fonts hosts:\n  ' + hits.join('\n  '));
  } else {
    ok(`no Google Fonts import or URL in ${files.length} web source files`);
  }

  for (const [fontFile, licenceFile] of REQUIRED_FONTS) {
    const fontPath = path.join(fontDir, fontFile);
    const licencePath = path.join(fontDir, licenceFile);
    if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 0) {
      ok(`committed font binary ${fontFile}`);
    } else {
      fail(`missing committed font binary apps/web/src/app/fonts/${fontFile}`);
    }
    if (fs.existsSync(licencePath) && fs.statSync(licencePath).size > 0) {
      ok(`committed licence ${licenceFile}`);
    } else {
      fail(`missing licence file apps/web/src/app/fonts/${licenceFile}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} font-egress failure(s).`);
    process.exitCode = 1;
  } else {
    console.log('\nfont-egress: OK');
  }
}

main();
