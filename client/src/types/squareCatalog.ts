export type CatalogLinkStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';
export type CatalogSyncOutcome =
  | 'STARTED'
  | 'SUCCESS'
  | 'FAILURE'
  | 'CONFLICT'
  | 'SKIPPED';
export type CatalogSyncKind =
  | 'LISTING_UPSERT'
  | 'LISTING_DELETE'
  | 'INVENTORY_ADJUST';

export type CatalogLink = {
  listingId: string;
  status: CatalogLinkStatus;
  squareObjectId: string | null;
  // Square's `version` field arrives as a string when serialised over JSON
  // (BigInt is not JSON-safe). Treat as opaque on the client.
  version: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type CatalogSyncEvent = {
  id: string;
  outcome: CatalogSyncOutcome;
  kind: CatalogSyncKind;
  action: string;
  message: string | null;
  listingId: string | null;
  createdAt: string;
  durationMs: number | null;
};

export type CatalogSyncSummary = {
  total: number;
  synced: number;
  pending: number;
  error: number;
};

export type CatalogSyncStatusResponse = {
  enabled: boolean;
  enabledAt: string | null;
  squareConnected: boolean;
  summary: CatalogSyncSummary;
  links: CatalogLink[];
  recentEvents: CatalogSyncEvent[];
};

export type FeaturedItem = {
  id: string;
  squareObjectId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
  rank: number;
};
