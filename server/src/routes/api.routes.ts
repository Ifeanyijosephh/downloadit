/** The /api surface (§9). */
import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.ts';
import { healthController } from '../controllers/health.controller.ts';
import { resolveController } from '../controllers/resolve.controller.ts';
import { downloadController } from '../controllers/download.controller.ts';
import { createRateLimiter, type RateLimiter } from '../utils/rate-limit.ts';
import { createQueue, type Queue } from '../queue/in-process-queue.ts';

export interface ApiDeps {
  resolveLimiter: RateLimiter;
  downloadLimiter: RateLimiter;
  queue: Queue;
}

export function createDeps(cfg: Config): ApiDeps {
  return {
    resolveLimiter: createRateLimiter({ limit: cfg.rateLimitResolve, windowMs: 60_000 }),
    downloadLimiter: createRateLimiter({ limit: cfg.rateLimitDownload, windowMs: 60_000 }),
    queue: createQueue(),
  };
}

export function buildApiRouter(cfg: Config, deps: ApiDeps): Router {
  const router = Router();

  router.get('/health', healthController(cfg));
  router.post('/resolve', resolveController(cfg, deps.resolveLimiter));
  router.post('/download', downloadController(cfg, deps.downloadLimiter, deps.queue));

  // Correct 405 + Allow for wrong methods on known API paths (§9).
  router.all('/health', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  });
  router.all(['/resolve', '/download'], (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  });

  return router;
}
