// profileSocials — the ONE definition of the link icons under a profile's bio.
//
// All three profile views (web own, web public, native own + public) render
// these. Each used to carry its own copy of socialsToList / socialIcon, which is
// how views drift apart.
//
// ⚠ EMAIL IS A CONTACT LINK THE PERSON ADDS, NEVER THE SIGN-UP ADDRESS.
// Founder, 2026-09-16: the email someone signed up with must not be visible;
// an email shows only when they add it in Edit Profile → Social Links, as an
// icon like any other link. The sign-up address lives in Firebase Auth only.
import { openExternalUrl } from './externalBrowser';

const ICONS = {
  twitter: 'public', x: 'public', youtube: 'play_circle', instagram: 'photo_camera',
  tiktok: 'music_note', discord: 'chat', twitch: 'live_tv', website: 'language',
  facebook: 'facebook', email: 'mail',
};

const LABELS = {
  twitter: 'X', x: 'X', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok',
  discord: 'Discord', twitch: 'Twitch', website: 'Website', facebook: 'Facebook', email: 'Email',
};

export function socialIcon(platform) {
  return ICONS[(platform || '').toLowerCase()] || 'link';
}

export function socialLabel(platform) {
  return LABELS[(platform || '').toLowerCase()] || 'Link';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address a link opens, or null when the value can't be used. */
export function socialHref(platform, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if ((platform || '').toLowerCase() === 'email') {
    const addr = v.replace(/^mailto:/i, '');
    return EMAIL_RE.test(addr) ? `mailto:${addr}` : null;
  }
  return v;
}

// Edit Profile stores socials as a map ({ twitter: 'url', ... }); older
// accounts may hold an array. A link shows unless its switch is turned off.
export function socialsToList(socials, enabled = {}) {
  if (!socials) return [];
  const rows = Array.isArray(socials)
    ? socials.filter((s) => s && s.url).map((s) => ({ platform: s.platform, url: s.url }))
    : typeof socials === 'object'
      ? Object.entries(socials)
        .filter(([platform, url]) => url && enabled?.[platform] !== false)
        .map(([platform, url]) => ({ platform, url }))
      : [];
  return rows
    .map((s) => ({ ...s, href: socialHref(s.platform, s.url) }))
    .filter((s) => s.href);
}

/** onClick for a link chip: in the phone app hand it to the system (mail app,
 *  browser); on the web let the anchor do its normal thing. */
export function openSocialLink(e, href) {
  if (openExternalUrl(href)) e.preventDefault();
}

// ── Game and platform handles (Settings → Connected accounts) ─────────────
// The ONE definition of which linked handles a profile shows, and how.
// Before 2026-09-21 the Connected accounts screen promised "shown on your
// profile" for every one of these and no profile view rendered any of them.
//
// Twitch and Discord are deliberately NOT here: those rows are integrations
// (stream mirror, server clone), connected for what they DO, and connecting one
// must not publish the handle. Someone who wants them shown adds them as a
// Social Link instead.
const HANDLE_PLATFORMS = [
  { id: 'steam',       label: 'Steam',       mark: 'S', bg: '#1b2838', fg: '#c7d5e0',
    href: (v) => (/^7656119\d{10}$/.test(v) ? `https://steamcommunity.com/profiles/${v}` : `https://steamcommunity.com/id/${encodeURIComponent(v)}`) },
  { id: 'youtube',     label: 'YouTube',     mark: 'Y', bg: '#3a0d0d', fg: '#ff6b6b',
    href: (v) => (/^https?:\/\//i.test(v) ? v : `https://www.youtube.com/@${encodeURIComponent(v.replace(/^@/, ''))}`) },
  { id: 'riotgames',   label: 'Riot ID',     mark: 'R', bg: '#3a1210', fg: '#ff8a80' },
  { id: 'battlenet',   label: 'Battle.net',  mark: 'B', bg: '#0b2a3d', fg: '#7dd3fc' },
  { id: 'origin',      label: 'EA',          mark: 'EA', bg: '#3a1414', fg: '#ff8a8a' },
  { id: 'openxbl',     label: 'Xbox',        mark: 'X', bg: '#0f2a12', fg: '#86efac' },
  { id: 'playstation', label: 'PlayStation', mark: 'P', bg: '#0c1c3d', fg: '#93c5fd' },
  { id: 'epicgames',   label: 'Epic Games',  mark: 'E', bg: '#222230', fg: '#e5e7eb' },
];

// Edit Profile used to collect the same IDs in a "Gaming Platforms" form
// (users.platforms, different keys) that nothing ever showed. They still
// display, as a fallback: a handle set in Connected accounts wins.
const LEGACY_PLATFORM_KEYS = { playstation: 'playstation', xbox: 'openxbl', steam: 'steam', epic: 'epicgames', riot: 'riotgames' };

/** [{ id, label, mark, bg, fg, handle, href|null }] for the handles someone added. */
export function linkedHandlesList(linkedAccounts, legacyPlatforms) {
  const linked = { ...(linkedAccounts && typeof linkedAccounts === 'object' ? linkedAccounts : {}) };
  if (legacyPlatforms && typeof legacyPlatforms === 'object') {
    for (const [k, id] of Object.entries(LEGACY_PLATFORM_KEYS)) {
      if (!linked[id] && typeof legacyPlatforms[k] === 'string' && legacyPlatforms[k].trim()) linked[id] = legacyPlatforms[k];
    }
  }
  const out = [];
  for (const p of HANDLE_PLATFORMS) {
    const raw = linked[p.id];
    // A string, a legacy { username }, or Steam's pre-2026-09-21 { steamId64 }.
    const handle = String(typeof raw === 'string' ? raw : (raw?.username || raw?.steamId64 || '')).trim().slice(0, 64);
    if (!handle) continue;
    out.push({ id: p.id, label: p.label, mark: p.mark, bg: p.bg, fg: p.fg, handle, href: p.href ? p.href(handle) : null });
  }
  return out;
}
