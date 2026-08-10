// Chat background wallpapers.
//
// Each entry has:
//   mobile  — vertical 1024×1563 PNG, used on small screens (tiles via repeat-x)
//   desktop — horizontal 1672×941 WebP (~5–10× smaller than PNG), used on wide
//             screens (cover). WebP support is near-universal.
//
// Folder convention: /backgrounds/static/bg_N.png (mobile),
//                    /backgrounds/static/bg_N_Desktop.webp (desktop).

export const CHAT_BACKGROUNDS = [
  { id: 'bg_1', name: 'Neon Icons',  mobile: '/backgrounds/static/bg_1.png', desktop: '/backgrounds/static/bg_1_Desktop.webp' },
  { id: 'bg_2', name: 'Gaming Tech', mobile: '/backgrounds/static/bg_2.png', desktop: '/backgrounds/static/bg_2_Desktop.webp' },
  { id: 'bg_3', name: 'Retro Arcade',mobile: '/backgrounds/static/bg_3.png', desktop: '/backgrounds/static/bg_3_Desktop.webp' },
  { id: 'bg_4', name: 'Dark Circuit',mobile: '/backgrounds/static/bg_4.png', desktop: '/backgrounds/static/bg_4_Desktop.webp' },
  { id: 'bg_5', name: 'Pixel Grid',  mobile: '/backgrounds/static/bg_5.png', desktop: '/backgrounds/static/bg_5_Desktop.webp' },
  { id: 'bg_6', name: 'Cyber Night', mobile: '/backgrounds/static/bg_6.png', desktop: '/backgrounds/static/bg_6_Desktop.webp' },
  // bg_7 has no desktop variant — falls back to the portrait file (cover-sized).
  { id: 'bg_7', name: 'Galaxy',      mobile: '/backgrounds/static/bg_7.png', desktop: '/backgrounds/static/bg_7.png' },
  { id: 'none', name: 'No Background', mobile: null, desktop: null },
];

export const BG_CATEGORIES = {
  wallpapers: 'Wallpapers',
  custom: 'Custom Upload',
};

export const getChatBackground = (id) => CHAT_BACKGROUNDS.find(b => b.id === id) || CHAT_BACKGROUNDS[0];

export const getChatBgStyle = (bgId, customImageUrl, opts = {}) => {
  const isDesktop = !!opts.isDesktop;

  if (customImageUrl) {
    return {
      backgroundImage: `url(${customImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundColor: '#07080D',
    };
  }
  const bg = getChatBackground(bgId);
  if (!bg) return { backgroundColor: '#07080D' };

  const url = isDesktop ? (bg.desktop || bg.mobile) : bg.mobile;
  if (!url) return { backgroundColor: '#07080D' };

  return {
    backgroundImage: `url(${url})`,
    backgroundSize: isDesktop ? 'cover' : 'auto 100%',
    backgroundPosition: 'center center',
    backgroundRepeat: isDesktop ? 'no-repeat' : 'repeat-x',
    backgroundColor: '#07080D',
  };
};

// Preload one background's chosen URL by inserting a <link rel="preload">
// into <head>. Browser priority will be high and the image will be in the
// HTTP cache by the time the chat thread mounts.
export const preloadBackground = (bgId, customImageUrl, opts = {}) => {
  if (typeof document === 'undefined') return;
  const isDesktop = !!opts.isDesktop;
  let url = customImageUrl || null;
  if (!url) {
    const bg = getChatBackground(bgId);
    if (!bg) return;
    url = isDesktop ? (bg.desktop || bg.mobile) : bg.mobile;
  }
  if (!url) return;
  // Skip if already preloaded.
  if (document.head.querySelector(`link[data-bg-preload="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  link.setAttribute('data-bg-preload', url);
  document.head.appendChild(link);
};

// Preload ALL static backgrounds in the background so the picker shows them
// instantly and switches are seamless. Call once at app boot.
export const preloadAllBackgrounds = (opts = {}) => {
  if (typeof window === 'undefined') return;
  const isDesktop = !!opts.isDesktop;
  // Use Image() not preload-link so we don't spam <head>. The browser puts
  // them in the disk cache without blocking page idle work.
  for (const bg of CHAT_BACKGROUNDS) {
    if (!bg.mobile) continue;
    const url = isDesktop ? (bg.desktop || bg.mobile) : bg.mobile;
    if (!url) continue;
    const img = new Image();
    // Low priority so we don't compete with above-the-fold image loads.
    if ('fetchPriority' in img) img.fetchPriority = 'low';
    img.decoding = 'async';
    img.src = url;
  }
};

export const getBackgroundsByCategory = () => ({
  wallpapers: CHAT_BACKGROUNDS.filter(b => b.mobile),
});

// Maximum target dimensions for user-uploaded custom backgrounds. Anything
// bigger gets canvas-resized in the browser before upload. Saves storage +
// load time for everyone.
export const CUSTOM_BG_TARGETS = {
  mobile:  { w: 1024, h: 1563 },
  desktop: { w: 1672, h: 941 },
};

// Client-side resize. Returns a Blob (image/webp by default, fall back to
// image/jpeg if webp unsupported). Picks orientation based on the source
// aspect ratio so portrait uploads → mobile target, landscape → desktop.
export const resizeCustomBackground = async (file) => {
  const bitmap = await createImageBitmap(file).catch(async () => {
    // Fallback for older Safari.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  });
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const isPortrait = srcH >= srcW;
  const target = isPortrait ? CUSTOM_BG_TARGETS.mobile : CUSTOM_BG_TARGETS.desktop;
  // Fit within target while preserving aspect ratio.
  const scale = Math.min(target.w / srcW, target.h / srcH, 1);
  const outW = Math.round(srcW * scale);
  const outH = Math.round(srcH * scale);
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  // Try WebP first (best compression + universal modern support); fall
  // back to JPEG if browser refuses.
  const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/webp', 0.85));
  if (blob && blob.size > 0) return { blob, type: 'image/webp', orientation: isPortrait ? 'mobile' : 'desktop', width: outW, height: outH };
  const jpeg = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.85));
  return { blob: jpeg, type: 'image/jpeg', orientation: isPortrait ? 'mobile' : 'desktop', width: outW, height: outH };
};
