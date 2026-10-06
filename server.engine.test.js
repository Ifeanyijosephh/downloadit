/**
 * server.engine.test.js — end-to-end flows against test-support/fake-engine.js.
 * Run via `node --test server.engine.test.js`.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createApp } from './server/src/app.ts';
import { loadConfig } from './server/src/config.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FAKE = join(ROOT, 'test-support', 'fake-engine.js');
const MARKER = join(mkdtempSync(join(tmpdir(), 'di-marker-')), 'killed.txt');
process.env.FAKE_MARKER = MARKER;

const cfg = { ...loadConfig(), ytDlpPath: FAKE, ffmpegPath: '', resolveTimeoutMs: 1500, downloadIdleTimeoutMs: 60000, downloadTimeoutMs: 60000 };
const app = createApp(cfg);

let server;
let base;
before(async () => {
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  try { rmSync(dirname(MARKER), { recursive: true, force: true }); } catch {}
});

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('health exposes cached fake-engine version', async () => {
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.equal(j.engine, true);
  assert.match(j.engineVersion, /fake-engine/);
  assert.equal(j.ffmpeg, false);
});

test('resolve success returns clipped metadata and mp4-only formats', async () => {
  const j = await (await post('/api/resolve', { url: 'https://www.youtube.com/watch?v=ok' })).json();
  assert.equal(j.platform, 'youtube');
  assert.ok(j.title.length <= 201);
  assert.deepEqual(j.formats, ['mp4']);
});

test('resolve private -> 422 restricted', async () => {
  const res = await post('/api/resolve', { url: 'https://www.youtube.com/watch?v=private' });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.match(j.code, /RESTRICTED|UNAVAILABLE/);
});

test('resolve slow -> 504 timeout (engine killed)', async () => {
  const res = await post('/api/resolve', { url: 'https://www.youtube.com/watch?v=slow' });
  assert.equal(res.status, 504);
});

test('download streams byte-for-byte (20000 bytes)', async () => {
  const res = await post('/api/download', { url: 'https://www.youtube.com/watch?v=ok', format: 'mp4' });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 20000);
  assert.equal(buf[0], 0);
  assert.equal(buf[1], 1);
  assert.equal(buf[999], 999 % 256);
  assert.equal(buf[1000], 0); // pattern repeats every 1000 bytes
  assert.equal(buf[19999], 999 % 256);
});

test('midfail: 200 then error -> connection torn down (incomplete, no success)', async () => {
  const res = await post('/api/download', { url: 'https://www.youtube.com/watch?v=midfail', format: 'mp4' });
  assert.equal(res.status, 200);
  let bytes = 0;
  let failed = false;
  try {
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
  } catch { failed = true; }
  assert.ok(failed, 'stream must not complete cleanly');
  assert.ok(bytes < 20000);
});

test('empty -> 502', async () => {
  const res = await post('/api/download', { url: 'https://www.youtube.com/watch?v=empty', format: 'mp4' });
  assert.equal(res.status, 502);
});

test('mp3 without ffmpeg -> 503 FFMPEG_REQUIRED', async () => {
  const res = await post('/api/download', { url: 'https://www.youtube.com/watch?v=ok', format: 'mp3' });
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.code, 'FFMPEG_REQUIRED');
});

test('Content-Disposition filename injection is neutralised', async () => {
  const res = await post('/api/download', { url: 'https://www.youtube.com/watch?v=ok', format: 'mp4', filename: 'x"; rm -rf /tmp/p; "y' });
  const cd = res.headers.get('content-disposition');
  await res.arrayBuffer();
  const inner = cd.replace(/^attachment; filename="/, '').replace(/"$/, '');
  assert.ok(!inner.includes('"'), 'no embedded quote');
  assert.ok(!inner.includes('/'), 'no slash');
});

test('client disconnect kills the engine (marker written)', async () => {
  const controller = new AbortController();
  const p = fetch(`${base}/api/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=hang', format: 'mp4' }),
    signal: controller.signal,
  }).catch(() => null);
  // Give the engine a moment to spawn, then drop the client.
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  await p;
  // Wait for the SIGTERM marker.
  const deadline = Date.now() + 5000;
  let ok = false;
  while (Date.now() < deadline) {
    if (existsSync(MARKER)) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ok, 'engine should have been killed on disconnect');
});
