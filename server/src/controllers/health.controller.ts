/** GET /api/health (§9.16): cached engine info only, never a live subprocess. */
import type { Request, Response } from 'express';
import type { Config } from '../config.ts';
import { hasYtDlp, hasFfmpeg, engineVersion } from '../utils/engine.ts';

const START = Date.now();

export function healthController(cfg: Config) {
  return (req: Request, res: Response): void => {
    res.json({
      ok: true,
      engine: hasYtDlp(cfg),
      engineVersion: engineVersion(cfg),
      ffmpeg: hasFfmpeg(cfg),
      uptime: Math.round((Date.now() - START) / 1000),
      version: cfg.appVersion,
    });
  };
}
