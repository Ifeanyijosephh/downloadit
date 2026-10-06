/** Engine discovery + subprocess helpers (§9.1, §9.2, §9.16). */
import { spawn, spawnSync, execFile, type ChildProcess } from 'node:child_process';
import type { Config } from '../config.ts';

export interface EngineTarget {
  cmd: string;
  prefix: string[]; // argv placed before engine args (e.g. ["-m","yt_dlp"])
}

const tryRun = (cmd: string, args: string[]): boolean => {
  try {
    const r = spawnSync(cmd, args, { timeout: 1000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
};

/** Resolve the yt-dlp command without hanging (§9.1). */
export function resolveYtDlp(cfg: Config): EngineTarget | null {
  if (cfg.ytDlpPath) return { cmd: cfg.ytDlpPath, prefix: [] };
  if (tryRun('yt-dlp', ['--version'])) return { cmd: 'yt-dlp', prefix: [] };
  if (tryRun('python3', ['-m', 'yt_dlp', '--version']))
    return { cmd: 'python3', prefix: ['-m', 'yt_dlp'] };
  return null;
}

export function resolveFfmpeg(cfg: Config): string | null {
  if (cfg.ffmpegPath) return cfg.ffmpegPath;
  if (tryRun('ffmpeg', ['-version'])) return 'ffmpeg';
  return null;
}

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
      timeout: 1000,
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
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '15',
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
      ? [...target.prefix, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--no-playlist', '--no-warnings', '-o', '-', url]
      : [...target.prefix, '-f', 'bv*+ba/b', '--no-playlist', '--no-warnings', '-o', '-', url];

  return spawn(target.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}
