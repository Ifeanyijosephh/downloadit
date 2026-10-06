/**
 * theme.test.js — preference resolution, persistence, toggle wiring (§8).
 * Run via `node --test theme.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, resolveTheme, nextTheme, themeLabel, initTheme } from './public/theme.js';

const makeStore = (init = {}, { failWrite = false } = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (failWrite) throw new Error('quota');
      m.set(k, v);
    },
    _m: m,
  };
};
const makeMedia = (initial) => {
  const listeners = [];
  let matches = initial;
  return {
    get matches() {
      return matches;
    },
    addEventListener: (t, f) => listeners.push(f),
    removeEventListener: (t, f) => {
      const i = listeners.indexOf(f);
      if (i >= 0) listeners.splice(i, 1);
    },
    _set(v) {
      matches = v;
      listeners.forEach((f) => f({ matches: v }));
    },
    _listeners: listeners,
  };
};
const makeRoot = () => ({ dataset: {}, style: {} });
const makeMeta = () => ({ attrs: {}, setAttribute(k, v) {
  this.attrs[k] = v;
} });
const makeButton = () => {
  const b = { dataset: {}, attrs: {}, handlers: {} };
  b.setAttribute = (k, v) => (b.attrs[k] = v);
  b.addEventListener = (t, f) => (b.handlers[t] = f);
  return b;
};

test('resolveTheme precedence: stored > OS; bad stored discarded', () => {
  assert.equal(resolveTheme('dark', 'light'), 'dark');
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme(null, 'dark'), 'dark');
  assert.equal(resolveTheme(undefined, 'light'), 'light');
  assert.equal(resolveTheme('bogus', 'dark'), 'dark');
  assert.equal(resolveTheme('BOGUS', 'light'), 'light');
});

test('nextTheme / themeLabel / STORAGE_KEY', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(themeLabel('dark'), 'Light theme');
  assert.equal(themeLabel('light'), 'Dark theme');
  assert.equal(STORAGE_KEY, 'downloadit.theme');
});

test('initTheme applies stored theme to root/meta/button', () => {
  const root = makeRoot();
  const meta = makeMeta();
  const button = makeButton();
  initTheme({ root, media: makeMedia(false), store: makeStore({ [STORAGE_KEY]: 'dark' }), meta, button });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(button.attrs['aria-label'], 'Light theme');
});

test('unset follows OS; OS change updates until chosen, then never', () => {
  const root = makeRoot();
  const media = makeMedia(true); // OS dark
  const store = makeStore();
  const ctrl = initTheme({ root, media, store, meta: null, button: null });
  assert.equal(root.dataset.theme, 'dark');
  media._set(false); // OS flips to light while unset
  assert.equal(root.dataset.theme, 'light');

  ctrl.toggle(); // choose dark
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(store.getItem(STORAGE_KEY), 'dark');
  media._set(true); // OS change after choosing must not switch
  assert.equal(root.dataset.theme, 'dark');
});

test('storage write failure is tolerated', () => {
  const root = makeRoot();
  const store = makeStore({}, { failWrite: true });
  const ctrl = initTheme({ root, media: makeMedia(false), store, meta: null, button: null });
  assert.doesNotThrow(() => ctrl.toggle());
  assert.equal(root.dataset.theme, 'dark');
});

test('toggle updates root + meta + button in one place', () => {
  const root = makeRoot();
  const meta = makeMeta();
  const button = makeButton();
  const ctrl = initTheme({ root, media: makeMedia(false), store: makeStore(), meta, button });
  button.handlers.click();
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(meta.attrs.content, '#060a12');
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(ctrl.current, 'dark');
  button.handlers.click();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(meta.attrs.content, '#ffffff');
});
