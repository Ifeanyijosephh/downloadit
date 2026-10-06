/** POST /api/download — stream engine stdout with a single settlement path (§9.7-9.10). */
import type { Request, Response } from 'express';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { validateUrl, sanitizeFilename } from '../utils/validate.ts';
import { classifyResolveError } from '../utils/classify.ts';
import { spawnDownload, hasYtDlp, hasFfmpeg } from '../utils/engine.ts';
import { applySecurityHeaders } from '../utils/security.ts';
import { clientIp } from '../utils/ip.ts';
import type { RateLimiter } from '../utils/rate-limit.ts';
import type { Queue } from '../queue/in-process-queue.ts';

const Body = z.object({
  url: z.string(),
  format: z.enum(['mp4', 'mp3']),
  filename: z.string().optional(),
});

const sendJsonError = (res: Response, status: number, code: string, hint: string): void => {
  if (res.headersSent) return;
  applySecurityHeaders(res);
  res.status(status).json({ code, hint });
};

export function downloadController(cfg: Config, limiter: RateLimiter, queue: Queue) {
  return (req: Request, res: Response): void => {
    const decision = limiter.hit(clientIp(req, cfg));
    if (!decision.allowed) {
      res.setHeader('Retry-After', decision.retryAfterSeconds);
      res.status(429).json({ code: 'RATE_LIMITED', hint: 'Too many downloads. Slow down and retry.' });
      return;
    }

    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', hint: 'Need { url, format: "mp4"|"mp3" }.' });
      return;
    }
    const { url, format } = parsed.data;

    const check = validateUrl(url);
    if (!check.ok) {
      res.status(400).json({ code: 'INVALID_URL', hint: check.message });
      return;
    }
    if (format === 'mp3' && !hasFfmpeg(cfg)) {
      res.status(503).json({ code: 'FFMPEG_REQUIRED', hint: 'Audio (MP3) needs ffmpeg, which is not installed.' });
      return;
    }
    if (!hasYtDlp(cfg)) {
      res.status(503).json({ code: 'ENGINE_UNAVAILABLE', hint: 'The download engine is not available.' });
      return;
    }

    const job = queue.add(clientIp(req, cfg), { url: check.url, format });
    queue.take(job.ip); // mark active (concurrency 1 per IP)

    let child: ChildProcess;
    try {
      child = spawnDownload(cfg, check.url, format);
    } catch (e) {
      queue.fail(job.id, 'ENGINE_UNAVAILABLE');
      sendJsonError(res, 503, 'ENGINE_UNAVAILABLE', 'The download engine is not available.');
      return;
    }

    let sentBytes = 0;
    let headersSent = false;
    let settled = false;
    let lastByteAt = Date.now();

    const kill = (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const t = setTimeout(() => child.kill('SIGKILL'), 5000);
        t.unref?.();
        child.on('close', () => clearTimeout(t));
      }
    };

    const timers: NodeJS.Timeout[] = [];

    // One guarded settlement path for every failure mode (§13).
    const failPreByte = (code: string, hint: string, status: number): void => {
      if (settled || headersSent) return;
      settled = true;
      timers.forEach(clearTimeout);
      kill();
      queue.fail(job.id, code);
      sendJsonError(res, status, code, hint);
    };

    const failPostByte = (): void => {
      // After the first byte we can no longer send JSON; tear down so the client
      // never mistakes a partial stream for a complete file (§9.7, §4.4).
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      kill();
      queue.fail(job.id, 'STREAM_ABORTED');
      res.destroy();
    };

    // Watchdogs: total + idle (stall) (§4.2, §4.3).
    timers.push(
      setTimeout(() => (sentBytes ? failPostByte() : failPreByte('TIMEOUT', 'The download timed out.', 504)), cfg.downloadTimeoutMs),
    );
    const stall = setInterval(() => {
      if (Date.now() - lastByteAt > cfg.downloadIdleTimeoutMs) {
        if (sentBytes) failPostByte();
        else failPreByte('STALL', 'The engine produced no data; treated as a stall.', 504);
      }
    }, 1000);
    timers.push(stall as unknown as NodeJS.Timeout);

    // Kill on real client disconnect / server shutdown (§9.8). Note: req 'close'
    // fires as soon as the (buffered) request body is consumed, so we key off the
    // response socket closing before the response finished instead.
    const onClientGone = (): void => {
      if (!settled) {
        settled = true;
        queue.fail(job.id, 'CLIENT_DISCONNECTED');
      }
      kill();
    };
    res.on('close', () => {
      if (!res.writableFinished) onClientGone();
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

    child.on('error', (err) => {
      failPreByte('ENGINE_ERROR', `Could not start the engine: ${err.message}`, 500);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!headersSent) {
        headersSent = true;
        const filename = sanitizeFilename(parsed.data.filename || check.platform, 'download');
        applySecurityHeaders(res, cfg);
        res.status(200);
        res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Accel-Buffering', 'no');
      }
      sentBytes += chunk.length;
      lastByteAt = Date.now();

      // Backpressure: pause the child until the socket drains (§9.9).
      const ok = res.write(chunk, (werr) => {
        const code = (werr as NodeJS.ErrnoException | undefined)?.code;
        if (werr && code !== 'EPIPE' && code !== 'ERR_STREAM_WRITE_AFTER_END') {
          failPostByte();
        }
      });
      if (!ok) child.stdout?.pause();
    });
    res.on('drain', () => child.stdout?.resume());

    child.on('close', (code) => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(stall);
      if (!headersSent) {
        // Engine exited before producing a byte -> a real error we can report.
        const text = Buffer.concat(stderrChunks).toString('utf8');
        if (text) {
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          const errLine = lines.find((l) => /^ERROR\b/i.test(l)) || lines[lines.length - 1] || '';
          console.error(`[download] engine stderr: ${errLine}`);
        }
        if (code === 0) {
          failPreByte('EMPTY_RESPONSE', 'The engine returned no data.', 502);
        } else {
          const c = classifyResolveError(text);
          failPreByte(c.code, c.hint, c.http);
        }
        return;
      }
      // We already streamed bytes.
      if (code === 0) {
        settled = true;
        queue.complete(job.id);
        res.end();
      } else {
        failPostByte();
      }
    });
  };
}
