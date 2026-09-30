// ============================================================
// vergr.me appearance + block model
// Single source of truth for themes, backgrounds, fonts, block
// shapes/styles, the block-type registry, and tier gating.
// Consumed by VergrMeView (renderer, shared by editor preview +
// public /u/:username) and VergrMeEditorScreen (builder).
// ============================================================

// ---- Themes ----------------------------------------------------
// Each theme is a token set. `accent` + `bg` seed the background/
// button defaults. Custom colours (data.colors) override any token.
export const THEMES = {
  dark: {
    label: 'Minimal Dark', designLang: 'minimal',
    bg:          '#0b0b0d',
    surface:     'rgba(255,255,255,0.055)',
    surfaceHover:'rgba(255,255,255,0.09)',
    text:        '#ffffff',
    textSub:     'rgba(255,255,255,0.45)',
    textMuted:   'rgba(255,255,255,0.22)',
    border:      'rgba(255,255,255,0.07)',
    iconBg:      'rgba(255,255,255,0.06)',
    // Brand violet, not the old cyan #4DFFD4 (audit A14). `dark` is the DEFAULT
    // theme (defaultPage sets theme:'dark', and resolveAppearance falls back to
    // 'dark'), so every brand-new vergr.me page rendered in a colour the brand
    // rule excludes — cyan is aliased away in tailwind.config.js and the
    // palette is violet / pink / gold.
    //
    // NOTE: A14 says to "change only the default selection to the violet theme
    // (#7B1FFF)" and not to delete the cyan theme. There is no separate cyan
    // theme to keep: #7B1FFF is the accent of the LIGHT theme, so switching the
    // default that way would have made every new page light-mode, which is a
    // far bigger change than the finding intends on a dark product. Cyan was
    // one token on the default dark theme, and that token is what moved. Any
    // creator who wants cyan can still set it as a custom colour, which
    // overrides theme tokens.
    accent:      '#7B1FFF',
    apply: { accentColor: '#7B1FFF', font: 'outfit', linkStyle: 'classic', colors: {},
      blockStyle: { shape: 'rounded', shadowType: 'none', outline: false },
      background: { type: 'gradient', color1: '#16161c', color2: '#0b0b0d', direction: 'diagonal', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'portrait', avatarShape: 'circle' } },
  },
  light: {
    label: 'Minimal Light', designLang: 'minimal',
    bg:          '#f4f4f0',
    surface:     '#ffffff',
    surfaceHover:'#ffffff',
    text:        '#111111',
    textSub:     'rgba(0,0,0,0.52)',
    textMuted:   'rgba(0,0,0,0.32)',
    border:      'rgba(0,0,0,0.09)',
    iconBg:      'rgba(0,0,0,0.05)',
    accent:      '#7B1FFF',
    apply: { accentColor: '#7B1FFF', font: 'outfit', linkStyle: 'classic', colors: {},
      blockStyle: { shape: 'rounded', shadowType: 'soft', shadowColor: 'rgba(0,0,0,0.08)', outline: false },
      background: { type: 'solid', value: '#f4f4f0', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'portrait', avatarShape: 'circle' } },
  },
  glass: {
    label: 'Glass', designLang: 'glass',
    bg:          '#0d1117',
    surface:     'rgba(255,255,255,0.07)',
    surfaceHover:'rgba(255,255,255,0.12)',
    text:        '#e6edf3',
    textSub:     'rgba(230,237,243,0.5)',
    textMuted:   'rgba(230,237,243,0.25)',
    border:      'rgba(255,255,255,0.1)',
    iconBg:      'rgba(255,255,255,0.08)',
    accent:      '#3D7FFF',
    apply: { accentColor: '#3D7FFF', font: 'sora', linkStyle: 'classic', colors: {},
      blockStyle: { shape: 'rounded', shadowType: 'soft', shadowColor: 'rgba(0,0,0,0.35)', outline: false },
      background: { type: 'gradient', color1: '#1b2a44', color2: '#0a0e16', direction: 'diagonal', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'banner', avatarShape: 'circle' } },
  },
  // ---- Retired colour themes (2026-06-16) -------------------------------
  // Removed from the picker (they were recoloured 'Minimal Dark', not real
  // design systems). KEPT here as `minimal` so any page already saved on one
  // still renders with its colour preserved; their palettes now live as one-tap
  // presets (MINIMAL_PRESETS) on the Minimal theme. Excluded from THEME_ORDER.
  midnight: {
    label: 'Midnight', designLang: 'minimal',
    bg:          '#08081a',
    surface:     'rgba(130,100,255,0.09)',
    surfaceHover:'rgba(130,100,255,0.15)',
    text:        '#e8e0ff',
    textSub:     'rgba(200,180,255,0.5)',
    textMuted:   'rgba(200,180,255,0.25)',
    border:      'rgba(130,100,255,0.15)',
    iconBg:      'rgba(130,100,255,0.1)',
    accent:      '#B44FFF',
  },
  warm: {
    label: 'Warm', designLang: 'minimal',
    bg:          '#130d08',
    surface:     'rgba(255,160,80,0.08)',
    surfaceHover:'rgba(255,160,80,0.14)',
    text:        '#fff5ee',
    textSub:     'rgba(255,220,180,0.55)',
    textMuted:   'rgba(255,220,180,0.28)',
    border:      'rgba(255,160,80,0.12)',
    iconBg:      'rgba(255,160,80,0.08)',
    accent:      '#F0A500',
  },
  classic: {
    label: 'Classic', designLang: 'minimal',
    bg:          '#101225',
    surface:     'rgba(120,140,255,0.08)',
    surfaceHover:'rgba(120,140,255,0.14)',
    text:        '#eef1ff',
    textSub:     'rgba(200,210,255,0.5)',
    textMuted:   'rgba(200,210,255,0.26)',
    border:      'rgba(120,140,255,0.14)',
    iconBg:      'rgba(120,140,255,0.1)',
    accent:      '#7B8CFF',
  },
  vibrant: {
    label: 'Vibrant', designLang: 'minimal',
    bg:          '#1a0a1f',
    surface:     'rgba(255,90,160,0.1)',
    surfaceHover:'rgba(255,90,160,0.16)',
    text:        '#ffeef6',
    textSub:     'rgba(255,200,225,0.55)',
    textMuted:   'rgba(255,200,225,0.3)',
    border:      'rgba(255,90,160,0.16)',
    iconBg:      'rgba(255,90,160,0.1)',
    accent:      '#FF5AA0',
  },
  ocean: {
    label: 'Ocean', designLang: 'minimal',
    bg:          '#04141f',
    surface:     'rgba(80,200,255,0.09)',
    surfaceHover:'rgba(80,200,255,0.15)',
    text:        '#e6f7ff',
    textSub:     'rgba(180,230,255,0.55)',
    textMuted:   'rgba(180,230,255,0.3)',
    border:      'rgba(80,200,255,0.15)',
    iconBg:      'rgba(80,200,255,0.1)',
    accent:      '#3DC6FF',
  },
  sunset: {
    label: 'Sunset', designLang: 'minimal',
    bg:          '#1f0c08',
    surface:     'rgba(255,130,70,0.1)',
    surfaceHover:'rgba(255,130,70,0.16)',
    text:        '#fff1e8',
    textSub:     'rgba(255,210,180,0.55)',
    textMuted:   'rgba(255,210,180,0.3)',
    border:      'rgba(255,130,70,0.16)',
    iconBg:      'rgba(255,130,70,0.1)',
    accent:      '#FF7A3D',
  },
  nature: {
    label: 'Nature', designLang: 'minimal',
    bg:          '#06140d',
    surface:     'rgba(60,220,140,0.09)',
    surfaceHover:'rgba(60,220,140,0.15)',
    text:        '#e9fff3',
    textSub:     'rgba(190,255,220,0.55)',
    textMuted:   'rgba(190,255,220,0.3)',
    border:      'rgba(60,220,140,0.15)',
    iconBg:      'rgba(60,220,140,0.1)',
    accent:      '#34D399',
  },
  // ---- Design-system themes -----------------------------------
  // These are full visual IDENTITIES, not just colour swatches. Each carries a
  // `designLang` that drives STRUCTURAL component variants in the renderer (the
  // link card renders differently under brutalist vs glass vs editorial) plus
  // an `apply` template the editor spreads on pick (font/linkStyle/blockStyle/
  // background/header) — overridable afterward. Brand-NEUTRAL: these are the
  // user's identity, never Vergr's app chrome.
  pastel: {
    label: 'Pastel', designLang: 'soft',
    bg: '#faf2ff', surface: '#ffffff', surfaceHover: '#ffffff',
    text: '#3b2d52', textSub: 'rgba(59,45,82,0.58)', textMuted: 'rgba(59,45,82,0.38)',
    border: 'rgba(150,110,200,0.16)', iconBg: '#f1e4ff', accent: '#b983e0',
    apply: { accentColor: '#b983e0', font: 'poppins', linkStyle: 'classic', colors: {},
      blockStyle: { shape: 'pill', shadowType: 'soft', shadowColor: 'rgba(185,131,224,0.30)', outline: false },
      background: { type: 'gradient', color1: '#ffe3f5', color2: '#e9d6ff', direction: 'diagonal', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'portrait', avatarShape: 'circle' } },
  },
  brutal: {
    label: 'Brutalist', designLang: 'brutalist',
    bg: '#f3efe4', surface: '#ffffff', surfaceHover: '#ffffff',
    text: '#0b0b0b', textSub: 'rgba(11,11,11,0.66)', textMuted: 'rgba(11,11,11,0.42)',
    border: '#0b0b0b', iconBg: '#ffe14d', accent: '#ffe14d',
    apply: { accentColor: '#ffe14d', font: 'grotesk', linkStyle: 'simple', colors: {},
      blockStyle: { shape: 'square', shadowType: 'hard', shadowColor: '#0b0b0b', outline: true, outlineColor: '#0b0b0b' },
      background: { type: 'solid', value: '#f3efe4', overlayOpacity: 0 },
      headerStyle: { layout: 'left', variant: 'minimal', avatarShape: 'square' } },
  },
  editorial: {
    label: 'Editorial', designLang: 'editorial',
    bg: '#f6f3ec', surface: 'rgba(0,0,0,0.035)', surfaceHover: 'rgba(0,0,0,0.06)',
    text: '#1a1a1a', textSub: 'rgba(26,26,26,0.6)', textMuted: 'rgba(26,26,26,0.4)',
    border: 'rgba(26,26,26,0.14)', iconBg: 'rgba(0,0,0,0.04)', accent: '#c0392b',
    apply: { accentColor: '#c0392b', font: 'playfair', linkStyle: 'minimal', colors: {},
      blockStyle: { shape: 'sharp', shadowType: 'none', outline: false },
      background: { type: 'solid', value: '#f6f3ec', overlayOpacity: 0 },
      headerStyle: { layout: 'left', variant: 'minimal', avatarShape: 'circle' } },
  },
  neon: {
    label: 'Neon', designLang: 'neon',
    bg: '#08010f', surface: 'rgba(255,255,255,0.04)', surfaceHover: 'rgba(255,255,255,0.08)',
    text: '#f5e9ff', textSub: 'rgba(245,233,255,0.55)', textMuted: 'rgba(245,233,255,0.3)',
    border: 'rgba(255,60,224,0.4)', iconBg: 'rgba(255,60,224,0.12)', accent: '#ff3ce0',
    apply: { accentColor: '#ff3ce0', font: 'grotesk', linkStyle: 'simple', colors: {},
      blockStyle: { shape: 'rounded', shadowType: 'none', outline: true, outlineColor: '#ff3ce0' },
      background: { type: 'gradient', color1: '#1a0030', color2: '#03010a', direction: 'diagonal', animated: true, overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'banner' } },
  },
  frost: {
    label: 'Frost', designLang: 'glass',
    bg: '#0e1726', surface: 'rgba(255,255,255,0.08)', surfaceHover: 'rgba(255,255,255,0.14)',
    text: '#eaf2ff', textSub: 'rgba(234,242,255,0.55)', textMuted: 'rgba(234,242,255,0.3)',
    border: 'rgba(255,255,255,0.16)', iconBg: 'rgba(255,255,255,0.1)', accent: '#6ea8ff',
    apply: { accentColor: '#6ea8ff', font: 'outfit', linkStyle: 'classic', colors: {},
      blockStyle: { shape: 'rounded', shadowType: 'soft', shadowColor: 'rgba(0,0,0,0.3)', outline: false },
      background: { type: 'gradient', color1: '#1e3a5f', color2: '#0a1422', direction: 'diagonal', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'banner' } },
  },
  zine: {
    label: 'Zine', designLang: 'zine',
    bg: '#efe9dd', surface: '#fffdf7', surfaceHover: '#fffdf7',
    text: '#1c1a17', textSub: 'rgba(28,26,23,0.62)', textMuted: 'rgba(28,26,23,0.4)',
    border: '#1c1a17', iconBg: '#ffd33d', accent: '#e2402c',
    apply: { accentColor: '#e2402c', font: 'bricolage', linkStyle: 'simple', colors: {},
      blockStyle: { shape: 'square', shadowType: 'hard', shadowColor: '#1c1a17', outline: true, outlineColor: '#1c1a17' },
      background: { type: 'solid', value: '#efe9dd', overlayOpacity: 0 },
      headerStyle: { layout: 'left', variant: 'minimal', avatarShape: 'square' } },
  },
  terminal: {
    label: 'Terminal', designLang: 'terminal',
    bg: '#020a04', surface: 'rgba(92,255,157,0.05)', surfaceHover: 'rgba(92,255,157,0.1)',
    text: '#5cff9d', textSub: 'rgba(92,255,157,0.6)', textMuted: 'rgba(92,255,157,0.35)',
    border: 'rgba(92,255,157,0.35)', iconBg: 'rgba(92,255,157,0.1)', accent: '#5cff9d',
    apply: { accentColor: '#5cff9d', font: 'jetbrains', linkStyle: 'simple', colors: {},
      blockStyle: { shape: 'sharp', shadowType: 'none', outline: true, outlineColor: 'rgba(92,255,157,0.4)' },
      background: { type: 'solid', value: '#020a04', overlayOpacity: 0 },
      headerStyle: { layout: 'left', variant: 'minimal' } },
  },
  luxe: {
    label: 'Luxe', designLang: 'luxe',
    bg: '#14110c', surface: 'rgba(212,175,55,0.05)', surfaceHover: 'rgba(212,175,55,0.1)',
    text: '#f3ead2', textSub: 'rgba(243,234,210,0.55)', textMuted: 'rgba(243,234,210,0.32)',
    border: 'rgba(212,175,55,0.3)', iconBg: 'rgba(212,175,55,0.1)', accent: '#d4af37',
    apply: { accentColor: '#d4af37', font: 'playfair', linkStyle: 'minimal', colors: {},
      blockStyle: { shape: 'sharp', shadowType: 'none', outline: true, outlineColor: 'rgba(212,175,55,0.35)' },
      background: { type: 'gradient', color1: '#1c1710', color2: '#0c0a06', direction: 'diagonal', overlayOpacity: 0 },
      headerStyle: { layout: 'centered', variant: 'portrait' } },
  },
  custom: {
    label: 'Custom',
    // Seeds from dark; user-supplied data.colors override everything.
    bg:          '#0b0b0d',
    surface:     'rgba(255,255,255,0.055)',
    surfaceHover:'rgba(255,255,255,0.09)',
    text:        '#ffffff',
    textSub:     'rgba(255,255,255,0.45)',
    textMuted:   'rgba(255,255,255,0.22)',
    border:      'rgba(255,255,255,0.07)',
    iconBg:      'rgba(255,255,255,0.06)',
    accent:      '#4DFFD4',
  },
};

// Themes a free user can pick. Pro unlocks everything (incl. custom + the
// premium "designer" templates terminal/luxe).
export const FREE_THEMES = ['dark', 'light', 'pastel', 'editorial', 'brutal', 'zine', 'glass', 'frost', 'neon'];

// The curated picker roster, in display order. Each entry is a genuinely
// distinct design system (not a recoloured swatch). The retired colour themes
// (midnight/warm/classic/vibrant/ocean/sunset/nature) are deliberately ABSENT
// — their palettes live on as one-tap presets under Minimal (MINIMAL_PRESETS),
// and any page still saved on one keeps rendering via resolveAppearance.
export const THEME_ORDER = ['dark', 'light', 'pastel', 'editorial', 'brutal', 'zine', 'glass', 'frost', 'neon', 'terminal', 'luxe', 'custom'];

// One-tap colour looks for the Minimal design system — these preserve the
// palettes of the retired colour themes without pretending to be separate
// designs. Selecting one sets accent + a matching solid/gradient background.
export const MINIMAL_PRESETS = [
  { label: 'Mono',     accent: '#4DFFD4', bg: { type: 'gradient', color1: '#16161c', color2: '#0b0b0d', direction: 'diagonal' } },
  { label: 'Midnight', accent: '#B44FFF', bg: { type: 'gradient', color1: '#1a1140', color2: '#08081a', direction: 'diagonal' } },
  { label: 'Warm',     accent: '#F0A500', bg: { type: 'gradient', color1: '#2a1a08', color2: '#130d08', direction: 'diagonal' } },
  { label: 'Ocean',    accent: '#3DC6FF', bg: { type: 'gradient', color1: '#062536', color2: '#04141f', direction: 'diagonal' } },
  { label: 'Sunset',   accent: '#FF7A3D', bg: { type: 'gradient', color1: '#3a1408', color2: '#1f0c08', direction: 'diagonal' } },
  { label: 'Vibrant',  accent: '#FF5AA0', bg: { type: 'gradient', color1: '#350f2a', color2: '#1a0a1f', direction: 'diagonal' } },
  { label: 'Nature',   accent: '#34D399', bg: { type: 'gradient', color1: '#0a2418', color2: '#06140d', direction: 'diagonal' } },
];

// Picking a theme is a TEMPLATE action: returns the appearance fields to spread
// into the page (theme key + the theme's `apply` defaults). The user can then
// override any individual field. Legacy themes (no `apply`) just set the key.
export function applyThemeTemplate(themeKey) {
  const th = THEMES[themeKey];
  return { theme: themeKey, ...(th?.apply || {}) };
}

// Sanitize user custom CSS (Pro escape hatch). Full creative freedom; the ONLY
// job here is security — strip anything that can run JS, break out of the
// <style>, make a remote/exfiltration request, or use legacy IE script vectors.
// Visual scoping (so it can't touch Vergr app chrome) is done by injecting this
// inside `@scope (#vm-custom-scope)` in the renderer.
const CSS_HOST_OK = /^(https?:)?\/\/(cdn\.vergr\.app|vergr\.app|vergr\.me)\//i;
const cssUrlSafe = (u) =>
  /^data:image\//i.test(u) || CSS_HOST_OK.test(u) || /^\/[^/]/.test(u) || u.startsWith('#');

export function sanitizeCustomCss(css) {
  if (!css) return '';
  let out = String(css);
  // 1) Strip CSS comments FIRST. The browser removes them before parsing, so
  //    leaving them in lets an attacker hide blocked tokens from the filters
  //    below (e.g. `@imp/* */ort`, `url(/* */ //evil.com/x)`).
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // 2) Decode CSS escape sequences so they can't smuggle a blocked keyword past
  //    the text filters (`\6A avascript:` → `javascript:`, `\40 import` → `@import`).
  out = out.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex) => {
    const cp = parseInt(hex, 16);
    return cp && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });
  out = out.replace(/\\([^\n])/g, '$1');
  // 3) Strip breakout / script / remote-fetch vectors.
  out = out.replace(/<\/?\s*style[^>]*>/gi, '');         // no tag breakout
  out = out.replace(/@(import|charset|namespace)[^;{]*;?/gi, ''); // remote sheets / namespace url()
  out = out.replace(/expression\s*\([^)]*\)/gi, '');     // legacy IE script
  out = out.replace(/behavior\s*:[^;]*;?/gi, '');        // legacy IE .htc
  out = out.replace(/-moz-binding\s*:[^;]*;?/gi, '');    // legacy XBL script
  out = out.replace(/(javascript|vbscript)\s*:/gi, '');  // script: in any value
  // 4) url(...) allowed only to our CDN/app/domain, root-relative paths, or
  //    inline data:image — everything else (off-domain fetch / exfiltration) → none.
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, u) => (cssUrlSafe(u.trim()) ? `url("${u.trim()}")` : 'none'));
  // 5) image-set()/cross-fade() accept a BARE "url-string" (no url()), another
  //    off-domain fetch path — apply the same allowlist to quoted args there.
  out = out.replace(/(image-set|cross-fade)\s*\(([^)]*)\)/gi, (_m, fn, inner) => {
    const cleaned = inner.replace(/(['"])([^'"]+)\1/g, (mm, _q, u) => (cssUrlSafe(u.trim()) ? mm : '""'));
    return `${fn}(${cleaned})`;
  });
  return out;
}

// ---- Backgrounds ----------------------------------------------
// A page background is { type, value, url, overlayOpacity }.
//  type: solid | gradient | mesh | image | gif | video
//  value: solid colour OR gradient seed accent
//  url:   media url for image/gif/video
// resolveBackground returns { kind:'css'|'media', css?, url?, mediaType?, overlay }.
export const BANNER_FN = {
  gradient: (accent, bg) =>
    `linear-gradient(160deg, ${accent}55 0%, ${accent}18 42%, ${bg} 100%)`,
  mesh: (accent, bg) =>
    `radial-gradient(ellipse at 18% 32%, ${accent}3a 0%, transparent 55%),
     radial-gradient(ellipse at 82% 64%, ${accent}22 0%, transparent 55%), ${bg}`,
  image: () => null,
  none: (_, bg) => bg,
};

// Gradient direction keyword → CSS angle/keyword.
export const GRAD_DIRECTIONS = {
  bottom:     { label: 'Top → bottom',  css: 'to bottom' },
  top:        { label: 'Bottom → top',  css: 'to top' },
  right:      { label: 'Left → right',  css: 'to right' },
  left:       { label: 'Right → left',  css: 'to left' },
  diagonal:   { label: 'Diagonal ↘',    css: '135deg' },
  diagonalUp: { label: 'Diagonal ↗',    css: '45deg' },
  radial:     { label: 'Radial',        css: 'radial' },
};

// Build a gradient CSS string from an explicit 2-colour spec, else fall
// back to the accent-seeded default.
function gradientCss(bgConf, accent, bg) {
  if (bgConf.color1 || bgConf.color2) {
    const c1 = bgConf.color1 || accent;
    const c2 = bgConf.color2 || bg;
    if (bgConf.direction === 'radial') return `radial-gradient(circle at 50% 32%, ${c1}, ${c2})`;
    const dir = GRAD_DIRECTIONS[bgConf.direction]?.css || '135deg';
    return `linear-gradient(${dir}, ${c1}, ${c2})`;
  }
  return BANNER_FN.gradient(accent, bg);
}

export function resolveBackground(data, t, accent) {
  const bgConf = data.background || legacyBackground(data);
  const overlay = typeof bgConf.overlayOpacity === 'number' ? bgConf.overlayOpacity : 0.35;
  const tintColor = bgConf.tint === 'light' ? '#ffffff' : '#000000';
  const blur = bgConf.blur || 0;
  const animated = !!bgConf.animated;
  switch (bgConf.type) {
    case 'solid':
      return { kind: 'css', css: bgConf.value || t.bg, overlay: 0 };
    case 'mesh':
      return { kind: 'css', css: BANNER_FN.mesh(accent, t.bg), overlay: 0, animated };
    case 'aurora':
    case 'blobs':
    case 'particles':
      return { kind: 'effect', effect: bgConf.type, c1: bgConf.color1 || accent, c2: bgConf.color2 || t.bg, accent, overlay: 0 };
    case 'gradient':
      return { kind: 'css', css: gradientCss(bgConf, accent, t.bg), overlay: 0, animated };
    case 'image':
    case 'gif':
      return bgConf.url
        ? { kind: 'media', mediaType: 'image', url: bgConf.url, overlay, tintColor, blur }
        : { kind: 'css', css: gradientCss(bgConf, accent, t.bg), overlay: 0 };
    case 'video':
      return bgConf.url
        ? { kind: 'media', mediaType: 'video', url: bgConf.url, overlay, tintColor, blur, muted: !bgConf.audio }
        : { kind: 'css', css: gradientCss(bgConf, accent, t.bg), overlay: 0 };
    default:
      return { kind: 'css', css: gradientCss(bgConf, accent, t.bg), overlay: 0, animated };
  }
}

// Map legacy bannerStyle field → new background spec (back-compat).
function legacyBackground(data) {
  const s = data.bannerStyle;
  if (s === 'image') return { type: 'image', url: data.bannerUrl, overlayOpacity: 0.35 };
  if (s === 'mesh') return { type: 'mesh' };
  if (s === 'none') return { type: 'solid', value: null };
  return { type: 'gradient' };
}

// ---- Fonts -----------------------------------------------------
// `google` = the Google Fonts css2 family spec to lazy-load (zero cost, our
// established mechanism — see index.html). Omitted = preloaded or system font.
export const FONT_PRESETS = {
  vergr:    { label: 'Vergr',     heading: 'Syne, sans-serif',        body: '"DM Sans", sans-serif' },
  modern:   { label: 'Modern',    heading: 'Inter, sans-serif',       body: 'Inter, sans-serif',          google: 'Inter:wght@400;500;600;700' },
  classic:  { label: 'Classic',   heading: 'Georgia, serif',          body: 'Georgia, serif' },
  mono:     { label: 'Mono',      heading: '"DM Mono", monospace',    body: '"DM Mono", monospace' },
  playful:  { label: 'Playful',   heading: '"Comic Sans MS", cursive',body: '"Comic Sans MS", cursive' },
  system:   { label: 'System',    heading: '-apple-system, system-ui, sans-serif', body: '-apple-system, system-ui, sans-serif' },
  poppins:  { label: 'Poppins',   heading: 'Poppins, sans-serif',     body: 'Poppins, sans-serif',        google: 'Poppins:wght@400;500;600;700' },
  grotesk:  { label: 'Space Grotesk', heading: '"Space Grotesk", sans-serif', body: '"Space Grotesk", sans-serif', google: 'Space+Grotesk:wght@400;500;600;700' },
  outfit:   { label: 'Outfit',    heading: 'Outfit, sans-serif',      body: 'Outfit, sans-serif',         google: 'Outfit:wght@400;500;600;700' },
  sora:     { label: 'Sora',      heading: 'Sora, sans-serif',        body: 'Sora, sans-serif',           google: 'Sora:wght@400;500;600;700' },
  bricolage:{ label: 'Bricolage', heading: '"Bricolage Grotesque", sans-serif', body: '"Bricolage Grotesque", sans-serif', google: 'Bricolage+Grotesque:wght@400;500;600;700' },
  montserrat:{ label: 'Montserrat', heading: 'Montserrat, sans-serif', body: 'Montserrat, sans-serif',    google: 'Montserrat:wght@400;500;600;700' },
  playfair: { label: 'Playfair',  heading: '"Playfair Display", serif', body: '"Playfair Display", serif', google: 'Playfair+Display:wght@400;500;600;700' },
  lora:     { label: 'Lora',      heading: 'Lora, serif',             body: 'Lora, serif',                google: 'Lora:wght@400;500;600;700' },
  jetbrains:{ label: 'JetBrains', heading: '"JetBrains Mono", monospace', body: '"JetBrains Mono", monospace', google: 'JetBrains+Mono:wght@400;500;700' },
  caveat:   { label: 'Caveat',    heading: 'Caveat, cursive',         body: 'Caveat, cursive',            google: 'Caveat:wght@400;500;600;700' },
};

// Lazy-load a preset's webfont once (no-op for system/preloaded fonts).
const _loadedFonts = new Set();
export function loadVergrMeFont(key) {
  if (typeof document === 'undefined' || !key || _loadedFonts.has(key)) return;
  const f = FONT_PRESETS[key];
  if (!f || !f.google) { _loadedFonts.add(key); return; }
  _loadedFonts.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.appendChild(link);
}

// ---- Per-component text styling (text + header blocks) ---------
export const TEXT_SIZE_PX = { s: 12, m: 15, l: 20, xl: 28 };
export const TEXT_WEIGHTS = { light: 300, normal: 400, medium: 600, bold: 800 };

// Resolve a block's font family (falls back to inheriting the page font).
export function blockFontFamily(block) {
  if (block?.font && FONT_PRESETS[block.font]) return FONT_PRESETS[block.font].body;
  return undefined;
}

// ---- Block shapes (corner radius of cards/buttons) -------------
export const BLOCK_SHAPES = {
  rounded: { label: 'Rounded', radius: 14 },
  pill:    { label: 'Pill',    radius: 999 },
  oval:    { label: 'Oval',    radius: 26 },
  square:  { label: 'Square',  radius: 6 },
  sharp:   { label: 'Sharp',   radius: 0 },
};

export const SHADOW_TYPES = { none: 'None', soft: 'Soft (float)', hard: 'Hard (pop-art)' };

// ---- Link/button visual styles --------------------------------
// Returns the style object applied to a link/card button.
export const LINK_STYLES = {
  classic: (accent, t, shape) => ({
    background: t.surface,
    border: `0.5px solid ${t.border}`,
    borderRadius: shape,
    boxShadow: 'none',
  }),
  simple: (accent, t, shape) => ({
    background: 'transparent',
    border: `1px solid ${t.border}`,
    borderRadius: shape,
    boxShadow: 'none',
  }),
  bold: (accent, t, shape) => ({
    background: accent,
    border: 'none',
    borderRadius: shape,
    boxShadow: `0 6px 20px ${accent}40`,
    color: needsDarkText(accent) ? '#111' : '#fff',
  }),
  minimal: (accent, t, shape) => ({
    background: 'transparent',
    border: 'none',
    borderRadius: shape,
    boxShadow: 'none',
  }),
};

// Back-compat: legacy buttonStyle (card/pill/outline/shadow) used by old pages.
export const BUTTON_STYLES_FN = {
  card:    (accent, t) => LINK_STYLES.classic(accent, t, 14),
  pill:    (accent, t) => LINK_STYLES.classic(accent, t, 999),
  outline: (accent, t) => LINK_STYLES.simple(accent, t, 14),
  shadow:  (accent, t) => ({ ...LINK_STYLES.classic(accent, t, 14), boxShadow: '0 4px 20px rgba(0,0,0,0.35)', border: 'none' }),
};

// Resolve the effective link style object from page data + shape/shadow/outline.
export function resolveLinkStyle(data, accent, t) {
  const shape = BLOCK_SHAPES[data.blockStyle?.shape || 'rounded']?.radius ?? 14;
  const styleKey = data.linkStyle || (data.buttonStyle ? null : 'classic');
  let base;
  if (styleKey) base = (LINK_STYLES[styleKey] || LINK_STYLES.classic)(accent, t, shape);
  else base = (BUTTON_STYLES_FN[data.buttonStyle] || BUTTON_STYLES_FN.card)(accent, t);
  // Shadow: legacy `shadow:true` => soft. New `shadowType` (soft|hard) with
  // an optional custom `shadowColor` (hard = brutalist offset, soft = blur).
  const bs = data.blockStyle || {};
  const shadowType = bs.shadowType || (bs.shadow ? 'soft' : 'none');
  if (shadowType === 'hard') {
    base.boxShadow = `5px 5px 0 0 ${bs.shadowColor || '#000000'}`;
  } else if (shadowType === 'soft') {
    base.boxShadow = `0 6px 22px ${bs.shadowColor || 'rgba(0,0,0,0.4)'}`;
  }
  if (bs.outline) base.border = `1.5px solid ${bs.outlineColor || `${accent}88`}`;
  if (data.colors?.buttonText) base.color = data.colors.buttonText;
  return base;
}

// ---- Per-block design overrides (Advanced Formatting) ---------
// The heart of "much deeper control over the layout": every block can override
// its own container look (background / text / accent / corners / border /
// shadow) so blocks don't all inherit one identical theme. `base` is the
// block's default card style (usually the resolved global linkSty merged with
// the design-language card). Returns { card, text, accent } to spread + use.
export function resolveBlockStyle(block, base, t, accent) {
  const s = block?.style || {};
  const card = { ...base };
  let text = base.color || t.text;
  let acc = accent;

  if (s.shape && s.shape !== 'inherit') {
    card.borderRadius = BLOCK_SHAPES[s.shape]?.radius ?? card.borderRadius;
  }
  if (s.bgType === 'solid' && s.bg) {
    card.background = s.bg;
  } else if (s.bgType === 'gradient' && (s.bg || s.bg2)) {
    const c1 = s.bg || accent;
    const c2 = s.bg2 || t.bg;
    const dir = GRAD_DIRECTIONS[s.gradDir]?.css || '135deg';
    card.background = dir === 'radial'
      ? `radial-gradient(circle at 50% 30%, ${c1}, ${c2})`
      : `linear-gradient(${dir}, ${c1}, ${c2})`;
  } else if (s.bgType === 'transparent') {
    card.background = 'transparent';
  }
  if (s.border && s.border !== 'inherit') {
    card.border = s.border === 'none'
      ? 'none'
      : `${s.border === 'thick' ? 2 : 1}px solid ${s.borderColor || `${acc}88`}`;
  }
  if (s.shadow && s.shadow !== 'inherit') {
    if (s.shadow === 'none') card.boxShadow = 'none';
    else if (s.shadow === 'soft') card.boxShadow = `0 8px 24px ${s.shadowColor || 'rgba(0,0,0,0.4)'}`;
    else card.boxShadow = `5px 5px 0 0 ${s.shadowColor || '#000000'}`;
  }
  if (s.accent) acc = s.accent;
  if (s.text) { text = s.text; card.color = s.text; }
  else if (s.bgType === 'solid' && s.bg) { text = needsDarkText(s.bg) ? '#111' : '#fff'; card.color = text; }
  return { card, text, accent: acc };
}

// True if a block carries any per-block design override (drives the editor's
// "custom" flag + the block-list summary chip).
export function hasBlockStyle(block) {
  const s = block?.style;
  return !!(s && (s.bgType || s.text || s.accent
    || (s.shape && s.shape !== 'inherit')
    || (s.border && s.border !== 'inherit')
    || (s.shadow && s.shadow !== 'inherit')));
}

// ---- Header (profile) styles ----------------------------------
export const HEADER_LAYOUTS = { centered: 'Centered', left: 'Left', full: 'Full width' };
export const HEADER_VARIANTS = { minimal: 'Minimal', banner: 'Banner', portrait: 'Portrait', animated: 'Animated' };

// ---- Design-language spec (the heart of "themes = design systems") --------
// A theme's `designLang` selects a complete structural identity here: page
// rhythm (gap/padding/width), link-card CONSTRUCTION (fill/border/shadow/icon
// tile/trailing affordance), profile typography (title/username/bio), the
// avatar frame, and the social-chip treatment. The renderer reads this — it is
// the single source of truth for what makes two themes look like two apps.
// These are brand-NEUTRAL (the user's identity), never Vergr app chrome.
export const SPACE_DEFAULT = { gap: 14, px: 20, pt: 18, maxW: 480 };

export function designSpec(dl, accent, t) {
  switch (dl) {
    case 'soft':
      return {
        space: { gap: 16, px: 22, pt: 22, maxW: 460 },
        link: { card: { borderRadius: 24, padding: '16px 20px', boxShadow: `0 12px 26px ${accent}26`, border: 'none', background: t.surface }, title: { fontWeight: 600 }, iconWrap: { borderRadius: 14 }, trail: '›' },
        profile: { title: { fontWeight: 700, letterSpacing: '-0.01em' } },
        avatar: { frame: 'soft' },
        social: { mode: 'brand', radius: 999 },
      };
    case 'brutalist':
      return {
        space: { gap: 14, px: 18, pt: 16, maxW: 480 },
        link: {
          card: { border: `2.5px solid ${t.text}`, boxShadow: `5px 5px 0 0 ${t.text}`, background: t.surface, borderRadius: 2, padding: '14px 16px' },
          title: { textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 },
          iconWrap: { borderRadius: 0, border: `2px solid ${t.text}`, background: accent },
          trail: '→', trailStyle: { fontWeight: 900, color: t.text },
        },
        profile: { title: { textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.01em' }, username: { textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, fontSize: 11 } },
        avatar: { frame: 'hard' },
        social: { mode: 'mono', radius: 0, border: 2 },
      };
    case 'editorial':
      return {
        space: { gap: 2, px: 28, pt: 30, maxW: 440 },
        link: {
          card: { background: 'transparent', border: 'none', borderBottom: `1px solid ${t.border}`, borderRadius: 0, boxShadow: 'none', padding: '17px 2px' },
          title: { fontWeight: 500, letterSpacing: '0.01em', fontSize: 16 },
          hideIcon: true, trail: '→', trailStyle: { color: t.textSub },
        },
        profile: { title: { fontWeight: 500, letterSpacing: '0.01em', fontSize: 30 }, username: { fontStyle: 'italic', letterSpacing: '0.02em' } },
        avatar: { frame: 'hairline' },
        social: { mode: 'mono', radius: 0, plain: true },
      };
    case 'neon':
      return {
        space: { gap: 15, px: 20, pt: 18, maxW: 480 },
        link: {
          card: { border: `1.5px solid ${accent}`, boxShadow: `0 0 16px ${accent}55, inset 0 0 12px ${accent}1f`, background: 'rgba(255,255,255,0.02)', borderRadius: 12 },
          title: { textShadow: `0 0 8px ${accent}99`, fontWeight: 600 },
          iconWrap: { border: `1px solid ${accent}`, background: 'transparent' },
          trail: '›', trailStyle: { color: accent, textShadow: `0 0 8px ${accent}` },
        },
        profile: { title: { fontWeight: 700, textShadow: `0 0 14px ${accent}aa`, letterSpacing: '0.02em' } },
        avatar: { frame: 'glow' },
        social: { mode: 'mono', radius: 12, glow: true },
      };
    case 'glass':
      return {
        space: { gap: 13, px: 20, pt: 18, maxW: 480 },
        link: { card: { backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }, iconWrap: { background: 'rgba(255,255,255,0.12)', borderRadius: 11 }, trail: '›' },
        profile: { title: { fontWeight: 700, letterSpacing: '-0.01em' } },
        avatar: { frame: 'glass' },
        social: { mode: 'theme', radius: 14, glass: true },
      };
    case 'zine':
      return {
        space: { gap: 15, px: 18, pt: 16, maxW: 480 },
        link: {
          card: { border: `2px solid ${t.text}`, boxShadow: `3px 3px 0 0 ${t.text}`, background: t.surface, borderRadius: 2, padding: '14px 16px' },
          title: { fontWeight: 700 },
          iconWrap: { borderRadius: 2, border: `2px solid ${t.text}`, background: accent },
          trail: '✦', trailStyle: { color: accent },
        },
        profile: { title: { fontWeight: 800, letterSpacing: '-0.01em' }, username: { fontWeight: 600 } },
        avatar: { frame: 'sticker' },
        social: { mode: 'mono', radius: 2, border: 2 },
      };
    case 'terminal':
      return {
        space: { gap: 9, px: 16, pt: 14, maxW: 480 },
        link: {
          card: { background: 'rgba(0,0,0,0.3)', border: `1px solid ${accent}55`, borderRadius: 2, boxShadow: 'none', padding: '12px 14px' },
          title: { fontFamily: 'monospace', fontWeight: 500 }, titlePrefix: '> ',
          hideIcon: true, trail: '_', trailStyle: { color: accent, fontWeight: 700 },
        },
        profile: { title: { fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0' }, prefix: '~/ ', username: { fontFamily: 'monospace' } },
        avatar: { frame: 'terminal' },
        social: { mode: 'mono', radius: 2 },
      };
    case 'luxe':
      return {
        space: { gap: 18, px: 26, pt: 30, maxW: 460 },
        link: {
          card: { background: 'transparent', border: `1px solid ${accent}55`, borderRadius: 2, boxShadow: 'none', padding: '17px 20px' },
          title: { letterSpacing: '0.07em', fontWeight: 500 },
          iconWrap: { background: 'transparent', border: `1px solid ${accent}55`, borderRadius: 2 },
          trail: '→', trailStyle: { color: accent },
        },
        profile: { title: { fontWeight: 400, letterSpacing: '0.12em', fontSize: 26, textTransform: 'uppercase' }, username: { letterSpacing: '0.22em', textTransform: 'uppercase', fontSize: 11 } },
        avatar: { frame: 'luxe' },
        social: { mode: 'mono', radius: 2, hairline: true },
      };
    case 'minimal':
    default:
      return {
        space: SPACE_DEFAULT,
        link: { card: {}, title: { fontWeight: 500 } },
        profile: { title: { fontWeight: 700, letterSpacing: '-0.02em' } },
        avatar: { frame: 'ring' },
        social: { mode: 'brand', radius: 12 },
      };
  }
}

// ---- Appearance resolver --------------------------------------
// Merges theme tokens with custom-colour overrides into a single
// effective token set, plus the accent. Used everywhere.
export function resolveAppearance(data) {
  const themeKey = THEMES[data.theme] ? data.theme : 'dark';
  const base = THEMES[themeKey];
  const c = data.colors || {};
  const t = { ...base };
  if (c.pageBg) t.bg = c.pageBg;
  if (c.text) t.text = c.text;
  if (c.textSub) t.textSub = c.textSub;
  if (c.blockBg) { t.surface = c.blockBg; t.iconBg = c.blockBg; }
  if (c.blockText) t.text = c.blockText;
  const accent = c.buttonBg || data.accentColor || base.accent || '#4DFFD4';
  const font = FONT_PRESETS[data.font] || FONT_PRESETS.vergr;
  // Independent text colours (title / bio) override the theme tokens.
  const titleColor = c.title || c.blockText || t.text;
  const bioColor = c.bio || t.textSub;
  const designLang = base.designLang || 'minimal';
  const spec = designSpec(designLang, accent, t);
  return { themeKey, t, accent, font, colors: c, titleColor, bioColor, designLang, spec, space: spec.space };
}

// ---- Block registry -------------------------------------------
// type → metadata + default field factory. `tier:'pro'` gates the
// block behind Pro (admin bypasses via useTier). icon = Material Symbol.
export const BLOCK_REGISTRY = {
  link:    { label: 'Link',          icon: 'link',                tier: 'free', cat: 'core',   make: () => ({ title: '', url: '', icon: '🔗', subtitle: '', highlight: false }) },
  collection: { label: 'Collection', icon: 'dashboard',           tier: 'free', cat: 'core',   make: () => ({ title: '', layout: 'grid', items: [] }) },
  header:  { label: 'Section title',  icon: 'title',               tier: 'free', cat: 'core',   make: () => ({ text: 'New section' }) },
  text:    { label: 'Text',          icon: 'notes',               tier: 'free', cat: 'core',   make: () => ({ text: '' }) },
  faq:     { label: 'FAQ / accordion', icon: 'quiz',              tier: 'free', cat: 'core',   make: () => ({ title: 'FAQ', items: [{ q: '', a: '' }] }) },
  countdown:{ label: 'Countdown',    icon: 'timer',               tier: 'free', cat: 'core',   make: () => ({ title: '', target: '', expired: 'hide', revealUrl: '', revealLabel: '', endedText: '' }) },
  divider: { label: 'Divider',       icon: 'horizontal_rule',     tier: 'free', cat: 'core',   make: () => ({ variant: 'line', label: '', spacing: 'md' }) },
  socials: { label: 'Social icons',  icon: 'share',               tier: 'free', cat: 'core',   make: () => ({ socials: {} }) },
  image:   { label: 'Image',         icon: 'image',               tier: 'free', cat: 'media',  make: () => ({ url: '', caption: '', link: '' }) },
  gallery: { label: 'Gallery',       icon: 'photo_library',       tier: 'free', cat: 'media',  make: () => ({ images: [], layout: 'grid' }) },
  video:   { label: 'Video',         icon: 'smart_display',       tier: 'free', cat: 'media',  make: () => ({ provider: 'youtube', url: '', title: '' }) },
  music:   { label: 'Music',         icon: 'music_note',          tier: 'free', cat: 'media',  make: () => ({ provider: 'spotify', url: '' }) },
  map:     { label: 'Map / location', icon: 'location_on',        tier: 'free', cat: 'media',  make: () => ({ address: '', zoom: 14, height: 220, caption: '' }) },
  product: { label: 'Product',       icon: 'storefront',          tier: 'free', cat: 'commerce', make: () => ({ title: '', url: '', price: '', imageUrl: '', desc: '' }) },
  digital_product: { label: 'Store product', icon: 'download_for_offline', tier: 'free', cat: 'commerce', make: () => ({ productId: '', layout: 'card' }) },
  shop_catalog: { label: 'Shop catalog', icon: 'store', tier: 'free', cat: 'commerce', make: () => ({ title: '', shopUrl: '', source: '', currency: '', items: [] }) },
  embed:   { label: 'Embed',         icon: 'code',                tier: 'pro',  cat: 'media',  make: () => ({ url: '', height: 320 }) },
  email:   { label: 'Email contact', icon: 'mail',                tier: 'free', cat: 'contact',make: () => ({ email: '', label: 'Connect with me' }) },
  message: { label: 'Message on Vergr', icon: 'chat',             tier: 'free', cat: 'contact',make: () => ({ label: 'Message on Vergr' }) },
  tip:     { label: 'Tip jar',       icon: 'volunteer_activism',  tier: 'free', cat: 'commerce', make: () => ({ label: 'Buy me a coffee' }) },
  membership: { label: 'Membership', icon: 'workspace_premium',   tier: 'free', cat: 'commerce', make: () => ({ title: 'Membership' }) },
  vergr_stream:     { label: 'My live stream',  icon: 'sensors',             tier: 'free', cat: 'vergr', make: () => ({ auto: true }) },
  // vergr_tournament fully removed 2026-08-19. It was already unaddable (parked
  // under a _retired_ key so the picker skipped it); the entry itself is gone
  // now, along with its editor form, its label and its renderer. A page saved
  // with one renders nothing for that block. See VergrMeView.
  vergr_event:      { label: 'Ticketed event',  icon: 'confirmation_number', tier: 'free', cat: 'vergr', make: () => ({ eventId: '' }) },
  vergr_squad:      { label: 'My squad',        icon: 'groups',              tier: 'free', cat: 'vergr', make: () => ({ squadId: '' }) },
  vergr_group:      { label: 'Join my group',   icon: 'forum',               tier: 'free', cat: 'vergr', make: () => ({ groupId: '' }) },
  invite:           { label: 'Invite & earn',    icon: 'card_giftcard',       tier: 'free', cat: 'vergr', make: () => ({ label: 'Join me on Vergr' }) },
  support:          { label: 'Support button',    icon: 'favorite',            tier: 'free', cat: 'commerce', make: () => ({ provider: 'bmac', handle: '', label: '' }) },
  services:         { label: 'Services & pricing',icon: 'sell',                tier: 'free', cat: 'commerce', make: () => ({ title: 'Services', items: [{ name: '', price: '', desc: '', url: '' }] }) },
  contact:          { label: 'Contact form',      icon: 'contact_mail',        tier: 'free', cat: 'contact', make: () => ({ label: 'Send', message: true, phone: false }) },
  booking:          { label: 'Booking',           icon: 'event_available',     tier: 'pro',  cat: 'contact', make: () => ({ provider: 'calendly', url: '', height: 660 }) },
};

// Starter templates — give a brand-new page a designed, on-purpose starting
// point (item 20). Each is a full look: a design system + accent + a curated,
// editable set of blocks. `blocks` are specs ({ type, ...fields }); the editor
// runs them through newBlock() so they get fresh ids/order. All free.
export const VERGRME_TEMPLATES = [
  {
    id: 'creator',
    label: 'Creator',
    sub: 'Links, socials, a tip jar',
    icon: 'auto_awesome',
    patch: { theme: 'dark', accentColor: '#4DFFD4', linkStyle: 'classic', headerStyle: { layout: 'centered', variant: 'portrait' } },
    blocks: [
      { type: 'header', text: 'My links' },
      { type: 'link', title: 'Latest video', subtitle: 'Watch the newest drop', icon: '▶️', highlight: true },
      { type: 'link', title: 'Subscribe on YouTube', icon: '📺' },
      { type: 'socials', socials: {} },
      { type: 'tip', label: 'Buy me a coffee' },
    ],
  },
  {
    id: 'streamer',
    label: 'Streamer',
    sub: 'Go-live, Discord, schedule',
    icon: 'sensors',
    patch: { theme: 'neon', accentColor: '#B44FFF', linkStyle: 'classic', headerStyle: { layout: 'centered', variant: 'banner' } },
    blocks: [
      { type: 'header', text: 'Stream hub' },
      { type: 'vergr_stream', auto: true },
      { type: 'link', title: 'Watch on Twitch', icon: '🟣', highlight: true },
      { type: 'link', title: 'Join the Discord', icon: '💬' },
      { type: 'text', text: 'Live most nights — follow so you don’t miss it.' },
      { type: 'socials', socials: {} },
      { type: 'support', provider: 'bmac', label: '' },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    sub: 'Intro, services, contact',
    icon: 'work',
    patch: { theme: 'editorial', accentColor: '#F0A500', linkStyle: 'classic', headerStyle: { layout: 'left', variant: 'minimal' } },
    blocks: [
      { type: 'header', text: 'Welcome' },
      { type: 'text', text: 'What I do, in one line. Edit this to introduce yourself.' },
      { type: 'services', title: 'Services', items: [{ name: 'Starter', price: '', desc: '', url: '' }] },
      { type: 'contact', label: 'Get in touch', message: true, phone: false },
      { type: 'socials', socials: {} },
    ],
  },
  {
    id: 'musician',
    label: 'Musician',
    sub: 'New release, shows, socials',
    icon: 'music_note',
    patch: { theme: 'brutal', accentColor: '#C87FFF', linkStyle: 'classic', headerStyle: { layout: 'centered', variant: 'portrait' } },
    blocks: [
      { type: 'header', text: 'New release' },
      { type: 'music', provider: 'spotify', url: '' },
      { type: 'link', title: 'Tour dates', icon: '🎫', highlight: true },
      { type: 'link', title: 'Merch store', icon: '🛍️' },
      { type: 'socials', socials: {} },
      { type: 'tip', label: 'Support the music' },
    ],
  },
];

// Support / tip providers — branded link cards (no API needed; the few that can
// show live data via webhook are a separate Pro item). base = profile URL stem.
export const SUPPORT_PROVIDERS = {
  bmac:     { label: 'Buy Me a Coffee', brand: '#FFDD00', base: 'https://buymeacoffee.com/', cta: 'Buy me a coffee', emoji: '☕' },
  kofi:     { label: 'Ko-fi',           brand: '#FF5E5B', base: 'https://ko-fi.com/',        cta: 'Support me on Ko-fi', emoji: '❤️' },
  patreon:  { label: 'Patreon',         brand: '#F96854', base: 'https://patreon.com/',      cta: 'Become a patron', emoji: 'Ⓟ' },
  paypal:   { label: 'PayPal',          brand: '#003087', base: 'https://paypal.me/',        cta: 'Tip via PayPal', emoji: '🅿' },
  cashapp:  { label: 'Cash App',        brand: '#00D632', base: 'https://cash.app/$',        cta: 'Pay me on Cash App', emoji: '$' },
  venmo:    { label: 'Venmo',           brand: '#3D95CE', base: 'https://venmo.com/',        cta: 'Pay me on Venmo', emoji: 'V' },
  gofundme: { label: 'GoFundMe',        brand: '#00B964', base: 'https://gofundme.com/f/',   cta: 'Support my fundraiser', emoji: '🎗' },
};

// Build a support provider's full URL from a stored handle (or pass-through URL).
export function supportUrl(provider, handle) {
  if (!handle) return '';
  if (/^https?:\/\//i.test(handle)) return handle;
  const base = SUPPORT_PROVIDERS[provider]?.base || '';
  return base + handle.replace(/^[@$]/, '');
}

// Collection (structural) layouts — group multiple links and pick how they tile.
export const COLLECTION_LAYOUTS = {
  stack:    'Stack',
  grid:     'Grid',
  carousel: 'Carousel',
  showcase: 'Showcase',
};

export const BLOCK_CATEGORIES = [
  { id: 'core',     label: 'Basics' },
  { id: 'media',    label: 'Media' },
  { id: 'commerce', label: 'Earn' },
  { id: 'contact',  label: 'Contact' },
  { id: 'vergr',    label: 'Vergr' },
];

// ---- Tier gates -----------------------------------------------
// What requires Pro. Generous free tier; Pro keeps power features.
// Block-type gating lives on BLOCK_REGISTRY[type].tier.
export const VERGRME_TIER_GATES = {
  customTheme:    'pro', // the fully-custom colour theme
  customColors:   'pro', // granular per-element colour overrides
  videoBackground:'pro',
  gifBackground:  'pro',
  animatedHeader: 'pro',
  hideBranding:   'lite', // Lite or Pro (gated via tier!=='free' in SettingsPanel)
  analytics:      'free', // basic views/clicks free; engagement/retention Pro (§5)
  customDomain:   'pro',
  premiumBg:      'pro', // particle/canvas animated backgrounds
  customCss:      'pro', // sandboxed custom CSS escape hatch
};

/**
 * The page a visitor may see for the OWNER's plan. The editor only stops a free
 * owner from CHOOSING a paid option; the page doc is client-written, so until
 * 2026-09-27 the public page drew whatever was saved: a lapsed Pro kept the
 * design kit, custom CSS and tracking pixels forever, and any account could
 * write them directly. Free because the page already loads the owner's profile.
 * Lead webhooks are gated server-side in functions/vergrMe.js.
 * @param {object} page  users/{uid}/vergrMe/page
 * @param {'free'|'lite'|'pro'} plan  the OWNER's plan (staff count as pro)
 */
export function pageForPlan(page, plan) {
  if (!page || plan === 'pro') return page;
  const out = { ...page };
  if (plan === 'free') out.hideBranding = false;
  if (out.theme && !FREE_THEMES.includes(out.theme)) out.theme = 'dark';
  if (out.colors && Object.keys(out.colors).length) out.colors = {};
  const bg = out.background;
  if (bg && ['video', 'gif', 'particles'].includes(bg.type)) out.background = { ...bg, type: 'gradient' };
  const hs = out.headerStyle;
  if (hs && (hs.variant === 'animated' || hs.avatarSize === 'hero')) {
    out.headerStyle = {
      ...hs,
      ...(hs.variant === 'animated' ? { variant: 'banner' } : {}),
      ...(hs.avatarSize === 'hero' ? { avatarSize: 'standard' } : {}),
    };
  }
  out.customCss = '';
  out.pixels = null;
  if (Array.isArray(out.blocks)) out.blocks = out.blocks.filter((b) => BLOCK_REGISTRY[b?.type]?.tier !== 'pro');
  return out;
}

export const ACCENT_PRESETS = [
  '#4DFFD4', '#7B1FFF', '#B44FFF', '#C87FFF',
  '#F0A500', '#F04060', '#3D7FFF', '#34D399', '#FF7A3D',
];

// label = compact glyph; brand = the platform's signature colour (used when
// the socials block is in brand-colour mode, vs monochrome theme colour).
export const SOCIAL_META = {
  instagram: { label: 'IG', baseUrl: 'https://instagram.com/',          brand: '#E1306C' },
  x:         { label: '𝕏',  baseUrl: 'https://x.com/',                  brand: '#000000' },
  youtube:   { label: 'YT', baseUrl: 'https://youtube.com/@',           brand: '#FF0000' },
  tiktok:    { label: 'TT', baseUrl: 'https://tiktok.com/@',            brand: '#00F2EA' },
  twitch:    { label: 'Tw', baseUrl: 'https://twitch.tv/',              brand: '#9146FF' },
  kick:      { label: 'Ki', baseUrl: 'https://kick.com/',               brand: '#53FC18' },
  discord:   { label: 'DC', baseUrl: 'https://discord.gg/',             brand: '#5865F2' },
  linkedin:  { label: 'in', baseUrl: 'https://linkedin.com/in/',        brand: '#0A66C2' },
  github:    { label: 'GH', baseUrl: 'https://github.com/',             brand: '#FFFFFF' },
  spotify:   { label: 'Sp', baseUrl: 'https://open.spotify.com/user/',  brand: '#1DB954' },
  facebook:  { label: 'fb', baseUrl: 'https://facebook.com/',           brand: '#1877F2' },
  threads:   { label: '@',  baseUrl: 'https://threads.net/@',           brand: '#000000' },
};

// Avatar size + shape options for the profile header.
export const AVATAR_SIZES = { standard: 'Standard', hero: 'Hero (large)' };
export const AVATAR_SHAPES = { circle: 'Circle', hexagon: 'Hexagon', square: 'Rounded square' };

export function needsDarkText(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145;
}
