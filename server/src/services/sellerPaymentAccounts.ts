import prisma from '../lib/prisma.js';
import {
  PaymentProvider,
  SellerAccountStatus,
  SellerPaymentAccount,
} from '../generated/prisma/client.js';
import { decryptTokenOrNull, encryptTokenOrNull } from '../lib/crypto.js';

// DB helpers for seller-connected payment accounts. Centralized so the
// encryption roundtrip happens in one place — routes never see the raw DB
// row's accessToken column.

export type DecryptedPaymentAccount = Omit<
  SellerPaymentAccount,
  'accessToken' | 'refreshToken'
> & {
  accessToken: string | null;
  refreshToken: string | null;
};

function decrypt(row: SellerPaymentAccount): DecryptedPaymentAccount {
  return {
    ...row,
    accessToken: decryptTokenOrNull(row.accessToken),
    refreshToken: decryptTokenOrNull(row.refreshToken),
  };
}

export async function findAccount(
  userId: string,
  provider: PaymentProvider,
): Promise<DecryptedPaymentAccount | null> {
  const row = await prisma.sellerPaymentAccount.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  return row ? decrypt(row) : null;
}

export async function listAccounts(
  userId: string,
): Promise<DecryptedPaymentAccount[]> {
  const rows = await prisma.sellerPaymentAccount.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(decrypt);
}

// "Public" shape safe to send to the client — omits the raw tokens entirely
// since the frontend never needs them. Keeps the wire payload small too.
export type PublicSellerPaymentAccount = {
  provider: PaymentProvider;
  status: SellerAccountStatus;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  locationId: string | null;
  onboardedAt: Date | null;
  lastSyncedAt: Date | null;
};

export function toPublic(
  account: DecryptedPaymentAccount | SellerPaymentAccount,
): PublicSellerPaymentAccount {
  return {
    provider: account.provider,
    status: account.status,
    accountId: account.accountId,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    locationId: account.locationId,
    onboardedAt: account.onboardedAt,
    lastSyncedAt: account.lastSyncedAt,
  };
}

// "Seller is able to accept this provider right now." Gates UI + payment
// endpoint. RESTRICTED / DISCONNECTED / PENDING all fail-closed — only
// ACTIVE with charges enabled counts.
export function canAcceptPayments(
  account: DecryptedPaymentAccount | SellerPaymentAccount | null,
): boolean {
  if (!account) return false;
  if (account.status !== 'ACTIVE') return false;
  return account.chargesEnabled;
}

export type UpsertInput = {
  userId: string;
  provider: PaymentProvider;
  accountId: string;
  status?: SellerAccountStatus;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scope?: string | null;
  locationId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  onboardedAt?: Date | null;
};

// Insert-or-update by (userId, provider). Used at three points:
//   1. First Connect click — status=PENDING, accountId only
//   2. Return from provider — fill in tokens + flip to ACTIVE if enabled
//   3. Status sync (webhook or manual refresh) — update chargesEnabled etc.
// Each caller passes only the fields it knows; undefined ⇒ keep existing.
export async function upsertAccount(
  input: UpsertInput,
): Promise<DecryptedPaymentAccount> {
  const {
    userId,
    provider,
    accountId,
    status,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    scope,
    locationId,
    chargesEnabled,
    payoutsEnabled,
    onboardedAt,
  } = input;

  const now = new Date();

  // Encrypt only if explicitly provided — undefined means "don't change".
  // Null means "clear it" (used on disconnect).
  const encryptedAccess =
    accessToken === undefined ? undefined : encryptTokenOrNull(accessToken);
  const encryptedRefresh =
    refreshToken === undefined ? undefined : encryptTokenOrNull(refreshToken);

  const row = await prisma.sellerPaymentAccount.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      provider,
      accountId,
      status: status ?? 'PENDING',
      accessToken: encryptedAccess ?? null,
      refreshToken: encryptedRefresh ?? null,
      tokenExpiresAt: tokenExpiresAt ?? null,
      scope: scope ?? null,
      locationId: locationId ?? null,
      chargesEnabled: chargesEnabled ?? false,
      payoutsEnabled: payoutsEnabled ?? false,
      onboardedAt: onboardedAt ?? null,
      lastSyncedAt: now,
    },
    update: {
      accountId,
      ...(status !== undefined ? { status } : {}),
      ...(encryptedAccess !== undefined ? { accessToken: encryptedAccess } : {}),
      ...(encryptedRefresh !== undefined ? { refreshToken: encryptedRefresh } : {}),
      ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
      ...(chargesEnabled !== undefined ? { chargesEnabled } : {}),
      ...(payoutsEnabled !== undefined ? { payoutsEnabled } : {}),
      ...(onboardedAt !== undefined ? { onboardedAt } : {}),
      lastSyncedAt: now,
    },
  });
  return decrypt(row);
}

export async function markDisconnected(
  userId: string,
  provider: PaymentProvider,
): Promise<void> {
  await prisma.sellerPaymentAccount.updateMany({
    where: { userId, provider },
    data: {
      status: 'DISCONNECTED',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      lastSyncedAt: new Date(),
    },
  });
}
