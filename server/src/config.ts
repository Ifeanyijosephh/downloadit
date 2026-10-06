/** Environment-driven configuration (§9.15). All values optional, safe defaults. */

export interface Config {
  port: number;
  host: string;
  publicDir: string;
  trustProxy: boolean;
  ytDlpPath: string;
  ffmpegPath: string;
  resolveTimeoutMs: number;
  downloadTimeoutMs: number;
  downloadIdleTimeoutMs: number;
  maxBodyBytes: number;
  rateLimitResolve: number;
  rateLimitDownload: number;
  appVersion: string;
}

/** Numeric env values must be plain digits — "4_000" parses to NaN (§13). */
const num = (v: string | undefined, def: number): number => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    publicDir: env.PUBLIC_DIR || 'public',
    trustProxy: env.TRUST_PROXY === '1',
    ytDlpPath: env.YT_DLP_PATH || '',
    ffmpegPath: env.FFMPEG_PATH || '',
    resolveTimeoutMs: num(env.RESOLVE_TIMEOUT_MS, 45000),
    downloadTimeoutMs: num(env.DOWNLOAD_TIMEOUT_MS, 300000),
    downloadIdleTimeoutMs: num(env.DOWNLOAD_IDLE_TIMEOUT_MS, 75000),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 16384),
    rateLimitResolve: num(env.RATE_LIMIT_RESOLVE, 20),
    rateLimitDownload: num(env.RATE_LIMIT_DOWNLOAD, 10),
    appVersion: env.APP_VERSION || '2.0.0',
  };
}
