import assert from 'node:assert/strict';
import test from 'node:test';

import { validateMobileDeliveryRef } from './validate-mobile-delivery-ref.mjs';

test('main is allowed and is not a tag', () => {
  assert.deepEqual(validateMobileDeliveryRef('refs/heads/main', '1.0.1'), {
    sourceRef: 'refs/heads/main',
    appVersion: '1.0.1',
    isTag: false,
    isRc: false,
    tagVersion: null,
    rcNumber: null,
  });
});

for (const [ref, version, isRc] of [
  ['refs/tags/mobile-v1.0.1', '1.0.1', false],
  ['refs/tags/mobile-v1.0.1-rc.2', '1.0.1', true],
  ['refs/tags/mobile-v2.10.4-rc.27', '2.10.4', true],
]) {
  test(`${ref} is accepted`, () => {
    const result = validateMobileDeliveryRef(ref, version);
    assert.equal(result.isTag, true);
    assert.equal(result.isRc, isRc);
    assert.equal(result.tagVersion, version);
  });
}

for (const ref of [
  'refs/tags/mobile-v1.0',
  'refs/tags/mobile-v1.0.bad',
  'refs/tags/mobile-v1.0.1-beta',
  'refs/tags/mobile-v1.0.1-rc',
  'refs/tags/mobile-v1.0.1-rc.foo',
  'refs/tags/mobile-v1.0.1-extra',
  'refs/tags/mobile-vfoo',
]) {
  test(`${ref} is rejected as INVALID_MOBILE_TAG`, () => {
    assert.throws(
      () => validateMobileDeliveryRef(ref, '1.0.1'),
      /INVALID_MOBILE_TAG/,
    );
  });
}

test('valid tag with mismatched app.json version is rejected', () => {
  assert.throws(
    () => validateMobileDeliveryRef('refs/tags/mobile-v1.0.2', '1.0.1'),
    /TAG_APP_VERSION_MISMATCH/,
  );
});

test('RC base version must match app.json version', () => {
  assert.throws(
    () => validateMobileDeliveryRef('refs/tags/mobile-v1.0.1-rc.2', '1.0.2'),
    /TAG_APP_VERSION_MISMATCH/,
  );
});

test('app version must be strict X.Y.Z', () => {
  assert.throws(
    () => validateMobileDeliveryRef('refs/heads/main', '1.0'),
    /INVALID_APP_VERSION/,
  );
});
