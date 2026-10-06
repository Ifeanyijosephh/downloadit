/**
 * DownloadIt v2 — root entry.
 *
 * Re-exports the public API for tests and, when run directly (`node server.js`),
 * starts the HTTP server. All logic lives in server/src/*.ts (Express 4 + zod).
 * Built and powered by Ifeco Digitals.
 */
import { pathToFileURL } from 'node:url';
import { createServer as httpCreateServer } from 'node:http';

import {
  loadConfig,
  createApp,
  PLATFORMS,
  validateUrl,
  sanitizeFilename,
  createRateLimiter,
  parseRange,
  MIME,
  classifyResolveError,
  hasYtDlp as engineHasYtDlp,
  hasFfmpeg as engineHasFfmpeg,
} from './server/src/index.ts';

const cfg = loadConfig();

/** The Express request handler (works as a node:http listener). */
export const handler = createApp(cfg);

/** A ready-to-listen HTTP server (not listening unless run as main). */
export const server = httpCreateServer(handler);

// Named API expected by the test suite (§3). hasYtDlp/hasFfmpeg are bound to the
// loaded config so tests can call them with no arguments.
export { PLATFORMS, validateUrl, sanitizeFilename, createRateLimiter, parseRange, MIME, classifyResolveError, loadConfig, createApp };
export const hasYtDlp = () => engineHasYtDlp(cfg);
export const hasFfmpeg = () => engineHasFfmpeg(cfg);

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  server.listen(cfg.port, cfg.host, () => {
    console.log(`DownloadIt v${cfg.appVersion} listening on http://${cfg.host}:${cfg.host === '0.0.0.0' ? '' : ''}${cfg.port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
