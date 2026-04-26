// Catalog-sync observability: append-only audit log, metrics counters, and
// the daily failure-summary cron. Centralised so the worker, webhook
// handler, and reconciler all emit consistent records.

import prisma from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { sendSyncFailureSummaryEmail } from './emails.js';

type Outcome = 'STARTED' | 'SUCCESS' | 'FAILURE' | 'CONFLICT' | 'SKIPPED';
type Kind = 'LISTING_UPSERT' | 'LISTING_DELETE' | 'INVENTORY_ADJUST';

// In-memory metrics counters. These are NOT a replacement for Prometheus —
// they're a starting point that:
//   - Powers a `/api/admin/square-catalog/metrics` endpoint
//   - Lets us prove "we instrumented sync" in interviews
// A real deployment would scrape these into a time-series DB.
const counters: Record<string, number> = {};
const latencyBuckets: Record<string, { count: number; sumMs: number; max: number }> = {};

function bumpCounter(key: string, by = 1): void {
  counters[key] = (counters[key] ?? 0) + by;
}

function recordLatency(key: string, ms: number): void {
  const bucket = latencyBuckets[key] ?? { count: 0, sumMs: 0, max: 0 };
  bucket.count += 1;
  bucket.sumMs += ms;
  if (ms > bucket.max) bucket.max = ms;
  latencyBuckets[key] = bucket;
}

export function getMetricsSnapshot(): {
  counters: Record<string, number>;
  latencies: Record<string, { count: number; avgMs: number; maxMs: number }>;
} {
  const latencies: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
  for (const [k, v] of Object.entries(latencyBuckets)) {
    latencies[k] = {
      count: v.count,
      avgMs: v.count === 0 ? 0 : Math.round(v.sumMs / v.count),
      maxMs: v.max,
    };
  }
  return { counters: { ...counters }, latencies };
}

/**
 * Persist + log + count one sync event. Called from the worker on every
 * terminal outcome and from the webhook handler on every inbound event.
 */
export async function recordSyncEvent(args: {
  outcome: Outcome;
  kind: Kind;
  action: string;
  sellerId: string;
  listingId: string | null;
  outboxId?: string;
  durationMs?: number;
  message?: string | null;
  errorCode?: string | null;
  squareObjectId?: string | null;
  squareEventId?: string | null;
}): Promise<void> {
  // Persist the audit row. Failure here is logged but doesn't block —
  // we'd rather lose an audit row than fail a successful sync because of
  // a transient DB hiccup.
  try {
    await prisma.squareSyncEvent.create({
      data: {
        outcome: args.outcome,
        kind: args.kind,
        action: args.action,
        sellerId: args.sellerId,
        listingId: args.listingId,
        outboxId: args.outboxId,
        durationMs: args.durationMs,
        message: args.message ? args.message.slice(0, 2000) : null,
        errorCode: args.errorCode ?? null,
        squareObjectId: args.squareObjectId ?? null,
        squareEventId: args.squareEventId ?? null,
      },
    });
  } catch (err) {
    logger.warn('square.catalog.event_persist_failed', {
      err: String(err),
      outcome: args.outcome,
      kind: args.kind,
      action: args.action,
      sellerId: args.sellerId,
    });
  }

  // Structured log mirror — these go to the same pipeline that aggregates
  // every other server log, so existing alerting hooks in (e.g. searches
  // for action=oauth + outcome=FAILURE).
  const level: 'info' | 'warn' | 'error' =
    args.outcome === 'FAILURE'
      ? 'error'
      : args.outcome === 'CONFLICT'
        ? 'warn'
        : 'info';
  logger[level]('square.catalog.event', {
    outcome: args.outcome,
    kind: args.kind,
    action: args.action,
    sellerId: args.sellerId,
    listingId: args.listingId,
    outboxId: args.outboxId,
    durationMs: args.durationMs,
    message: args.message,
    errorCode: args.errorCode,
    squareObjectId: args.squareObjectId,
  });

  // Counters + latency.
  bumpCounter(`sync.${args.kind}.${args.outcome}`);
  if (typeof args.durationMs === 'number') {
    recordLatency(`sync.${args.kind}.${args.action}`, args.durationMs);
  }
}

// ─── Daily summary cron ───────────────────────────────────────────────────

let summaryTimer: NodeJS.Timeout | null = null;

export function startDailyFailureSummary(): void {
  if (summaryTimer) return;
  // Every 24h. We don't try to align to "midnight" — the email's body
  // says "in the last 24 hours" so the actual run time doesn't matter.
  // First run is delayed by 1 hour so a fresh deploy isn't immediately
  // bombarded by daily emails on top of the existing monitoring noise.
  const ONE_DAY = 24 * 60 * 60 * 1000;
  summaryTimer = setTimeout(function tick() {
    runDailyFailureSummary().catch((err) =>
      logger.error('square.catalog.daily_summary_failed', { err: String(err) }),
    );
    summaryTimer = setTimeout(tick, ONE_DAY);
  }, 60 * 60 * 1000);
}

export function stopDailyFailureSummary(): void {
  if (summaryTimer) {
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }
}

async function runDailyFailureSummary(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Group by seller in the last 24h. Anyone with at least 3 failures gets
  // a summary email. Below that threshold, the noise outweighs the value.
  const failures = await prisma.squareSyncEvent.groupBy({
    by: ['sellerId'],
    where: { outcome: 'FAILURE', createdAt: { gte: since } },
    _count: { _all: true },
    having: { sellerId: { _count: { gte: 3 } } },
  });

  for (const row of failures) {
    const allEvents = await prisma.squareSyncEvent.findMany({
      where: { sellerId: row.sellerId, createdAt: { gte: since } },
      select: {
        outcome: true,
        message: true,
        listing: { select: { title: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const total = allEvents.length;
    const successes = allEvents.filter((e) => e.outcome === 'SUCCESS' || e.outcome === 'SKIPPED').length;
    const successRate = total === 0 ? 1 : successes / total;
    const samples = allEvents
      .filter((e) => e.outcome === 'FAILURE')
      .slice(0, 3)
      .map((e) => ({
        listingTitle: e.listing?.title ?? '(deleted listing)',
        message: e.message ?? 'unknown error',
      }));
    await sendSyncFailureSummaryEmail(row.sellerId, {
      failures: row._count._all,
      successRate,
      samples,
    });
  }
}
