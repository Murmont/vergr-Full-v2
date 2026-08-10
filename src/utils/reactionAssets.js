// Animated emoji system (Telegram-style), powered by Google Noto Animated
// Emoji (Apache-2.0) served from fonts.gstatic.com ($0, long-cached CDN).
// 881 emoji have animated (Lottie vector) versions; anything without one
// renders the normal unicode glyph. Animated rendering is a Lite/Pro perk
// (admins bypass via useTier -> 'pro').
//
// CUSTOM VERGR ART OVERRIDE: when the founder's own original emoji artwork
// lands, import it and map it in REACTION_ASSETS below — an entry here takes
// precedence over the Noto CDN version everywhere automatically.
import NOTO_ANIMATED from './notoAnimatedManifest';

export const REACTION_ASSETS = {};

/** Quick-react set shown in the reaction bar (all 8 have animated versions). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👏'];

/** Unicode emoji -> Noto codepoint key ("1f44d", "2764_fe0f", ...). */
export function emojiCodepoint(emoji) {
  if (!emoji) return null;
  const full = [...emoji].map((c) => c.codePointAt(0).toString(16)).join('_');
  if (NOTO_ANIMATED.has(full)) return full;
  const noVs = full.replace(/_fe0f/g, '');
  if (NOTO_ANIMATED.has(noVs)) return noVs;
  return null;
}

/** True when this emoji has an animated version (custom art or Noto). */
export function hasAnimatedEmoji(emoji) {
  return !!REACTION_ASSETS[emoji] || !!emojiCodepoint(emoji);
}

/**
 * Animation source for an emoji, or null when only the glyph exists.
 * { type:'custom', src } for founder-supplied art; { type:'lottie', src } for
 * the Noto CDN Lottie JSON.
 */
export function animatedEmojiSrc(emoji) {
  if (REACTION_ASSETS[emoji]) return { type: 'custom', src: REACTION_ASSETS[emoji] };
  const cp = emojiCodepoint(emoji);
  if (cp) return { type: 'lottie', src: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json` };
  return null;
}
