/**
 * public/theme-boot.js — sets data-theme before first paint (no flash, §8).
 *
 * Loaded as a blocking script in <head> so the document is themed before any
 * render. Kept external (rather than inline) so the CSP can stay `script-src
 * 'self'` with no 'unsafe-inline' (§9.12). Mirrors theme.js#resolveTheme.
 */
(function () {
  var doc = document.documentElement;
  var theme = 'light';
  try {
    var stored = null;
    try {
      stored = localStorage.getItem('downloadit' + '.theme');
    } catch (e) {
      stored = null;
    }
    var system =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    theme = stored === 'light' || stored === 'dark' ? stored : system;
  } catch (e) {
    theme = 'light';
  }
  doc.dataset.theme = theme;
  doc.style.colorScheme = theme;
  doc.removeAttribute('data-no-theme');
})();
