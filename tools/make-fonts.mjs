#!/usr/bin/env node
/**
 * tools/make-fonts.mjs
 *
 * Copies the Poppins latin woff2 subsets out of the `@fontsource/poppins`
 * devDependency into public/fonts/ under the filenames styles.css references.
 *
 * Why npm and not fonts.googleapis.com: the app must render correctly offline
 * (§5), so no runtime CDN. The devDependency is a build-time source only — it
 * is never imported by shipped code and lives in git-ignored node_modules.
 *
 * Licence: SIL Open Font License 1.1. Poppins is (c) the Indian Type Foundry.
 * The upstream LICENSE is copied verbatim to public/fonts/LICENSE.txt.
 *
 * Regenerate:  npm run assets:fonts
 */
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'fonts');

// [public filename, fontsource weight, CSS font-weight]
const WEIGHTS = [
  ['Poppins-Light.woff2', 300, 300],
  ['Poppins-Regular.woff2', 400, 400],
  ['Poppins-Medium.woff2', 500, 500],
  ['Poppins-SemiBold.woff2', 600, 600],
  ['Poppins-Bold.woff2', 700, 700],
];

function fontsourceDir() {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require.resolve('@fontsource/poppins/package.json');
    return dirname(pkg);
  } catch {
    // Fall back to a plain path probe so the script still explains itself
    // when run before `npm install`.
    const guess = join(ROOT, 'node_modules', '@fontsource', 'poppins');
    if (existsSync(guess)) return guess;
    throw new Error(
      '@fontsource/poppins not found. Run `npm install` first, then `npm run assets:fonts`.',
    );
  }
}

async function main() {
  const src = fontsourceDir();
  const filesDir = join(src, 'files');
  if (!existsSync(filesDir)) {
    throw new Error(`Expected ${filesDir} to exist — @fontsource/poppins layout changed?`);
  }
  await mkdir(OUT, { recursive: true });

  let total = 0;
  for (const [name, weight] of WEIGHTS) {
    // `-latin-<w>-normal` is the latin subset, upright (non-italic) cut.
    const from = join(filesDir, `poppins-latin-${weight}-normal.woff2`);
    if (!existsSync(from)) throw new Error(`Missing source font: ${from}`);
    const to = join(OUT, name);
    await copyFile(from, to);
    const { size } = await stat(to);
    total += size;
    console.log(`  fonts/${name.padEnd(22)} ${String(weight).padStart(3)}  ${size} bytes`);
  }

  const upstreamLicence = join(src, 'LICENSE');
  if (!existsSync(upstreamLicence)) throw new Error(`Missing ${upstreamLicence}`);
  const body = await readFile(upstreamLicence, 'utf8');
  const header = [
    'DownloadIt ships Poppins as a self-hosted webfont (no runtime CDN).',
    '',
    'Poppins is Copyright 2020 The Poppins Project Authors',
    '(https://github.com/itfoundry/Poppins) — the Indian Type Foundry.',
    'Files here are the latin subsets, copied unmodified from the',
    '@fontsource/poppins package (https://www.npmjs.com/package/@fontsource/poppins).',
    '',
    'Licence: SIL Open Font License, Version 1.1 — reproduced verbatim below.',
    '='.repeat(78),
    '',
  ].join('\n');
  await writeFile(join(OUT, 'LICENSE.txt'), header + body, 'utf8');
  console.log(`  fonts/LICENSE.txt           OFL-1.1`);
  console.log(`\nTotal font payload: ${total} bytes (${(total / 1024).toFixed(1)} KB, budget 200 KB)`);
}

main().catch((err) => {
  console.error('make-fonts failed:', err.message);
  process.exit(1);
});
