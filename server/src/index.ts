/** TypeScript bootstrap / re-export hub. The runtime entry is the root server.js. */
import { createServer as httpCreateServer, type Server } from 'node:http';
import { loadConfig, type Config } from './config.ts';
import { createApp } from './app.ts';

export { loadConfig } from './config.ts';
export { createApp } from './app.ts';
export { PLATFORMS, platformForHost } from './platforms.ts';
export { validateUrl, sanitizeFilename } from './utils/validate.ts';
export { createRateLimiter } from './utils/rate-limit.ts';
export { parseRange } from './utils/range.ts';
export { MIME } from './utils/mime.ts';
export { classifyResolveError } from './utils/classify.ts';
export { hasYtDlp, hasFfmpeg, engineVersion, _resetEngineCache } from './utils/engine.ts';
export { createQueue } from './queue/in-process-queue.ts';

export function createHandler(cfg: Config = loadConfig()) {
  return createApp(cfg);
}

export function createServer(cfg: Config = loadConfig()): Server {
  return httpCreateServer(createApp(cfg));
}

/** Start listening (used by `npm start` / `node server.js`). */
export function start(cfg: Config = loadConfig()): Server {
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    // eslint-disable-next-line no-console
    console.log(`DownloadIt v${cfg.appVersion} listening on http://${cfg.host}:${cfg.port}`);
  });
  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}
