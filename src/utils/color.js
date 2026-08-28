// Colour conversions for the cosmetic pickers. No dependency: this is ~40 lines
// of arithmetic and pulling in a colour library for it would be weight on every
// bundle that touches a swatch.

/** '#rrggbb' (or '#rgb') -> {r,g,b} 0-255, or null if it is not a hex colour. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** {r,g,b} -> '#rrggbb', always 6 digits and always lower case. */
export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** {r,g,b} 0-255 -> {h:0-360, s:0-1, v:0-1} */
export function rgbToHsv({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** {h:0-360, s:0-1, v:0-1} -> {r,g,b} 0-255 */
export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r1, g1, b1] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export const hsvToHex = (hsv) => rgbToHex(hsvToRgb(hsv));
export const hexToHsv = (hex) => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
};

/**
 * Is this a hex colour safe to interpolate into a CSS custom property?
 *
 * ⚠ These values are USER INPUT and end up inside a `linear-gradient()`. A
 * custom property can carry arbitrary tokens, so an unvalidated value like
 * `red 0%, url(x)` would rewrite the gradient rather than colour it. Mirrored in
 * firestore.rules so a direct write cannot bypass the picker.
 */
export const isHexColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Nudge `hex` until it meets `target` contrast against `onHex`, in whichever
 * DIRECTION actually has headroom.
 *
 * ⚠ THIS EXISTS BECAUSE `inkFor()` IN profileThemes.js ONLY DARKENS.
 * docs/effects/04 said to reuse it. It multiplies the colour by 0.95 up to 40
 * times, which is correct for dark ink on a LIGHT surface — the one case it was
 * written for. Vergr's surfaces are near-black, so darkening a low-contrast
 * accent makes it WORSE, and after 40 iterations returns something
 * indistinguishable from the background. It would have rendered names invisible.
 * (It is also not exported, so "reuse it" was not possible as written.)
 *
 * Direction is chosen from the background: lighten on a dark surface, darken on
 * a light one. A user's colour is respected as far as legibility allows, rather
 * than being overridden outright.
 */
export function ensureContrast(hex, onHex, target = 4.5) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  if (contrastRatio(hex, onHex) >= target) return hex;

  const lightenTowardWhite = luminance(onHex) < 0.5;
  let c = { ...rgb };
  for (let i = 0; i < 60; i++) {
    c = lightenTowardWhite
      ? { r: c.r + (255 - c.r) * 0.06, g: c.g + (255 - c.g) * 0.06, b: c.b + (255 - c.b) * 0.06 }
      : { r: c.r * 0.94, g: c.g * 0.94, b: c.b * 0.94 };
    if (contrastRatio(rgbToHex(c), onHex) >= target) break;
  }
  return rgbToHex(c);
}

/** Relative luminance 0-1, for deciding whether to draw a light or dark handle. */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}
