/** Static file serving with containment, Range, HEAD, 304 and cache rules (§9.13). */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config.ts';
import { mimeFor } from '../utils/mime.ts';
import { parseRange } from '../utils/range.ts';
import { applySecurityHeaders } from '../utils/security.ts';

const IMMUTABLE_1Y = 'public, max-age=31536000, immutable';
const CACHE_30D = 'public, max-age=2592000';
const NO_CACHE = 'no-cache';

function cacheControlFor(urlPath: string): string {
  if (urlPath.endsWith('.html') || urlPath === '/') return NO_CACHE;
  if (urlPath.startsWith('/fonts/') || urlPath.startsWith('/assets/icons/3d/')) return IMMUTABLE_1Y;
  if (urlPath.startsWith('/assets/hero-background') || urlPath.startsWith('/assets/hero-poster'))
    return CACHE_30D;
  return NO_CACHE;
}

export function serveStatic(cfg: Config) {
  const publicDir = path.resolve(cfg.publicDir);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      applySecurityHeaders(res, cfg);
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    // Reject encoded traversal at the raw-URL level before anything decodes it.
    if (/%2e%2e/i.test(req.url) || /%2f/i.test(req.url)) {
      applySecurityHeaders(res, cfg);
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    let rel: string;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      applySecurityHeaders(res, cfg);
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    if (rel === '/') rel = '/index.html';

    // Reject dotfiles and normalise; then enforce containment with a sep-aware check.
    if (rel.split('/').some((seg) => seg.startsWith('.'))) {
      applySecurityHeaders(res, cfg);
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const full = path.join(publicDir, path.normalize(rel));
    if (full !== publicDir && !full.startsWith(publicDir + path.sep)) {
      applySecurityHeaders(res, cfg);
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    let st;
    try {
      st = await stat(full);
    } catch {
      return next();
    }
    if (!st.isFile()) return next();

    const size = st.size;
    const etag = `W/"${st.mtimeMs.toString(16)}-${size.toString(16)}"`;

    applySecurityHeaders(res, cfg);
    res.setHeader('Content-Type', mimeFor(full));
    res.setHeader('Cache-Control', cacheControlFor(req.path));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const r = parseRange(rangeHeader, size);
      if (r.ok === false && r.reason === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.status(416).end();
        return;
      }
      if (r.ok) {
        const len = r.end - r.start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${size}`);
        res.setHeader('Content-Length', len);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = createReadStream(full, { start: r.start, end: r.end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
      // invalid range falls through to a full 200 response
    }

    res.setHeader('Content-Length', size);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(full);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };
}
