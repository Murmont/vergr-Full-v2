// ═══════════════════════════════════════════
// VERGR ECONOMY — THREE CURRENCIES
// ═══════════════════════════════════════════
// Coins: bought with real money, spent in-app
// Revenue share: accrued when someone spends coins ON YOU, paid on Vergr's schedule
// VP: earned through activity, drives levels/perks/commission

// ── RANK TIERS (11 ranks, 10 levels each; L100 = Immortal) ──
// Levels 1-10 Rookie, 11-20 Contender, 21-30 Rival, 31-40 Challenger,
// 41-50 Elite, 51-60 Champion, 61-70 Veteran, 71-80 Legend,
// 81-90 Mythic, 91-99 Ascendant, 100 Immortal
export const RANK_TIERS = [
  { min: 1,   max: 10,  name: 'Rookie',     ring: null,        ringColor: '#8A8F98' },
  { min: 11,  max: 20,  name: 'Contender',  ring: 'bronze',    ringColor: '#CD7F32' },
  { min: 21,  max: 30,  name: 'Rival',      ring: 'silver',    ringColor: '#C0C0C0' },
  { min: 31,  max: 40,  name: 'Challenger', ring: 'gold',      ringColor: '#F5C542' },
  { min: 41,  max: 50,  name: 'Elite',      ring: 'platinum',  ringColor: '#4DFFD4' },
  { min: 51,  max: 60,  name: 'Champion',   ring: 'diamond',   ringColor: '#7B6FFF' },
  { min: 61,  max: 70,  name: 'Veteran',    ring: 'onyx',      ringColor: '#2A2A2A' },
  { min: 71,  max: 80,  name: 'Legend',     ring: 'ruby',      ringColor: '#E0115F' },
  { min: 81,  max: 90,  name: 'Mythic',     ring: 'mythic',    ringColor: '#C87FFF' },
  { min: 91,  max: 99,  name: 'Ascendant',  ring: 'ascendant', ringColor: '#FFB347' },
  { min: 100, max: 100, name: 'Immortal',   ring: 'immortal',  ringColor: '#FFFFFF' },
];

const getRankForLevel = (level) => RANK_TIERS.find(t => level >= t.min && level <= t.max) || RANK_TIERS[0];

// Per-level VP cost to reach level N from N-1.
// L2..L10 = 2000, L11..L20 = 3000, ... +1000 per 10-level bracket. L91..L100 = 11000.
// Total to hit L100 = 648,000 VP.
export const levelCost = (level) => {
  if (level <= 1) return 0;
  const bracket = Math.floor((level - 1) / 10); // 0..9
  return 2000 + 1000 * bracket;
};

// ── REVENUE SHARE LADDER — CLIENT MIRROR ──────────────────────────────
// Server source of truth: functions/coinLedger.js (shareForEarnings). These two
// files MUST stay byte-aligned; the client cannot import from functions/, so a
// ladder change is always a two-file change. The server is authoritative on the
// actual credit — anything here is for DISPLAY ONLY, never for promising a
// number before the server has agreed to it.
//
// See docs/REVENUE_SHARE_PLAN.md for why this replaced the VP-keyed commission:
// Vergr is the principal, the creator is a supplier paid a share of the revenue
// their content generated, and a supplier rate card is keyed to volume
// delivered, not to how much the supplier played our game.
//
// Thresholds are LIFETIME GROSS COINS EARNED (wallets/{uid}.totalEarnedCoinsGross).
// At 1 coin = $0.01 they are $0 / $50 / $250 / $1,000 / $5,000 / $15,000 / $50,000.
export const REVENUE_SHARE_RATES      = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
export const REVENUE_SHARE_THRESHOLDS = [0, 5000, 25000, 100000, 500000, 1500000, 5000000];

/** Fraction the creator KEEPS (0.50-0.80). Note: not what is taken. */
export const shareForEarnings = (earnedGross = 0) => {
  for (let i = REVENUE_SHARE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (earnedGross >= REVENUE_SHARE_THRESHOLDS[i]) return REVENUE_SHARE_RATES[i];
  }
  return REVENUE_SHARE_RATES[0];
};

/** Tier index (0-6) and progress toward the next, for the Earnings screen. */
export const revenueShareTier = (earnedGross = 0) => {
  let idx = 0;
  for (let i = REVENUE_SHARE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (earnedGross >= REVENUE_SHARE_THRESHOLDS[i]) { idx = i; break; }
  }
  const isMax = idx >= REVENUE_SHARE_RATES.length - 1;
  const nextAt = isMax ? null : REVENUE_SHARE_THRESHOLDS[idx + 1];
  const floor = REVENUE_SHARE_THRESHOLDS[idx];
  return {
    tier: idx + 1,
    tierCount: REVENUE_SHARE_RATES.length,
    share: REVENUE_SHARE_RATES[idx],
    nextShare: isMax ? null : REVENUE_SHARE_RATES[idx + 1],
    nextAt,
    coinsToNext: isMax ? 0 : Math.max(0, nextAt - earnedGross),
    progress: isMax ? 100 : Math.min(100, ((earnedGross - floor) / (nextAt - floor)) * 100),
  };
};

// ── COMMISSION — DEAD. CHARGES NOTHING. DO NOT SHOW IT TO A USER. ──
//
// This described a commission on coin→gem conversion. Gems, conversion and
// user-initiated withdrawal were all deleted from the product (2026-08-15/16),
// and revenue share is now the ONLY model: there is no fee, commission or
// spread on any surface. Verified 2026-08-19 — nothing in functions/ or src/
// calls commissionForVP to charge anything.
//
// It is kept ONLY because VP_LEVELS below still stamps a `commission` field on
// each level and removing that field is a wider change than it looks. Nothing
// renders it.
//
// The deprecation note here used to say it was "still imported by VPRanksScreen,
// wallet v2 and marketing rate tables". That was stale, and it was cover for
// five LIVE screens telling users they paid 5-30% commission to convert coins
// to gems, long after both the commission and the gems were gone. All five were
// rewritten on 2026-08-19.
//
// DO NOT use these numbers in user-facing copy. The only rate that exists is the
// revenue share: the creator KEEPS 50% rising to 80%, by lifetime gross earnings.
export const COMMISSION_RATES = [0.30, 0.28, 0.25, 0.22, 0.20, 0.18, 0.15];
export const VP_THRESHOLDS    = [0,    500,  2000, 5000, 15000, 40000, 100000];
export const commissionForVP = (vp = 0) => {
  for (let i = VP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (vp >= VP_THRESHOLDS[i]) return COMMISSION_RATES[i];
  }
  return 0.30;
};

// Build 100 levels (index 0 = L1)
export const VP_LEVELS = (() => {
  const out = [];
  let cumulative = 0;
  for (let lvl = 1; lvl <= 100; lvl++) {
    cumulative += levelCost(lvl);
    const rank = getRankForLevel(lvl);
    out.push({
      level: lvl,
      name: rank.name,
      vpRequired: cumulative,         // total VP needed to be AT this level
      vpToNext: levelCost(lvl + 1),   // VP cost of next transition (0 at L100 unless prestige)
      ring: rank.ring,
      ringColor: rank.ringColor,
      // Commission at the VP needed to BE at this level (matches the server,
      // which keys off live VP). Steps further down as VP rises within a band.
      commission: commissionForVP(cumulative),
    });
  }
  return out;
})();

export const MAX_VP_LEVEL = 100;
export const TOTAL_VP_TO_MAX = VP_LEVELS[99].vpRequired; // 648,000

// ── PRESTIGE (post-L100, automatic, status only) ──
// The level stops at 100. Past it, every further full ladder of VP
// (TOTAL_VP_TO_MAX) adds one prestige, up to PRESTIGE_MAX: a star beside the
// rank and a title. NOTHING RESETS. The earlier design reset the displayed
// level to 1 "with perks intact", but every perk is gated on that level, so the
// promise contradicted itself, and nothing ever implemented it. Level, perks,
// crest and commission stay where L100 put them. No coins (audit A112).
// MIRROR of prestigeForVp() in functions/vpLevel.js, which writes users.prestige.
export const PRESTIGE_MAX = 10;
export const prestigeForVP = (totalVP) =>
  Math.max(0, Math.min(PRESTIGE_MAX, Math.floor((Number(totalVP) || 0) / TOTAL_VP_TO_MAX) - 1));
/** Total VP at which the NEXT prestige lands, or null below L100 and at the cap. */
export const nextPrestigeVP = (totalVP) => {
  const vp = Number(totalVP) || 0;
  if (vp < TOTAL_VP_TO_MAX) return null;
  const p = prestigeForVP(vp);
  return p >= PRESTIGE_MAX ? null : (p + 2) * TOTAL_VP_TO_MAX;
};
export const PRESTIGE_REWARDS = [
  // No coinReward: nothing pays one, and a figure left here gets displayed again.
  { prestige: 1,  badge: '★',     title: 'Ascendant I'  },
  { prestige: 2,  badge: '★★',    title: 'Ascendant II' },
  { prestige: 3,  badge: '★★★',   title: 'Ascendant III'},
  { prestige: 4,  badge: '✦',     title: 'Immortal I'   },
  { prestige: 5,  badge: '✦✦',    title: 'Immortal II'  },
  { prestige: 6,  badge: '✦✦✦',   title: 'Immortal III' },
  { prestige: 7,  badge: '❂',     title: 'Eternal I'    },
  { prestige: 8,  badge: '❂❂',    title: 'Eternal II'   },
  { prestige: 9,  badge: '❂❂❂',   title: 'Eternal III'  },
  { prestige: 10, badge: '⟁',     title: 'Transcendent' },
];

// Get user's VP level from total VP (capped at L100; prestige handled separately)
export const getVPLevel = (totalVP) => {
  let current = VP_LEVELS[0];
  for (const level of VP_LEVELS) {
    if (totalVP >= level.vpRequired) current = level;
    else break;
  }
  return current;
};

// Get progress to next level (0-100%)
export const getVPProgress = (totalVP) => {
  const current = getVPLevel(totalVP);
  if (current.level >= MAX_VP_LEVEL) return 100;
  const next = VP_LEVELS[current.level]; // current.level is 1-indexed, array is 0-indexed
  const progress = (totalVP - current.vpRequired) / (next.vpRequired - current.vpRequired);
  return Math.min(Math.max(progress * 100, 0), 100);
};

// Get the next level info
export const getNextVPLevel = (totalVP) => {
  const current = getVPLevel(totalVP);
  if (current.level >= MAX_VP_LEVEL) return null;
  return VP_LEVELS[current.level];
};

// @deprecated Commission at the user's CURRENT VP. Superseded by
// shareForEarnings(); kept only for screens that have not moved yet.
// `getGemRate` was removed on 2026-08-16 with the gem unit.
export const getCommission = (totalVP) => commissionForVP(totalVP);

// ── PLAN VP MULTIPLIERS ──
// Applied server-side when granting VP. Pro users level up 2× as fast.
export const PLAN_VP_MULTIPLIER = {
  free: 1,
  lite: 1.5,
  pro:  2,
};
export const getVPMultiplier = (plan) => PLAN_VP_MULTIPLIER[plan] || 1;

// ── MONTHLY PLAN BONUSES ──
// Paid once per paid period, the moment it is paid for (functions/planBonus.js).
export const MONTHLY_VP_BONUS  = { free: 0, lite: 1000, pro: 3000 };
export const MONTHLY_COIN_REWARDS = { free: 0, lite: 50,   pro: 150  };

// ── VP EARNING RATES (base, pre-multiplier) ──
export const VP_ACTIONS = {
  daily_login:       10,
  daily_streak_5:    50,
  create_post:       15,
  get_like:          2,
  get_comment:       5,
  like_post:         1,
  comment_post:      3,
  win_match:         50,
  win_tournament:    200,
  squad_message:     1,
  complete_quest:    20,
  purchase_coins:    25,
  boost_post:        10,
  go_live:           30,
  stream_hour:       20,
  // ⚠⚠ NOT AWARDED BY ANYTHING. `watch_stream_hour` appears in NO server path:
  // functions/engagementVp.js ENGAGEMENT_VP has create_post, get_comment, go_live,
  // stream_hour and raid_sent only, and this is absent from the /prestige earn table.
  // A preview chip once displayed it to viewers as VP they were earning; it was not.
  // DO NOT SURFACE THIS ANYWHERE until a server path awards it — that would be a new
  // VP faucet and needs a daily cap and a founder decision, not a UI change.
  watch_stream_hour: 5,
};

// ── GIFTING / TIPPING → VP (sender / gifter only) ──
// Tipping contributes to rank but is deliberately NOT 1:1 with coins: coins are
// bought with real money, so 1 VP per coin would let anyone buy max rank. Instead
// a low coins→VP rate keeps gifting a contributor, not a shortcut.
// Server-enforced in functions/index.js sendTip; this is the source of truth.
export const GIFT_COINS_PER_VP = 25;   // 25 coins gifted → 1 VP (pre plan-multiplier)

// ── BOOST COSTS ──
// ⚠ THE LABEL AND desc ARE WHAT A USER READS, so they say what the buyer GETS,
// not which of our surfaces is involved. The old copy was "3x visibility in For
// You", "Shown in Suggested Users" and "Pinned to top of LFG" — internal names.
// Founder, 2026-08-28: *"i dont even know what an LFG boost is so how the fuck is
// a user going to know?"*
export const BOOST_COSTS = {
  post:       { coins: 50,  duration: 24, label: 'Post Boost',       desc: 'Your post is shown to 3x more people for 24 hours' },
  profile:    { coins: 100, duration: 48, label: 'Profile Boost',    desc: 'You appear in people’s suggested-to-follow list for 48 hours' },
  // "LFG" means looking for group. Nobody outside gaming forums reads that as
  // "find me teammates", and there is no separate LFG LIST to pin to — an LFG
  // post is a post, so this boosts it in the feed like any other, cheaper and
  // shorter because a teammate hunt is urgent and short-lived.
  lfg:        { coins: 25,  duration: 12, label: 'Teammate Search Boost', desc: 'Your looking-for-teammates post is shown to 3x more people for 12 hours' },
  squad:      { coins: 75,  duration: 48, label: 'Squad Boost',      desc: 'Your squad is shown to people looking for one, for 48 hours' },
  // 'tournament' boost removed 2026-08-19: it was a purchasable product for a
  // feature that no longer exists.
  //
  // ⚠ 'stream' REMOVED 2026-08-28, same reason. It sold 60 coins for 4 hours
  // "pinned to the Live tab", a pin nothing ever read, while BOOST_TIERS.boost
  // in streamBoost.js sells 50 coins for real discovery reach and IS honoured.
  // Two products, one name, different prices. The live one wins.
  // `purchaseBoost` still refuses type 'stream' explicitly, for any client that
  // has not reloaded.
};

// ── COIN PACK CONFIG ──────────────────────────────────────────────
// HARD FLOOR: €0.0090 per coin. Do NOT drop below this on any pack
// (including with promos/discounts). Derivation:
//   max user payout per coin = topTierKeep × coinFaceValue × (1 − payoutFee)
//                            = 0.85 × €0.01 × 0.97 = €0.008245
// Selling at €0.0090 keeps ~€0.0008/coin margin even when a Titan-tier user
// converts and cashes out — the worst case for the platform.
//
// `vpBonus` is the BASE VP awarded with the pack. Optional promo fields
// (`promoVPBonus`, `promoLabel`, `promoStartsAt`, `promoEndsAt`) can be set
// per-pack server-side to layer a temporary bonus on any pack.
// Display value of ONE coin, for showing "what is this worth" next to a coin
// amount. This is the ladder's BEST per-coin rate — i.e. what a coin costs at
// the cheapest tier, which is the number that makes sense when you are about to
// send some. It is NOT a payout rate: cashing out runs through the coins→gems
// commission, so never reuse this to promise anyone a withdrawal figure.
//
// Now USD, matching the native-USD ladder below ($249.99 / 21,500 coins).
export const COIN_VALUE_USD = 0.01163;

/**
 * @deprecated EUR alias kept ONLY so a missed callsite renders a sane number
 * instead of `undefined` while the USD migration settles. It is the same coin at
 * an approximate 1.08 rate, NOT an independently maintained price. Do not add
 * new uses, and do not "correct" it to a live rate: two numbers describing one
 * price is exactly how the gem ended up with three different values in three
 * different files. Delete once nothing reads it.
 */
export const COIN_VALUE_EUR = +(0.01163 / 1.08).toFixed(5);

/**
 * How much better value a pack is than the smallest one, as a percentage of
 * coins per unit of currency.
 *
 * The ladder really does get cheaper per coin as it grows (Starter 101 coins per
 * euro, Legend and above 111), and until now nothing displayed that, so every
 * pack looked like the same deal in a bigger box and there was no reason to
 * scroll past the first one.
 *
 * This is the HONEST figure, computed from the prices actually charged. It tops
 * out around +10%. It is deliberately NOT the kind of number competitors show
 * ("+300% More"), because those are promotional rates measured against a base
 * the seller invented, not a bulk curve. If we want numbers like that they have
 * to come from a real promotion crediting real extra coins, which is a founder
 * decision and would layer on top of this rather than replace it.
 */
export function packValueBonusPct(pack, packs = COIN_PACKS) {
  const base = packs[0];
  if (!base || !pack || pack.id === base.id) return 0;
  const baseRate = base.coins / base.priceUSD;
  const rate = pack.coins / pack.priceUSD;
  if (!isFinite(baseRate) || !isFinite(rate) || baseRate <= 0) return 0;
  return Math.round(((rate / baseRate) - 1) * 100);
}

/**
 * Below this, the difference is not worth a badge.
 *
 * A "+3% More" label is technically true and reads as an insult; it draws the
 * eye to a number that argues against buying the bigger pack. Only Elite and
 * above clear this today.
 */
export const MIN_SHOWN_VALUE_BONUS_PCT = 5;

// ── THE COIN LADDER — NATIVE USD ──────────────────────────────────────
//
// Re-denominated from EUR to USD on 2026-08-11 (founder approved). USD is the
// currency both DISPLAYED and CHARGED; local currency appears beside it as an
// estimate only, never as the charged figure. See `project-geo-pricing`.
//
// ## Why the coin counts are the variable and the prices are not
//
// Buyers anchor on price points, not on coin counts. $0.99 / $4.99 / $9.99 read
// as familiar and cheap; 78 coins reads as nothing in particular, because
// nobody has a reference for what a coin should cost. So the ladder holds the
// price points people recognise and moves the quantity, which is exactly how
// TikTok (70 coins for $0.99) and Tango price theirs.
//
// ## The per-coin rate, which is the number that actually matters
//
// Payout does NOT move when the sale price moves: one earned coin can cost up
// to $0.008 to pay out, because a creator at the top of the revenue-share
// ladder keeps 80% of the $0.01 that coin represents. So every cent added to the
// sale price is a cent of pure margin, and nothing else in the economy is that
// direct. (This used to be reasoned from gems at EUR 0.01, a 15% commission and
// a 2% withdrawal spread. All three are gone; the conclusion is unchanged.)
//
// The old EUR ladder bottomed out at EUR 0.0090/coin (~$0.0104), which left
// roughly 17% gross against that EUR 0.0075 payout, and under 13% after
// processing and referral. That is the tail this ladder fixes: the floor is now
// $0.01163/coin, about 30% gross at the worst rank.
//
//   Starter    $1.27 per 100 coins
//   ...          monotonically improving
//   Ascendant  $1.16 per 100 coins
//
// +9% bulk curve top to bottom, the same shape the EUR ladder had. The founder's
// stated anchor of ~$1.17 per 100 coins sits mid-ladder by design.
//
// ⚠ ONE WORLDWIDE PRICE. Coins redeem back into money at a fixed rate, so a
// regional discount on them is arbitrage, not a promotion: buy cheap in a
// discounted region, tip, withdraw at the full rate, and the treasury funds the
// gap. Regional pricing is for SUBSCRIPTIONS ONLY (functions/geoPricing.js).
// Affordability in cheaper markets comes from the small packs, never a cheaper
// coin. See `reference-never-discount-a-redeemable`.
export const COIN_PACKS = [
  { id: 'starter',   name: 'Starter Pack',   coins: 78,     vpBonus: 0,    priceUSD: 0.99,   tagline: 'Get started for less than a coffee' },
  { id: 'gamer',     name: 'Gamer Pack',     coins: 400,    vpBonus: 0,    priceUSD: 4.99,   tagline: 'Better value per coin than Starter' },
  { id: 'pro',       name: 'Pro Pack',       coins: 815,    vpBonus: 0,    priceUSD: 9.99,   tagline: 'Enough to tip 16 creators', badge: 'MOST POPULAR', badgeStyle: 'popular' },
  { id: 'elite',     name: 'Elite Pack',     coins: 1650,   vpBonus: 0,    priceUSD: 19.99,  tagline: 'Headroom for streaks and locked content',         badge: 'BEST VALUE',   badgeStyle: 'value' },
  { id: 'legend',    name: 'Legend Pack',    coins: 4180,   vpBonus: 0,    priceUSD: 49.99,  tagline: 'For serious players and squads' },
  { id: 'champion',  name: 'Champion Pack',  coins: 8450,   vpBonus: 0,    priceUSD: 99.99,  tagline: 'Deep bulk discount' },
  { id: 'titan',     name: 'Titan Pack',     coins: 12800,  vpBonus: 1500, priceUSD: 149.99, tagline: 'Skip ranks faster', badge: '+1,500 VP BONUS', badgeStyle: 'vp' },
  { id: 'ascendant', name: 'Ascendant Pack', coins: 21500,  vpBonus: 3000, priceUSD: 249.99, tagline: 'For top creators and squad leaders',              badge: 'BIGGEST VP BONUS', badgeStyle: 'vp' },
];

// ── WITHDRAWAL CONSTANTS ───────────────────────────────────────────
// 2% spread platform takes on gem→crypto conversion (covers FX spread +
// rate-refresh slack). 60s quote TTL.
export const PAYOUT_SPREAD_PCT = 0.02;
export const PAYOUT_QUOTE_TTL_MS = 60_000;

// Currencies surfaced in the picker. Cheap-network options first.
export const PAYOUT_CURRENCIES = [
  { code: 'usdttrc20',  name: 'USDT',  network: 'TRC-20',   tagline: 'Cheapest fees', recommended: true },
  { code: 'usdcsol',    name: 'USDC',  network: 'Solana',   tagline: 'Fast & cheap' },
  { code: 'usdterc20',  name: 'USDT',  network: 'ERC-20',   tagline: 'Ethereum mainnet' },
  { code: 'usdtbsc',    name: 'USDT',  network: 'BSC',      tagline: 'Binance chain' },
  { code: 'btc',        name: 'BTC',   network: 'Bitcoin' },
  { code: 'eth',        name: 'ETH',   network: 'Ethereum' },
  { code: 'sol',        name: 'SOL',   network: 'Solana' },
  { code: 'ltc',        name: 'LTC',   network: 'Litecoin' },
  { code: 'doge',       name: 'DOGE',  network: 'Dogecoin' },
  { code: 'matic',      name: 'MATIC', network: 'Polygon' },
];

// ── ECONOMY CONSTANTS ──
//
// The gem unit was REMOVED on 2026-08-16. Accrued revenue share is stored and
// displayed as money (micro-USD on `wallets/{uid}.owedMicroUsd`), so there is no
// intermediate unit left to price. One coin is one cent of gross revenue, which
// is what COIN_TO_EUR below still records for the few legacy callers.
//
// GEM_VALUE_USD / GEM_TO_EUR / getGemRate are gone. If you are reaching for one
// of them you are converting into a currency that no longer exists.
export const COIN_TO_EUR = 0.01;
export const MIN_CASHOUT_GEMS = 1000;
export const CASHOUT_PLATFORM_FEE = 0;
export const CASHOUT_PROCESSOR_FEE = 0.03;
export const DAILY_STREAK_REWARD = 5;
export const DAILY_STREAK_DAYS = 5;
// Referral VP rewards — paid out when referee completes onboarding (signup
// via referrer's link + adds phone + joins a squad OR subscribes to Lite/Pro).
export const REFERRAL_VP_REFERRER = 5000; // person doing the inviting
export const REFERRAL_VP_REFEREE  = 3000; // the friend who joins
// Legacy export kept for backwards compatibility — points at the referrer reward.
export const REFERRAL_REWARD = REFERRAL_VP_REFERRER;
export const LIKE_REWARD_VP = 2;
export const LIKE_REWARD_CAP = 20;

// ── SQUAD ECONOMICS ──
export const SQUAD_CONTRIBUTION_RATE = 0.10;
export const TOURNAMENT_MOD_FEE_RATE = 0.05;
