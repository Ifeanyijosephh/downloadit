/**
 * frontend.test.js — UI state-machine invariants + markup/CSS/contrast contracts.
 * Run via `node --test frontend.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INITIAL, reduce } from './public/downloader.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

/* ------------------------------------------------------------ state machine */

const STATES = ['idle', 'fetching', 'ready', 'downloading', 'error', 'cancelled'];
const base = (status) => ({ ...INITIAL, status, busy: status === 'fetching' || status === 'downloading' });
const err = { code: 'X', hint: 'x' };
const EVENTS = [
  { type: 'SUBMIT' },
  { type: 'RESOLVE_OK', payload: { title: 't', formats: ['mp4'] } },
  { type: 'RESOLVE_FAIL', error: err },
  { type: 'DOWNLOAD_START' },
  { type: 'DOWNLOAD_PROGRESS', progress: 40 },
  { type: 'DOWNLOAD_OK' },
  { type: 'DOWNLOAD_FAIL', error: err },
  { type: 'CANCEL' },
  { type: 'RESET' },
];
const TERMINAL = new Set(['RESOLVE_OK', 'RESOLVE_FAIL', 'DOWNLOAD_OK', 'DOWNLOAD_FAIL', 'CANCEL', 'RESET']);

test('every state x every event: terminal events never leave the UI busy', () => {
  for (const s of STATES) {
    for (const ev of EVENTS) {
      const next = reduce(base(s), ev);
      if (TERMINAL.has(ev.type)) {
        assert.equal(next.busy, false, `${s} + ${ev.type} must clear busy`);
      }
      assert.ok(['idle', 'fetching', 'ready', 'downloading', 'error', 'cancelled'].includes(next.status));
    }
  }
});

test('in-flight flows reach a terminal state that clears busy', () => {
  // fetching -> resolve outcomes
  for (const ev of [{ type: 'RESOLVE_OK', payload: {} }, { type: 'RESOLVE_FAIL', error: err }, { type: 'CANCEL' }]) {
    assert.equal(reduce(base('fetching'), ev).busy, false);
  }
  // downloading -> download outcomes
  for (const ev of [{ type: 'DOWNLOAD_OK' }, { type: 'DOWNLOAD_FAIL', error: err }, { type: 'CANCEL' }]) {
    assert.equal(reduce(base('downloading'), ev).busy, false);
  }
  // progress keeps busy but never wedges
  assert.equal(reduce(base('downloading'), { type: 'DOWNLOAD_PROGRESS', progress: 5 }).busy, true);
});

test('SUBMIT always starts a fresh run token', () => {
  const a = reduce(INITIAL, { type: 'SUBMIT' });
  assert.equal(a.run, 1);
  assert.equal(a.busy, true);
  const b = reduce(a, { type: 'SUBMIT' });
  assert.equal(b.run, 2);
});

/* ---------------------------------------------------------------- CSS checks */

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const noComments = stripComments(css);

function tokenBlock(selectorRe) {
  const m = noComments.match(selectorRe);
  return m ? m[1] : '';
}
const lightTokens = tokenBlock(/:root\s*\{([^}]*)\}/);
const darkTokens = tokenBlock(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

function parseTokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = parseTokens(lightTokens);
const dark = parseTokens(darkTokens);

test('no @import and no missing url() targets', () => {
  assert.ok(!/@import/.test(noComments), 'no @import allowed');
  for (const m of noComments.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const p = m[1];
    if (p.startsWith('/')) {
      assert.ok(existsSync(join(ROOT, 'public', p)), `url target missing: ${p}`);
    }
  }
});

test('every colour literal lives inside a token declaration block', () => {
  let rest = noComments;
  rest = rest.replace(/:root\s*\{[^}]*\}/, '');
  rest = rest.replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/, '');
  const hex = rest.match(/#[0-9a-fA-F]{3,8}\b/g);
  const fn = rest.match(/\b(rgba?|hsla?)\(/g);
  assert.equal(hex, null, `hex colours outside tokens: ${hex}`);
  assert.equal(fn, null, `rgb()/hsl() outside tokens: ${fn}`);
});

test('every var() referenced is defined in a token block', () => {
  const defined = new Set([...Object.keys(light), ...Object.keys(dark)]);
  for (const m of noComments.matchAll(/var\(\s*(--[\w-]+)/g)) {
    assert.ok(defined.has(m[1]), `undefined var: ${m[1]}`);
  }
});

test('font-family declarations resolve to @font-face or a token; woff2 exist', () => {
  for (const m of noComments.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const fam = m[1];
    assert.ok(/var\(--font-ui\)|var\(--font-mono\)|Poppins/.test(fam), `unresolved font-family: ${fam}`);
  }
  assert.ok(/@font-face/.test(noComments));
  for (const w of [300, 400, 500, 600, 700]) {
    const name = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' }[w];
    assert.ok(existsSync(join(ROOT, 'public', 'fonts', `Poppins-${name}.woff2`)), `missing Poppins-${name}.woff2`);
  }
});

/* ---------------------------------------------------------------- contrast */
function hexToRgb(h) {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}
function lum([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const l1 = lum(hexToRgb(a));
  const l2 = lum(hexToRgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('WCAG 2.2 AA contrast in both themes', () => {
  for (const t of [light, dark]) {
    assert.ok(ratio(t['--text'], t['--bg']) >= 4.5, 'text/bg');
    assert.ok(ratio(t['--text-muted'], t['--bg']) >= 4.5, 'muted/bg');
    assert.ok(ratio(t['--text-faint'], t['--bg']) >= 4.5, 'faint/bg');
    assert.ok(ratio(t['--on-accent'], t['--accent']) >= 4.5, 'on-accent/accent');
    assert.ok(ratio(t['--control-border'], t['--bg']) >= 3, 'control-border/bg');
    assert.ok(ratio(t['--focus'], t['--bg']) >= 3, 'focus/bg');
  }
});

/* ---------------------------------------------------------------- markup */
test('markup carries the required a11y + structural hooks', () => {
  assert.ok(/id="formStatus"[^>]*aria-live="polite"/.test(html) || /aria-live="polite"[^>]*id="formStatus"/.test(html), 'formStatus aria-live');
  assert.ok(/<dialog id="downloadDialog"/.test(html), 'native dialog');
  assert.ok(/data-theme="dark"/.test(html), 'dark theme is fixed');
  assert.ok(/id="heroFloat"/.test(html), 'hero floating-icons background');
  assert.ok(/\/vendor\/aos\.js/.test(html), 'AOS motion library wired');
  assert.ok(!/image\/svg\+xml/.test(html), 'no svg link types');
  assert.ok(/Built and powered by/.test(html), 'attribution present');
});
