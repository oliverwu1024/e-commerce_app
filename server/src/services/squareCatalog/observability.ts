// Catalog-sync observability: append-only audit log, metrics counters, and
// the daily failure-summary cron. Centralised so the worker, webhook
// handler, and reconciler all emit consistent records.

import prisma from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { sendSyncFailureSummaryEmail } from './emails.js';
import {
  squareSyncTotal,
  squareSyncLatency,
} from '../../lib/metrics.js';

type Outcome = 'STARTED' | 'SUCCESS' | 'FAILURE' | 'CONFLICT' | 'SKIPPED';
type Kind =
  | 'LISTING_UPSERT'
  | 'LISTING_DELETE'
  | 'INVENTORY_ADJUST'
  | 'IMAGE_DELETE';

// Metrics now live in Prometheus (see `lib/metrics.ts`). The admin endpoint
// formerly returned an in-memory snapshot; keeping the function signature
// for backward compat but it now returns a static "see /metrics" pointer
// so old admin UIs don't break. Real scraping happens at /metrics with a
// Prometheus-compatible scraper.
export function getMetricsSnapshot(): {
  counters: Record<string, number>;
  latencies: Record<string, { count: number; avgMs: number; maxMs: number }>;
  note: string;
} {
  return {
    counters: {},
    latencies: {},
    note: 'Metrics moved to Prometheus. Scrape /metrics with the configured METRICS_AUTH_TOKEN.',
  };
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

  // Prometheus counters + latency histogram.
  squareSyncTotal.inc({ kind: args.kind, outcome: args.outcome });
  if (typeof args.durationMs === 'number') {
    squareSyncLatency.observe(
      { kind: args.kind, action: args.action },
      args.durationMs / 1000,
    );
  }
}

// ─── Daily summary cron ───────────────────────────────────────────────────
//
// Backed by node-cron. Runs at 09:00 UTC every day (~early-evening AU).
// Earlier this was a setTimeout chain pegged to "24h after server boot",
// which drifts on every restart and means a redeploy can either skip a
// day or fire two summaries within hours of each other. Cron fixes that.

import cron, { type ScheduledTask } from 'node-cron';

let summaryTask: ScheduledTask | null = null;

const DAILY_SUMMARY_CRON =
  process.env.SQUARE_CATALOG_SUMMARY_CRON || '0 9 * * *';

// Postgres advisory-lock keys (two int4s identifying this specific cron).
// pg_try_advisory_lock returns false if any other session already holds the
// pair, which is exactly the "only one replica fires the summary" property
// we need. Pick stable, namespaced numbers: 71_92 = ascii 'G','\\' — random
// enough to not collide with anyone else's locks.
const SUMMARY_LOCK_KEY_1 = 71;
const SUMMARY_LOCK_KEY_2 = 9201;

async function withDailySummaryLock<T>(work: () => Promise<T>): Promise<T | null> {
  // Hold the lock for the duration of the work via a transaction. If we
  // can't grab it, another replica is already running this tick — skip.
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${SUMMARY_LOCK_KEY_1}, ${SUMMARY_LOCK_KEY_2}) AS ok
    `;
    if (!rows[0]?.ok) {
      logger.info('square.catalog.daily_summary_skipped_other_replica');
      return null;
    }
    return work();
  });
}

export function startDailyFailureSummary(): void {
  if (summaryTask) return;
  if (!cron.validate(DAILY_SUMMARY_CRON)) {
    logger.error('square.catalog.daily_summary_invalid_cron', {
      cron: DAILY_SUMMARY_CRON,
    });
    return;
  }
  summaryTask = cron.schedule(
    DAILY_SUMMARY_CRON,
    () => {
      withDailySummaryLock(runDailyFailureSummary).catch((err) =>
        logger.error('square.catalog.daily_summary_failed', { err: String(err) }),
      );
    },
    { timezone: 'UTC' },
  );
  logger.info('square.catalog.daily_summary_scheduled', {
    cron: DAILY_SUMMARY_CRON,
    timezone: 'UTC',
  });
}

export function stopDailyFailureSummary(): void {
  if (summaryTask) {
    summaryTask.stop();
    summaryTask = null;
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
