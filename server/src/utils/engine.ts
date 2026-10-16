/** Engine discovery + subprocess helpers (§9.1, §9.2, §9.16). */
import { spawn, spawnSync, execFile, type ChildProcess } from 'node:child_process';
import type { Config } from '../config.ts';

export interface EngineTarget {
  cmd: string;
  prefix: string[]; // argv placed before engine args (e.g. ["-m","yt_dlp"])
}

const tryRun = (cmd: string, args: string[]): boolean => {
  try {
    // Python-based yt-dlp startup can exceed 1s on a cold cache; give it room
    // so discovery does not intermittently (and wrongly) report "unavailable".
    const r = spawnSync(cmd, args, { timeout: 5000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
};

let targetCache: EngineTarget | null | undefined;

/** Resolve the yt-dlp command without hanging (§9.1). Result is cached. */
export function resolveYtDlp(cfg: Config): EngineTarget | null {
  if (cfg.ytDlpPath) return { cmd: cfg.ytDlpPath, prefix: [] };
  if (targetCache !== undefined) return targetCache;
  if (tryRun('yt-dlp', ['--version'])) {
    targetCache = { cmd: 'yt-dlp', prefix: [] };
    return targetCache;
  }
  if (tryRun('python3', ['-m', 'yt_dlp', '--version'])) {
    targetCache = { cmd: 'python3', prefix: ['-m', 'yt_dlp'] };
    return targetCache;
  }
  targetCache = null;
  return null;
}

export function resolveFfmpeg(cfg: Config): string | null {
  if (cfg.ffmpegPath) return cfg.ffmpegPath;
  if (tryRun('ffmpeg', ['-version'])) return 'ffmpeg';
  return null;
}

/**
 * Optional yt-dlp authentication args. Off by default (public-only). When the
 * operator sets COOKIES_FILE (a Netscape cookies.txt) or COOKIES_FROM_BROWSER
 * (e.g. "firefox"), we pass it on every engine call so login-gated platforms
 * (Instagram, private Facebook) can resolve/download. For self-hosted/personal
 * use — a public deployment should leave both unset.
 */
function cookieArgs(cfg: Config): string[] {
  if (cfg.cookiesFile) return ['--cookies', cfg.cookiesFile];
  if (cfg.cookiesFromBrowser) return ['--cookies-from-browser', cfg.cookiesFromBrowser];
  return [];
}

/** True when a cookies source is configured (surfaced in /api/health). */
export function cookiesActive(cfg: Config): boolean {
  return Boolean(cfg.cookiesFile || cfg.cookiesFromBrowser);
}

/**
 * yt-dlp resilience flags. A single transient hiccup (a 429, a dropped socket,
 * a flaky extractor call) should not fail an otherwise-good download, so we let
 * the engine retry on its own. This is the main code-level stability lever for
 * YouTube/TikTok/X/Pinterest/Instagram/Facebook; the rest is keeping yt-dlp
 * up to date and supplying cookies for login-gated platforms.
 */
const RESILIENCE = ['--retries', '5', '--fragment-retries', '5', '--extractor-retries', '3', '--socket-timeout', '20'];

let ytDlpCache: boolean | null = null;
let ffmpegCache: boolean | null = null;

export function hasYtDlp(cfg: Config): boolean {
  if (ytDlpCache === null) ytDlpCache = resolveYtDlp(cfg) !== null;
  return ytDlpCache;
}

export function hasFfmpeg(cfg: Config): boolean {
  if (ffmpegCache === null) ffmpegCache = resolveFfmpeg(cfg) !== null;
  return ffmpegCache;
}

export const _resetEngineCache = (): void => {
  ytDlpCache = null;
  ffmpegCache = null;
  targetCache = undefined;
};

let versionCache: string | null | undefined;

/** Cached version string; never blocks >1s and never hangs when absent (§9.16). */
export function engineVersion(cfg: Config): string | null {
  if (versionCache !== undefined) return versionCache;
  const target = resolveYtDlp(cfg);
  if (!target) {
    versionCache = null;
    return null;
  }
  try {
    const r = spawnSync(target.cmd, [...target.prefix, '--version'], {
      timeout: 5000,
      encoding: 'utf8',
    });
    versionCache = r.status === 0 ? (r.stdout || '').trim().split('\n')[0] ?? null : null;
  } catch {
    versionCache = null;
  }
  return versionCache;
}

/** Resolve metadata as JSON via --dump-json (§9.3). Always an argv array. */
export function execResolve(cfg: Config, url: string): Promise<Record<string, unknown>> {
  const target = resolveYtDlp(cfg);
  if (!target) {
    return Promise.reject(Object.assign(new Error('ENGINE_UNAVAILABLE'), { engineUnavailable: true }));
  }
  const args = [
    ...target.prefix,
    ...cookieArgs(cfg),
    ...RESILIENCE,
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      target.cmd,
      args,
      {
        timeout: cfg.resolveTimeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
          e.stderr = stderr || e.message;
          return reject(e);
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          const e = new Error('MALFORMED_METADATA') as NodeJS.ErrnoException & { stderr?: string };
          e.stderr = 'engine returned unparseable metadata';
          reject(e);
        }
      },
    ).stdin?.end(); // keep stdin closed
  });
}

/** Spawn the engine to emit media bytes on stdout (§9.7, §9.10). */
export function spawnDownload(
  cfg: Config,
  url: string,
  format: 'mp4' | 'mp3',
): ChildProcess {
  const target = resolveYtDlp(cfg);
  if (!target) throw Object.assign(new Error('ENGINE_UNAVAILABLE'), { engineUnavailable: true });

  const args =
    format === 'mp3'
      ? [...target.prefix, ...cookieArgs(cfg), ...RESILIENCE, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--no-playlist', '--no-warnings', '--newline', '-o', '-', url]
      : // Single pre-merged file only: yt-dlp cannot merge two streams into
        // stdout, so a bv*+ba selector would always fail for MP4 here.
        [...target.prefix, ...cookieArgs(cfg), ...RESILIENCE, '-f', 'best[ext=mp4]/best', '--no-playlist', '--no-warnings', '--newline', '-o', '-', url];

  return spawn(target.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Spawn the engine to write a finished file to disk (§9.7 merge path).
 * MP4 needs video+audio merged, which yt-dlp cannot do to stdout, so we let it
 * merge into a temp file (requires ffmpeg) and the controller streams that file.
 */
export function spawnDownloadToFile(
  cfg: Config,
  url: string,
  format: 'mp4' | 'mp3',
  outPath: string,
): ChildProcess {
  const target = resolveYtDlp(cfg);
  if (!target) throw Object.assign(new Error('ENGINE_UNAVAILABLE'), { engineUnavailable: true });

  const args =
    format === 'mp3'
      ? [...target.prefix, ...cookieArgs(cfg), ...RESILIENCE, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--no-playlist', '--no-warnings', '--newline', '-o', outPath, url]
      : [...target.prefix, ...cookieArgs(cfg), ...RESILIENCE, '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--no-playlist', '--no-warnings', '--newline', '-o', outPath, url];

  // stdout carries yt-dlp's `[download] NN%` progress lines (media goes to the
  // file), so the controller can parse live progress; stderr carries errors.
  return spawn(target.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}
