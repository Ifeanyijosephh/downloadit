#!/usr/bin/env node
/**
 * test-support/fake-engine.js — an executable yt-dlp stand-in (§10).
 *
 * Reads its URL from argv and switches behaviour on substrings in that URL, so
 * the engine-driven tests can exercise every path without a real engine:
 *
 *   --version            -> prints a version (health)
 *   --dump-json          -> resolve; URL may include private/restricted/slow
 *   -o -                 -> download; URL may include hang/empty/midfail
 *
 * `hang` writes a marker file on SIGTERM so the disconnect test can assert the
 * engine was actually killed. (ESM, because package.json sets "type":"module".)
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a)) || '';
const isResolve = args.includes('--dump-json');
const marker = process.env.FAKE_MARKER;

function main() {
  if (args.includes('--version')) {
    console.log('2026.10.06 (fake-engine)');
    process.exit(0);
  }

  if (isResolve) {
    if (url.includes('private')) {
      console.error('ERROR: [youtube] This video is private');
      process.exit(1);
    }
    if (url.includes('restricted')) {
      console.error('ERROR: This video is age-restricted');
      process.exit(1);
    }
    if (url.includes('slow')) {
      // Outlive the resolve timeout; the server must kill us and return 504.
      setTimeout(() => process.exit(0), 60_000);
      return;
    }
    const meta = {
      title: 'Fake <Video> "Title"',
      uploader: 'Fake Author',
      duration: 120,
      width: 1280,
      height: 720,
      thumbnail: 'https://i.ytimg.com/vi/fake/hq.jpg',
    };
    console.log(JSON.stringify(meta));
    process.exit(0);
  }

  /* download (-o -) */
  if (url.includes('hang') || url.includes('disconnect')) {
    process.on('SIGTERM', () => {
      if (marker) {
        try {
          fs.writeFileSync(marker, `killed ${Date.now()}`);
        } catch {}
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 60_000); // stay alive until killed
    return;
  }

  if (url.includes('empty')) {
    process.exit(0); // success exit but zero bytes -> 502 EMPTY_RESPONSE
  }

  if (url.includes('midfail')) {
    // 200 first (bytes sent), then die -> client must report incomplete.
    process.stdout.write(Buffer.alloc(4096, 1), () => {
      setTimeout(() => process.exit(1), 100);
    });
    return;
  }

  /* success: emit a deterministic 20000-byte stream */
  const chunk = Buffer.alloc(1000);
  for (let i = 0; i < chunk.length; i++) chunk[i] = i % 256;
  for (let k = 0; k < 20; k++) process.stdout.write(chunk);
  process.exit(0);
}

main();
