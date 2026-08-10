// KLIPY API — gifs + stickers + clips.
//
// GIFs used to come from Tenor. Google shut that API down: every request now
// answers 403 PERMISSION_DENIED "Tenor API is discontinued", with or without a
// Referer, so it is not the referrer-restricted key it looks like and the GIF
// tab had been silently empty. KLIPY serves `gifs` on the same key as the other
// two tabs, in the same nested shape as stickers, so one provider covers all
// three and there is no second API to keep alive.
//
// KLIPY ads appear natively within trending/search/recent responses as items
// with `type: 'ad'`. We MUST pass them through to the UI (and not filter them
// out) for ad delivery + revenue to work. We also pass all required and
// recommended request parameters so KLIPY can target + bill impressions.
const KLIPY_KEY = 'D750DKSQKSBSoCbA8ImbChLBriKeshCoqax2172wm7iy5tQHh3ujjPk5zKnAVzcJ';
const KLIPY_BASE = 'https://api.klipy.com/api/v1';

// ── Persistent per-user id for KLIPY ──
// KLIPY requires a stable customer_id per end-user for ad targeting + frequency capping.
const getCustomerId = () => {
  try {
    let id = localStorage.getItem('klipy_customer_id');
    if (!id) {
      id = `vergr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('klipy_customer_id', id);
    }
    return id;
  } catch {
    return 'vergr_anon';
  }
};

// Fresh session id — new per page load
const SESSION_ID = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const getLocale = () => {
  try {
    const l = (navigator.language || 'en-US').replace('-', '_');
    return l;
  } catch {
    return 'en_US';
  }
};

// Build the common KLIPY param string (required + recommended)
const buildKlipyParams = (extra = '') => {
  const params = new URLSearchParams({
    per_page: '30',
    customer_id: getCustomerId(),
    session_id: SESSION_ID,
    locale: getLocale(),
    content_filter: 'medium',
  });
  return `?${params.toString()}${extra}`;
};

// Stickers and gifs share the nested file structure: file.hd.webp.url
// Keep ads: they ship with the same shape plus click_url/impression_url.
//
// `prefer` orders the formats: a sticker wants its transparent webp, a gif
// wants the actual gif. Same split the Kotlin client makes, so both send the
// same file for the same tile.
const mapNestedResults = (data, prefer = ['webp', 'gif', 'png']) => {
  const items = data?.data?.data || [];
  return items.map(item => {
    const f = item.file || {};
    const hd = f.hd || f.md || f.sm || {};
    const sm = f.sm || f.xs || f.md || {};
    const pick = (bucket) => prefer.map(k => bucket[k]).find(v => v?.url);
    const big = pick(hd) || {};
    const small = pick(sm) || {};
    return {
      id: item.id,
      slug: item.slug,
      title: item.title || '',
      type: item.type, // 'sticker' | 'gif' | 'ad'
      isAd: item.type === 'ad',
      url: big.url || '',
      preview: small.url || big.url || '',
      width: big.width || 200,
      height: big.height || 200,
      click_url: item.click_url || item.target_url || null,
      impression_url: item.impression_url || null,
    };
  });
};

// Clips have FLAT file structure: file.mp4 = "url", file.gif = "url"
const mapClipResults = (data) => {
  const items = data?.data?.data || [];
  return items.map(item => {
    const f = item.file || {};
    const meta = item.file_meta || {};
    return {
      id: item.id,
      slug: item.slug,
      title: item.title || '',
      type: item.type, // 'clip' | 'ad'
      isAd: item.type === 'ad',
      url: f.mp4 || f.gif || f.webp || '',
      preview: f.gif || f.webp || f.mp4 || '',
      videoUrl: f.mp4 || '',
      width: meta.mp4?.width || meta.gif?.width || 320,
      height: meta.mp4?.height || meta.gif?.height || 240,
      click_url: item.click_url || item.target_url || null,
      impression_url: item.impression_url || null,
    };
  });
};

const fetchKlipy = async (contentType, endpoint, extra = '') => {
  try {
    const url = `${KLIPY_BASE}/${KLIPY_KEY}/${contentType}/${endpoint}${buildKlipyParams(extra)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (contentType === 'clips') return mapClipResults(data);
    return mapNestedResults(data, contentType === 'gifs' ? ['gif', 'webp'] : ['webp', 'gif', 'png']);
  } catch (err) {
    console.error(`KLIPY ${contentType}/${endpoint} error:`, err);
    return [];
  }
};

// ── KLIPY ad impression tracking ──
// Fire-and-forget pixel ping for when a KLIPY ad becomes visible.
export const trackKlipyImpression = (item) => {
  if (!item?.isAd || !item?.impression_url) return;
  try {
    // Use an Image pixel so the request works cross-origin without CORS.
    const img = new Image();
    img.src = item.impression_url;
  } catch {}
};

// GIFs (KLIPY — Tenor is discontinued, see the note at the top of this file)
export const searchGifs = (q) => fetchKlipy('gifs', 'search', `&q=${encodeURIComponent(q)}`);
export const getTrendingGifs = () => fetchKlipy('gifs', 'trending');

// Stickers (KLIPY — transparent)
export const searchStickers = (q) => fetchKlipy('stickers', 'search', `&q=${encodeURIComponent(q)}`);
export const getTrendingStickers = () => fetchKlipy('stickers', 'trending');

// Clips (KLIPY — video)
export const searchClips = (q) => fetchKlipy('clips', 'search', `&q=${encodeURIComponent(q)}`);
export const getTrendingClips = () => fetchKlipy('clips', 'trending');
