#!/usr/bin/env node
/**
 * font-egress.mjs — proves the web build does not depend on font-host egress.
 *
 * EGA-778 replaced `next/font/google` with `next/font/local` so that a
 * restricted-network or locked-down build still compiles. That guarantee is
 * invisible in a normal green build (the hosted runner has egress), so this
 * lightweight source check fails when the boundary is broken:
 *
 *  1. No `next/font/google` import and no `fonts.googleapis.com` /
 *     `fonts.gstatic.com` URL in any web build input (source, build config,
 *     public assets).
 *  2. `apps/web/src/app/layout.tsx` still loads each committed font with
 *     `next/font/local`, so deleting the loader cannot silently drop the
 *     product typography back to system fonts.
 *  3. Every committed font binary is a real WOFF2 and ships with its SIL OFL
 *     1.1 licence text.
 *
 * Not a test suite: it does not re-derive the layout edit, only the boundary
 * that the build must keep.
 *
 * Run: `node scripts/ci/font-egress.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const webSrc = path.join(webRoot, 'src');
const fontDir = path.join(webSrc, 'app', 'fonts');
const layoutPath = path.join(webSrc, 'app', 'layout.tsx');

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

// Provenance prose in the fonts folder legitimately names the hosts it came from.
const PROVENANCE_FILES = new Set(['README.md']);

const WOFF2_MAGIC = Buffer.from('wOF2', 'ascii');

let failures = 0;

function ok(message) {
  console.log(`ok   - ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function isTestFile(file) {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
  return /(^|\/)tests?\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

function scannable(target) {
  return walk(target).filter((file) => {
    const name = path.basename(file);
    if (path.dirname(file) === fontDir) {
      // Only the licence texts and provenance notes may name the font hosts;
      // any other file added to this folder is still scanned.
      if (PROVENANCE_FILES.has(name) || /^OFL-.*\.txt$/.test(name)) return false;
    }
    // Tests are not shipped build inputs and may assert on the forbidden string.
    if (isTestFile(file)) return false;
    return SCAN_EXTENSIONS.has(path.extname(name));
  });
}

function main() {
  if (!fs.existsSync(webSrc)) {
    fail(`web source tree not found at ${path.relative(repoRoot, webSrc)}`);
    return;
  }

  // 1. Forbidden font-host dependency anywhere in the web build inputs.
  const webConfigFiles = ['next.config.ts', 'next.config.mjs', 'postcss.config.mjs', 'postcss.config.js']
    .map((name) => path.join(webRoot, name))
    .filter((file) => fs.existsSync(file));
  const scanned = [
    ...scannable(webSrc),
    ...scannable(path.join(webRoot, 'public')),
    ...webConfigFiles,
  ];

  const hits = [];
  for (const file of scanned) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { pattern, label } of FORBIDDEN) {
      if (pattern.test(text)) {
        hits.push(`${path.relative(repoRoot, file)} — ${label}`);
      }
    }
  }

  if (hits.length > 0) {
    fail('web build depends on Google Fonts hosts:\n  ' + hits.join('\n  '));
  } else {
    ok(`no Google Fonts import or URL in ${scanned.length} web build inputs`);
  }

  // 2. The loader that makes the committed binaries reachable still exists.
  if (!fs.existsSync(layoutPath)) {
    fail('apps/web/src/app/layout.tsx not found');
  } else {
    const layout = fs.readFileSync(layoutPath, 'utf8');
    if (/from ['"]next\/font\/local['"]/.test(layout)) {
      ok('layout.tsx loads next/font/local');
    } else {
      fail('layout.tsx no longer imports next/font/local');
    }
    for (const [fontFile] of REQUIRED_FONTS) {
      if (layout.includes(`./fonts/${fontFile}`)) {
        ok(`layout.tsx loads ./fonts/${fontFile}`);
      } else {
        fail(`layout.tsx does not load ./fonts/${fontFile}`);
      }
    }
  }

  // 3. Committed binaries are real WOFF2 files with their licence texts.
  for (const [fontFile, licenceFile] of REQUIRED_FONTS) {
    const fontPath = path.join(fontDir, fontFile);
    if (!fs.existsSync(fontPath)) {
      fail(`missing committed font binary apps/web/src/app/fonts/${fontFile}`);
    } else {
      const buf = fs.readFileSync(fontPath);
      // WOFF2 header: signature, flavor, then `length` = total file size in
      // bytes, so a truncated or corrupted download is rejected.
      if (buf.length < 12 || !buf.subarray(0, 4).equals(WOFF2_MAGIC)) {
        fail(`apps/web/src/app/fonts/${fontFile} is not a WOFF2 file`);
      } else if (buf.readUInt32BE(8) !== buf.length) {
        fail(
          `apps/web/src/app/fonts/${fontFile} is truncated or corrupt (header says ` +
            `${buf.readUInt32BE(8)} bytes, file is ${buf.length})`,
        );
      } else {
        ok(`committed font binary ${fontFile}`);
      }
    }

    const licencePath = path.join(fontDir, licenceFile);
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
