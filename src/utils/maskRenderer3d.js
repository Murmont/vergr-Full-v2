// Textured 3D mask renderer (three.js / WebGL).
//
// Replaces the flat-fill Canvas 2D path in liveMaskMesh.js. That renderer could
// not texture a triangle, so every mask was drawn as a single invented colour
// and the models' own artwork was discarded at conversion time. Jeeliz authored
// these assets for three.js and their docs put WebGL first for exactly this
// reason.
//
// HOW IT PLUGS IN
// ───────────────
// Renders to its own offscreen canvas with a transparent background, which the
// caller then drawImage()s over the video frame. The compositor keeps owning
// the video, the background effect and the colour look; this owns only the
// mask layer.
//
// COORDINATE SPACE
// ────────────────
// The camera is orthographic in PIXELS with Y increasing downward, so placement
// maths is identical to the old 2D path (anchor on the eye line, scale by eye
// distance, roll from the eye angle). That is deliberate: the anchoring was the
// one part that already worked, and re-deriving it in a new space is how the
// dog's nose went missing last time.
//
// Model geometry is Y-up, screen space is Y-down, hence the negative Y scale.
//
// OCCLUDER
// ────────
// `occluder.vgmesh` is a low-poly head rendered depth-only (colorWrite off).
// It hides the parts of a model that sit BEHIND the head: helmet shell, glasses
// arms, wings that wrap round. It does not erase the wearer's face, since the
// video lives outside this scene. Covering the face is the mask geometry's job.

import * as THREE from 'three';

const MAGIC = 'VGMESH2';
const meshCache = new Map();
const texCache = new Map();

/** Parse a VGMESH2 buffer into a three.js BufferGeometry. */
function toGeometry(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 7));
  if (magic !== MAGIC) return null;
  const vc = dv.getUint32(8, true);
  const ic = dv.getUint32(12, true);
  if (!vc || !ic) return null;

  let o = 16;
  const pos = new Float32Array(buf.slice(o, o + vc * 12)); o += vc * 12;
  const nor = new Float32Array(buf.slice(o, o + vc * 12)); o += vc * 12;
  const uv = new Float32Array(buf.slice(o, o + vc * 8)); o += vc * 8;
  const idx = new Uint16Array(buf.slice(o, o + ic * 2));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // Centre on the bounding box so placement is predictable. Each artist
  // modelled at a different origin (some at the feet, some at the head), and
  // without this the same `lift` value means something different per model,
  // which is unmaintainable.
  g.computeBoundingBox();
  g.center();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

async function loadGeometry(url) {
  if (meshCache.has(url)) return meshCache.get(url);
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return toGeometry(await res.arrayBuffer());
    } catch { return null; }
  })();
  meshCache.set(url, p);
  return p;
}

function loadTexture(url) {
  if (!url) return null;
  if (texCache.has(url)) return texCache.get(url);
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true; // model UVs are bottom-left origin, images are top-left
  texCache.set(url, t);
  return t;
}

/**
 * Mask registry.
 *
 * `kind` matters: a 'mask' sits ON the face and is anchored to the eye line; a
 * 'prop' is a character or object that hovers near the head and must NOT be
 * scaled as though it were a face. angel/demon are full character models in the
 * original demos, not face coverings, so treating them as masks makes them
 * enormous and wrong.
 */
// Keys MUST match LIVE_MASKS in liveMaskMesh.js, because the UI selects by
// those names. A mismatch does not error, it silently falls back to the old
// untextured path, which is exactly the kind of quiet regression to avoid.
export const MASKS_3D = {
  none: null,
  tiger: { kind: 'mask', mesh: '/masks/tiger.vgmesh', tex: '/masks/tiger.png', widthMul: 2.9, lift: 0.15, occlude: true },
  visor: { kind: 'mask', mesh: '/masks/helmet.vgmesh', tex: '/masks/helmet.jpg', widthMul: 3.4, lift: 0.55, rotY: Math.PI, occlude: true },
  spider: { kind: 'prop', mesh: '/masks/spider.vgmesh', tex: '/masks/spider.jpg', widthMul: 2.4, lift: 1.35, occlude: false },
  butterflies: { kind: 'prop', mesh: '/masks/butterfly.vgmesh', tex: '/masks/butterfly.jpg', widthMul: 0.9, lift: 1.15, occlude: false, repeat: 5 },
  angel: { kind: 'prop', mesh: '/masks/angel.vgmesh', tex: '/masks/angel.png', widthMul: 1.5, lift: 0.7, offX: -1.9, occlude: false },
  demon: { kind: 'prop', mesh: '/masks/demon.vgmesh', tex: '/masks/demon.png', widthMul: 1.5, lift: 0.7, offX: 1.9, occlude: false },
  // Untextured in the originals: solid materials lit by an environment map, not
  // a stripped texture. Given a base colour and a glossy material instead.
  shades: { kind: 'mask', mesh: '/masks/glasses.vgmesh', tex: null, color: 0x2a2a32, metal: 0.7, rough: 0.25, widthMul: 2.15, lift: 0, occlude: true },
  alien: { kind: 'mask', mesh: '/masks/alien.vgmesh', tex: null, color: 0x2fbf5f, metal: 0.3, rough: 0.4, widthMul: 2.4, lift: 0.1, occlude: true },
  cloud: { kind: 'prop', mesh: '/masks/cloud.vgmesh', tex: null, color: 0xc8cee0, metal: 0.0, rough: 0.9, widthMul: 3.2, lift: 1.15, occlude: false },
};

const OCCLUDER_URL = '/masks/occluder.vgmesh';

/**
 * Create a mask renderer bound to its own offscreen canvas.
 * Returns null if WebGL is unavailable, so callers fall back rather than crash.
 */
export function createMaskRenderer(width = 640, height = 640) {
  let renderer, scene, camera, canvas;
  try {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, premultipliedAlpha: false,
      // Without this a WebGL canvas is cleared once the browser composites it,
      // so any drawImage() that does not happen in the very same frame copies
      // nothing. The compositor does copy immediately, but relying on that is
      // how you get a mask that works everywhere except one device.
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    return null; // no WebGL: caller keeps the plain camera
  }

  scene = new THREE.Scene();
  // Pixel-space orthographic camera, Y down, matching canvas convention.
  camera = new THREE.OrthographicCamera(0, width, 0, height, -5000, 5000);

  // Three-point-ish lighting. Flat ambient alone makes a textured model look
  // like a sticker; the directional light is what gives it form.
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(0.4, -1, 1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x99aaff, 0.4);
  fill.position.set(-1, -0.2, 0.5);
  scene.add(fill);

  let current = null;      // { key, meshes: Mesh[], def }
  let occluderMesh = null;
  let loadToken = 0;

  async function ensureOccluder() {
    if (occluderMesh) return occluderMesh;
    const g = await loadGeometry(OCCLUDER_URL);
    if (!g) return null;
    // Depth-only: writes depth, draws nothing. renderOrder -1 so it is laid
    // down before the model is tested against it.
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    occluderMesh = new THREE.Mesh(g, m);
    occluderMesh.renderOrder = -1;
    occluderMesh.visible = false;
    scene.add(occluderMesh);
    return occluderMesh;
  }

  async function setMask(key) {
    const token = ++loadToken;
    if (current) {
      for (const m of current.meshes) scene.remove(m);
      current = null;
    }
    const def = MASKS_3D[key];
    if (!def) return;

    const [g] = await Promise.all([loadGeometry(def.mesh), ensureOccluder()]);
    if (!g || token !== loadToken) return; // superseded by a later selection

    const tex = loadTexture(def.tex);
    const material = new THREE.MeshStandardMaterial({
      map: tex || null,
      color: tex ? 0xffffff : (def.color ?? 0xffffff),
      metalness: def.metal ?? 0.15,
      roughness: def.rough ?? 0.65,
      transparent: false,
      side: THREE.DoubleSide, // several models are single-sided shells
    });

    const meshes = [];
    for (let i = 0; i < (def.repeat || 1); i++) {
      const mesh = new THREE.Mesh(g, material);
      scene.add(mesh);
      meshes.push(mesh);
    }
    current = { key, meshes, def };
  }

  /**
   * Fit factor: model units -> pixels.
   *
   * Keyed on the model's WIDTH only. Using max(width, height) made tall models
   * (the angel, the helmet) shrink to fit their height, so `widthMul` stopped
   * meaning "how many eye-widths across" and every mask needed a different
   * magic number. Width alone keeps the unit honest.
   */
  function fitScale(geometry, eyeDist, widthMul) {
    const bb = geometry.boundingBox;
    const span = (bb.max.x - bb.min.x) || 1;
    return (eyeDist * widthMul) / span;
  }

  /**
   * Draw the current mask for one frame.
   * L / R are the eye landmarks in the SAME pixel space as the target canvas.
   */
  function render(L, R, yaw = 0) {
    if (!current) return null;
    const { meshes, def } = current;

    const ex = R.x - L.x, ey = R.y - L.y;
    const d = Math.hypot(ex, ey) || 1;
    const roll = Math.atan2(ey, ex);
    const cxp = (L.x + R.x) / 2, cyp = (L.y + R.y) / 2;
    const ux = ex / d, uy = ey / d;
    const px = -uy, py = ux;

    const geom = meshes[0].geometry;

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      let dx = (def.offX || 0) * d;
      let dy = (def.lift || 0) * d;
      let mul = def.widthMul;
      let extraYaw = 0;

      if (meshes.length > 1) {
        // Swarm: arc across and above the head, sizes alternating so it reads
        // as depth rather than a row of identical stamps.
        const t = (i / (meshes.length - 1)) * 2 - 1;
        dx = t * d * 1.5;
        dy = (def.lift + 0.35 * (1 - t * t)) * d;
        mul = def.widthMul * (0.75 + 0.35 * (1 - Math.abs(t)));
        extraYaw = t * 0.5;
      }

      const ox = ux * dx + px * -dy;
      const oy = uy * dx + py * -dy;
      const s = fitScale(geom, d, mul);

      mesh.position.set(cxp + ox, cyp + oy, 0);
      // Negative Y: model space is Y-up, this camera is Y-down.
      mesh.scale.set(s, -s, s);
      // rotY/rotX are per-model authoring corrections: not every artist modelled
      // facing +Z. The helmet in particular faces away, so without this you see
      // straight into the lining.
      mesh.rotation.set(def.rotX || 0, yaw + extraYaw + (def.rotY || 0), roll);
    }

    if (occluderMesh) {
      occluderMesh.visible = Boolean(def.occlude);
      if (occluderMesh.visible) {
        const os = fitScale(occluderMesh.geometry, d, 3.1);
        occluderMesh.position.set(cxp, cyp, -1);
        occluderMesh.scale.set(os, -os, os);
        occluderMesh.rotation.set(0, yaw, roll);
      }
    }

    renderer.render(scene, camera);
    return canvas;
  }

  function resize(w, h) {
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w; canvas.height = h;
    renderer.setSize(w, h, false);
    camera.left = 0; camera.right = w; camera.top = 0; camera.bottom = h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    try { renderer.dispose(); } catch { /* already gone */ }
  }

  return { setMask, render, resize, dispose, get canvas() { return canvas; } };
}
