/** POST /api/resolve (§9). */
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { validateUrl, sanitizeFilename } from '../utils/validate.ts';
import { clip } from '../utils/clip.ts';
import { classifyResolveError } from '../utils/classify.ts';
import { execResolve, hasYtDlp, hasFfmpeg } from '../utils/engine.ts';
import { clientIp } from '../utils/ip.ts';
import type { RateLimiter } from '../utils/rate-limit.ts';

const Body = z.object({ url: z.string() });

export function resolveController(cfg: Config, limiter: RateLimiter) {
  return async (req: Request, res: Response): Promise<void> => {
    const decision = limiter.hit(clientIp(req, cfg));
    if (!decision.allowed) {
      res.setHeader('Retry-After', decision.retryAfterSeconds);
      res.status(429).json({ code: 'RATE_LIMITED', hint: 'Too many requests. Slow down and retry.' });
      return;
    }

    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_URL', hint: 'Provide a "url" string.' });
      return;
    }

    const check = validateUrl(parsed.data.url);
    if (!check.ok) {
      // §10: a non-allowlisted host must answer 400 INVALID_URL, never 500.
      res.status(400).json({ code: 'INVALID_URL', hint: check.message });
      return;
    }

    if (!hasYtDlp(cfg)) {
      res.status(503).json({
        code: 'ENGINE_UNAVAILABLE',
        hint: 'The download engine is not installed on this server.',
      });
      return;
    }

    try {
      const meta = await execResolve(cfg, check.url);
      const width = Number(meta.width) || Number((meta as { resolution?: string }).resolution?.split('x')[0]) || 0;
      const height = Number(meta.height) || 0;
      res.json({
        title: clip(meta.title, 200) || 'Untitled video',
        author: clip(meta.uploader ?? meta.author ?? meta.channel, 120),
        duration: Number(meta.duration) || 0,
        width,
        height,
        thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
        platform: check.platform,
        filename: sanitizeFilename(meta.title),
        formats: hasFfmpeg(cfg) ? ['mp4', 'mp3'] : ['mp4'],
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; engineUnavailable?: boolean };
      if (e.engineUnavailable) {
        res.status(503).json({ code: 'ENGINE_UNAVAILABLE', hint: 'The download engine is not available.' });
        return;
      }
      if (e.code === 'ERR_BUFFER_OUT_OF_BOUNDS') {
        res.status(504).json({ code: 'METADATA_TOO_LARGE', hint: 'The video metadata is too large.' });
        return;
      }
      const c = classifyResolveError(e.stderr || e.message || '');
      res.status(c.http).json({ code: c.code, hint: c.hint });
    }
  };
}
