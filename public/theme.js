/**
 * public/theme.js — DOM-free theme preference logic (§8).
 *
 * Follows the OS only while the user has not chosen; once chosen, never
 * auto-switches. All DOM touches happen through the injected handles so the
 * logic itself is testable without a document.
 * Built and powered by Ifeco Digitals.
 */

export const STORAGE_KEY = 'downloadit' + '.theme';

const isTheme = (v) => v === 'light' || v === 'dark';

/** stored wins if valid; any other stored value is discarded; unset follows OS. */
export function resolveTheme(stored, system) {
  if (isTheme(stored)) return stored;
  return system === 'dark' ? 'dark' : 'light';
}

export const nextTheme = (current) => (current === 'dark' ? 'light' : 'dark');

/** The button label names the theme it will switch TO. */
export const themeLabel = (current) => (current === 'dark' ? 'Light theme' : 'Dark theme');

export const toggleState = (current) => nextTheme(current);

/**
 * Wire the theme into the page.
 * @param {object} h
 * @param {HTMLElement} h.root      document.documentElement
 * @param {MediaQueryList} h.media  matchMedia('(prefers-color-scheme: dark)')
 * @param {Storage} h.store         localStorage
 * @param {HTMLElement|null} h.meta meta[name=theme-color]
 * @param {HTMLButtonElement|null} h.button #themeToggle
 */
export function initTheme({ root, media, store, meta, button }) {
  let chosen = null;
  try {
    const s = store.getItem(STORAGE_KEY);
    if (isTheme(s)) chosen = s;
  } catch {
    chosen = null; // storage may be unavailable (private mode); tolerate
  }

  const apply = (theme) => {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#060a12' : '#ffffff');
    if (button) {
      button.setAttribute('aria-label', themeLabel(theme));
      button.setAttribute('title', themeLabel(theme));
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.dataset.theme = theme;
    }
  };

  let theme = resolveTheme(chosen, media.matches ? 'dark' : 'light');
  apply(theme);

  // OS change only matters while the user has not chosen.
  const onSystem = (e) => {
    if (chosen) return;
    theme = e.matches ? 'dark' : 'light';
    apply(theme);
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onSystem);

  const toggle = () => {
    theme = nextTheme(theme);
    chosen = theme;
    try {
      store.setItem(STORAGE_KEY, theme);
    } catch {
      // writing may fail (quota/private mode); the in-page theme still applies
    }
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onSystem);
    apply(theme);
  };

  if (button) button.addEventListener('click', toggle);

  return {
    get current() {
      return theme;
    },
    get isChosen() {
      return chosen !== null;
    },
    toggle,
  };
}
