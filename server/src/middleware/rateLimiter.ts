import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Options } from 'express-rate-limit';
import type { Request } from 'express';

// Per-user key when authenticated, IPv6-safe IP key otherwise. The library's
// default keys everyone on `req.ip` — behind a NAT or shared proxy that lets
// one abusive user burn the bucket for every colocated user. Keying on
// `req.userId` first isolates authenticated requests per account.
function userOrIpKey(req: Request): string {
  if (req.userId) return `u:${req.userId}`;
  return ipKeyGenerator(req.ip ?? '');
}

export function createRateLimiter(opts: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    ...opts,
  });
}
