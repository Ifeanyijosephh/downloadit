/**
 * In-memory download-progress store, keyed by a client-supplied job id.
 *
 * The browser can't see progress while the server is still running yt-dlp (no
 * bytes flow yet), so the engine's `[download] NN%` lines are parsed and stored
 * here; the client polls GET /api/progress/:jobId to move its bar in real time.
 * Bounded + TTL'd so it can never grow without limit.
 */
const store = new Map<string, { percent: number; ts: number }>();
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

export function setProgress(jobId: string, percent: number): void {
  if (!jobId) return;
  if (store.size >= MAX_ENTRIES && !store.has(jobId)) {
    // Evict the oldest entry to stay bounded.
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of store) {
      if (v.ts < oldest) { oldest = v.ts; oldestKey = k; }
    }
    if (oldestKey) store.delete(oldestKey);
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  store.set(jobId, { percent: clamped, ts: Date.now() });
}

export function getProgress(jobId: string): number | null {
  const e = store.get(jobId);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { store.delete(jobId); return null; }
  return e.percent;
}

export function clearProgress(jobId: string): void {
  if (jobId) store.delete(jobId);
}

/** Test helper. */
export function _progressSize(): number {
  return store.size;
}
