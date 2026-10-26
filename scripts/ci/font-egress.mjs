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
 *     `fonts.gstatic.com` string (matched case-insensitively) in the scanned web
 *     build inputs: `apps/web/src` and `apps/web/public` files with a known text
 *     extension, plus `next.config.*` and `postcss.config.*`.
 *  2. `apps/web/src/app/layout.tsx` still imports `next/font/local`, each
 *     committed font binary is loaded from `./fonts/<file>` with its expected
 *     `weight` and CSS variable, and each `${constant}.variable` still reaches
 *     the root element. Deleting, renaming or no longer applying a loader
 *     cannot silently drop the product typography back to system fonts.
 *  3. Each committed font binary starts with the WOFF2 signature and its header
 *     `length` field matches the file size (catches truncation and appended
 *     bytes, not arbitrary corruption inside a same-length file), and each has
 *     a non-empty SIL OFL 1.1 licence text next to it.
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

// Each entry: the committed binary, its licence text, the CSS variable it must
// assign, the JS constant that must apply that variable, and the declared weight
// descriptor (parity with the faces the previous configuration exposed).
const REQUIRED_FONTS = [
  {
    file: 'instrument-sans-latin-var.woff2',
    licence: 'OFL-instrument-sans.txt',
    variable: '--font-body-next',
    constant: 'instrumentSans',
    weight: '400 700',
  },
  {
    file: 'sora-latin-var.woff2',
    licence: 'OFL-sora.txt',
    variable: '--font-display-next',
    constant: 'sora',
    weight: '100 800',
  },
  {
    file: 'jetbrains-mono-latin-var.woff2',
    licence: 'OFL-jetbrains-mono.txt',
    variable: '--font-mono-next',
    constant: 'jetbrainsMono',
    weight: '400 600',
  },
];

const FORBIDDEN = [
  { pattern: /next\/font\/google/, label: 'next/font/google import' },
  { pattern: /fonts\.googleapis\.com/i, label: 'fonts.googleapis.com reference' },
  { pattern: /fonts\.gstatic\.com/i, label: 'fonts.gstatic.com reference' },
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
  '.svg',
]);

// The provenance note legitimately names the hosts the fonts came from.
const PROVENANCE_FILES = new Set(['README.md']);

const WOFF2_MAGIC = Buffer.from('wOF2', 'ascii');
const OFL_MARKER = 'SIL OPEN FONT LICENSE';

let failures = 0;

function ok(message) {
  console.log(`ok   - ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function walk(target, out = [], seen = new Set()) {
  // `existsSync` is false for a broken symlink, so entry existence is decided by
  // lstat and a resolvable target by stat.
  try {
    fs.lstatSync(target);
  } catch {
    return out;
  }

  let stat;
  let real;
  try {
    stat = fs.statSync(target);
    real = stat.isDirectory() ? fs.realpathSync(target) : null;
  } catch {
    // Broken symlink: fail loudly rather than silently skipping the path.
    fail(`broken symlink or unreadable path ${path.relative(repoRoot, target)}`);
    return out;
  }

  if (real) {
    if (seen.has(real)) return out;
    seen.add(real);
  }

  if (stat.isFile()) {
    out.push(target);
    return out;
  }

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, out, seen);
    } else {
      out.push(full);
    }
  }
  return out;
}

function isTestFile(file) {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
  // Only genuine test locations: the Playwright suite, private __tests__
  // folders, and *.test.*/*.spec.* files. `src/app/tests/**` is a real route
  // segment and must stay scanned.
  if (rel.startsWith('apps/web/tests/')) return true;
  if (/(^|\/)__tests__\//.test(rel)) return true;
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

function scannable(target) {
  return walk(target).filter((file) => {
    const name = path.basename(file);
    if (path.dirname(file) === fontDir && PROVENANCE_FILES.has(name)) return false;
    // Tests are not shipped build inputs and may assert on the forbidden string.
    if (isTestFile(file)) return false;
    return SCAN_EXTENSIONS.has(path.extname(name));
  });
}

/** Every `localFont({ ... })` call body in layout.tsx. */
function localFontBlocks(layout) {
  return [...layout.matchAll(/localFont\(\{([\s\S]*?)\n\}\)/g)].map((m) => m[0]);
}

function checkFontHostBoundary() {
  const webConfigFiles = [
    'next.config.ts',
    'next.config.mjs',
    'postcss.config.mjs',
    'postcss.config.js',
  ]
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
      if (pattern.test(text)) hits.push(`${path.relative(repoRoot, file)} — ${label}`);
    }
  }

  if (hits.length > 0) {
    fail('web build depends on Google Fonts hosts:\n  ' + hits.join('\n  '));
  } else {
    ok(`no Google Fonts import or URL in ${scanned.length} web build inputs`);
  }
}

function checkLoader() {
  if (!fs.existsSync(layoutPath)) {
    fail('apps/web/src/app/layout.tsx not found');
    return;
  }

  const layout = fs.readFileSync(layoutPath, 'utf8');

  if (/from ['"]next\/font\/local['"]/.test(layout)) {
    ok('layout.tsx loads next/font/local');
  } else {
    fail('layout.tsx no longer imports next/font/local');
  }

  const blocks = localFontBlocks(layout);
  const byFontFile = new Map();
  for (const block of blocks) {
    const match = block.match(/src: "\.\/fonts\/([^"]+)"/);
    if (match) byFontFile.set(match[1], block);
  }

  for (const { file, variable, constant, weight } of REQUIRED_FONTS) {
    const block = byFontFile.get(file);
    if (!block) {
      fail(`layout.tsx does not load ./fonts/${file}`);
      continue;
    }
    if (!block.includes(`variable: "${variable}"`)) {
      fail(`layout.tsx loads ./fonts/${file} without variable: "${variable}"`);
    } else if (!block.includes(`weight: "${weight}"`)) {
      fail(`layout.tsx loads ./fonts/${file} without weight: "${weight}"`);
    } else if (!layout.includes(`\${${constant}.variable}`)) {
      // Assigning the variable is not enough: it must reach the root element,
      // otherwise the family silently falls back to the globals.css stack.
      fail(`layout.tsx no longer applies \${${constant}.variable} to the root element`);
    } else {
      ok(`layout.tsx loads ./fonts/${file} as ${variable} (${weight}) and applies it`);
    }
  }
}

function checkBinaries() {
  for (const { file, licence: licenceFile } of REQUIRED_FONTS) {
    const fontPath = path.join(fontDir, file);

    if (!fs.existsSync(fontPath)) {
      fail(`missing committed font binary apps/web/src/app/fonts/${file}`);
    } else {
      const buf = fs.readFileSync(fontPath);
      // WOFF2 header: signature, flavor, then `length` = total file size.
      if (buf.length < 12 || !buf.subarray(0, 4).equals(WOFF2_MAGIC)) {
        fail(`apps/web/src/app/fonts/${file} is not a WOFF2 file`);
      } else if (buf.readUInt32BE(8) !== buf.length) {
        fail(
          `apps/web/src/app/fonts/${file} is truncated or has extra bytes ` +
            `(header says ${buf.readUInt32BE(8)} bytes, file is ${buf.length})`,
        );
      } else {
        ok(`committed font binary ${file} (${buf.length} bytes)`);
      }
    }

    const licencePath = path.join(fontDir, licenceFile);
    if (!fs.existsSync(licencePath)) {
      fail(`missing licence file apps/web/src/app/fonts/${licenceFile}`);
      continue;
    }
    const licence = fs.readFileSync(licencePath, 'utf8');
    if (licence.includes(OFL_MARKER)) {
      ok(`committed SIL OFL 1.1 licence ${licenceFile}`);
    } else {
      fail(`apps/web/src/app/fonts/${licenceFile} is not a SIL OFL 1.1 text`);
    }
  }
}

function main() {
  if (!fs.existsSync(webSrc)) {
    fail(`web source tree not found at ${path.relative(repoRoot, webSrc)}`);
    return;
  }

  checkFontHostBoundary();
  checkLoader();
  checkBinaries();

  if (failures > 0) {
    console.error(`\n${failures} font-egress failure(s).`);
    process.exitCode = 1;
  } else {
    console.log('\nfont-egress: OK');
  }
}

main();
