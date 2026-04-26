// Pure-function tests for the catalog mapper. No DB, no network — just
// listingSnapshot → CatalogObject and back. Run with `npm test`.
//
// Why node:test instead of jest/vitest:
//   - Zero config, no devDep to add to a stable package.json
//   - tsx handles the TS source via --import tsx
//   - The mapper is the only piece worth unit-testing in isolation; every
//     other module is integration-shaped (DB, network) and would need
//     heavyweight harness either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCatalogItemToListing,
  hashListingForSync,
  listingToCatalogPayload,
  type ListingSnapshot,
} from './mapper.js';

function fixture(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Sony WH-1000XM5 Headphones',
    description: 'Lightly used. Excellent noise-cancelling.',
    priceCents: 39900,
    currency: 'AUD',
    condition: 'LIKE_NEW',
    brand: 'Sony',
    category: 'Audio',
    status: 'ACTIVE',
    images: [
      { url: 'https://example.com/a.jpg' },
      { url: 'https://example.com/b.jpg' },
    ],
    ...overrides,
  };
}

test('listingToCatalogPayload: creates ITEM with nested ITEM_VARIATION', () => {
  const { itemObject, itemClientId, variationClientId } = listingToCatalogPayload(fixture());
  assert.equal(itemObject.type, 'ITEM');
  assert.ok(itemClientId.startsWith('#listing-'));
  assert.ok(variationClientId.startsWith('#listing-'));

  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.equal(item.itemData?.name, 'Sony WH-1000XM5 Headphones');
  assert.match(item.itemData?.descriptionHtml ?? '', /<p>/);
  assert.equal(item.itemData?.variations?.length, 1);

  const variation = item.itemData?.variations?.[0];
  assert.equal(variation?.type, 'ITEM_VARIATION');
  if (variation && 'itemVariationData' in variation) {
    assert.equal(variation.itemVariationData?.priceMoney?.amount, 39900n);
    assert.equal(variation.itemVariationData?.priceMoney?.currency, 'AUD');
    assert.equal(variation.itemVariationData?.sku, fixture().id);
    assert.match(variation.itemVariationData?.name ?? '', /Sony.*Like New/);
  }
});

test('listingToCatalogPayload: marks REMOVED listings as is_deleted', () => {
  const { itemObject } = listingToCatalogPayload(
    fixture({ status: 'REMOVED' }),
  );
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.equal(item.isDeleted, true);
});

test('listingToCatalogPayload: marks SOLD listings as is_deleted', () => {
  const { itemObject } = listingToCatalogPayload(
    fixture({ status: 'SOLD' }),
  );
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.equal(item.isDeleted, true);
});

test('listingToCatalogPayload: ACTIVE listings are NOT marked is_deleted', () => {
  const { itemObject } = listingToCatalogPayload(fixture({ status: 'ACTIVE' }));
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.notEqual(item.isDeleted, true);
});

test('listingToCatalogPayload: existing ids/version round-trip', () => {
  const { itemObject } = listingToCatalogPayload(fixture(), {
    itemId: 'L_SERVER_ITEM_ID',
    variationId: 'L_SERVER_VAR_ID',
    version: 42n,
  });
  assert.equal(itemObject.id, 'L_SERVER_ITEM_ID');
  // Version is sent on update only (id doesn't start with #).
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.equal(item.version, 42n);
});

test('listingToCatalogPayload: rejects negative price', () => {
  assert.throws(
    () => listingToCatalogPayload(fixture({ priceCents: -1 })),
    /Invalid priceCents/,
  );
});

test('listingToCatalogPayload: handles zero price (free)', () => {
  const { itemObject } = listingToCatalogPayload(fixture({ priceCents: 0 }));
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  const variation = item.itemData?.variations?.[0];
  if (variation && 'itemVariationData' in variation) {
    assert.equal(variation.itemVariationData?.priceMoney?.amount, 0n);
  }
});

test('listingToCatalogPayload: HTML-escapes the seller description', () => {
  const { itemObject } = listingToCatalogPayload(
    fixture({ description: 'Cool <script>alert(1)</script> headphones' }),
  );
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  const html = item.itemData?.descriptionHtml ?? '';
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
});

test('listingToCatalogPayload: truncates long titles', () => {
  const longTitle = 'a'.repeat(500);
  const { itemObject } = listingToCatalogPayload(fixture({ title: longTitle }));
  const item = itemObject as Extract<typeof itemObject, { type: 'ITEM' }>;
  assert.ok((item.itemData?.name?.length ?? 0) <= 255);
});

test('hashListingForSync: deterministic for same input', () => {
  const a = hashListingForSync(fixture());
  const b = hashListingForSync(fixture());
  assert.equal(a, b);
  assert.equal(a.length, 64); // sha256 hex
});

test('hashListingForSync: changes when title changes', () => {
  const a = hashListingForSync(fixture());
  const b = hashListingForSync(fixture({ title: 'different' }));
  assert.notEqual(a, b);
});

test('hashListingForSync: changes when price changes', () => {
  const a = hashListingForSync(fixture());
  const b = hashListingForSync(fixture({ priceCents: 9900 }));
  assert.notEqual(a, b);
});

test('hashListingForSync: changes when image order changes', () => {
  const a = hashListingForSync(fixture());
  const b = hashListingForSync(
    fixture({
      images: [
        { url: 'https://example.com/b.jpg' },
        { url: 'https://example.com/a.jpg' },
      ],
    }),
  );
  assert.notEqual(a, b);
});

test('applyCatalogItemToListing: extracts name + price from inbound item', () => {
  const updates = applyCatalogItemToListing({
    itemData: {
      name: 'Updated by POS',
      descriptionPlaintext: 'New description from POS edit.',
      variations: [
        {
          type: 'ITEM_VARIATION',
          id: 'V1',
          itemVariationData: {
            priceMoney: { amount: 49900n, currency: 'AUD' },
          },
        },
      ],
    },
  });
  assert.equal(updates.title, 'Updated by POS');
  assert.equal(updates.description, 'New description from POS edit.');
  assert.equal(updates.priceCents, 49900);
  assert.equal(updates.currency, 'AUD');
});

test('applyCatalogItemToListing: empty item returns empty updates', () => {
  assert.deepEqual(applyCatalogItemToListing(null), {});
  assert.deepEqual(applyCatalogItemToListing({}), {});
});

test('applyCatalogItemToListing: falls back from html to plaintext', () => {
  const updates = applyCatalogItemToListing({
    itemData: {
      descriptionHtml: '<p>From <b>HTML</b></p>',
    },
  });
  assert.equal(updates.description, 'From HTML');
});
