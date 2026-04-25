// Compute the public-display location string for a seller. Centralises the
// privacy rule so every route that surfaces a seller can't accidentally
// leak their full street address.
//
// Rule:
//   1. BUSINESS sellers who've opted in (showFullAddressPublicly=true) and
//      have all four address parts filled → "Line 1, Suburb Postcode State".
//   2. Anyone with postcode+state → "Postcode State" (e.g., "2000 NSW").
//   3. Fallback to the legacy free-form `location` field for back-compat
//      (pre-2026-04-29 sellers haven't filled in the structured fields yet).
//   4. Otherwise null.
//
// PERSONAL sellers' addresses are never public regardless of the flag —
// the rule (1) check on sellerType is the gate.

export type LocationSource = {
  sellerType: 'PERSONAL' | 'BUSINESS';
  location: string | null;
  addressLine1: string | null;
  suburb: string | null;
  postcode: string | null;
  state: string | null;
  showFullAddressPublicly: boolean;
};

export function publicLocation(u: LocationSource): string | null {
  if (
    u.sellerType === 'BUSINESS' &&
    u.showFullAddressPublicly &&
    u.addressLine1 &&
    u.suburb &&
    u.postcode &&
    u.state
  ) {
    return `${u.addressLine1}, ${u.suburb} ${u.postcode} ${u.state}`;
  }
  if (u.postcode && u.state) {
    return `${u.postcode} ${u.state}`;
  }
  return u.location ?? null;
}

// The fields a route needs to select on the User to compute publicLocation().
// Use this with Prisma's `select` to keep the projection consistent.
export const PUBLIC_LOCATION_SELECT = {
  sellerType: true,
  location: true,
  addressLine1: true,
  suburb: true,
  postcode: true,
  state: true,
  showFullAddressPublicly: true,
} as const;

// Replace the raw structured-address fields with a single derived `location`
// string. Use this on every API response that includes a seller-like object,
// so the client never sees the full street address unless explicitly allowed.
//
// Permissive return type — at runtime we strip the structured fields and
// inject `location`. The exact static type bookkeeping isn't worth the
// complexity here since the projection is the authoritative shape.
export function projectPublicSeller<T extends LocationSource>(
  seller: T,
): Record<string, unknown> {
  const {
    addressLine1: _l1,
    addressLine2: _l2,
    suburb: _su,
    postcode: _pc,
    state: _st,
    country: _co,
    showFullAddressPublicly: _show,
    location: _loc,
    ...rest
  } = seller as LocationSource & {
    addressLine2?: string | null;
    country?: string | null;
  } & Record<string, unknown>;
  return {
    ...rest,
    location: publicLocation(seller),
  };
}
