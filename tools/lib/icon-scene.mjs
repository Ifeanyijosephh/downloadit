/**
 * tools/lib/icon-scene.mjs — the shared 3D icon scene (camera, light, materials).
 *
 * Pulled out so every consumer — the 14 icons, the favicons and the og-cover —
 * provably renders with the same camera, the same key/rim lights and the same
 * matte-plastic materials (§7 consistency contract).
 */
import { renderFrame, makeCamera, roundBox } from './renderer.mjs';

/* ------------------------------------------------------------------- geometry */
export const PLATE = { hx: 0.52, hy: 0.52, hz: 0.075, r: 0.13, z: -0.09 };
export const MARK = { z0: -0.045, z1: 0.115, r: 0.028 };

/** Rounded extrusion of a 2D SDF along Z between z0 and z1. */
export function extrude(x, y, z, sdf2, z0, z1, r) {
  const d2 = sdf2(x, y);
  const mid = (z0 + z1) / 2;
  const half = (z1 - z0) / 2;
  const dz = Math.abs(z - mid) - half;
  const qx = d2 - r;
  const qz = dz - r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** Shared camera orientation (upper-left-front, isometric-ish 3/4 view). */
export const EYE = [-3.9, 3.5, 5.9];

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export const LIGHT = {
  key: { dir: norm3(-0.55, 0.72, 0.42), color: [255, 248, 236], intensity: 1.5 },
  rim: { dir: norm3(0.7, 0.25, -0.6), color: [122, 172, 255], intensity: 0.95 },
  ambient: { sky: [152, 184, 238], ground: [20, 28, 50], intensity: 0.5 },
  shadowStrength: 0.2,
  eye: EYE,
};

export const PLATE_MAT = { base: [23, 37, 64], rough: 0.5, subsurface: 0.16 };
export const markMat = (colour) => ({ base: colour, rough: 0.34, subsurface: 0.3 });

export function buildParts(shapes) {
  const plateSdf = (x, y, z) =>
    roundBox(x, y, z - PLATE.z, PLATE.hx, PLATE.hy, PLATE.hz, PLATE.r);
  const parts = shapes.map((s) => ({
    sdf: (x, y, z) => extrude(x, y, z, s.sdf, MARK.z0, MARK.z1 + (s.raise ?? 0), MARK.r),
    mat: markMat(s.colour),
  }));
  const combined = (x, y, z) => {
    let d = plateSdf(x, y, z);
    for (const p of parts) d = Math.min(d, p.sdf(x, y, z));
    return d;
  };
  const surface = (p) => {
    let best = plateSdf(p[0], p[1], p[2]);
    let mat = PLATE_MAT;
    for (const part of parts) {
      const d = part.sdf(p[0], p[1], p[2]);
      if (d <= best) {
        best = d;
        mat = part.mat;
      }
    }
    return { mat, alpha: 1 };
  };
  return { combined, surface };
}

/** Render one icon RGBA at the given ortho scale / size / samples. */
export function renderIconScene(shapes, { ortho, size, samples }) {
  const { combined, surface } = buildParts(shapes);
  return renderFrame({
    width: size,
    height: size,
    sdf: combined,
    camera: makeCamera({ eye: EYE, target: [0, 0, 0], up: [0, 1, 0], aspect: 1, ortho }),
    maxSteps: 110,
    maxDist: 18,
    opaque: false,
    samples,
    exposure: 1.05,
    background: () => [0, 0, 0],
    light: LIGHT,
    surface,
  });
}
