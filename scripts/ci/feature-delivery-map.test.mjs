import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDeliveryMap, classifyChanged, DELIVERY_DOMAINS } from './feature-delivery-map.mjs';

test('packages/api-client change propagates to mobile AFFECTED', () => {
  const map = computeDeliveryMap(['packages/api-client/src/client.ts']);
  assert.equal(map.API_CLIENT, 'CHANGED');
  assert.equal(map.MOBILE, 'AFFECTED');
  assert.equal(map.WEB, 'NO_CHANGE');
});

test('contracts change propagates to api-client and mobile', () => {
  const map = computeDeliveryMap(['packages/contracts/src/mobile.ts']);
  assert.equal(map.CONTRACTS, 'CHANGED');
  assert.equal(map.API_CLIENT, 'AFFECTED');
  assert.equal(map.MOBILE, 'AFFECTED');
});

test('domain change propagates to contracts, api-client, mobile', () => {
  const map = computeDeliveryMap(['packages/domain/src/tasks/due-date.ts']);
  assert.equal(map.DOMAIN, 'CHANGED');
  assert.equal(map.CONTRACTS, 'AFFECTED');
  assert.equal(map.API_CLIENT, 'AFFECTED');
  assert.equal(map.MOBILE, 'AFFECTED');
});

test('web-only change does not affect mobile', () => {
  const map = computeDeliveryMap(['apps/web/src/components/layout/top-bar.tsx']);
  assert.equal(map.WEB, 'CHANGED');
  assert.equal(map.MOBILE, 'NO_CHANGE');
});

test('mobile direct change is CHANGED not AFFECTED', () => {
  const map = computeDeliveryMap(['apps/mobile/app/(app)/timer.tsx']);
  assert.equal(map.MOBILE, 'CHANGED');
});

test('empty file list yields all NO_CHANGE', () => {
  const map = computeDeliveryMap([]);
  for (const d of DELIVERY_DOMAINS) assert.equal(map[d], 'NO_CHANGE');
});

test('application change propagates to data-access, api, web and transitively to mobile via contracts/domain? no, app does not affect mobile directly', () => {
  // mobile does not consume @ega/application, so application change alone should NOT affect mobile
  const map = computeDeliveryMap(['packages/application/src/tasks/list-view.ts']);
  assert.equal(map.APPLICATION, 'CHANGED');
  assert.equal(map.MOBILE, 'NO_CHANGE');
  assert.equal(map.DATA_ACCESS, 'AFFECTED');
  assert.equal(map.API, 'AFFECTED');
  assert.equal(map.WEB, 'AFFECTED');
});

test('data-access change does not affect mobile', () => {
  const map = computeDeliveryMap(['packages/data-access/src/tasks/repository.ts']);
  assert.equal(map.DATA_ACCESS, 'CHANGED');
  assert.equal(map.MOBILE, 'NO_CHANGE');
});

test('database change does not affect mobile', () => {
  const map = computeDeliveryMap(['drizzle/0044_task_sessions_owner_open_unique.sql']);
  assert.equal(map.DATABASE, 'CHANGED');
  assert.equal(map.MOBILE, 'NO_CHANGE');
});

test('multiple domains changed simultaneously', () => {
  const map = computeDeliveryMap(['apps/web/src/app/page.tsx', 'packages/api-client/src/tasks.ts']);
  assert.equal(map.WEB, 'CHANGED');
  assert.equal(map.API_CLIENT, 'CHANGED');
  assert.equal(map.MOBILE, 'AFFECTED');
});

test('classifyChanged marks only matching domains', () => {
  const c = classifyChanged(['packages/api-client/src/index.ts', 'apps/mobile/package.json']);
  assert.equal(c.API_CLIENT, true);
  assert.equal(c.MOBILE, true);
  assert.equal(c.WEB, false);
});
