// For You ranking — pure, client-side, zero extra reads. BEHAVIORAL-FIRST: the
// dominant signals are AUTHOR affinity and HASHTAG affinity, which work on EVERY
// post regardless of whether it's about gaming (a meme, an IRL clip, a music
// post all participate). Declared/inferred TOPICS are a lighter secondary boost.
// Additive on top of chronological, so a zero-signal account still gets a good
// populated feed (never a ghost town) and personalization ramps in as the viewer
// engages. See docs/handover/08 PART 0.

import { CONTENT_TOPICS } from './constants';
import { localeOf } from './localePrefs';
import { getSeenSet } from './seenPosts';
import {
  getNegatives, getAuthorWeights, getHashtagWeights, getTopicWeights,
  bumpAuthor, bumpHashtags, bumpTopics,
} from './feedPrefs';
import { getFollowingSet } from './followingCache';

// Same detection ExploreScreen uses (isBotAccount): accountType contains "bot".
import { isBoosted, POST_BOOST_REACH } from './promoBoost';

export const isBotAccount = (u) => /bot/i.test(String(u?.accountType || ''));

// Keyword → CONTENT_TOPICS label, for scoring-time topic inference on posts that
// carry no explicit topic. Covers general culture AND games (games map to
// 'Gaming'/'Esports'). Compact by design; hashtag AFFINITY (below) does the
// heavy lifting, so this only needs to be roughly right.
const TOPIC_TOKENS = {
  // Gaming / esports
  gaming: 'Gaming', gamer: 'Gaming', gameplay: 'Gaming', valorant: 'Gaming', fortnite: 'Gaming',
  minecraft: 'Gaming', warzone: 'Gaming', cod: 'Gaming', apex: 'Gaming', lol: 'Gaming',
  leagueoflegends: 'Gaming', dota: 'Gaming', cs2: 'Gaming', csgo: 'Gaming', overwatch: 'Gaming',
  fps: 'Gaming', rpg: 'Gaming', moba: 'Gaming', speedrun: 'Gaming', gamedev: 'Gaming',
  esports: 'Esports', tournament: 'Esports', scrim: 'Esports', ranked: 'Esports',
  // Just chatting / IRL
  justchatting: 'Just Chatting', irl: 'IRL', vlog: 'IRL', daily: 'IRL', story: 'IRL',
  // Music
  music: 'Music', song: 'Music', beat: 'Music', rap: 'Music', producer: 'Music', spotify: 'Music', dj: 'Music',
  // Art / creative
  art: 'Art & Creative', drawing: 'Art & Creative', design: 'Art & Creative', digitalart: 'Art & Creative',
  fanart: 'Art & Creative', animation: 'Art & Creative',
  // Tech
  tech: 'Tech', coding: 'Tech', programming: 'Tech', ai: 'Tech', pc: 'Tech', setup: 'Tech', gadget: 'Tech',
  // Memes / comedy
  meme: 'Memes & Comedy', funny: 'Memes & Comedy', lol_: 'Memes & Comedy', comedy: 'Memes & Comedy', shitpost: 'Memes & Comedy',
  // Sports
  football: 'Sports', soccer: 'Sports', nba: 'Sports', basketball: 'Sports', ufc: 'Sports', fifa: 'Sports', workout: 'Fitness & Health',
  // Anime / movies
  anime: 'Anime & Manga', manga: 'Anime & Manga', otaku: 'Anime & Manga', waifu: 'Anime & Manga',
  movie: 'Movies & TV', film: 'Movies & TV', netflix: 'Movies & TV', series: 'Movies & TV',
  // Lifestyle / food / fitness / fashion
  lifestyle: 'Lifestyle', food: 'Food & Cooking', cooking: 'Food & Cooking', recipe: 'Food & Cooking',
  fitness: 'Fitness & Health', gym: 'Fitness & Health', health: 'Fitness & Health',
  fashion: 'Fashion & Beauty', outfit: 'Fashion & Beauty', beauty: 'Fashion & Beauty', makeup: 'Fashion & Beauty',
  // Science / news / cars / travel / crypto
  science: 'Science & Education', education: 'Science & Education', learn: 'Science & Education',
  news: 'News', politics: 'News', car: 'Cars & Motors', cars: 'Cars & Motors', jdm: 'Cars & Motors',
  travel: 'Travel', crypto: 'Crypto & Finance', bitcoin: 'Crypto & Finance', finance: 'Crypto & Finance', nft: 'Crypto & Finance',
};

const TOPIC_SET = new Set(CONTENT_TOPICS.map(t => t.toLowerCase()));
const cleanTag = (t) => String(t).toLowerCase().replace(/^#/, '').trim();

// Infer a Set of CONTENT_TOPICS labels for a post (best-effort, scoring-time).
export const inferPostTopics = (post) => {
  const out = new Set();
  const add = (t) => { if (t) out.add(t); };
  if (post?.topic) add(post.topic);
  if (post?.game) add('Gaming');
  const tags = (Array.isArray(post?.hashtags) ? post.hashtags : []).map(cleanTag);
  const hay = [...tags, String(post?.content || '')].join(' ').toLowerCase();
  if (hay) {
    for (const [tok, topic] of Object.entries(TOPIC_TOKENS)) { if (hay.includes(tok)) add(topic); }
    for (const t of TOPIC_SET) { if (hay.includes(t)) add(CONTENT_TOPICS.find(x => x.toLowerCase() === t)); }
  }
  return out;
};

// Infer topics from a list of game TITLES / interests (profile.games) — used to
// backfill accounts with no declared interests. Free (no reads).
export const topicsFromText = (values) => {
  const out = new Set();
  for (const v of (values || [])) {
    const s = String(v).toLowerCase();
    for (const [tok, topic] of Object.entries(TOPIC_TOKENS)) { if (s.includes(tok)) out.add(topic); }
    for (const t of TOPIC_SET) { if (s.includes(t)) out.add(CONTENT_TOPICS.find(x => x.toLowerCase() === t)); }
  }
  // Any listed game title implies Gaming even if the specific title isn't mapped.
  if ((values || []).length && out.size === 0) out.add('Gaming');
  return [...out];
};

// Record a positive interest signal from an interaction (like/save/comment/…).
// Behavioral-first: the author + the post's hashtags are the primary signal;
// inferred topics are secondary. Device-local + free.
export const captureInterest = (post, amount = 1) => {
  if (!post) return;
  if (post.authorId) bumpAuthor(post.authorId, amount);
  if (Array.isArray(post.hashtags) && post.hashtags.length) bumpHashtags(post.hashtags, amount);
  const topics = inferPostTopics(post);
  if (topics.size) bumpTopics(topics, amount * 0.5);
};

// Watching a live stream = a host (author) affinity signal + the stream's
// game/topic. Called from the viewers after a short dwell. Device-local + free.
/**
 * The topics a live stream is about, inferred from its game and title.
 *
 * ⚠ EXTRACTED FROM captureStreamInterest, NOT REWRITTEN. This logic used to be
 * inline in the capture path only, so the app could LEARN what you like about
 * streams but had nothing that could rank streams BY what you like. Boost
 * needed the read side; duplicating the inference would have given two
 * definitions of "what is this stream about" that could drift apart — the exact
 * failure that produced two disagreeing theme systems.
 *
 * Costs nothing: string matching on fields the stream doc already carries.
 */
export const inferStreamTopics = (streamDoc) => {
  const topics = new Set();
  if (!streamDoc) return [];
  if (streamDoc.game) topics.add('Gaming');
  if (streamDoc.topic) topics.add(streamDoc.topic);
  const hay = `${streamDoc.game || ''} ${streamDoc.title || ''}`.toLowerCase();
  if (hay.trim()) {
    for (const [tok, topic] of Object.entries(TOPIC_TOKENS)) { if (hay.includes(tok)) topics.add(topic); }
  }
  return [...topics];
};

export const captureStreamInterest = (streamDoc, amount = 1) => {
  if (!streamDoc) return;
  const host = streamDoc.hostUid || streamDoc.streamerId;
  if (host) bumpAuthor(host, amount);
  const topics = inferStreamTopics(streamDoc);
  if (topics.length) bumpTopics(topics, amount * 0.5);
};

const tsMs = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0)) || 0;

// How long an official @Vergr post is hard-pinned to the top of For You.
export const VERGR_PIN_HOURS = 24;

// Build the ranking context from what the screen already has in hand.
export const buildForYouCtx = ({ profile, vergrUid = null, botHumanRatio = 0.5, allowNsfw = false } = {}) => {
  const declaredTopics = new Set();
  for (const t of (profile?.gameTags || [])) declaredTopics.add(String(t).toLowerCase());
  const neg = getNegatives();
  return {
    followingSet: getFollowingSet(),
    authorWeights: getAuthorWeights(),
    hashtagWeights: getHashtagWeights(),
    topicWeights: getTopicWeights(),
    declaredTopics,
    locale: localeOf(profile),
    seenIds: getSeenSet(),
    negativeAuthors: neg.authors,
    negativeTopics: neg.topics, // matched vs post hashtags AND inferred topics
    vergrUid,
    botPenaltyScale: 1 + Math.max(0, Math.min(1, botHumanRatio)), // 1..2
    allowNsfw: allowNsfw === true,
  };
};

// ── ADULT CONTENT: the one place the demote-never-drop rule is INVERTED ──
//
// Everything else in this file demotes rather than excludes, because a blank
// For You is the worse failure while the app is still bot-seeded (B2, founder
// 2026-07-12). NSFW is the exact opposite: showing adult content to somebody who
// did not ask for it is not a ranking miss, it is the failure. A low score is
// not a gate, it just means "further down", and further down is still visible.
//
// So this drops. It is applied to BOTH rank entry points, before the early
// returns, so a one-item page cannot slip past on the length check.
//
// This is presentation only and is NOT the security boundary. The real gate is
// server-side in functions/entitlements.js (assertNsfwViewerAllowed), which
// requires a verified identity before the media or playback URL is ever signed.
// 2026-08-14: the adult marker is an ADVISORY LABEL, not a filter.
//
// Nudity and sexual content are now prohibited on every surface (Acceptable
// Use Policy s.3) and actual nudity is refused at upload by the scanner's
// "block" verdict before anything is stored. So `contentRating: "nsfw"` can
// only ever mean the softer band: mature language, dark humour, adult subject
// matter. That warrants telling a viewer what they are joining. It does not
// warrant hiding the content or demanding a government ID to see it.
//
// The marker, the broadcaster toggle and the on-stream banner all stay. Only
// the filtering behaviour is switched off, so restoring it is a one-line
// change if the content policy ever moves back.
const passesRating = () => true;

export const filterForViewer = (posts, ctx) =>
  (Array.isArray(posts) ? posts.filter((p) => passesRating(p, ctx)) : []);

const scorePost = (post, ctx, nowMs) => {
  const author = post.author || {};
  const ageHours = Math.max(0, (nowMs - tsMs(post.createdAt)) / 3600000);
  // Freshness dominates early, decays smoothly (half-life 6h).
  let s = 6 * Math.pow(0.5, ageHours / 6);

  // @Vergr pin — floats to the very top, but only while the post is NEW.
  // An unbounded +1000 meant one official post sat above everything for as
  // long as it existed, so the feed stopped looking alive. Past the window a
  // @Vergr post is still boosted (it's official), it just competes on recency
  // like everything else instead of outranking it.
  if (ctx.vergrUid && post.authorId === ctx.vergrUid) {
    s += ageHours <= VERGR_PIN_HOURS ? 1000 : 2.5;
  }

  // Following (structural) + AUTHOR AFFINITY (behavioral, the biggest lever).
  if (ctx.followingSet?.has(post.authorId)) s += 3.0;
  const aw = ctx.authorWeights?.[post.authorId];
  if (aw) s += Math.min(4, 1.2 * aw);

  // HASHTAG AFFINITY — max weight over the post's tags (generalizes to anything).
  const tags = (Array.isArray(post.hashtags) ? post.hashtags : []).map(cleanTag);
  let hwMax = 0;
  for (const t of tags) { const w = ctx.hashtagWeights?.[t]; if (w > hwMax) hwMax = w; }
  if (hwMax) s += Math.min(3, 0.9 * hwMax);

  // TOPIC (lighter secondary): declared-interest match + accumulated topic weight.
  const topics = inferPostTopics(post);
  let topicMatched = false, twMax = 0;
  for (const t of topics) {
    const lt = t.toLowerCase();
    if (ctx.declaredTopics?.has(lt)) topicMatched = true;
    const w = ctx.topicWeights?.[lt]; if (w > twMax) twMax = w;
  }
  if (topicMatched) s += 1.2;
  if (twMax) s += Math.min(1.5, 0.5 * twMax);

  // Locale (same language / country) — a nudge, not a float-to-top.
  const loc = localeOf(author);
  if (ctx.locale?.language && loc.language === ctx.locale.language) s += 1.0;
  if (ctx.locale?.country && loc.country === ctx.locale.country) s += 0.4;

  // Seen demotion.
  if (ctx.seenIds?.has(post.id)) s -= 2.5;

  // Bot penalty (phased by pool composition).
  if (isBotAccount(author)) s -= 2.0 * (ctx.botPenaltyScale || 1);

  // Explicit "not interested" — author, or any topic/hashtag the viewer muted.
  if (ctx.negativeAuthors?.has(post.authorId)) s -= 6;
  if (ctx.negativeTopics && ctx.negativeTopics.size) {
    if (tags.some(t => ctx.negativeTopics.has(t))) s -= 4;
    else for (const t of topics) { if (ctx.negativeTopics.has(t.toLowerCase())) { s -= 4; break; } }
  }

  // ⚠ PAID POST BOOST. Applied LAST and as a MULTIPLIER, so it scales whatever
  // the post had already earned rather than swamping it. `BOOST_COSTS.post.desc`
  // has promised "3x visibility in For You" since the day it shipped, and until
  // 2026-08-28 NOTHING read the boost at all, so the promise was false.
  //
  // Guarded on s > 0: multiplying a negative score would push a muted author
  // FURTHER down, which is not what was bought.
  if (s > 0 && isBoosted(post, nowMs)) s *= POST_BOOST_REACH;

  return s;
};

// Stable sort by descending score; ties keep original (chronological) order.
// News-bot posts are a SEPARATE tier: kept (never excluded) but hard-sorted
// BELOW every human / non-news post so they only backfill the tail and never
// flood the prime slots. Founder call 2026-07-12 (B2): excluding `isNewsPost`
// outright would blank For You while the app is still bot-seeded (ghost-town),
// so demote instead of drop — real content leads, news fills the bottom.
export const rankForYou = (posts, ctx) => {
  const list = filterForViewer(posts, ctx);
  if (list.length < 2) return list;
  const nowMs = Date.now();
  const newsTier = (p) => (p?.isNewsPost ? 1 : 0);
  return list
    .map((post, i) => ({ post, i, s: scorePost(post, ctx, nowMs) }))
    .sort((a, b) =>
      (newsTier(a.post) - newsTier(b.post)) || // non-news first, always
      (b.s - a.s) ||                            // then by score
      (a.i - b.i))                             // then original (chronological)
    .map((x) => x.post);
};

// Rank while HOLDING the order of anything the viewer has already been shown.
//
// WHY: rankForYou is deterministic, but its inputs are not stable within a
// session: seen-state accumulates, affinity weights move on every like/follow,
// and the recency decay keeps sliding. So re-running it over a list that is
// already on screen legitimately produces a different order, and the user
// experiences that as the feed rearranging under their thumb. It bit hardest on
// two paths: appending page 2 re-sorted page 1 above the scroll position, and
// the instant cache paint was re-ranked when the network page landed.
//
// `shownIds` is the order already committed to screen. Those posts keep their
// exact slots. Only genuinely new posts are ranked, and they are appended below.
// Pass an empty list on an explicit refresh to re-rank everything from scratch.
export const rankForYouStable = (posts, ctx, shownIds) => {
  const visible = filterForViewer(posts, ctx);
  if (visible.length < 2) return visible;
  if (!shownIds || !shownIds.length) return rankForYou(visible, ctx);
  const byId = new Map(visible.map((p) => [p.id, p]));
  const held = [];
  for (const id of shownIds) {
    const p = byId.get(id);
    if (p) { held.push(p); byId.delete(id); }   // still present -> keeps its slot
  }
  const fresh = rankForYou([...byId.values()], ctx);
  return [...held, ...fresh];
};
