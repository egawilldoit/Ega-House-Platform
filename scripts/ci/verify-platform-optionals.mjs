import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log(`platform-optionals: no Linux x64 verification needed on ${process.platform}/${process.arch}`);
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const wanted = Object.entries(manifest.optionalDependencies ?? {}).filter(([name]) => /linux-x64-(?:gnu|glibc)/.test(name));
if (wanted.length === 0) throw new Error('platform-optionals: no Linux x64 native pins declared');
const missing = wanted.filter(([name]) => !fs.existsSync(path.join('node_modules', ...name.split('/'), 'package.json')));
if (missing.length > 0) {
  throw new Error(`platform-optionals: npm ci omitted required Linux x64 native packages: ${missing.map(([n, v]) => `${n}@${v}`).join(', ')}`);
}
console.log(`platform-optionals: verified ${wanted.length} Linux x64 native packages`);
