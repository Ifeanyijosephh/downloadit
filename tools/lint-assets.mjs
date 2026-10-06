#!/usr/bin/env node
/**
 * tools/lint-assets.mjs — the asset gate (§2, §10).
 *
 *   - no .svg anywhere under public/
 *   - hero video <= 2 MB, poster <= 60 KB
 *   - all 14 icons (+@2x) present, each <= 12 KB
 *   - favicons <= 30 KB, og-cover <= 150 KB
 *   - the five Poppins woff2 + LICENSE.txt present
 *   - every /assets/... and /fonts/... path referenced by index.html or
 *     styles.css resolves to a real file (a 404 in the console is a failure)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const KB = 1024;
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const size = (p) => (existsSync(p) ? statSync(p).size : -1);

/* walk public/ */
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const all = walk(PUB);

/* 1. no svg */
const svgs = all.filter((p) => p.endsWith('.svg'));
if (svgs.length) fail(`.svg files present: ${svgs.join(', ')}`);
else ok('no .svg files under public/');

/* 2. budgets */
const budget = (rel, max) => {
  const s = size(join(PUB, rel));
  if (s < 0) fail(`${rel} missing`);
  else if (s > max) fail(`${rel} is ${s} bytes > ${max}`);
  else ok(`${rel} ${(s / KB).toFixed(1)} KB <= ${max / KB} KB`);
};
budget('assets/hero-background.mp4', 2 * 1024 * KB);
budget('assets/hero-poster.webp', 60 * KB);
budget('assets/og-cover.png', 150 * KB);
budget('assets/favicon-32.png', 30 * KB);
budget('assets/favicon-180.png', 30 * KB);
budget('assets/favicon.ico', 30 * KB);

/* 3. icons present + budget */
const icons = ['youtube', 'instagram', 'tiktok', 'x', 'facebook', 'vimeo', 'snapchat', 'pinterest', 'reddit', 'linkedin', 'search', 'download', 'theme-light', 'theme-dark'];
for (const n of icons) {
  budget(`assets/icons/3d/${n}.png`, 12 * KB);
  budget(`assets/icons/3d/${n}@2x.png`, 12 * KB);
}

/* 4. fonts */
for (const w of ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold']) budget(`fonts/Poppins-${w}.woff2`, 200 * KB);
budget('fonts/LICENSE.txt', 200 * KB);

/* 5. referenced paths resolve */
const refs = new Set();
for (const f of ['index.html', 'styles.css']) {
  const text = readFileSync(join(PUB, f), 'utf8');
  for (const m of text.matchAll(/["'(](\/(?:assets|fonts)\/[^"')?#]+)/g)) refs.add(m[1].split(/\s+/)[0]);
}
for (const r of refs) {
  if (!existsSync(join(PUB, r))) fail(`referenced but missing: ${r}`);
}
ok(`${refs.size} referenced /assets + /fonts paths checked`);

console.log(failures ? `\n${failures} asset lint failure(s).` : '\nlint:assets passed.');
process.exit(failures ? 1 : 0);
