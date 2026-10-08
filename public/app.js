/**
 * public/app.js — DOM wiring only. All logic lives in downloader.js / theme.js.
 *
 * Guarantees (§4): every fetch is wrapped in try/catch/finally that clears all
 * pending UI; watchdogs abort and reset; cancel is first-class; success is never
 * false; a stale run token makes aborted responses inert.
 * Built and powered by Ifeco Digitals.
 */
import { INITIAL, reduce, createRunGuard, apiResolve, apiDownload, ApiError } from './downloader.js';
const $ = (s) => document.querySelector(s);

/* ------------------------------------------------------------------ theme -- */
// Dark theme is fixed (no toggle). theme-boot.js set it before first paint;
// re-assert here so nothing can flip it, then reveal the body.
document.documentElement.dataset.theme = 'dark';
document.documentElement.style.colorScheme = 'dark';
document.body.removeAttribute('hidden');

/* ---------------------------------------------------------- hero + motion -- */
(function initHeroAndMotion() {
  // Floating, faded social icons in the hero background (replaces the video).
  const floatWrap = document.getElementById('heroFloat');
  if (floatWrap) {
    const brands = ['youtube', 'instagram', 'tiktok', 'x', 'facebook', 'vimeo', 'snapchat', 'pinterest', 'reddit', 'soundcloud', 'twitch', 'dailymotion'];
    const spots = [[6, 12, 72], [78, 8, 60], [16, 68, 54], [86, 64, 68], [40, 18, 48], [62, 80, 58],
      [28, 42, 44], [92, 36, 50], [8, 88, 46], [70, 46, 40], [50, 62, 52], [22, 16, 42]];
    brands.forEach((b, i) => {
      const s = spots[i % spots.length];
      const img = document.createElement('img');
      img.src = `https://cdn.simpleicons.org/${b}`;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.className = 'hero-float-icon';
      img.style.left = s[0] + '%';
      img.style.top = s[1] + '%';
      img.style.width = s[2] + 'px';
      img.style.height = s[2] + 'px';
      img.style.animationDelay = (i * 0.7).toFixed(1) + 's';
      floatWrap.appendChild(img);
    });
  }
  // AOS scroll reveals (respect reduced-motion).
  if (window.AOS && typeof window.AOS.init === 'function') {
    window.AOS.init({
      duration: 700,
      easing: 'ease-out-cubic',
      once: true,
      offset: 60,
      disable: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  } else {
    // Fallback: never leave [data-aos] content invisible if AOS didn't load.
    document.querySelectorAll('[data-aos]').forEach((el) => el.classList.add('aos-animate'));
  }
})();

/* ------------------------------------------- platforms marquee + loader ----- */
(function initMarqueeAndLoader() {
  // Loader: bouncy "DownloadIt" until resources are ready, then fade out.
  const loader = document.getElementById('loader');
  if (loader) {
    loader.querySelectorAll('.loader-word span').forEach((s, i) => {
      s.style.animationDelay = (i * 0.08).toFixed(2) + 's';
    });
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      loader.classList.add('done');
      setTimeout(() => loader.remove(), 650);
    };
    const ready = () =>
      (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(hide, 350));
    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready);
    setTimeout(hide, 6000); // safety: never let the loader stick
  }

  // Platforms marquee: two copies so translateX(-50%) loops seamlessly.
  const track = document.getElementById('marqueeTrack');
  if (track) {
    const CDN = 'https://cdn.simpleicons.org/';
    const items = [
      ['YouTube', CDN + 'youtube'], ['Instagram', CDN + 'instagram'], ['TikTok', CDN + 'tiktok'],
      ['X / Twitter', CDN + 'x'], ['Facebook', CDN + 'facebook'], ['Vimeo', CDN + 'vimeo'],
      ['Snapchat', CDN + 'snapchat'], ['Pinterest', CDN + 'pinterest'], ['Reddit', CDN + 'reddit'],
      ['LinkedIn', '/assets/icons/3d/linkedin.png'], // Simple Icons CDN no longer ships LinkedIn
    ];
    const build = () => items.map(([name, src]) => {
      const fig = document.createElement('figure');
      fig.className = 'plat-item';
      const img = document.createElement('img');
      img.src = src; img.width = 40; img.height = 40; img.alt = '';
      img.setAttribute('aria-hidden', 'true'); img.decoding = 'async';
      img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      const cap = document.createElement('figcaption');
      cap.textContent = name;
      fig.append(img, cap);
      return fig;
    });
    build().forEach((n) => track.appendChild(n));
    build().forEach((n) => track.appendChild(n));
  }

  // Scroll-direction drift on top of the marquee: down => left, up => right.
  const shift = document.getElementById('marqueeShift');
  if (shift) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastY = window.scrollY;
    let t = null;
    window.addEventListener('scroll', () => {
      if (reduce) return;
      const y = window.scrollY;
      const dir = y > lastY ? -1 : y < lastY ? 1 : 0;
      lastY = y;
      if (dir !== 0) {
        shift.style.transform = `translateX(${dir * 70}px)`;
        clearTimeout(t);
        t = setTimeout(() => { shift.style.transform = 'translateX(0)'; }, 550);
      }
    }, { passive: true });
  }
})();

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

/* --------------------------------------------------------- friendly errors -- */
// Turn any failure into a patient, human message + a clear "try again" nudge.
// Raw server codes/hints are never shown to the user.
function friendlyMessage(error) {
  const code = error && error.code;
  const specific = {
    LOGIN_REQUIRED: 'This one needs a login, so we can\u2019t fetch it here. Please try a public link.',
    AGE_RESTRICTED: 'This video is age-restricted, so it can\u2019t be downloaded here.',
    PRIVATE_VIDEO: 'That video looks private or was removed. Please try a public link.',
    NOT_FOUND: 'We couldn\u2019t find that video. Double-check the link and try again.',
    URL_BLOCKED: 'That link isn\u2019t allowed. Please use a public video URL.',
    NO_FORMAT: 'This video has no single-file MP4 (common for live streams). Try MP3, or use a regular non-live video.',
    FFMPEG_REQUIRED: 'Audio conversion isn\u2019t available on this server right now. Please try MP4 instead.',
    UNSUPPORTED: 'That link isn\u2019t from a supported platform. Please use a public video URL.',
    RESTRICTED: 'This video is private, age-restricted, region-locked or needs a login, so it can\u2019t be downloaded.',
    UNAVAILABLE: 'That video is unavailable \u2014 it may have been removed or made private.',
  };
  if (specific[code]) return specific[code];
  return 'Hang tight \u2014 the platform seems busy or the connection dropped. Please give it a moment and try again.';
}

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

  // Error line — always a calm, patient, human message (never raw server codes).
  const errLine = $('#errorLine');
  if (state.status === 'error' && state.error) {
    errLine.hidden = false;
    errLine.textContent = friendlyMessage(state.error);
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

// Paste button: read the clipboard into the input, with honest fallbacks.
const pasteBtn = $('#pasteBtn');
if (pasteBtn) {
  const say = (msg, kind) => { formStatus.textContent = msg; formStatus.dataset.kind = kind || 'info'; };
  pasteBtn.addEventListener('click', async () => {
    // Clipboard API needs a secure context (HTTPS or localhost) + permission.
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      say('Your browser blocks auto-paste here \u2014 tap the field and press Ctrl/Cmd + V.', 'info');
      urlInput.focus();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        urlInput.value = text.trim();
        render();
        say('Link pasted \u2014 hit Get video.', 'success');
      } else {
        say('Your clipboard is empty.', 'info');
      }
      urlInput.focus();
    } catch {
      say('Clipboard permission was blocked \u2014 tap the field and press Ctrl/Cmd + V.', 'info');
      urlInput.focus();
    }
  });
}

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

  // Feel alive immediately: indeterminate bar + ticking timer until bytes flow.
  const track = progressFill.parentElement;
  track.classList.add('indeterminate');
  progressFill.style.width = '';
  dlStatus.textContent = 'Working…';
  let elapsed = 0;
  const aliveTimer = setInterval(() => {
    elapsed += 1;
    if (state.status === 'downloading' && state.progress === 0) {
      dlStatus.textContent = `Working… ${elapsed}s`;
    }
  }, 1000);

  // Watchdogs: 5 min total, 75 s with zero progress (stall) (§4.2).
  const total = setTimeout(() => ctl.abort(new Error('TIMEOUT')), 5 * 60 * 1000);
  let stall = setTimeout(() => ctl.abort(new Error('STALL')), 75000);
  const bump = (p) => {
    if (p > 0) track.classList.remove('indeterminate');
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
    clearInterval(aliveTimer);
    track.classList.remove('indeterminate');
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
