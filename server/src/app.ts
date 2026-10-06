/** Express application factory (§3, §9). */
import express, { json, type Request, type Response, type NextFunction } from 'express';
import type { Config } from './config.ts';
import { applySecurityHeaders } from './utils/security.ts';
import { buildApiRouter, createDeps, type ApiDeps } from './routes/api.routes.ts';
import { serveStatic } from './routes/static.routes.ts';

export function createApp(cfg: Config, deps: ApiDeps = createDeps(cfg)): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  // Security headers on every response, whatever the outcome (§9.12, §13).
  app.use((req: Request, res: Response, next: NextFunction) => {
    applySecurityHeaders(res, cfg);
    next();
  });

  // Request logger for easy debugging: method, path, status, duration.
  // Set LOG_STATIC=1 to also log static asset requests.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isStatic = !req.path.startsWith('/api');
    if (isStatic && process.env.LOG_STATIC !== '1') return next();
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const line = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`;
      if (res.statusCode >= 500) console.error(line);
      else console.log(line);
    });
    next();
  });

  // §9.6: JSON bodies only. Wrong Content-Type -> 415 before any parsing.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ code: 'UNSUPPORTED_MEDIA', hint: 'Send Content-Type: application/json.' });
      return;
    }
    next();
  });

  app.use(
    '/api',
    json({
      limit: cfg.maxBodyBytes,
      type: 'application/json',
    }),
  );

  app.use('/api', buildApiRouter(cfg, deps));

  // Static assets under public/ (Range, HEAD, 304, cache rules).
  app.use(serveStatic(cfg));

  // Anything else is a 404.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // Central error handler: 413 / 400 / 415 / 500 with no stack trace (§9.6).
  app.use((err: Error & { type?: string; status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') {
      res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', hint: 'The request body is too large.' });
      return;
    }
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      res.status(400).json({ code: 'BAD_JSON', hint: 'The request body is not valid JSON.' });
      return;
    }
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({
      code: 'INTERNAL',
      hint: 'An internal error occurred.',
    });
  });

  return app;
}
