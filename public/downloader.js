/**
 * public/downloader.js — DOM-free core: state machine, API client, run guard.
 *
 * The non-negotiable promise (§4): no request path may leave a spinner running.
 * Every transition that ends a flight clears `busy`, and every terminal event
 * clears it unconditionally so a malformed or out-of-order event can never wedge
 * the UI. Built and powered by Ifeco Digitals.
 */

export const INITIAL = Object.freeze({
  status: 'idle', // idle | fetching | ready | downloading | error | cancelled
  busy: false,
  run: 0,
  result: null,
  error: null,
  progress: 0,
  message: '',
});

/** Terminal events always clear the busy flag, whatever the current state. */
const TERMINAL = new Set([
  'RESOLVE_OK',
  'RESOLVE_FAIL',
  'DOWNLOAD_OK',
  'DOWNLOAD_FAIL',
  'CANCEL',
  'RESET',
]);

/**
 * Pure reducer over the UI state machine (§4).
 * @param {typeof INITIAL} state
 * @param {{type:string, [k:string]:any}} event
 */
export function reduce(state, event) {
  switch (event.type) {
    case 'SUBMIT':
      return { ...state, status: 'fetching', busy: true, run: state.run + 1, result: null, error: null, progress: 0, message: 'Fetching…' };
    case 'RESOLVE_OK':
      return { ...state, status: 'ready', busy: false, result: event.payload, error: null, message: 'Ready' };
    case 'RESOLVE_FAIL':
      return { ...state, status: 'error', busy: false, error: event.error, message: 'Failed' };
    case 'DOWNLOAD_START':
      return { ...state, status: 'downloading', busy: true, progress: 0, message: 'Downloading…' };
    case 'DOWNLOAD_PROGRESS':
      return { ...state, status: 'downloading', busy: true, progress: event.progress, message: `${event.progress}%` };
    case 'DOWNLOAD_OK':
      return { ...state, status: 'ready', busy: false, progress: 100, message: 'Saved' };
    case 'DOWNLOAD_FAIL':
      return { ...state, status: 'error', busy: false, error: event.error, message: 'Failed' };
    case 'CANCEL':
      return { ...state, status: 'cancelled', busy: false, error: null, message: 'Cancelled' };
    case 'RESET':
      return { ...INITIAL, run: state.run };
    default:
      return state;
  }
}

/** Monotonic run token: stale responses from an aborted run are inert (§4). */
export function createRunGuard() {
  let current = 0;
  return {
    next: () => ++current,
    current: () => current,
    isStale: (run) => run !== current,
  };
}

/** A fetch error carrying a stable code + human sentence (§4.5). */
export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const readError = async (res) => {
  try {
    const body = await res.json();
    return new ApiError(body.code || 'HTTP_' + res.status, body.hint || body.message || `Request failed (${res.status})`, res.status);
  } catch {
    return new ApiError('HTTP_' + res.status, `Request failed (${res.status})`, res.status);
  }
};

/** POST /api/resolve. Success requires ok && error==null && payload present (§4.4, §4.7). */
export async function apiResolve(url, { signal } = {}) {
  let res;
  try {
    res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('OFFLINE', 'Could not reach the server. Check your connection.');
  }
  if (!res.ok) throw await readError(res);
  const payload = await res.json().catch(() => null);
  if (payload == null || payload.error != null) {
    throw new ApiError('MALFORMED', 'The server returned an unreadable response.');
  }
  return payload;
}

/**
 * POST /api/download. Streams the body, reporting progress, and rejects a
 * non-ok response before any bytes are consumed (§4.7).
 */
export async function apiDownload({ url, format }, { signal, onProgress } = {}) {
  let res;
  try {
    res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format }),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('OFFLINE', 'Could not reach the server. Check your connection.');
  }
  if (!res.ok) throw await readError(res);

  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (onProgress && total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
    }
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') || 'application/octet-stream' });
}
