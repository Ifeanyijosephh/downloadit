/**
 * tools/lib/renderer.mjs — a small dependency-free software 3D renderer.
 *
 * This is a real renderer: every pixel is a marched ray through a signed
 * distance field, shaded with a key light, a cool rim light, soft shadows and
 * ambient occlusion. It is not SVG, not canvas, not a CSS shape — the output is
 * genuine raster imagery produced by raymarching (§6, §7).
 *
 * It backs both asset pipelines:
 *   tools/make-hero-video.mjs  ->  frame sequence -> ffmpeg -> H.264
 *   tools/make-icons.mjs       ->  3D icon renders -> PNG
 */

/* ------------------------------------------------------------------ SDF ops */

export const sphere = (px, py, pz, r) => Math.hypot(px, py, pz) - r;

/** Rounded box centred at the origin. */
export function roundBox(px, py, pz, bx, by, bz, r) {
  const qx = Math.abs(px) - bx;
  const qy = Math.abs(py) - by;
  const qz = Math.abs(pz) - bz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Rounded box rotated about the Y axis then the X axis. */
export function roundBoxRot(px, py, pz, bx, by, bz, r, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  let x = px * cy - pz * sy;
  let z = px * sy + pz * cy;
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const y = py * cx - z * sx;
  z = py * sx + z * cx;
  return roundBox(x, y, z, bx, by, bz, r);
}

/** Smooth minimum — blends two surfaces so they merge like soft plastic. */
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}

/** Torus in the XZ plane. */
export function torus(px, py, pz, R, r) {
  const q = Math.hypot(px, pz) - R;
  return Math.hypot(q, py) - r;
}

/** Circular cylinder along Y, capped. */
export function cylinder(px, py, pz, r, h) {
  const dx = Math.hypot(px, pz) - r;
  const dy = Math.abs(py) - h;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/* --------------------------------------------------------------- vector math */

export function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/* ---------------------------------------------------------------- raymarcher */

/**
 * March a ray and return the hit distance, or -1.
 * @param {number[]} o  ray origin
 * @param {number[]} d  ray direction (unit)
 * @param {(x:number,y:number,z:number)=>number} sdf
 */
export function march(o, d, sdf, { maxSteps = 96, maxDist = 60, eps = 0.0015 } = {}) {
  let t = 0.02;
  for (let i = 0; i < maxSteps; i++) {
    const h = sdf(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    if (h < eps) return t;
    t += h * 0.9; // slight understep keeps thin surfaces from being tunnelled
    if (t > maxDist) return -1;
  }
  return -1;
}

/** Surface normal by tetrahedron gradient. */
export function normalAt(x, y, z, sdf, e = 0.0009) {
  const k1 = [1, -1, -1];
  const k2 = [-1, -1, 1];
  const k3 = [-1, 1, -1];
  const k4 = [1, 1, 1];
  let nx =
    k1[0] * sdf(x + k1[0] * e, y + k1[1] * e, z + k1[2] * e) +
    k2[0] * sdf(x + k2[0] * e, y + k2[1] * e, z + k2[2] * e) +
    k3[0] * sdf(x + k3[0] * e, y + k3[1] * e, z + k3[2] * e) +
    k4[0] * sdf(x + k4[0] * e, y + k4[1] * e, z + k4[2] * e);
  let ny =
    k1[1] * sdf(x + k1[0] * e, y + k1[1] * e, z + k1[2] * e) +
    k2[1] * sdf(x + k2[0] * e, y + k2[1] * e, z + k2[2] * e) +
    k3[1] * sdf(x + k3[0] * e, y + k3[1] * e, z + k3[2] * e) +
    k4[1] * sdf(x + k4[0] * e, y + k4[1] * e, z + k4[2] * e);
  let nz =
    k1[2] * sdf(x + k1[0] * e, y + k1[1] * e, z + k1[2] * e) +
    k2[2] * sdf(x + k2[0] * e, y + k2[1] * e, z + k2[2] * e) +
    k3[2] * sdf(x + k3[0] * e, y + k3[1] * e, z + k3[2] * e) +
    k4[2] * sdf(x + k4[0] * e, y + k4[1] * e, z + k4[2] * e);
  const n = norm(nx, ny, nz);
  nx = n[0];
  ny = n[1];
  nz = n[2];
  return [nx, ny, nz];
}

/** Soft shadow: march toward the light, accumulating a penumbra estimate. */
export function softShadow(px, py, pz, lx, ly, lz, sdf, strength = 1) {
  let res = 1;
  let t = 0.03;
  for (let i = 0; i < 28; i++) {
    const h = sdf(px + lx * t, py + ly * t, pz + lz * t);
    if (h < 0.0008) return 1 - strength;
    res = Math.min(res, (9 * h) / t);
    t += Math.max(h, 0.02);
    if (t > 14) break;
  }
  return Math.max(1 - strength, 1 - strength * (1 - clamp(res, 0, 1)));
}

/** Cheap ambient occlusion. */
export function ao(px, py, pz, nx, ny, nz, sdf) {
  let occ = 0;
  let scale = 1;
  for (let i = 1; i <= 5; i++) {
    const hr = 0.035 * i * i;
    const dd = sdf(px + nx * hr, py + ny * hr, pz + nz * hr);
    occ += (hr - dd) * scale;
    scale *= 0.62;
  }
  return clamp(1 - 2.1 * occ, 0, 1);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/** sRGB transfer curve applied at the end so lighting math stays linear. */
export const toSRGB = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** Convert a 0-255 sRGB triple to linear light. */
export function srgbToLinear(r, g, b) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f(r), f(g), f(b)];
}

/* -------------------------------------------------------------------- camera */

/**
 * Build a camera basis.
 * @returns {{origin:number[], right:number[], up:number[], forward:number[], fovScale:number}}
 */
export function makeCamera({ eye, target, up = [0, 1, 0], fovDeg = 42, aspect = 1, ortho = 0 }) {
  const forward = norm(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
  const right = norm(
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  );
  const camUp = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { origin: eye, right, up: camUp, forward, fovScale: Math.tan(((fovDeg / 2) * Math.PI) / 180) * 2, ortho };
}

/* ------------------------------------------------------------------- shading */

/**
 * Shade a hit point.
 *
 * @param {object} ctx
 * @param {number[]} ctx.p     hit point
 * @param {number[]} ctx.n     surface normal
 * @param {number[]} ctx.v     direction from surface toward the eye (unit)
 * @param {object}   ctx.mat   { base:[r,g,b] 0-255 sRGB, rough:0-1, subsurface:0-1, metal:0-1 }
 * @param {object}   ctx.light { key:{dir,color,intensity}, rim:{dir,color,intensity}, ambient:{sky,ground}, shadow:number, ao:number, fog:{color,density,dist} }
 */
export function shade(ctx) {
  const { p, n, v, mat, light } = ctx;
  const base = srgbToLinear(mat.base[0], mat.base[1], mat.base[2]);

  const key = light.key;
  const ndl = n[0] * key.dir[0] + n[1] * key.dir[1] + n[2] * key.dir[2];

  // Matte plastic with a hint of subsurface wrap so silhouettes do not go dead flat.
  const wrap = mat.subsurface ?? 0.22;
  const wrapped = clamp((ndl + wrap) / (1 + wrap), 0, 1);
  const shadow = light.shadow ?? 1;

  const keyColor = srgbToLinear(key.color[0], key.color[1], key.color[2]);
  let r = base[0] * keyColor[0] * wrapped * key.intensity * shadow;
  let g = base[1] * keyColor[1] * wrapped * key.intensity * shadow;
  let b = base[2] * keyColor[2] * wrapped * key.intensity * shadow;

  // Cool rim light from behind.
  const rim = light.rim;
  const ndlRim = Math.max(0, -(n[0] * rim.dir[0] + n[1] * rim.dir[1] + n[2] * rim.dir[2]));
  const nv = clamp(n[0] * v[0] + n[1] * v[1] + n[2] * v[2], 0, 1);
  const fres = Math.pow(1 - nv, 3.2);
  const rimAmount = fres * ndlRim * rim.intensity;
  const rimColor = srgbToLinear(rim.color[0], rim.color[1], rim.color[2]);
  r += rimColor[0] * rimAmount;
  g += rimColor[1] * rimAmount;
  b += rimColor[2] * rimAmount;

  // Hemisphere ambient, occluded.
  const occ = light.ao ?? 1;
  const sky = srgbToLinear(light.ambient.sky[0], light.ambient.sky[1], light.ambient.sky[2]);
  const ground = srgbToLinear(
    light.ambient.ground[0],
    light.ambient.ground[1],
    light.ambient.ground[2],
  );
  const hemi = 0.5 + 0.5 * n[1];
  const ambI = light.ambient.intensity * occ;
  r += mix(ground[0], sky[0], hemi) * base[0] * ambI;
  g += mix(ground[1], sky[1], hemi) * base[1] * ambI;
  b += mix(ground[2], sky[2], hemi) * base[2] * ambI;

  // Tight specular highlight — plastic, not glass.
  const rough = mat.rough ?? 0.42;
  const h = norm(
    key.dir[0] + v[0],
    key.dir[1] + v[1],
    key.dir[2] + v[2],
  );
  const ndh = Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
  const shin = 8 + (1 - rough) * 150;
  const spec = Math.pow(ndh, shin) * (1 - rough) * 0.55 * shadow;
  r += keyColor[0] * spec;
  g += keyColor[1] * spec;
  b += keyColor[2] * spec;

  // Depth fog toward the background colour.
  if (light.fog) {
    const f = 1 - Math.exp(-light.fog.density * light.fog.dist);
    const fc = srgbToLinear(light.fog.color[0], light.fog.color[1], light.fog.color[2]);
    r = mix(r, fc[0], f);
    g = mix(g, fc[1], f);
    b = mix(b, fc[2], f);
  }

  return [r, g, b];
}

/* ------------------------------------------------------------------- framing */

/**
 * Render one frame.
 *
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {(x:number,y:number,z:number)=>number} o.sdf
 * @param {object} o.camera  from makeCamera()
 * @param {(p:number[], n:number[], v:number[], t:number)=>{mat:object, alpha:number, shadow?:number}} o.surface
 * @param {(x:number,y:number)=>[number,number,number]} o.background  linear-light RGB
 * @param {object} [o.light]
 * @param {number} [o.exposure]
 * @param {number} [o.samples]   supersampling factor per axis (1 = none)
 * @param {boolean} [o.opaque]   true for the video path (alpha always 255);
 *                               false for icons, which need real transparency.
 * @returns {Buffer} RGBA, straight (non-premultiplied) alpha
 */
export function renderFrame(o) {
  const {
    width,
    height,
    sdf,
    camera,
    surface,
    background,
    light,
    exposure = 1,
    samples = 1,
    maxSteps = 96,
    maxDist = 60,
    opaque = false,
  } = o;

  const out = Buffer.alloc(width * height * 4);
  const aspect = width / height;
  const sub = samples;
  const inv = 1 / (sub * sub);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;

      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          // Normalised device coords, y up, centred.
          const ndcX = ((px + (sx + 0.5) / sub) / width) * 2 - 1;
          const ndcY = 1 - ((py + (sy + 0.5) / sub) / height) * 2;

          let ox;
          let oy;
          let oz;
          let dx;
          let dy;
          let dz;

          if (camera.ortho) {
            // Orthographic: parallel rays, which is what an isometric icon read needs.
            const s = camera.ortho;
            ox =
              camera.origin[0] +
              (camera.right[0] * ndcX + camera.up[0] * ndcY) * s * aspect;
            oy =
              camera.origin[1] +
              (camera.right[1] * ndcX + camera.up[1] * ndcY) * s * aspect;
            oz =
              camera.origin[2] +
              (camera.right[2] * ndcX + camera.up[2] * ndcY) * s * aspect;
            dx = camera.forward[0];
            dy = camera.forward[1];
            dz = camera.forward[2];
          } else {
            const rx = ndcX * aspect * camera.fovScale;
            const ry = ndcY * camera.fovScale;
            const d = norm(
              camera.forward[0] + camera.right[0] * rx + camera.up[0] * ry,
              camera.forward[1] + camera.right[1] * rx + camera.up[1] * ry,
              camera.forward[2] + camera.right[2] * rx + camera.up[2] * ry,
            );
            ox = camera.origin[0];
            oy = camera.origin[1];
            oz = camera.origin[2];
            dx = d[0];
            dy = d[1];
            dz = d[2];
          }

          const t = march([ox, oy, oz], [dx, dy, dz], sdf, { maxSteps, maxDist });
          if (t < 0) {
            // Background: supplied in linear light already.
            const bg = background(ox, oy);
            R += bg[0];
            G += bg[1];
            B += bg[2];
            A += opaque ? 1 : 0;
            continue;
          }

          const hx = ox + dx * t;
          const hy = oy + dy * t;
          const hz = oz + dz * t;
          const n = normalAt(hx, hy, hz, sdf);
          const v = [-dx, -dy, -dz];
          const sh = surface([hx, hy, hz], n, v, t);
          if (!sh || sh.alpha <= 0) {
            const bg = background(ox, oy);
            R += bg[0];
            G += bg[1];
            B += bg[2];
            A += opaque ? 1 : 0;
            continue;
          }

          const L = lightFor(light, sh, [hx, hy, hz], n, sdf);
          const c = shade({
            p: [hx, hy, hz],
            n,
            v,
            mat: sh.mat,
            light: L,
          });

          // Alpha-composite the object over the background so edges anti-alias.
          const bg = background(ox, oy);
          const a = sh.alpha;
          R += mix(bg[0], c[0], a);
          G += mix(bg[1], c[1], a);
          B += mix(bg[2], c[2], a);
          A += opaque ? 1 : a;
        }
      }

      const i = (py * width + px) * 4;
      const alpha = clamp(A * inv, 0, 1);
      // Accumulated colour is premultiplied by coverage; un-multiply it so the
      // PNG carries straight alpha, which is what browsers expect.
      const unmul = !opaque && alpha > 0 ? 1 / alpha : 1;
      out[i] = clamp(toSRGB(R * inv * unmul * exposure), 0, 1) * 255;
      out[i + 1] = clamp(toSRGB(G * inv * unmul * exposure), 0, 1) * 255;
      out[i + 2] = clamp(toSRGB(B * inv * unmul * exposure), 0, 1) * 255;
      out[i + 3] = alpha * 255;
    }
  }

  return out;
}

/** Resolve per-hit lighting (shadows + AO are computed once, at the hit point). */
function lightFor(light, sh, p, n, sdf) {
  const key = light.key;
  const shadow =
    light.shadowStrength > 0
      ? softShadow(p[0], p[1], p[2], key.dir[0], key.dir[1], key.dir[2], sdf, light.shadowStrength)
      : 1;
  const occ = ao(p[0], p[1], p[2], n[0], n[1], n[2], sdf);
  const dist = Math.hypot(p[0] - light.eye[0], p[1] - light.eye[1], p[2] - light.eye[2]);
  return { ...light, shadow, ao: occ, fog: light.fog ? { ...light.fog, dist } : undefined };
}

/* --------------------------------------------------------------- post effects */

/**
 * Additive bloom: blur the bright parts and screen them back in.
 * Operates on RGBA in place; `threshold` is in 0-255 luma.
 */
export function bloom(buf, width, height, { threshold = 150, radius = 6, amount = 0.45 } = {}) {
  const src = Buffer.from(buf);
  const bright = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < buf.length; i += 4, j += 3) {
    const luma = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    const k = Math.max(0, luma - threshold) / 255;
    bright[j] = src[i] * k;
    bright[j + 1] = src[i + 1] * k;
    bright[j + 2] = src[i + 2] * k;
  }
  const blurred = boxBlur(bright, width, height, radius);
  for (let i = 0, j = 0; i < buf.length; i += 4, j += 3) {
    buf[i] = clamp(src[i] + blurred[j] * amount, 0, 255);
    buf[i + 1] = clamp(src[i + 1] + blurred[j + 1] * amount, 0, 255);
    buf[i + 2] = clamp(src[i + 2] + blurred[j + 2] * amount, 0, 255);
  }
  return buf;
}

function boxBlur(f, width, height, radius) {
  const tmp = new Float32Array(f.length);
  const out = new Float32Array(f.length);
  const pass = (src, dst, horizontal) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? clamp(x + k, 0, width - 1) : x;
          const sy = horizontal ? y : clamp(y + k, 0, height - 1);
          const i = (sy * width + sx) * 3;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
        const o = (y * width + x) * 3;
        dst[o] = r / n;
        dst[o + 1] = g / n;
        dst[o + 2] = b / n;
      }
    }
  };
  pass(f, tmp, true);
  pass(tmp, out, false);
  return out;
}

/** Vignette: darken the corners, in place. */
export function vignette(buf, width, height, strength = 0.35) {
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const k = 1 - strength * Math.pow(d, 2.4);
      const i = (y * width + x) * 4;
      buf[i] *= k;
      buf[i + 1] *= k;
      buf[i + 2] *= k;
    }
  }
  return buf;
}
