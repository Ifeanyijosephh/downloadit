/**
 * public/app.js — DOM wiring only. All logic lives in downloader.js / theme.js.
 *
 * Guarantees (§4): every fetch is wrapped in try/catch/finally that clears all
 * pending UI; watchdogs abort and reset; cancel is first-class; success is never
 * false; a stale run token makes aborted responses inert.
 * Built and powered by Ifeco Digitals.
 */
import { INITIAL, reduce, createRunGuard, apiResolve, apiDownload, ApiError } from './downloader.js';
import { initTheme } from './theme.js';

const $ = (s) => document.querySelector(s);

/* ------------------------------------------------------------------ theme -- */
initTheme({
  root: document.documentElement,
  media: window.matchMedia('(prefers-color-scheme: dark)'),
  store: window.localStorage,
  meta: document.querySelector('meta[name="theme-color"]'),
  button: $('#themeToggle'),
});
// theme-boot.js themed the document before paint; now reveal the body.
document.body.removeAttribute('hidden');

/* ------------------------------------------------------------------ store -- */
let state = INITIAL;
const guard = createRunGuard();
let resolveCtl = null;
let downloadCtl = null;
let cancelRequested = false;

function dispatch(event) {
  state = reduce(state, event);
  render();
}

/* ---------------------------------------------------------------- elements -- */
const form = $('#urlForm');
const urlInput = $('#urlInput');
const submitBtn = $('#submitBtn');
const formStatus = $('#formStatus');
const resultCard = $('#resultCard');
const dlStatus = $('#downloadStatus');
const dialog = $('#downloadDialog');
const dialogClose = $('#dialogClose');
const dialogCancel = $('#dialogCancel');
const progressFill = $('#progressFill');
const progressText = $('#progressText');

/* ----------------------------------------------------------------- render -- */
function render() {
  // §4.9: submit disabled unless a non-empty URL and nothing in flight.
  submitBtn.disabled = state.busy || urlInput.value.trim().length === 0;
  formStatus.textContent = state.message;
  formStatus.dataset.kind = state.status === 'error' ? 'error' : state.status === 'cancelled' ? 'cancel' : state.status === 'ready' ? 'success' : 'info';

  document.querySelectorAll('[data-spinner]').forEach((el) => {
    el.hidden = !state.busy;
  });

  // Result card.
  if (state.result) {
    resultCard.hidden = false;
    $('#resTitle').textContent = state.result.title || 'Untitled';
    $('#resAuthor').textContent = state.result.author || '';
    $('#resMeta').textContent = `${state.result.width}×${state.result.height} · ${Math.round(state.result.duration || 0)}s`;
    const hasMp3 = Array.isArray(state.result.formats) && state.result.formats.includes('mp3');
    $('#btnMp3').hidden = !hasMp3;
    const thumb = $('#resThumb');
    if (state.result.thumbnail && /^https:/.test(state.result.thumbnail)) {
      thumb.src = state.result.thumbnail;
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
    }
  } else {
    resultCard.hidden = true;
  }

  // Error line.
  const errLine = $('#errorLine');
  if (state.status === 'error' && state.error) {
    errLine.hidden = false;
    errLine.textContent = `[${state.error.code}] ${state.error.hint}`;
    $('#retryBtn').hidden = false;
  } else {
    errLine.hidden = true;
    $('#retryBtn').hidden = true;
  }

  // Download progress.
  if (state.status === 'downloading') {
    progressFill.style.width = `${state.progress}%`;
    progressText.textContent = `${state.progress}%`;
    dlStatus.textContent = state.message;
  }
}

/* ---------------------------------------------------------------- submit -- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url || state.busy) return;
  // A second submit aborts the previous run first (§4.9).
  if (resolveCtl) resolveCtl.abort();

  const run = guard.next();
  dispatch({ type: 'SUBMIT' });
  resolveCtl = new AbortController();
  const ctl = resolveCtl;

  // Resolve watchdog: 20 s (§4.2).
  const watchdog = setTimeout(() => ctl.abort(new Error('TIMEOUT')), 20000);

  try {
    const payload = await apiResolve(url, { signal: ctl.signal });
    if (guard.isStale(run)) return;
    dispatch({ type: 'RESOLVE_OK', payload });
  } catch (err) {
    if (guard.isStale(run)) return;
    if (err && err.name === 'AbortError') {
      dispatch({ type: 'RESOLVE_FAIL', error: { code: 'TIMEOUT', hint: 'That took too long. Try again.' } });
    } else {
      dispatch({ type: 'RESOLVE_FAIL', error: { code: err.code || 'ERROR', hint: err.message || 'Something went wrong.' } });
    }
  } finally {
    clearTimeout(watchdog);
    if (resolveCtl === ctl) resolveCtl = null;
  }
});

urlInput.addEventListener('input', render);

$('#retryBtn').addEventListener('click', () => {
  dispatch({ type: 'RESET' });
  form.requestSubmit();
});

/* --------------------------------------------------------------- download -- */
let currentFormat = 'mp4';

function openDialog(format) {
  currentFormat = format;
  cancelRequested = false;
  dialog.showModal();
  startDownload(format);
  // Focus lands on the primary action (§4.11).
  requestAnimationFrame(() => $('#dialogPrimary')?.focus());
}

$('#btnMp4').addEventListener('click', () => openDialog('mp4'));
$('#btnMp3').addEventListener('click', () => openDialog('mp3'));

async function startDownload(format) {
  const run = guard.next();
  dispatch({ type: 'DOWNLOAD_START' });
  downloadCtl = new AbortController();
  const ctl = downloadCtl;
  cancelRequested = false;

  // Watchdogs: 5 min total, 75 s with zero progress (stall) (§4.2).
  const total = setTimeout(() => ctl.abort(new Error('TIMEOUT')), 5 * 60 * 1000);
  let stall = setTimeout(() => ctl.abort(new Error('STALL')), 75000);
  const bump = (p) => {
    clearTimeout(stall);
    stall = setTimeout(() => ctl.abort(new Error('STALL')), 75000);
    if (!guard.isStale(run)) dispatch({ type: 'DOWNLOAD_PROGRESS', progress: p });
  };

  try {
    const blob = await apiDownload(
      { url: urlInput.value.trim(), format },
      { signal: ctl.signal, onProgress: bump },
    );
    if (guard.isStale(run)) return;

    // Save, then revoke the object URL once the save resolves (§4.12).
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `${(state.result && state.result.filename) || 'download'}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 0));
    URL.revokeObjectURL(objUrl);

    dispatch({ type: 'DOWNLOAD_OK' });
    closeDialog();
    submitBtn.focus();
  } catch (err) {
    if (guard.isStale(run)) return;
    if (cancelRequested || (err && err.name === 'AbortError' && cancelRequested)) {
      // Cancel is a distinct, non-error outcome (§4.3).
      dispatch({ type: 'CANCEL' });
    } else if (err && err.name === 'AbortError') {
      dispatch({ type: 'DOWNLOAD_FAIL', error: { code: 'TIMEOUT', hint: 'The download stalled or timed out.' } });
    } else {
      dispatch({ type: 'DOWNLOAD_FAIL', error: { code: err.code || 'ERROR', hint: err.message || 'Download failed.' } });
    }
    closeDialog();
  } finally {
    clearTimeout(total);
    clearTimeout(stall);
    if (downloadCtl === ctl) downloadCtl = null;
  }
}

function cancelDownload() {
  cancelRequested = true;
  if (downloadCtl) downloadCtl.abort(new Error('CANCEL'));
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

dialogCancel.addEventListener('click', cancelDownload);
dialogClose.addEventListener('click', () => {
  if (state.status === 'downloading') cancelDownload();
  closeDialog();
});
// Escape closes and aborts an in-flight download (§4.11).
dialog.addEventListener('cancel', (e) => {
  if (state.status === 'downloading') {
    cancelDownload();
  }
});
dialog.addEventListener('close', () => {
  submitBtn.focus();
});

const primary = document.createElement('button');
primary.id = 'dialogPrimary';
primary.type = 'button';
primary.className = 'btn btn-primary';
primary.textContent = 'Close';
primary.addEventListener('click', () => {
  if (state.status === 'downloading') cancelDownload();
  closeDialog();
});
$('#dialogActions')?.appendChild(primary);

render();
