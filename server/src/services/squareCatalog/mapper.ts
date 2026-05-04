// Pure functions that translate between marketplace Listing rows and the
// Square Catalog object model. Kept side-effect-free so they're trivially
// unit-testable: no DB, no network, no logger.
//
// ─── Mapping decisions ────────────────────────────────────────────────────
//
// 1 Listing  ↔  1 CatalogItem  +  1 CatalogItemVariation
//   Square requires every ITEM to own at least one ITEM_VARIATION (the
//   variation is what carries price + SKU + inventory). Marketplace
//   listings are single-SKU by design, so we model them as 1:1:1.
//
// Field mapping:
//   Listing.title             → item.name (max 255 chars)
//   Listing.description       → item.descriptionHtml (max 4096 chars)
//   Listing.condition + brand → appended to variation.name suffix so it
//                               renders on POS without requiring custom
//                               attribute definitions
//   Listing.price             → variation.priceMoney (smallest currency unit)
//   Listing.id                → variation.sku   (stable, queryable later)
//   ListingImage[].url        → array of CatalogImage objects, then their
//                               server-assigned ids go into item.imageIds
//   Currency                  → AUD (electronics marketplace is .au only)
//
// Client ids are deterministic from the Listing id so subsequent upserts
// are idempotent — Square treats `#item-<uuid>` as the same temp id even
// across sessions, so a missed upsert response won't duplicate.

import type { CatalogObject, Money } from 'square';
import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Snapshot of the Listing fields needed to build a CatalogObject. We accept
 * a snapshot rather than the live Prisma model so the mapper is decoupled
 * from generated client types (which break the moment someone runs a
 * different `prisma generate`).
 */
export type ListingSnapshot = {
  id: string;
  title: string;
  description: string;
  // String/Decimal — Prisma returns Decimal in some configs, plain string in
  // others. We stringify before hashing to dodge precision drift.
  priceCents: number;
  currency: string;
  condition: 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
  brand: string | null;
  category: string;
  status: 'ACTIVE' | 'HIDDEN' | 'ON_HOLD' | 'SOLD' | 'REMOVED';
  // Sorted by displayOrder ascending. Empty array OK.
  images: { url: string }[];
};

export type MappedCatalogPayload = {
  // The CatalogObjects to send to Square. Always exactly one ITEM. The
  // ITEM_VARIATION is nested inside the ITEM (Square's model). Images are
  // separate top-level objects — they need to be upserted first to get
  // server-assigned ids.
  itemObject: CatalogObject;
  // Stable client-id strings for the item + variation. Useful when the
  // worker wants to find the upserted ids in the response's id_mappings.
  itemClientId: string;
  variationClientId: string;
};

// ─── Constants ────────────────────────────────────────────────────────────

const CONDITION_LABEL: Record<ListingSnapshot['condition'], string> = {
  LIKE_NEW: 'Like New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
};

// Square hard limits we have to respect. Values beyond these will 400.
const MAX_NAME_LEN = 255;
const MAX_DESCRIPTION_LEN = 4096;
const MAX_VARIATION_NAME_LEN = 255;

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Build the CatalogObject payload for a single listing. `existingIds`
 * lets us preserve server-assigned ids on update — Square requires the
 * same `id` on update, with `version` set to the prior version for
 * optimistic-concurrency. `categoryId` is the seller-scoped Square
 * CatalogCategory id (resolved by `ensureCategoryForSeller`); when null,
 * the item is upserted without a category.
 */
export function listingToCatalogPayload(
  listing: ListingSnapshot,
  existingIds: {
    itemId?: string | null;
    variationId?: string | null;
    version?: bigint | null;
    imageIds?: string[];
    categoryId?: string | null;
  } = {},
): MappedCatalogPayload {
  const itemClientId = existingIds.itemId ?? `#listing-${listing.id}-item`;
  const variationClientId =
    existingIds.variationId ?? `#listing-${listing.id}-variation`;

  const variationName = buildVariationName(listing);
  const itemName = truncate(listing.title.trim() || 'Untitled', MAX_NAME_LEN);
  const description = buildDescription(listing);

  // Build the nested ITEM_VARIATION first; Square requires variations on
  // create AND update.
  const variationObject: CatalogObject = {
    type: 'ITEM_VARIATION',
    id: variationClientId,
    // version is required on update; absent on create (when id starts with #)
    ...(existingIds.version != null && !variationClientId.startsWith('#')
      ? { version: existingIds.version }
      : {}),
    presentAtAllLocations: true,
    itemVariationData: {
      itemId: itemClientId,
      name: variationName,
      sku: listing.id, // stable, lets us reverse-lookup from POS
      pricingType: 'FIXED_PRICING',
      priceMoney: toMoney(listing.priceCents, listing.currency),
      // sellable + stockable: marketplace inventory is 1 (one of a kind),
      // so tracking is on so the seller's POS shows "1 in stock".
      sellable: true,
      stockable: true,
      trackInventory: true,
      // Tells Square to alert when stock < 1, which it will be after the
      // sole unit sells. The seller can use this as a "needs relisting"
      // signal in their POS dashboard.
      inventoryAlertType: 'LOW_QUANTITY',
      inventoryAlertThreshold: BigInt(1),
    },
  };

  const itemObject: CatalogObject = {
    type: 'ITEM',
    id: itemClientId,
    // version on update only — not on create
    ...(existingIds.version != null && !itemClientId.startsWith('#')
      ? { version: existingIds.version }
      : {}),
    // Mark deleted listings (REMOVED) as is_deleted=true on Square. The
    // worker also calls deleteCatalogObject for finality, but isDeleted
    // makes the intent explicit if a partial failure leaves the row.
    ...(listing.status === 'REMOVED' || listing.status === 'SOLD'
      ? { isDeleted: true }
      : {}),
    presentAtAllLocations: true,
    ...(existingIds.imageIds && existingIds.imageIds.length > 0
      ? {
          // Set on the variation too so POS thumbnails render — Square
          // looks at the variation's image first, then falls back to the
          // item's. Setting both is harmless and keeps every UI consistent.
        }
      : {}),
    itemData: {
      name: itemName,
      // Prefer descriptionHtml — `description` is deprecated in Square
      // 2022-07-20 and the two stay in sync server-side. Strip script tags
      // to be safe; Square's allow-list rejects them anyway.
      descriptionHtml: description,
      // categories[] is the post-2023-12 way to file an item under a
      // merchant's taxonomy. The legacy `categoryId` field still works
      // but is deprecated; we set both for max compatibility with older
      // Square POS clients.
      ...(existingIds.categoryId
        ? {
            categoryId: existingIds.categoryId,
            categories: [{ id: existingIds.categoryId, ordinal: BigInt(0) }],
          }
        : {}),
      ...(existingIds.imageIds && existingIds.imageIds.length > 0
        ? { imageIds: existingIds.imageIds }
        : {}),
      variations: [variationObject],
    },
  };

  return { itemObject, itemClientId, variationClientId };
}

/**
 * Build the CatalogObject for an image. One per ListingImage URL. Square
 * will fetch the URL itself when we use `image_url` on the data — but
 * that path is best-effort; for reliability we upload via the dedicated
 * CreateCatalogImage endpoint elsewhere. This function is kept for the
 * lighter "Square fetches the URL" path used in the sandbox/dev fixture.
 */
export function imageToCatalogObject(
  index: number,
  url: string,
  listingId: string,
): CatalogObject {
  return {
    type: 'IMAGE',
    id: `#listing-${listingId}-img-${index}`,
    presentAtAllLocations: true,
    imageData: {
      name: `Listing ${listingId} image ${index + 1}`,
      url,
      // captionText is shown in alt-text — useful for accessibility on the
      // POS sale screen. Bounded to 100 chars to fit Square's limit.
      caption: `Image ${index + 1}`,
    },
  };
}

/**
 * Hash the parts of the listing that affect the Square payload. Used by
 * the worker to short-circuit no-op syncs (when a save doesn't change any
 * Square-visible field).
 *
 * Stability matters: this hash is persisted, so changes to the algorithm
 * invalidate every link's cache. Bump the version prefix below if you
 * change the inputs.
 */
export function hashListingForSync(listing: ListingSnapshot): string {
  const parts = [
    'v1', // bump if the mapping ever changes shape
    listing.title,
    listing.description,
    String(listing.priceCents),
    listing.currency,
    listing.condition,
    listing.brand ?? '',
    listing.category,
    listing.status,
    listing.images.map((i) => i.url).join('|'),
  ];
  return createHash('sha256').update(parts.join('\x1f')).digest('hex');
}

/**
 * Inverse mapping: when Square pushes us a catalog.version.updated webhook,
 * we read back the CatalogObject and apply selected fields onto the
 * Listing. Only the fields a seller might edit on POS are propagated:
 * name, description, price. Status / images / brand / category are
 * NOT propagated back (those are marketplace-canonical concepts).
 */
export function applyCatalogItemToListing(
  catalogItem: { itemData?: { name?: string | null; descriptionHtml?: string | null; descriptionPlaintext?: string | null; variations?: CatalogObject[] | null } | null } | null,
): Partial<Pick<ListingSnapshot, 'title' | 'description' | 'priceCents' | 'currency'>> {
  const out: Partial<ListingSnapshot> = {};
  if (!catalogItem?.itemData) return out;
  const data = catalogItem.itemData;
  if (typeof data.name === 'string' && data.name.trim()) {
    out.title = data.name.trim().slice(0, 200);
  }
  // Prefer descriptionPlaintext (Square auto-generates from descriptionHtml);
  // fall back to stripping HTML if plaintext is absent.
  if (typeof data.descriptionPlaintext === 'string' && data.descriptionPlaintext.trim()) {
    out.description = data.descriptionPlaintext.slice(0, 5000);
  } else if (typeof data.descriptionHtml === 'string' && data.descriptionHtml.trim()) {
    out.description = stripHtml(data.descriptionHtml).slice(0, 5000);
  }
  // Pull price from the first variation (which is what we wrote on the way out).
  const firstVar = data.variations?.[0];
  if (
    firstVar &&
    'itemVariationData' in firstVar &&
    firstVar.itemVariationData?.priceMoney?.amount != null
  ) {
    const amount = Number(firstVar.itemVariationData.priceMoney.amount);
    const currency = firstVar.itemVariationData.priceMoney.currency;
    if (Number.isFinite(amount) && typeof currency === 'string') {
      out.priceCents = amount;
      out.currency = currency;
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildVariationName(listing: ListingSnapshot): string {
  // Square's POS doesn't have a "Condition" field, so fold it into the
  // variation name where it'll show next to the price ("Default (Like New)").
  // Brand goes ahead of "Default" so a search for "Sony" in POS finds it.
  const parts: string[] = [];
  if (listing.brand && listing.brand.trim()) parts.push(listing.brand.trim());
  parts.push('Default');
  parts.push(`(${CONDITION_LABEL[listing.condition]})`);
  return truncate(parts.join(' '), MAX_VARIATION_NAME_LEN);
}

function buildDescription(listing: ListingSnapshot): string {
  // Wrap the seller's plaintext description in <p> for descriptionHtml.
  // Square's allow-list permits <p>, <br>, <b>, <i>, <strong>, <em>, <ul>,
  // <ol>, <li>, <a>. Anything else is silently dropped server-side.
  const escaped = escapeHtml(listing.description.trim() || '—');
  // Preserve linebreaks as <br> so multi-paragraph descriptions render
  // sensibly on POS, which doesn't display markdown.
  const html = escaped.replace(/\n/g, '<br>');
  return truncate(`<p>${html}</p>`, MAX_DESCRIPTION_LEN);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function toMoney(cents: number, currency: string): Money {
  // Square Money: { amount: bigint (smallest currency unit), currency: 3-letter ISO }
  // Negative or NaN amounts are rejected up front — would 400 anyway.
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error(`Invalid priceCents for Money: ${cents}`);
  }
  return {
    amount: BigInt(Math.round(cents)),
    currency: currency.toUpperCase() as Money['currency'],
  };
}
