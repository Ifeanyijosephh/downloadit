/**
 * tools/lib/marks.mjs — the 2D signed-distance marks behind the 3D icon set.
 *
 * Each mark is one or more flat silhouettes built from boxes, circles and
 * capsules, then extruded into solid plastic by tools/make-icons.mjs. A mark is
 * a list of shapes so brand marks that are two-coloured (YouTube's white play
 * triangle on a red field, Instagram's white glyph on a pink frame) render
 * faithfully. Keeping the shapes in one file holds §7's consistency contract.
 */

/* ------------------------------------------------------- 2D shape primitives */

export const box2 = (x, y, hx, hy) => {
  const dx = Math.abs(x) - hx;
  const dy = Math.abs(y) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};

export const rbox2 = (x, y, hx, hy, r) => {
  const dx = Math.abs(x) - hx + r;
  const dy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};

export const circle2 = (x, y, r) => Math.hypot(x, y) - r;

export function capsule2(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay || 1e-9;
  let h = (pax * bax + pay * bay) / denom;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** Equilateral triangle of circumradius s, pointing +X. */
export function triRight(x, y, s) {
  const px = y / s;
  const py = -x / s;
  const k = Math.sqrt(3);
  let ax = Math.abs(px) - 1;
  let ay = py + 1 / k;
  if (ax + k * ay > 0) {
    const nx = (ax - k * ay) / 2;
    const ny = (-k * ax - ay) / 2;
    ax = nx;
    ay = ny;
  }
  ax -= Math.min(Math.max(ax, -2), 0);
  return -Math.hypot(ax, ay) * Math.sign(ay) * s;
}

/* ---------------------------------------------------------------- operators */

export const uni = (a, b) => Math.min(a, b);
export const sub = (a, b) => Math.max(a, -b);
export function smoothUni(a, b, k = 0.03) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}
export function smoothSub(a, b, k = 0.03) {
  const h = Math.max(k - Math.abs(a + b), 0) / k;
  return Math.max(a, -b) + h * h * h * k * (1 / 6);
}

/* -------------------------------------------------------------------- marks */

/**
 * Every mark is a list of { sdf(x,y)->distance, colour:[r,g,b], raise? }.
 * `raise` lifts a sub-shape slightly toward the camera (for inlaid details).
 * Silhouettes are drawn inside roughly [-0.36, 0.36] so the base plate supplies
 * the required 10% padding (§7).
 */
export const MARKS = {
  youtube: [
    { sdf: (x, y) => rbox2(x, y, 0.34, 0.245, 0.1), colour: [255, 30, 60] },
    { sdf: (x, y) => triRight(x - 0.012, y, 0.15), colour: [255, 255, 255], raise: 0.022 },
  ],

  instagram: [
    {
      sdf: (x, y) =>
        sub(rbox2(x, y, 0.3, 0.3, 0.135), rbox2(x, y, 0.215, 0.215, 0.095)),
      colour: [226, 72, 152],
    },
    {
      sdf: (x, y) =>
        smoothUni(
          sub(circle2(x, y, 0.135), circle2(x, y, 0.082)),
          circle2(x - 0.175, y - 0.175, 0.04),
          0.02,
        ),
      colour: [255, 255, 255],
      raise: 0.022,
    },
  ],

  tiktok: [
    {
      sdf: (x, y) => {
        const stem = capsule2(x, y, 0.045, -0.17, 0.045, 0.25, 0.075);
        const head = circle2(x + 0.045, y + 0.175, 0.125);
        const flag = capsule2(x, y, 0.045, 0.245, 0.215, 0.175, 0.062);
        return smoothUni(smoothUni(stem, flag, 0.03), head, 0.03);
      },
      colour: [48, 232, 227],
    },
  ],

  x: [
    {
      sdf: (x, y) => {
        const a = capsule2(x, y, -0.225, -0.25, 0.225, 0.25, 0.062);
        const b = capsule2(x, y, -0.225, 0.25, 0.225, -0.25, 0.062);
        return smoothUni(a, b, 0.012);
      },
      colour: [240, 245, 252],
    },
  ],

  facebook: [
    {
      sdf: (x, y) => {
        const stem = capsule2(x, y, 0.055, -0.31, 0.055, 0.2, 0.078);
        const hook = capsule2(x, y, 0.055, 0.2, -0.055, 0.285, 0.072);
        const bar = capsule2(x, y, -0.175, -0.02, 0.225, -0.02, 0.07);
        return smoothUni(smoothUni(stem, hook, 0.03), bar, 0.02);
      },
      colour: [72, 148, 255],
    },
  ],

  vimeo: [
    {
      sdf: (x, y) => {
        const a = capsule2(x, y, -0.235, 0.27, -0.01, -0.245, 0.072);
        const b = capsule2(x, y, 0.25, 0.29, -0.01, -0.245, 0.072);
        return smoothUni(a, b);
      },
      colour: [56, 200, 242],
    },
  ],

  snapchat: [
    {
      sdf: (x, y) => {
        const head = circle2(x, y - 0.055, 0.215);
        const body = rbox2(x, y - 0.215, 0.235, 0.085, 0.05);
        const l1 = circle2(x + 0.16, y + 0.25, 0.075);
        const l2 = circle2(x, y + 0.28, 0.078);
        const l3 = circle2(x - 0.16, y + 0.25, 0.075);
        const armL = triRight(-(x + 0.235), y + 0.02, 0.075);
        const armR = triRight(x - 0.235, y + 0.02, 0.075);
        return smoothUni(
          smoothUni(smoothUni(smoothUni(head, body, 0.06), smoothUni(l1, l2, 0.03), 0.03), l3, 0.03),
          smoothUni(armL, armR, 0.02),
          0.03,
        );
      },
      colour: [255, 236, 74],
    },
  ],

  pinterest: [
    {
      sdf: (x, y) => {
        const ring = sub(circle2(x - 0.005, y - 0.075, 0.215), circle2(x - 0.005, y - 0.075, 0.128));
        const stem = capsule2(x, y, -0.005, -0.075, -0.115, -0.315, 0.082);
        return smoothUni(ring, stem, 0.02);
      },
      colour: [242, 72, 92],
    },
  ],

  reddit: [
    {
      sdf: (x, y) => {
        const head = circle2(x, y - 0.015, 0.245);
        const earL = circle2(x + 0.275, y - 0.02, 0.062);
        const earR = circle2(x - 0.275, y - 0.02, 0.062);
        const stalk = capsule2(x, y, 0.05, -0.24, 0.135, -0.335, 0.032);
        const knob = circle2(x - 0.15, y + 0.335, 0.058);
        let d = smoothUni(smoothUni(head, smoothUni(earL, earR, 0.01), 0.01), stalk, 0.01);
        d = smoothUni(d, knob, 0.01);
        d = sub(d, circle2(x - 0.098, y + 0.03, 0.056));
        d = sub(d, circle2(x + 0.098, y + 0.03, 0.056));
        d = sub(d, capsule2(x, y, -0.085, -0.15, 0.085, -0.15, 0.026));
        return d;
      },
      colour: [255, 96, 51],
    },
  ],

  linkedin: [
    {
      sdf: (x, y) => {
        const dot = circle2(x + 0.185, y - 0.245, 0.078);
        const iStem = capsule2(x, y, -0.185, -0.245, -0.185, 0.075, 0.078);
        const nStem = capsule2(x, y, 0.085, -0.245, 0.085, 0.075, 0.078);
        const arch = capsule2(x, y, 0.085, 0.075, 0.245, 0.005, 0.075);
        const nLeg = capsule2(x, y, 0.245, 0.005, 0.245, -0.245, 0.078);
        return smoothUni(
          smoothUni(smoothUni(dot, iStem, 0.01), nStem, 0.02),
          smoothUni(arch, nLeg, 0.02),
          0.02,
        );
      },
      colour: [66, 152, 242],
    },
  ],

  search: [
    {
      sdf: (x, y) => {
        const cx = x + 0.035;
        const cy = y - 0.045;
        const ring = sub(circle2(cx, cy, 0.215), circle2(cx, cy, 0.145));
        const handle = capsule2(x, y, -0.135, 0.155, -0.3, 0.31, 0.052);
        return smoothUni(ring, handle, 0.02);
      },
      colour: [140, 186, 255],
    },
  ],

  download: [
    {
      sdf: (x, y) => {
        const shaft = capsule2(x, y, 0, -0.3, 0, 0.045, 0.078);
        const head = triRight(x, -(y + 0.135), 0.19);
        const tray = capsule2(x, y, -0.27, 0.3, 0.27, 0.3, 0.062);
        return smoothUni(smoothUni(shaft, head, 0.03), tray, 0.02);
      },
      colour: [140, 186, 255],
    },
  ],

  'theme-light': [
    {
      sdf: (x, y) => {
        const core = circle2(x, y, 0.155);
        let rays = core;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          rays = smoothUni(rays, capsule2(x, y, ca * 0.225, sa * 0.225, ca * 0.315, sa * 0.315, 0.042), 0.012);
        }
        return rays;
      },
      colour: [255, 205, 110],
    },
  ],

  'theme-dark': [
    {
      sdf: (x, y) => sub(circle2(x + 0.03, y + 0.02, 0.275), circle2(x - 0.085, y - 0.075, 0.235)),
      colour: [158, 180, 232],
    },
  ],
};

export const MARK_NAMES = Object.keys(MARKS);

/**
 * The 14 required icons (§7): 10 platforms + 4 UI, in the brief's order.
 */
export const ICON_SET = [
  { name: 'youtube', label: 'YouTube', group: 'platform' },
  { name: 'instagram', label: 'Instagram', group: 'platform' },
  { name: 'tiktok', label: 'TikTok', group: 'platform' },
  { name: 'x', label: 'X', group: 'platform' },
  { name: 'facebook', label: 'Facebook', group: 'platform' },
  { name: 'vimeo', label: 'Vimeo', group: 'platform' },
  { name: 'snapchat', label: 'Snapchat', group: 'platform' },
  { name: 'pinterest', label: 'Pinterest', group: 'platform' },
  { name: 'reddit', label: 'Reddit', group: 'platform' },
  { name: 'linkedin', label: 'LinkedIn', group: 'platform' },
  { name: 'search', label: 'Search', group: 'ui' },
  { name: 'download', label: 'Download', group: 'ui' },
  { name: 'theme-light', label: 'Light theme', group: 'ui' },
  { name: 'theme-dark', label: 'Dark theme', group: 'ui' },
];
