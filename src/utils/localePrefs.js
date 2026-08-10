// Locality preferences — country/language signals used to group content so
// users mostly see same-country / same-language posts, streams, and people
// first. This reduces how often a user hits foreign-language content (and so
// reduces translation demand) and is better UX.
//
// v1 is ZERO-MIGRATION: users already carry an ISO `country` (set at
// onboarding). We derive a language from country via COUNTRY_LANG so every
// existing user has a usable language signal without a new profile field.
// An explicit per-user spoken-language override can be layered on later
// (EditProfile + onboarding picker) — read it first, fall back to country.
//
// All ranking helpers are PURE + CLIENT-SIDE: feed authors and stream hosts
// are already hydrated with the full user doc, so no extra reads / indexes.

// Translation/locality scope (mirrors docs/LIBRETRANSLATE_PLAN.md Tier 1).
// Russian (ru) + French (fr) are deliberately excluded per founder.
export const SUPPORTED_LANGS = ['en', 'es', 'pt', 'de', 'uk', 'it', 'nl', 'pl', 'tr'];

export const LANG_LABELS = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', de: 'German', uk: 'Ukrainian',
  it: 'Italian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
  // labels for languages we may detect but don't (yet) translate
  id: 'Indonesian', hi: 'Hindi', ar: 'Arabic', ja: 'Japanese', ko: 'Korean',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
};

export const langLabel = (code) => LANG_LABELS[code] || (code ? code.toUpperCase() : '');

// ISO country (uppercase) → primary language code. Only the entries we care
// about; anything unmapped falls back to English. Kept intentionally small —
// extend as markets are added.
export const COUNTRY_LANG = {
  GB: 'en', US: 'en', CA: 'en', AU: 'en', NZ: 'en', IE: 'en', ZA: 'en', IN: 'en',
  PH: 'en', NG: 'en', SG: 'en',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es',
  PT: 'pt', BR: 'pt',
  DE: 'de', AT: 'de', CH: 'de',
  UA: 'uk',
  IT: 'it',
  NL: 'nl', BE: 'nl',
  PL: 'pl',
  TR: 'tr',
  ID: 'id', JP: 'ja', KR: 'ko', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi',
};

// Normalize a country to uppercase ISO-2 (best-effort). Accepts already-ISO
// codes; passes through anything else uppercased so the map can still hit.
const normCountry = (c) => (c ? String(c).trim().toUpperCase() : '');

export const languageForCountry = (country) => COUNTRY_LANG[normCountry(country)] || 'en';

// Resolve a user/profile object to its locale signal.
// Priority: explicit Settings → Language choice, then a stored spoken language,
// then derived from country. The Settings choice is the user's clearest intent.
export const localeOf = (user) => {
  if (!user) return { country: '', language: 'en' };
  const country = normCountry(user.country);
  const language =
    user.settings?.language ||
    user.language ||
    (Array.isArray(user.spokenLanguages) && user.spokenLanguages[0]) ||
    languageForCountry(country);
  return { country, language };
};

// The language to TRANSLATE INTO for this viewer. LibreTranslate only supports
// SUPPORTED_LANGS, so a Settings choice we can't translate to (e.g. ja/ar/fr)
// falls back to English rather than erroring.
export const translateTarget = (profile) => {
  const lang = viewerLocale(profile).language;
  return SUPPORTED_LANGS.includes(lang) ? lang : 'en';
};

// The viewer's own locale (from their profile). Falls back to the device
// locale's region/language when the profile has no country yet.
export const viewerLocale = (profile) => {
  const base = localeOf(profile);
  if (base.country) return base;
  try {
    const loc = (navigator.language || 'en').toLowerCase(); // e.g. "uk-ua"
    const [lang, region] = loc.split('-');
    return {
      country: region ? region.toUpperCase() : '',
      language: SUPPORTED_LANGS.includes(lang) ? lang : base.language,
    };
  } catch {
    return base;
  }
};

// Stable re-rank: float same-language, then same-country, items to the top
// while preserving each item's original relative order (recency, viewerCount,
// rankScore — whatever the caller fetched). Pure, no mutation of the input.
//
//   items   — array to rank
//   viewer  — { country, language } from viewerLocale()
//   getUser — (item) => the hydrated user doc for that item (author/streamer)
//
// Buckets: 0 = same language AND same country, 1 = same language,
// 2 = same country, 3 = everything else. Within a bucket, original order holds.
export const rankByLocale = (items, viewer, getUser) => {
  if (!Array.isArray(items) || items.length < 2 || !viewer) return items || [];
  const vLang = viewer.language;
  const vCountry = viewer.country;
  if (!vLang && !vCountry) return items;
  const score = (item) => {
    const u = getUser ? getUser(item) : item;
    const { country, language } = localeOf(u);
    const sameLang = vLang && language === vLang;
    const sameCountry = vCountry && country === vCountry;
    if (sameLang && sameCountry) return 0;
    if (sameLang) return 1;
    if (sameCountry) return 2;
    return 3;
  };
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => (a.s - b.s) || (a.i - b.i))
    .map((x) => x.item);
};

// ── Source-language gating ──────────────────────────────────────────────
// We only show a "Translate" control when the content is likely NOT already in
// the viewer's language. Precise when the content carries a stored `lang`
// (stamped server-side on new posts); otherwise we fall back to a cheap script
// heuristic that reliably separates non-Latin scripts (Cyrillic/CJK/Arabic/…)
// from Latin. This means an English post never shows Translate to an English
// viewer, and a Ukrainian (Cyrillic) post always does.

// Writing-system bucket for a language code (all our Latin-script langs vs uk).
const LANG_SCRIPT = { uk: 'cyrillic' }; // everything else in scope is latin
export const scriptOfLang = (code) => LANG_SCRIPT[code] || 'latin';

// Dominant script of a text sample, by counting letters per script range.
export const dominantScript = (text) => {
  const s = String(text || '');
  let latin = 0, cyrillic = 0, other = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
    else if (c >= 0x400 && c <= 0x4ff) cyrillic++;
    else if (
      (c >= 0x4e00 && c <= 0x9fff) ||  // CJK
      (c >= 0x3040 && c <= 0x30ff) ||  // kana
      (c >= 0x0600 && c <= 0x06ff) ||  // Arabic
      (c >= 0x0370 && c <= 0x03ff) ||  // Greek
      (c >= 0x0590 && c <= 0x05ff) ||  // Hebrew
      (c >= 0x0e00 && c <= 0x0e7f) ||  // Thai
      (c >= 0xac00 && c <= 0xd7af)     // Hangul
    ) other++;
  }
  if (cyrillic > latin && cyrillic >= other) return 'cyrillic';
  if (other > latin && other >= cyrillic) return 'other';
  return latin > 0 ? 'latin' : 'none';
};

// Should we offer to translate this text into `target` for the viewer?
//   knownLang — a stored language code on the content (precise) if available.
export const looksForeign = (text, target, knownLang = null) => {
  if (!text || !String(text).trim()) return false;
  if (knownLang) return knownLang !== target;          // precise path
  const ds = dominantScript(text);
  if (ds === 'none') return false;
  // Non-Latin script that differs from a Latin target (or vice-versa) → foreign.
  const targetScript = scriptOfLang(target);
  if (ds === 'cyrillic' || ds === 'other') return ds !== targetScript;
  // Latin text + Latin target: can't cheaply tell English from Spanish, so we
  // do NOT show (avoids the false "Translate" on the viewer's own language).
  return targetScript !== 'latin';
};
