import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const vendorPath = path.join(root, 'vendor/decode-uri-component/index.cjs');

test('security-patched decoder is installed from the owned CommonJS source', () => {
  const resolved = require.resolve('decode-uri-component');
  assert.equal(fs.realpathSync(resolved), fs.realpathSync(vendorPath));
  assert.equal(
    createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'),
    createHash('sha256').update(fs.readFileSync(vendorPath)).digest('hex'),
  );
  assert.equal(require('decode-uri-component/package.json').version, '0.5.1');
  assert.equal(typeof require('decode-uri-component'), 'function');
});

test('query-string 7 CommonJS parse and stringify remain compatible', () => {
  const queryString = require('query-string');
  assert.equal(typeof queryString.parse, 'function');
  assert.equal(typeof queryString.stringify, 'function');
  assert.equal(queryString.stringify({name: 'hello world', q: 'a+b'}), 'name=hello%20world&q=a%2Bb');
  const parsed = queryString.parse('name=hello%20world&q=a%2Bb');
  assert.equal(parsed.name, 'hello world');
  assert.equal(parsed.q, 'a+b');
  assert.equal(require('decode-uri-component')('%FE%FF'), '\uFFFD\uFFFD');
});

test('malformed high-cardinality percent runs do not cause quadratic CPU denial of service', () => {
  let payload = '';
  for (let i = 0; i < 32000; i++) {
    const high = Math.floor(i / 256).toString(16).padStart(2, '0');
    const low = (i % 256).toString(16).padStart(2, '0');
    payload += `%${high}%${low}x`;
  }
  payload += '%zz';
  const start = performance.now();
  const decoded = require('decode-uri-component')(payload);
  const elapsed = performance.now() - start;
  assert.ok(decoded.endsWith('%zz'));
  assert.ok(elapsed < 5000, `decoder took ${Math.round(elapsed)}ms for the advisory regression payload`);
});
