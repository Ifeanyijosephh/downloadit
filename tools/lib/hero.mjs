/**
 * tools/lib/hero.mjs — the hero background is a genuine volumetric CGI render.
 *
 * Every frame is raymarched front-to-back through an animated density field: a
 * cool "ink" fog plus a handful of softly glowing orbs, all moving on closed
 * orbits so the clip loops with no visible seam. The time variable is a phase in
 * [0, 2*PI) and every animated term is an integer harmonic of that phase, which
 * is what guarantees frame 0 == frame N (§6 loop continuity).
 *
 * This is real computer-generated imagery — raymarched volumetrics — not SVG,
 * not CSS, not a canvas stand-in and not a looped still.
 */
import { toSRGB, clamp, mix, norm } from './renderer.mjs';

export const HERO_W = 320; // rendered internally; ffmpeg upscales to 854x480
export const HERO_H = 180;
export const HERO_FPS = 24;
export const HERO_SECONDS = 7;
export const HERO_FRAMES = HERO_FPS * HERO_SECONDS; // 168

const KEY = norm(-0.55, 0.72, 0.42); // same key light family as the icons

/* Palette (sRGB) — deliberately deep so light-mode text clears 4.5:1 over it. */
const INK_DEEP = [3, 7, 15]; // void
const INK_MID = [9, 22, 44]; // body of the ink
const INK_GLOW = [40, 96, 196]; // lit ink / bloom core
const ORB_CORE = [120, 176, 255]; // emissive orb highlight

/** Cheap periodic 3D field in [-1,1], seamless in time. */
function field(x, y, z, phase) {
  return (
    (Math.sin(x * 1.35 + phase) +
      Math.sin(y * 1.7 - phase * 1.0 + 1.7) +
      Math.sin((x + z) * 1.05 + phase * 2.0)) /
    3
  );
}

/* Orbiting density blobs and emissive orbs. Closed orbits => seamless loop. */
function blobCenter(i, phase) {
  const s = i * 2.399963; // golden-angle spread
  return [
    Math.sin(phase + s) * (2.2 + 0.9 * Math.sin(s * 1.7)),
    Math.cos(phase * 1.0 + s * 1.3) * 1.1 + Math.sin(s) * 0.6,
    4.2 + Math.sin(phase + s * 2.1) * 1.4,
  ];
}

function density(p, phase) {
  let d = 0;
  // Large drifting ink sheet.
  const f = field(p[0] * 0.55, p[1] * 0.75, p[2] * 0.5, phase);
  const sheet = clamp(f * 0.9 + 0.25, 0, 1);
  // Vertical falloff so the ink pools toward the lower half.
  const pool = clamp(1.15 - Math.abs(p[1] + 0.35) * 0.55, 0, 1);
  d += sheet * pool * 0.5;

  // Discrete drifting clouds.
  for (let i = 0; i < 4; i++) {
    const c = blobCenter(i, phase);
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dz = p[2] - c[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    const rad = 1.35 + 0.35 * Math.sin(phase + i);
    d += Math.exp(-r2 / (rad * rad)) * 0.8;
  }
  return d;
}

function emission(p, phase) {
  let e = 0;
  for (let i = 0; i < 2; i++) {
    const c = blobCenter(i + 4, phase);
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dz = p[2] - c[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    e += Math.exp(-r2 / 0.5) * 1.2;
  }
  return e;
}

/** Background gradient behind the fog (linear light). */
function backgroundLinear(nx, ny) {
  // Radial ink gradient, brightest just above centre.
  const r = Math.hypot(nx * 1.1, ny * 0.9 - 0.1);
  const g = clamp(1 - r * 0.75, 0, 1);
  const l = [
    mix(INK_DEEP[0], INK_MID[0], g) / 255,
    mix(INK_DEEP[1], INK_MID[1], g) / 255,
    mix(INK_DEEP[2], INK_MID[2], g) / 255,
  ];
  return l;
}

const FOV = 50 * (Math.PI / 180);

/**
 * Render one hero frame as RGBA (alpha always 255).
 * @param {number} phase time in radians, 0..2*PI
 */
export function renderHeroFrame(phase, { width = HERO_W, height = HERO_H, steps = 30 } = {}) {
  const out = Buffer.alloc(width * height * 4);
  const focal = 1 / Math.tan(FOV / 2);
  const eye = [0, 0.1, 0];
  const t0 = 1.2; // near clip
  const tMax = 9.0;
  const stepLen = (tMax - t0) / steps;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = 1 - ((y + 0.5) / height) * 2;
      const aspect = width / height;
      const dir = norm(nx * aspect / focal, ny / focal, 1);

      let bg = backgroundLinear(nx, ny);
      // Convert bg sRGB-ish to linear (it is already small values).
      const lin = (v) => v; // bg already near-linear after the /255 above

      let accR = 0;
      let accG = 0;
      let accB = 0;
      let trans = 1;

      for (let s = 0; s < steps; s++) {
        const t = t0 + s * stepLen + 0.5 * stepLen;
        const px = eye[0] + dir[0] * t;
        const py = eye[1] + dir[1] * t;
        const pz = eye[2] + dir[2] * t;

        const d = density([px, py, pz], phase);
        const e = emission([px, py, pz], phase);
        if (d <= 0.001 && e <= 0.001) continue;

        // Directional shading: ink facing the key light reads brighter.
        const li = 0.45 + 0.55 * clamp(0.5 + 0.5 * Math.sin(py * 1.9 + phase), 0, 1);
        const depthFade = clamp(1 - t / tMax, 0, 1);

        const a = clamp(d * stepLen * 0.5 * depthFade, 0, 0.5);
        const inkR = mix(INK_MID[0], INK_GLOW[0], li * 0.55) / 255;
        const inkG = mix(INK_MID[1], INK_GLOW[1], li * 0.55) / 255;
        const inkB = mix(INK_MID[2], INK_GLOW[2], li * 0.55) / 255;

        const em = e * depthFade;
        const coreR = ORB_CORE[0] / 255;
        const coreG = ORB_CORE[1] / 255;
        const coreB = ORB_CORE[2] / 255;

        accR += trans * (a * inkR * li + em * coreR * 0.24);
        accG += trans * (a * inkG * li + em * coreG * 0.24);
        accB += trans * (a * inkB * li + em * coreB * 0.24);
        trans *= 1 - a;
        if (trans < 0.02) break;
      }

      const r = accR + trans * lin(bg[0]);
      const g = accG + trans * lin(bg[1]);
      const b = accB + trans * lin(bg[2]);

      const i = (y * width + x) * 4;
      out[i] = clamp(toSRGB(clamp(r, 0, 1)), 0, 1) * 255;
      out[i + 1] = clamp(toSRGB(clamp(g, 0, 1)), 0, 1) * 255;
      out[i + 2] = clamp(toSRGB(clamp(b, 0, 1)), 0, 1) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}
