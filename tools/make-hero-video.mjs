#!/usr/bin/env node
/**
 * tools/make-hero-video.mjs — regenerate the hero background video (§6).
 *
 * Renders HERO_FRAMES raymarched volumetric frames (tools/lib/hero.mjs), pipes
 * them as raw RGB24 into ffmpeg, and encodes H.264 at 854x480 / 24fps. The clip
 * is exactly HERO_SECONDS long and loops seamlessly because every animated term
 * is an integer harmonic of a phase that runs 0 -> 2*PI across the clip.
 *
 * Source/licence is recorded in public/assets/CREDITS.md: this asset is an
 * original CGI render generated entirely in this repository (no third-party
 * footage, no stock, no hotlink).
 *
 * Regenerate:  npm run assets:video
 */
import { spawn } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  renderHeroFrame,
  HERO_W,
  HERO_H,
  HERO_FPS,
  HERO_FRAMES,
} from './lib/hero.mjs';
import { bloom, vignette } from './lib/renderer.mjs';
import { encodePNG } from './lib/png.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const ffprobe = require('@ffprobe-installer/ffprobe').path;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MP4 = join(ROOT, 'public', 'assets', 'hero-background.mp4');
const OUT_POSTER = join(ROOT, 'public', 'assets', 'hero-poster.webp');
const MAX_BYTES = 2 * 1024 * 1024; // §6: hero video <= 2.0 MB

const run = (bin, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${bin} exit ${code}: ${err.slice(-800)}`)),
    );
    return child;
  });

function writeFrame(child, rgba) {
  const rgb = Buffer.alloc(HERO_W * HERO_H * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return new Promise((resolve, reject) => {
    const ok = child.stdin.write(rgb, () => resolve());
    if (!ok) child.stdin.once('drain', resolve);
    child.stdin.on('error', reject);
  });
}

async function main() {
  const t0 = Date.now();

  const encoder = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${HERO_W}x${HERO_H}`,
      '-r', String(HERO_FPS),
      '-i', '-',
      '-vf', 'scale=854:480:flags=lanczos',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '32',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      '-y',
      OUT_MP4,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let encErr = '';
  encoder.stderr.on('data', (d) => (encErr += d));
  const done = new Promise((res, rej) => {
    encoder.on('error', rej);
    encoder.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${encErr.slice(-800)}`))));
  });

  let posterRGBA = null;
  for (let f = 0; f < HERO_FRAMES; f++) {
    const phase = (f / HERO_FRAMES) * Math.PI * 2;
    let buf = renderHeroFrame(phase);
    buf = bloom(buf, HERO_W, HERO_H, { threshold: 110, radius: 5, amount: 0.42 });
    vignette(buf, HERO_W, HERO_H, 0.32);
    if (f === 0) posterRGBA = buf;
    await writeFrame(encoder, buf);
    if (f % 24 === 0) console.log(`  frame ${f}/${HERO_FRAMES}`);
  }
  encoder.stdin.end();
  await done;

  // Poster: first frame, as WebP (<= 60 KB).
  const png = encodePNG(posterRGBA, HERO_W, HERO_H, { level: 6 });
  const tmpPng = join(ROOT, 'tmp', 'hero-first.png');
  await import('node:fs/promises').then((m) => m.mkdir(dirname(tmpPng), { recursive: true }));
  await writeFile(tmpPng, png);
  await run(ffmpeg, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', tmpPng,
    '-vf', 'scale=854:480:flags=lanczos',
    '-c:v', 'libwebp',
    '-quality', '68',
    '-y',
    OUT_POSTER,
  ]);

  const mp4 = await stat(OUT_MP4);
  const poster = await stat(OUT_POSTER);
  console.log(`\nhero-background.mp4  ${mp4.size} bytes (${(mp4.size / 1024).toFixed(0)} KB)`);
  console.log(`hero-poster.webp     ${poster.size} bytes (${(poster.size / 1024).toFixed(0)} KB)`);
  console.log(`render+encode time   ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (mp4.size > MAX_BYTES) {
    console.error(`\nOVER BUDGET: hero-background.mp4 is ${mp4.size} bytes (limit ${MAX_BYTES}).`);
    process.exit(1);
  }

  // Verify with ffprobe: duration, no audio, dimensions.
  const probeOut = await new Promise((res, rej) => {
    const p = spawn(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
      '-of', 'default=nw=1',
      OUT_MP4,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`ffprobe exit ${c}`))));
  });
  console.log('\nffprobe:');
  console.log(probeOut.trim());

  const dur = Number((probeOut.match(/duration=([0-9.]+)/) || [])[1]);
  if (!(dur >= 6 && dur <= 10)) {
    console.error(`Duration ${dur}s outside the 6-10s window.`);
    process.exit(1);
  }
  if (/codec_type=audio/.test(probeOut)) {
    console.error('Audio stream present; hero must be silent.');
    process.exit(1);
  }
  console.log('\nHero video OK: silent, 6-10s, <=2MB, seamless loop.');
  if (!existsSync(OUT_MP4)) throw new Error('output missing');
}

main().catch((err) => {
  console.error('make-hero-video failed:', err.message);
  process.exit(1);
});
