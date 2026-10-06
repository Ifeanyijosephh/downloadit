/**
 * server.test.js — validation, rate limit, Range parser, sanitising, classify,
 * plus live HTTP against the exported handler (engine absent).
 * Run via `node --test server.test.js`.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  PLATFORMS, validateUrl, sanitizeFilename, createRateLimiter, parseRange,
  MIME, classifyResolveError, handler,
} from './server.js';

/* ------------------------------------------------------------------ pure */

test('PLATFORMS has exactly the ten supported networks', () => {
  assert.equal(PLATFORMS.length, 10);
});

test('validateUrl accepts allowlisted hosts incl. subdomains', () => {
  assert.equal(validateUrl('https://www.youtube.com/watch?v=1').ok, true);
  assert.equal(validateUrl('https://youtu.be/abc').ok, true);
  assert.equal(validateUrl('https://m.facebook.com/x').ok, true);
  assert.equal(validateUrl('https://vm.tiktok.com/x').ok, true);
});

test('validateUrl rejects bad protocol, credentials, foreign hosts', () => {
  assert.equal(validateUrl('ftp://youtube.com/x').code, 'INVALID_URL');
  assert.equal(validateUrl('not a url').code, 'INVALID_URL');
  assert.equal(validateUrl('https://user:pass@youtube.com/x').code, 'INVALID_URL');
  assert.equal(validateUrl('https://example.com/x').code, 'UNSUPPORTED');
});

test('sanitizeFilename strips control and hostile chars', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(sanitizeFilename('   '), 'download');
  assert.equal(sanitizeFilename('ok name'), 'ok name');
});

test('parseRange handles a-b, a-, -n, and rejects junk', () => {
  assert.deepEqual(parseRange('bytes=100-199', 1000), { ok: true, start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=100-', 1000), { ok: true, start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { ok: true, start: 900, end: 999 });
  assert.equal(parseRange('bytes=1000-2000', 1000).ok, false);
  assert.equal(parseRange('nonsense', 1000).ok, false);
});

test('rate limiter allows up to limit then 429 with retryAfter, store stays bounded', () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 60000 });
  assert.equal(rl.hit('ip').allowed, true);
  assert.equal(rl.hit('ip').allowed, true);
  const third = rl.hit('ip');
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds >= 1);
  assert.ok(rl.size() <= 20000);
});

test('classifyResolveError maps engine output to codes + statuses', () => {
  assert.equal(classifyResolveError('This video is private').http, 422);
  assert.equal(classifyResolveError('ERROR: age-restricted').code, 'RESTRICTED');
  assert.equal(classifyResolveError('timed out').http, 504);
  assert.equal(classifyResolveError('Video unavailable').http, 422);
  assert.equal(classifyResolveError('some random failure').http, 500);
});

test('MIME includes woff2, webp, ico, mp4, webm, mjs', () => {
  for (const k of ['.woff2', '.webp', '.ico', '.mp4', '.webm', '.mjs']) assert.ok(MIME[k], k);
  assert.ok(!('.svg' in MIME), 'no svg mime expected');
});

/* ------------------------------------------------------------- live HTTP */

let server;
let base;
before(async () => {
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

test('GET /api/health reports engine absent without hanging', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.engine, false);
  assert.equal(j.ffmpeg, false);
});

test('POST /api/resolve foreign host -> 400 INVALID_URL, no stack trace', async () => {
  const res = await fetch(`${base}/api/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/x' }),
  });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('INVALID_URL'));
  assert.ok(!/at .*\(/.test(body), 'no stack trace');
});

test('POST /api/resolve wrong content-type -> 415', async () => {
  const res = await fetch(`${base}/api/resolve`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});

test('GET on /api/resolve -> 405 with Allow', async () => {
  const res = await fetch(`${base}/api/resolve`);
  assert.equal(res.status, 405);
  assert.ok(res.headers.get('allow'));
});

test('static mp4: 200 video/mp4 + CSP; Range -> 206 exactly the requested bytes', async () => {
  const full = await fetch(`${base}/assets/hero-background.mp4`);
  assert.equal(full.status, 200);
  assert.match(full.headers.get('content-type'), /video\/mp4/);
  assert.ok(full.headers.get('content-security-policy'), 'CSP on static');
  await full.arrayBuffer();

  const r = await fetch(`${base}/assets/hero-background.mp4`, { headers: { range: 'bytes=100-199' } });
  assert.equal(r.status, 206);
  const buf = await r.arrayBuffer();
  assert.equal(buf.byteLength, 100);
});

test('HEAD matches GET Content-Length for the mp4', async () => {
  const head = await fetch(`${base}/assets/hero-background.mp4`, { method: 'HEAD' });
  const get = await fetch(`${base}/assets/hero-background.mp4`);
  const gb = await get.arrayBuffer();
  assert.equal(head.headers.get('content-length'), String(gb.byteLength));
});

test('index.html served with CSP and no-cache', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(res.headers.get('content-security-policy'));
  assert.match(res.headers.get('cache-control'), /no-cache/);
  await res.text();
});
