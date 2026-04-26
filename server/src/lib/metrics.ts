// Centralised Prometheus registry. One process-wide `register` so every
// metric goes through the same exposition endpoint (`/metrics`). Default
// process metrics (CPU, memory, event-loop lag, GC counts) are enabled
// because they're free and answer "is the server unhappy" before any
// app-level signal does.
//
// Auth on /metrics: a shared `METRICS_AUTH_TOKEN` env var. Set it on
// Railway, configure the same value in your Prometheus scrape config's
// bearer_token. Skipped if unset (the endpoint then returns 503).
//
// Why a thin facade over prom-client instead of using prom-client directly
// from each module: one file owns the names, labels, and buckets so a
// change here is one diff, not a dozen.

import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type Histogram as HistogramType,
  type Counter as CounterType,
} from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'electromarket-api' });

// Default metrics: process_cpu_seconds_total, nodejs_eventloop_lag_seconds,
// nodejs_heap_size_total_bytes, etc. Cheap, useful, idempotent.
collectDefaultMetrics({ register: registry });

// ─── App metrics ──────────────────────────────────────────────────────────

// Square Catalog sync — these mirror the in-memory counters that lived in
// services/squareCatalog/observability.ts before the migration.
export const squareSyncTotal: CounterType<string> = new Counter({
  name: 'square_catalog_sync_total',
  help: 'Total Square Catalog sync events by kind + outcome',
  labelNames: ['kind', 'outcome'],
  registers: [registry],
});

export const squareSyncLatency: HistogramType<string> = new Histogram({
  name: 'square_catalog_sync_latency_seconds',
  help: 'Square Catalog sync attempt duration in seconds',
  labelNames: ['kind', 'action'],
  // Wide buckets — catalog upserts can be sub-second when only a name
  // changes, multi-second when 5+ images upload.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

// HTTP requests — coarse but useful as the first signal that something
// is wrong (latency spike, 5xx rate climbing).
export const httpRequestsTotal: CounterType<string> = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by method + route + status class',
  labelNames: ['method', 'route', 'status_class'],
  registers: [registry],
});

export const httpRequestLatency: HistogramType<string> = new Histogram({
  name: 'http_request_latency_seconds',
  help: 'HTTP request duration in seconds, by method + route',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// Background queue — useful for "is BullMQ keeping up."
export const queueJobsTotal: CounterType<string> = new Counter({
  name: 'queue_jobs_total',
  help: 'Total BullMQ jobs by queue + name + outcome',
  labelNames: ['queue', 'name', 'outcome'],
  registers: [registry],
});
