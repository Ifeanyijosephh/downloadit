#!/usr/bin/env node
/**
 * tools/make-brand-assets.mjs — favicon set + og-cover (§7, §11).
 *
 * Favicons are rendered from the same 3D "logo cube" scene as the icons
 * (download mark on a rounded cube) at favicon-180 / favicon-32 / favicon.ico.
 *
 * og-cover.png (1200x630, <=150 KB) shows a real 3D icon cluster on the dark
 * theme plus the wordmark, which is set with drawtext at composite time.
 *
 * Regenerate:  node tools/make-brand-assets.mjs
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { MARKS } from './lib/marks.mjs';
import { renderIconScene } from './lib/icon-scene.mjs';
import { encodePNG, downsample } from './lib/png.mjs';
import { mix, toSRGB, clamp } from './lib/renderer.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const TMP = join(ROOT, 'tmp');

/* ------------------------------------------------------------- tiny helpers */

const run = (args) =>
  new Promise((res, rej) => {
    const c = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args]);
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('error', rej);
    c.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
  });

/** Alpha-over sprite onto an RGBA canvas. */
function over(canvas, cw, ch, sprite, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    const cy = y + dy;
    if (cy < 0 || cy >= ch) continue;
    for (let x = 0; x < sw; x++) {
      const cx = x + dx;
      if (cx < 0 || cx >= cw) continue;
      const si = (y * sw + x) * 4;
      const a = sprite[si + 3] / 255;
      if (a <= 0) continue;
      const ci = (cy * cw + cx) * 4;
      canvas[ci] = sprite[si] * a + canvas[ci] * (1 - a);
      canvas[ci + 1] = sprite[si + 1] * a + canvas[ci + 1] * (1 - a);
      canvas[ci + 2] = sprite[si + 2] * a + canvas[ci + 2] * (1 - a);
      canvas[ci + 3] = Math.max(canvas[ci + 3], sprite[si + 3]);
    }
  }
}

/** Dark-theme radial gradient canvas with a soft glow at the cluster. */
function ogBackground(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const cx = w * 0.3;
  const cy = h * 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = clamp(Math.hypot((x - cx) / w, ((y - cy) / h) * 1.4) , 0, 1);
      const r = mix(20, 6, t);
      const g = mix(34, 10, t);
      const b = mix(60, 18, t);
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/* ------------------------------------------------------------------- favicon */

async function favicons() {
  // Logo = the download mark on the shared cube plate.
  const big = renderIconScene(MARKS.download, { ortho: 0.95, size: 720, samples: 2 });

  const at180 = downsample(big, 720, 720, 4);
  await writeFile(join(ASSETS, 'favicon-180.png'), encodePNG(at180.rgba, 180, 180, { level: 9 }));

  // favicon-32 via ffmpeg lanczos from the 180 render.
  await run([
    '-i', join(ASSETS, 'favicon-180.png'),
    '-vf', 'scale=32:32:flags=lanczos',
    '-y', join(ASSETS, 'favicon-32.png'),
  ]);

  // favicon.ico = a 32x32 PNG wrapped in an ICO container.
  const { readFile } = await import('node:fs/promises');
  const png32 = await readFile(join(ASSETS, 'favicon-32.png'));
  const ico = Buffer.alloc(22 + png32.length);
  ico.writeUInt16LE(0, 0); // reserved
  ico.writeUInt16LE(1, 2); // type = icon
  ico.writeUInt16LE(1, 4); // one image
  ico[6] = 32; // width
  ico[7] = 32; // height
  ico[8] = 0; // palette
  ico[9] = 0; // reserved
  ico.writeUInt16LE(1, 10); // planes
  ico.writeUInt16LE(32, 12); // bpp
  ico.writeUInt32LE(png32.length, 14);
  ico.writeUInt32LE(22, 18);
  png32.copy(ico, 22);
  await writeFile(join(ASSETS, 'favicon.ico'), ico);

  for (const f of ['favicon-32.png', 'favicon-180.png', 'favicon.ico']) {
    const { size } = await stat(join(ASSETS, f));
    console.log(`  ${f.padEnd(16)} ${size} bytes (limit 30720)`);
    if (size > 30 * 1024) throw new Error(`${f} over 30 KB budget`);
  }
}

/* ------------------------------------------------------------------ og-cover */

async function ogCover() {
  const W = 1200;
  const H = 630;
  const canvas = ogBackground(W, H);

  const put = async (name, size, ortho, dx, dy) => {
    const s = renderIconScene(MARKS[name], { ortho, size, samples: 1 });
    over(canvas, W, H, s, size, size, dx, dy);
  };

  await put('youtube', 260, 0.98, 150, 120);
  await put('download', 300, 0.98, 250, 260);
  await put('tiktok', 240, 0.98, 90, 330);

  const base = join(TMP, 'og-base.png');
  await mkdir(TMP, { recursive: true });
  await writeFile(base, encodePNG(canvas, W, H, { level: 9 }));

  const out = join(ASSETS, 'og-cover.png');
  await run([
    '-i', base,
    '-vf',
    [
      // Wordmark, right side (sized to clear the 1200px edge).
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
        `text='DownloadIt':fontcolor=0xEFF3FB:fontsize=86:x=600:y=250`,
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:` +
        `text='save any public video as MP4 or MP3':fontcolor=0xA9B8CF:fontsize=28:x=602:y=372`,
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:` +
        `text='Built and powered by Ifeco Digitals':fontcolor=0x6BA3FF:fontsize=27:x=602:y=428`,
    ].join(','),
    '-y', out,
  ]);

  const { size } = await stat(out);
  console.log(`  og-cover.png       ${size} bytes (limit 153600)`);
  if (size > 150 * 1024) throw new Error(`og-cover.png over 150 KB budget (${size})`);
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  console.log('favicons:');
  await favicons();
  console.log('og-cover:');
  await ogCover();
  console.log('\nBrand assets OK.');
}

main().catch((err) => {
  console.error('make-brand-assets failed:', err.message);
  process.exit(1);
});
