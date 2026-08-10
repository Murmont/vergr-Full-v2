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
export const captureStreamInterest = (streamDoc, amount = 1) => {
  if (!streamDoc) return;
  const host = streamDoc.hostUid || streamDoc.streamerId;
  if (host) bumpAuthor(host, amount);
  const topics = new Set();
  if (streamDoc.game) topics.add('Gaming');
  if (streamDoc.topic) topics.add(streamDoc.topic);
  const hay = `${streamDoc.game || ''} ${streamDoc.title || ''}`.toLowerCase();
  if (hay.trim()) {
    for (const [tok, topic] of Object.entries(TOPIC_TOKENS)) { if (hay.includes(tok)) topics.add(topic); }
  }
  if (topics.size) bumpTopics([...topics], amount * 0.5);
};

const tsMs = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0)) || 0;

// How long an official @Vergr post is hard-pinned to the top of For You.
export const VERGR_PIN_HOURS = 24;

// Build the ranking context from what the screen already has in hand.
export const buildForYouCtx = ({ profile, vergrUid = null, botHumanRatio = 0.5 } = {}) => {
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
  };
};

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

  return s;
};

// Stable sort by descending score; ties keep original (chronological) order.
// News-bot posts are a SEPARATE tier: kept (never excluded) but hard-sorted
// BELOW every human / non-news post so they only backfill the tail and never
// flood the prime slots. Founder call 2026-07-12 (B2): excluding `isNewsPost`
// outright would blank For You while the app is still bot-seeded (ghost-town),
// so demote instead of drop — real content leads, news fills the bottom.
export const rankForYou = (posts, ctx) => {
  if (!Array.isArray(posts) || posts.length < 2) return posts || [];
  const nowMs = Date.now();
  const newsTier = (p) => (p?.isNewsPost ? 1 : 0);
  return posts
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
  if (!Array.isArray(posts) || posts.length < 2) return posts || [];
  if (!shownIds || !shownIds.length) return rankForYou(posts, ctx);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const held = [];
  for (const id of shownIds) {
    const p = byId.get(id);
    if (p) { held.push(p); byId.delete(id); }   // still present -> keeps its slot
  }
  const fresh = rankForYou([...byId.values()], ctx);
  return [...held, ...fresh];
};
