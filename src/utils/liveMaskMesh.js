// 3D face masks for the LIVE stream compositor.
//
// Deliberately a straight port of the native renderer
// (android/.../MaskMesh.kt) — same `.vgmesh` asset files, same projection, same
// half-Lambert + Blinn-Phong shading, same back-face cull and painter sort. A
// mask must look identical whether you are recording a Status or live on air;
// two independent implementations would drift apart the first time either is
// touched.
//
// The two bugs the native version hit are already fixed here, so do not
// "simplify" them back out:
//   - Y is NEGATED. 3D content is authored Y-up, canvas is Y-down; without the
//     flip the model renders upside down.
//   - SPECULAR is not optional. Eyewear and helmets are near-black, and a dark
//     base multiplied by diffuse alone lands at single-digit RGB — a flat
//     silhouette, which is what "looks like a cartoon" actually means.

const meshCache = new Map();

/** Load and parse a .vgmesh. Resolves null on any failure — masks are cosmetic. */
export async function loadMaskMesh(url) {
  if (meshCache.has(url)) return meshCache.get(url);
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const dv = new DataView(buf);
      const magic = String.fromCharCode(...new Uint8Array(buf, 0, 7));
      if (magic !== 'VGMESH1') return null;
      const vc = dv.getUint32(8, true);
      const ic = dv.getUint32(12, true);
      if (!vc || !ic || vc > 65535) return null;
      let o = 16;
      const pos = new Float32Array(buf, o, vc * 3); o += vc * 12;
      const nor = new Float32Array(buf, o, vc * 3); o += vc * 12;
      const idx = new Uint16Array(buf.slice(o, o + ic * 2));
      return {
        vc, pos, nor, idx,
        // Scratch buffers, allocated once per mesh — these are touched every
        // frame and per-frame allocation is a GC stall on a phone.
        sx: new Float32Array(vc), sy: new Float32Array(vc), sz: new Float32Array(vc),
        cr: new Float32Array(vc), cg: new Float32Array(vc), cb: new Float32Array(vc),
        tri: new Int32Array(ic / 3), depth: new Float32Array(ic / 3),
      };
    } catch { return null; }
  })();
  meshCache.set(url, p);
  return p;
}

/** Head-yaw proxy: eye midpoint drifting off the face centre. Mirrors estimateYaw(). */
export function estimateYaw(faceCentreX, faceWidth, eyeMidX) {
  if (!(faceWidth > 1)) return 0;
  const off = Math.max(-1, Math.min(1, (eyeMidX - faceCentreX) / (faceWidth * 0.5)));
  return Math.max(-0.9, Math.min(0.9, off * 0.9));
}

/**
 * Draw a mask onto a 2D canvas context, fitted between two eye points.
 * Triangles are filled individually: canvas has no depth buffer and no
 * Gouraud fill, so flat-shading each sorted triangle is the honest equivalent
 * of the native drawVertices path.
 */
export function drawMaskMesh(ctx, mesh, left, right, yaw, widthMul, rgb, envStrength = 95) {
  if (!mesh) return;
  const ex = right.x - left.x;
  const ey = right.y - left.y;
  const ipd = Math.hypot(ex, ey);
  if (ipd < 4) return;

  const roll = Math.atan2(ey, ex);
  const scale = ipd * widthMul;
  const cx = (left.x + right.x) / 2;
  const cy = (left.y + right.y) / 2;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cro = Math.cos(roll), sro = Math.sin(roll);

  const lx = -0.4, ly = -0.6, lz = 0.7;
  const hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz) || 1;

  const { vc, pos, nor, sx, sy, sz, cr, cg, cb, idx, tri, depth } = mesh;

  for (let v = 0; v < vc; v++) {
    const x0 = pos[v * 3];
    const y0 = -pos[v * 3 + 1]; // Y-up -> Y-down
    const z0 = pos[v * 3 + 2];
    const xa = x0 * cyw + z0 * syw;
    const za = -x0 * syw + z0 * cyw;
    sx[v] = cx + (xa * cro - y0 * sro) * scale;
    sy[v] = cy + (xa * sro + y0 * cro) * scale;
    sz[v] = za;

    const nx0 = nor[v * 3];
    const ny0 = -nor[v * 3 + 1];
    const nz0 = nor[v * 3 + 2];
    const na = nx0 * cyw + nz0 * syw;
    const nz = -nx0 * syw + nz0 * cyw;
    const nx = na * cro - ny0 * sro;
    const ny = na * sro + ny0 * cro;

    const d = nx * lx + ny * ly + nz * lz;
    const diff = Math.min(1, Math.max(0, 0.5 + 0.5 * d)) * 0.85 + 0.15;
    const sp = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    // Exponent 4 (not 8): a tight lobe lights a flat lens all-or-nothing, which
    // is how this first shipped looking like a silhouette.
    const s2 = sp * sp;
    const spec = s2 * s2 * 210;
    // Fresnel rim — draws the frame edge and lens rim, i.e. the SHAPE.
    const facing = Math.min(1, Math.abs(nz));
    const rt = 1 - facing;
    const rim = rt * rt * rt * 95;
    // Environment reflection. The measured difference between "a real object"
    // and "a black shape": mean brightness 11.9 -> 53.9 on the glasses model.
    const up = Math.min(1, Math.max(0, -ny * 0.5 + 0.5));
    const env = Math.pow(up, 1.4) * envStrength;
    const add = spec + rim + env;

    cr[v] = Math.min(255, rgb[0] * diff + add);
    cg[v] = Math.min(255, rgb[1] * diff + add);
    cb[v] = Math.min(255, rgb[2] * diff + add * 1.04);
  }

  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    // Signed area = back-face cull. Without it the inside of the frame paints
    // over the outside, since there is no depth buffer.
    if ((sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]) > 0) {
      tri[n] = t;
      depth[n] = sz[a] + sz[b] + sz[c];
      n++;
    }
  }
  if (!n) return;

  // Insertion sort, far to near: order barely changes between frames, so this
  // is near-linear here and allocates nothing (a comparator sort would box).
  for (let i = 1; i < n; i++) {
    const d = depth[i], o = tri[i];
    let j = i - 1;
    while (j >= 0 && depth[j] > d) { depth[j + 1] = depth[j]; tri[j + 1] = tri[j]; j--; }
    depth[j + 1] = d; tri[j + 1] = o;
  }

  for (let k = 0; k < n; k++) {
    const t = tri[k];
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    // Flat shade from the first vertex. Per-vertex gradients would need a mesh
    // gradient canvas has no primitive for, and at mask scale it is unnoticeable.
    ctx.fillStyle = `rgb(${cr[a] | 0},${cg[a] | 0},${cb[a] | 0})`;
    ctx.beginPath();
    ctx.moveTo(sx[a], sy[a]);
    ctx.lineTo(sx[b], sy[b]);
    ctx.lineTo(sx[c], sy[c]);
    ctx.closePath();
    ctx.fill();
  }
}

/** Mask registry, mirroring the native MASK_* set. */
export const LIVE_MASKS = {
  none: null,
  // Mirror of the native registry in ArCameraActivity.MASKS — same assets, same
  // numbers. If you change one, change the other; a mask that looks different
  // live from how it looked in the camera is a bug, not a variation.
  shades: { url: '/masks/glasses.vgmesh', widthMul: 2.15, rgb: [42, 42, 50], lift: 0, env: 95 },
  visor: { url: '/masks/visor.vgmesh', widthMul: 3.4, rgb: [52, 56, 68], lift: 0.75, env: 85 },
  dog: { url: '/masks/dog.vgmesh', widthMul: 2.6, rgb: [138, 106, 74], lift: 0.95, env: 70 },
  tiger: { url: '/masks/tiger.vgmesh', widthMul: 2.9, rgb: [200, 138, 58], lift: 0.25, env: 80 },
  werewolf: { url: '/masks/werewolf.vgmesh', widthMul: 3.0, rgb: [107, 90, 74], lift: -0.05, env: 75 },
  alien: { url: '/masks/matrixmask.vgmesh', widthMul: 2.4, rgb: [47, 191, 95], lift: 0.10, env: 95 },
  spider: { url: '/masks/spider.vgmesh', widthMul: 2.6, rgb: [58, 48, 56], lift: 1.40, env: 70 },
  butterflies: { url: '/masks/butterfly.vgmesh', widthMul: 0.9, rgb: [212, 106, 224], lift: 1.15, env: 90, repeat: 5 },
  cloud: { url: '/masks/cloud.vgmesh', widthMul: 3.2, rgb: [200, 206, 224], lift: 1.15, env: 60 },
  angel: { url: '/masks/angel.vgmesh', widthMul: 1.5, rgb: [232, 226, 208], lift: 0.60, env: 85, offX: -1.9 },
  demon: { url: '/masks/demon.vgmesh', widthMul: 1.5, rgb: [176, 58, 58], lift: 0.60, env: 80, offX: 1.9 },
};
