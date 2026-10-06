/** URL + filename validation (§9.5). */
import { platformForHost } from '../platforms.ts';

export type UrlCheck =
  | { ok: true; platform: string; url: string }
  | { ok: false; code: 'INVALID_URL' | 'UNSUPPORTED'; message: string };

/** Absolute http(s) URL whose hostname is on the platform allowlist. */
export function validateUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) {
    return { ok: false, code: 'INVALID_URL', message: 'A URL is required.' };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'That is not a valid absolute URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_URL', message: 'Only http(s) URLs are supported.' };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'INVALID_URL', message: 'URLs with embedded credentials are not allowed.' };
  }
  const host = url.hostname;
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) {
    return { ok: false, code: 'INVALID_URL', message: 'A hostname is required.' };
  }
  const platform = platformForHost(host);
  if (!platform) {
    return {
      ok: false,
      code: 'UNSUPPORTED',
      message: `${host} is not a supported platform.`,
    };
  }
  return { ok: true, platform: platform.name, url: url.href };
}

// Control characters and the filesystem-hostile set:  / \ : * ? " < > |
const CONTROL = /[\x00-\x1f\x7f]/g;
const HOSTILE = /[/\\:*?"<>|]/g;

/** Strip control chars and filesystem-hostile characters from a filename (§9.5). */
export function sanitizeFilename(input: unknown, fallback = 'download'): string {
  const s = typeof input === 'string' ? input : '';
  const clean = s.replace(CONTROL, '').replace(HOSTILE, '').trim();
  const trimmed = clean.slice(0, 180);
  return trimmed.length > 0 ? trimmed : fallback;
}
