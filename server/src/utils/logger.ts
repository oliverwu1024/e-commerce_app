// Zero-dep structured logger. JSON in production (log-aggregator friendly),
// pretty-ish in development. Avoids shipping pino until we need its features.
//
// Usage:
//   import { logger } from './utils/logger.js';
//   logger.info('user.login', { userId });
//   logger.error('stripe.webhook.bad_signature', { eventId, err: err.message });
//
// Existing `console.error` calls in route files still work — migrate them
// incrementally when touching the code.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const isProduction = process.env.NODE_ENV === 'production';

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  };

  if (isProduction) {
    // Single-line JSON so log aggregators (Datadog/Loki/CloudWatch) parse
    // each line as one event. Use `console.log` (not `process.stdout.write`)
    // because console.log's semantics are friendlier for non-TTY stdout:
    // Node auto-flushes per-call on most runtimes, which matters in
    // container logs where buffered writes can hide boot/crash signals.
    console.log(JSON.stringify(entry));
  } else {
    const prefix = `[${entry.time}] ${level.toUpperCase().padEnd(5)} ${msg}`;
    if (meta && Object.keys(meta).length > 0) {
      console.log(prefix, meta);
    } else {
      console.log(prefix);
    }
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
