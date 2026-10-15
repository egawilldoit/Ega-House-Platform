import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const records = JSON.parse(fs.readFileSync(new URL('./security-backports.json', import.meta.url), 'utf8'));

// Registry audits use package versions, so an unchanged-version source backport
// needs affirmative installed-code proof. No missing/mismatched copy is accepted.
export function verifySecurityBackports(root = process.cwd()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const verified = new Map();
  for (const record of records) {
    assert.equal(manifest.overrides[record.name], record.resolved, `${record.name}: override drift`);
    const copies = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${record.name}`));
    assert.ok(copies.length, `${record.name}: missing locked dependency`);
    for (const [location, entry] of copies) {
      for (const key of ['version', 'resolved', 'integrity']) {
        assert.equal(entry[key], record[key], `${location}: ${key} drift`);
      }
      const installed = path.join(root, location);
      assert.equal(JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, record.version);
      for (const [file, hash] of Object.entries(record.sha256)) {
        assert.equal(createHash('sha256').update(fs.readFileSync(path.join(installed, file))).digest('hex'), hash, `${location}/${file}: unverified code`);
      }
      const require = createRequire(path.join(installed, 'package.json'));
      if (record.name === 'braces') verifyBraces(require(installed));
      else verifyForge(require(installed));
    }
    verified.set(record.source, record.name);
  }
  return verified;
}

export function verifyBraces(braces) {
  const pattern = '{'.repeat(101) + 'a' + '}'.repeat(101);
  assert.throws(() => braces.parse(pattern), /exceeds max depth/);
  for (const method of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'text', value: 'a' };
    for (let i = 0; i < 101; i++) ast = { type: 'brace', nodes: [ast] };
    assert.throws(() => braces[method]({ type: 'root', nodes: [ast] }), /exceeds max depth/);
  }
  assert.deepEqual(braces.expand('src/{app,lib}/*.ts'), ['src/app/*.ts', 'src/lib/*.ts']);
}

export function verifyForge(forge) {
  const { asn1: a } = forge;
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 65537 });
  const message = 'security-backport regression';
  const digest = forge.md.sha256.create().update(message).digest().getBytes();
  const signature = keys.privateKey.sign(forge.md.sha256.create().update(message));
  assert.equal(keys.publicKey.verify(digest, signature), true);
  for (const includeNull of [true, false]) {
    const algorithm = [a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes())];
    if (includeNull) algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.NULL, false, ''));
    const info = () => a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
      a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, algorithm),
      a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, digest),
    ]);
    // Both permitted AlgorithmIdentifier encodings must continue to verify.
    const valid = keys.privateKey.sign(a.toDer(info()).getBytes(), 'NONE');
    assert.equal(keys.publicKey.verify(digest, valid), true);
    algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'unconsumed garbage'));
    const malformed = keys.privateKey.sign(a.toDer(info()).getBytes(), 'NONE');
    assert.throws(() => keys.publicKey.verify(digest, malformed), /DigestInfo/);
  }
}
