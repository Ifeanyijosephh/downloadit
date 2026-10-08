/** Security headers applied to every response, static/206/HEAD/304 included (§9.12). */

export interface HeaderSink {
  setHeader: (name: string, value: string | number | readonly string[]) => unknown;
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://*.ytimg.net https://i.imgur.com https://cdn.simpleicons.org https://api.iconify.design",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** One helper builds headers for every response path (§13: the previous build missed static files). */
export function applySecurityHeaders(res: HeaderSink, opts: { trustProxy?: boolean } = {}): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (opts.trustProxy) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}
