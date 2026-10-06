/** Client IP for rate limiting. X-Forwarded-For only when TRUST_PROXY=1 (§9.11). */
import type { Request } from 'express';
import type { Config } from '../config.ts';

export function clientIp(req: Request, cfg: Config): string {
  if (cfg.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) {
      return (fwd.split(',')[0] ?? '').trim() || 'unknown';
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}
