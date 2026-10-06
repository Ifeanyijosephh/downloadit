#!/usr/bin/env node
/**
 * tools/make-icons.mjs — regenerate the 14 3D icons (§7).
 *
 * Pipeline (all of it reproducible from this file, nothing hand-drawn):
 *   1. build the shared scene (tools/lib/icon-scene.mjs): dark-blue rounded-cube
 *      base plate + the extruded mark, one camera + light rig for every icon
 *   2. raymarch at 448x448 with 2x2 supersampling
 *   3. area-average down to 112x112 (@2x) and 56x56 (@1x)
 *   4. encode PNG with tools/lib/png.mjs and assert the 12 KB budget
 *
 * §7 consistency contract, enforced by construction (see icon-scene.mjs):
 *   one camera (isometric-ish ~27deg pitch, 3/4 view), one key + one rim light,
 *   matte plastic + slight subsurface, identical base plate, alpha background,
 *   contact shadow baked at 20% opacity (shadowStrength 0.2).
 *
 * Regenerate:  npm run assets:icons
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFrame, makeCamera, clamp } from './lib/renderer.mjs';
import { MARKS, ICON_SET } from './lib/marks.mjs';
import { EYE, LIGHT, buildParts } from './lib/icon-scene.mjs';
import { encodePNG, downsample } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets', 'icons', '3d');

/* ------------------------------------------------------------------- budget */
const BUDGET_BYTES = 12 * 1024; // §7: <= 12 KB each
const RENDER_SIZE = 448; // 448 / 4 = 112 (@2x), 448 / 8 = 56 (@1x)
const SAMPLES = 2; // 2x2 supersampling

function renderWith(combined, surface, ortho, size, samples) {
  return renderFrame({
    width: size,
    height: size,
    sdf: combined,
    camera: makeCamera({ eye: EYE, target: [0, 0, 0], up: [0, 1, 0], aspect: 1, ortho }),
    maxSteps: 110,
    maxDist: 18,
    opaque: false, // icons need real transparency
    samples,
    exposure: 1.05,
    background: () => [0, 0, 0], // discarded; alpha carries the silhouette
    light: LIGHT,
    surface,
  });
}

/** Alpha bounding box as a fraction (0..1) of the canvas side. */
function inkFraction(rgba, size) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return 0;
  return Math.max(maxX - minX + 1, maxY - minY + 1) / size;
}

/**
 * Auto-fit the orthographic half-extent so the object occupies ~80% of the
 * frame (== ~10% padding on the tightest side, §7).
 */
function renderIcon(shapes) {
  const { combined, surface } = buildParts(shapes);
  const probe = renderWith(combined, surface, 1, 112, 1);
  const f = inkFraction(probe, 112);
  if (f <= 0) throw new Error('probe produced no ink; SDF likely degenerate (NaN)');
  const ortho = clamp(f / 0.76, 0.2, 4);
  return renderWith(combined, surface, ortho, RENDER_SIZE, SAMPLES);
}

/* ------------------------------------------------------------------- helpers */

/** Smallest padding fraction between the ink and the canvas edge (0.10 == 10%). */
function minPadding(rgba, size) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return 1;
  return Math.min(minX, minY, size - 1 - maxX, size - 1 - maxY) / size;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const missing = ICON_SET.filter((i) => !MARKS[i.name]);
  if (missing.length) {
    throw new Error(`No mark defined for: ${missing.map((m) => m.name).join(', ')}`);
  }

  console.log(
    `Rendering ${ICON_SET.length} icons at ${RENDER_SIZE}x${RENDER_SIZE} ` +
      `(${SAMPLES}x${SAMPLES} supersampled) -> 112 @2x and 56 @1x\n`,
  );

  const rows = [];
  let failures = 0;

  for (const icon of ICON_SET) {
    const t0 = Date.now();
    const big = renderIcon(MARKS[icon.name]);
    const renderMs = Date.now() - t0;

    const at2x = downsample(big, RENDER_SIZE, RENDER_SIZE, 4); // 112
    const at1x = downsample(big, RENDER_SIZE, RENDER_SIZE, 8); // 56

    const padding = minPadding(at2x.rgba, at2x.width);

    const files = [
      [`${icon.name}.png`, at1x],
      [`${icon.name}@2x.png`, at2x],
    ];

    const sizes = [];
    for (const [name, img] of files) {
      const png = encodePNG(img.rgba, img.width, img.height, { level: 9 });
      const path = join(OUT, name);
      await writeFile(path, png);
      const { size } = await stat(path);
      sizes.push([name, img.width, size]);
      if (size > BUDGET_BYTES) {
        failures++;
        console.error(`  OVER BUDGET: ${name} is ${size} bytes (limit ${BUDGET_BYTES})`);
      }
    }

    rows.push({ icon: icon.name, padding, renderMs, sizes });
    console.log(
      `  ${icon.name.padEnd(13)} ${String(at1x.width).padStart(3)}px ${String(sizes[0][2]).padStart(6)}B   ` +
        `${String(at2x.width).padStart(3)}px ${String(sizes[1][2]).padStart(6)}B   ` +
        `padding ${(padding * 100).toFixed(1)}%  ${renderMs}ms`,
    );
  }

  const total = rows.reduce((s, r) => s + r.sizes[0][2] + r.sizes[1][2], 0);
  console.log(`\n${rows.length * 2} PNGs written to public/assets/icons/3d/`);
  console.log(`Total icon payload: ${total} bytes (${(total / 1024).toFixed(1)} KB)`);

  const tight = rows.filter((r) => r.padding < 0.09);
  if (tight.length) {
    console.error(
      `\nPadding below ~10% on: ${tight.map((t) => `${t.icon} (${(t.padding * 100).toFixed(1)}%)`).join(', ')}`,
    );
    failures++;
  }

  if (!existsSync(OUT)) throw new Error(`Output directory missing: ${OUT}`);
  if (failures) {
    console.error(`\n${failures} asset budget/padding violation(s).`);
    process.exit(1);
  }
  console.log('\nAll icons within budget.');
}

main().catch((err) => {
  console.error('make-icons failed:', err);
  process.exit(1);
});
