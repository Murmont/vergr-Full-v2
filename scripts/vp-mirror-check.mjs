// The VP reward constants are MIRRORED between the client (which advertises
// them on /prestige) and the server (which pays them). A drift is silent and
// shows up as the screen promising a rate the server does not honour, which is
// exactly the class of bug that has bitten this repo repeatedly.
//
//   node scripts/vp-mirror-check.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(`${repo}/${p}`, 'utf8');
const { VP_BONUS_PER_LEVEL, VP_BONUS_MAX, PROFILE_THEMES, PROFILE_ACCENTS, RANK_UNLOCKS, EFFECTS,
        CREST_SWEEP_MS, CREST_CYCLE_MS, crestPhaseMs } =
  await import(`file://${repo}/src/utils/rankUnlocks.js`);
const { VP_ACTIONS } = await import(`file://${repo}/src/utils/vpSystem.js`);
// prestigeData.js imports without a file extension (Vite resolves that, node does not),
// so EARN_ITEMS is parsed out of the source rather than imported.
const EARN_SRC = read('src/components/prestige/prestigeData.js');
const EARN_ITEMS = [...EARN_SRC.matchAll(/\{\s*key:\s*'([^']+)'[^}]*?label:\s*'([^']+)'([^}]*)\}/g)]
  .map(([, key, label, rest]) => ({ key, label, custom: /custom:/.test(rest) || undefined }));

const fail = [];
const ok = [];
const check = (name, cond, detail) => (cond ? ok : fail).push(`${name}${detail ? ' — ' + detail : ''}`);

// 1. Rank VP bonus: client vs BOTH server mirrors.
for (const f of ['functions/engagementVp.js', 'functions/walletActions.js']) {
  const s = read(f);
  check(`rank bonus rate in ${f}`, s.includes(String(VP_BONUS_PER_LEVEL)), `expected ${VP_BONUS_PER_LEVEL}`);
  check(`rank bonus cap in ${f}`, s.includes(`${VP_BONUS_MAX},`) || s.includes(`min(${VP_BONUS_MAX}`), `expected ${VP_BONUS_MAX}`);
}

// 1b. The raid reward, which lives in TWO files.
// ⚠⚠ `ENGAGEMENT_VP.raid_sent` is what actually pays; `RAID_VP` in raids.js is a
// reference mirror that nothing reads. A mirror nothing reads is exactly the kind
// that drifts silently and then gets quoted as fact — this repo has a list of them
// (the "10% platform fee" membership header, the stale HashRouter lines). Either
// they agree or the build fails.
{
  const eng = read('functions/engagementVp.js');
  const raids = read('functions/raids.js');
  const m = eng.match(/raid_sent:\s*\{\s*vp:\s*(\d+),\s*dailyCapVp:\s*(\d+)/);
  check('raid_sent exists in ENGAGEMENT_VP', !!m, 'the raid reward is gone');
  if (m) {
    check('RAID_VP mirrors ENGAGEMENT_VP', raids.includes(`const RAID_VP = ${m[1]};`),
      `engagementVp says ${m[1]}`);
    check('RAID_VP_DAILY_CAP mirrors ENGAGEMENT_VP', raids.includes(`const RAID_VP_DAILY_CAP = ${m[2]};`),
      `engagementVp says ${m[2]}`);
    // ⚠ A RAID MUST OUT-PAY GOING LIVE. It is rarer, it can only happen once per
    // stream, and it costs the giver their whole audience — if it pays less than
    // pressing "go live" the incentive is backwards, which is what 40 vs 30 was.
    const goLive = (eng.match(/go_live:\s*\{\s*vp:\s*(\d+)/) || [])[1];
    check('a raid out-pays go_live', goLive && Number(m[1]) > Number(goLive),
      `raid ${m[1]} vs go_live ${goLive}`);
  }
}

// 2. Boost token levels: client vs vpLevel.js.
const boostSrc = read('functions/vpLevel.js').match(/BOOST_TOKEN_LEVELS = \[([^\]]+)\]/);
const clientBoost = RANK_UNLOCKS.filter((r) => r.kind === 'boost').map((r) => r.level).sort((a, b) => a - b);
// ⚠ Filter blanks BEFORE mapping. The array is multi-line with a trailing
// comma (valid JS), and a naive split produced an empty final entry that
// `+''` turned into a phantom level 0, failing a mirror that was correct.
const serverBoost = boostSrc
  ? boostSrc[1].split(',').map((n) => n.trim()).filter(Boolean).map(Number).sort((a, b) => a - b)
  : [];
check('boost token levels', JSON.stringify(clientBoost) === JSON.stringify(serverBoost),
  `client ${clientBoost} vs server ${serverBoost}`);

// 2a. HOW MANY tokens each level grants — expand all 100 levels on BOTH sides.
// The list matching is not enough now that the count varies: a divisor typo
// server-side would pay a different number at every Elite level and the list
// check would still be green.
{
  const { boostTokensForLevel, BOOST_TOKEN_VP_PER_TOKEN } =
    await import(`file://${repo}/src/utils/rankUnlocks.js`);
  const srv = read('functions/vpLevel.js');
  check('boost token divisor mirrored',
    srv.includes(`BOOST_TOKEN_VP_PER_TOKEN = ${BOOST_TOKEN_VP_PER_TOKEN};`),
    `expected ${BOOST_TOKEN_VP_PER_TOKEN}`);
  check('server sums token counts, not levels',
    srv.includes('boostTokensForLevel(l)') && !srv.includes(').length;'),
    'vpLevel.js must reduce over boostTokensForLevel, not count the list');
  // The whole expansion, so a single disagreeing level fails the build.
  const srvCost = srv.includes('2000 + 1000 * Math.floor((level - 1) / 10)');
  check('server levelCost mirrors the client', srvCost);
  let totalTokens = 0;
  for (let l = 1; l <= 100; l++) totalTokens += boostTokensForLevel(l);
  // ⚠ Recount whenever BOOST_TOKEN_LEVELS or the band scale changes. 14 levels
  // were handed over to VP bonus packs on 2026-08-28, which is why this is not
  // the 75 the plan document first quoted.
  check('boost token total is the documented 47', totalTokens === 47, `got ${totalTokens}`);
}

// 2c. VP BONUS PACKS: client table vs the server table that charges for them.
//
// The client prints the price and the server debits it. A drift here means the
// card advertises 200 coins and the wallet loses 350, which is the exact class of
// defect every mirror in this file exists to stop.
{
  const { VP_BONUS_PACKS, VP_BONUS_CEILING, bonusPackForLevel } =
    await import(`file://${repo}/src/utils/rankUnlocks.js`)
      .then(async (ru) => ({ ...(await import(`file://${repo}/src/utils/vpBonuses.js`)), bonusPackForLevel: ru.bonusPackForLevel }));
  const srv = read('functions/vpBonuses.js');

  for (const pk of VP_BONUS_PACKS) {
    // One regex per pack, matching the server row as a whole, so a single wrong
    // field fails rather than being masked by the others being right.
    const row = new RegExp(
      `id: '${pk.id}'[^}]*?mult: ${String(pk.mult).replace('.', '\\.')},[^}]*?hours: ${pk.hours},[^}]*?coins: ${pk.coins},`,
      's');
    check(`bonus pack "${pk.id}" mirrored server-side`, row.test(srv),
      `expected mult ${pk.mult}, hours ${pk.hours}, coins ${pk.coins}`);

    // A scoped pack that loses its scope silently becomes a blanket pack.
    if (Array.isArray(pk.scope)) {
      for (const a of pk.scope) {
        check(`bonus pack "${pk.id}" scope keeps ${a}`, srv.includes(`'${a}'`));
      }
    }
  }

  check('bonus pack count matches', 
    (srv.match(/\bid: '[a-z_]+',\s+name:/g) || []).length === VP_BONUS_PACKS.length,
    `client has ${VP_BONUS_PACKS.length}`);
  check('bonus ceiling mirrored', srv.includes(`VP_BONUS_CEILING = ${VP_BONUS_CEILING}`));

  // ⚠ NO VP PRICE MAY EVER APPEAR. A VP-priced VP multiplier is an infinite
  // loop, and the founder ruled coins-only on 2026-08-28. This is cheap to
  // assert and expensive to discover in production.
  const cli = read('src/utils/vpBonuses.js');
  check('bonus packs have NO vp price (client)', !/\bvp:\s*\d/.test(cli));
  check('bonus packs have NO vp price (server)', !/\bvp:\s*\d/.test(srv));

  // The ladder levels that hand out a pack, mirrored into vpLevel.js.
  const lvlSrc = read('functions/vpLevel.js');
  let bonusLevels = 0;
  for (let l = 1; l <= 100; l++) {
    const id = bonusPackForLevel(l);
    if (!id) continue;
    bonusLevels++;
    check(`ladder bonus at L${l} mirrored in vpLevel.js`,
      new RegExp(`\\b${l}: '${id}'`).test(lvlSrc), `expected ${l}: '${id}'`);
  }
  check('ladder grants some bonus packs', bonusLevels > 0, `${bonusLevels} levels`);
  check('vpLevel.js actually grants them', lvlSrc.includes('grantBonusPack('),
    'the map can be perfect and still never be read');
}

// Comment-stripped source, so a guard can never match its own warning text.
// The follower-gate guard passed once for exactly that reason.
const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// True only when a USERS query carries boostExpiresAt. The STREAM boost
// legitimately queries collection(db,'streams') that way and must not be
// flagged. Line-based on purpose: a greedy cross-line regex here blew the heap.
const usersBoostQuery = (src) => {
  const ls = codeOnly(src).split(/\r?\n/);
  return ls.some((l, n) => /boostExpiresAt/.test(l)
    && ls.slice(Math.max(0, n - 4), n + 2).some((w) => w.includes("collection(db, 'users')")));
};

// 2d. EVERY SUGGESTION SURFACE MUST HONOUR A PAID BOOST.
//
// ⚠ This guard exists because a Profile Boost was wired into TWO of six
// surfaces on 2026-08-28 and shipped. The founder opened Explore, the boosted
// account was not there, and the product had taken 100 coins for placement it
// did not deliver. A new suggestion surface that forgets this is indis-
// tinguishable from a refund request.
//
// The rule: a file that suggests USERS to follow must call getBoostedUsers().
// Hand-rolling a boost query is what let the surfaces drift apart, so a raw
// `boostExpiresAt` query outside firestore.js fails too.
{
  const SUGGESTION_SURFACES = [
    'src/components/brand/HomeFeedRail.jsx',
    'src/components/DiscoveryStrip.jsx',
    'src/components/RightSidebarPanel.jsx',
    'src/screens/explore/ExploreScreen.jsx',
    'src/screens/explore/native/NativeExploreScreen.jsx',
    'src/screens/onboarding/OnboardingFlowScreen.jsx',
  ];
  for (const f of SUGGESTION_SURFACES) {
    const src = read(f);
    check(`${f} honours a paid boost`, src.includes('getBoostedUsers('),
      'suggests users but never asks for boosted ones — a paid boost will not appear here');
    check(`${f} does not hand-roll a boost query`,
      !usersBoostQuery(src),
      'use getBoostedUsers() so fairness, targeting and self-exclusion stay in ONE place');
  }

  // The shared query itself must keep its three properties.
  const store = read('src/firebase/firestore.js');
  check('getBoostedUsers exists', store.includes('export const getBoostedUsers'));
  check('getBoostedUsers shards by bucket', /where\('boostBucket', '==', pickBucket\(\)\)/.test(store),
    'without a random bucket the same boosts are served to everyone forever');
  check('getBoostedUsers falls back when a bucket is empty', store.includes('needsFallback('),
    'at launch volume a random bucket is empty ~97% of the time and nobody would ever be shown');
  check('getBoostedUsers ranks for the viewer', store.includes('rankBoostedForViewer('));

  const del = read('src/utils/boostDelivery.js');
  check('viewer is excluded from their own suggestions', del.includes('u.id !== viewerUid'),
    'Verion was suggested to Verion on 2026-08-28');
  check('a muted author still outranks a payment', del.includes('negatives.authors.has(u.id)'));
  // ⚠ Founder decision 2026-08-28: relevance is the ONLY tiebreak. Ordering by
  // spend turns a suggestion rail into an ad auction.
  check('boost tiebreak is relevance, never spend', !/spend|coinsPaid|amountPaid/.test(codeOnly(del)),
    'no spend term may enter rankBoostedForViewer');

  // ⚠ EVERY SERVER PATH THAT BOOSTS A PROFILE MUST STAMP A BUCKET.
  //
  // The old guard here asserted read('functions/boosts.js').includes('boostBucket'),
  // which is a substring test over the WHOLE FILE, comments included. It was green
  // the entire time `purchaseBoost` in walletActions.js wrote boostExpiresAt to a
  // users doc with NO bucket, so every profile boost sold from the shop tab landed
  // outside every bucket query and could only ever be delivered by the empty-bucket
  // fallback. That fallback stops firing once the platform is busy, so the boost
  // would have gone dark exactly when it finally had an audience to reach.
  //
  // A guard must assert the CODE, not a comment that mentions the right word.
  for (const f of ['functions/boosts.js', 'functions/walletActions.js']) {
    const code = codeOnly(read(f));
    if (!/boostExpiresAt/.test(code)) continue;
    check(`${f} stamps a boostBucket in code`, /boostBuckets*[:,]/.test(code),
      'writes boostExpiresAt but no bucket, so the sharded reader can never see it');
  }

  // ⚠ BOTH BOOST WRITERS MUST PRODUCE THE SAME LEDGER SHAPE.
  //
  // The buyer's receipt (getMyActiveBoosts -> MyBoosts.jsx) reads boostId, target
  // and startedAt. applyBoost always wrote all three; purchaseBoost wrote none of
  // them, so the Profile Boost (the ONLY boost sold from the shop tab) rendered a
  // blank name with 0 impressions and 0 people while its real counters sat on the
  // users doc. A boost whose buyer cannot see what it did is the same failure as a
  // boost that does nothing.
  // ⚠ SCOPED TO THE LEDGER WRITE, NOT THE FILE. The first version of this guard
  // regexed the whole file and stayed GREEN with boostId deleted from the row,
  // because purchaseBoost's return statement says `boostId: boostRef.id` further
  // down. Negative-tested both ways after that was found.
  const ledgerRow = (code, open) => {
    const i = code.indexOf(open);
    if (i < 0) return null;
    const j = code.indexOf('});', i);
    return j < 0 ? null : code.slice(i, j);
  };
  for (const [f, fn, open] of [
    ['functions/boosts.js', 'applyBoost', "tx.set(d.collection('boosts').doc(), {"],
    ['functions/walletActions.js', 'purchaseBoost', 'tx.set(boostRef, {'],
  ]) {
    const row = ledgerRow(codeOnly(read(f)), open);
    check(`${fn} writes a boosts ledger row`, !!row,
      'the buyer receipt lists this collection; no row means no receipt');
    for (const field of ['boostId', 'target', 'startedAt']) {
      check(`${fn} ledger row carries ${field}`,
        !!row && row.includes(field + ':'),
        'the buyer receipt reads this field; without it RUNNING NOW shows a blank row');
    }
  }

  // The receipt must still understand rows written before that agreement.
  check('the receipt normalises both ledger shapes',
    /b.boostId || b.type/.test(codeOnly(read('src/firebase/firestore.js'))),
    'boosts already live when this shipped carry only the type field and would render blank');

  // ⚠ A DOTTED KEY IN set() CREATES A FIELD LITERALLY NAMED "a.b".
  //
  // Only update() resolves a dotted path. `tx.set(ref, { 'boosts.post': inc(1) })`
  // silently creates a field whose NAME is the seven characters "boosts.post",
  // which no reader will ever find. That cost 50 coins and produced an inventory
  // the buyer could not see, on 2026-08-28. set() with { boosts: { [id]: inc } }
  // plus { merge: true } is the correct shape and is what the code uses now.
  //
  // update() is deliberately NOT flagged: a dotted path is correct there.
  {
    // Regex-free on purpose: a quoted dotted key is easy to find with plain
    // string ops, and every attempt to generate this check as a regex through a
    // template literal silently lost its backslashes and matched nothing.
    const hasDottedKey = (stmt) => {
      for (const q of ["'", '"']) {
        let i = stmt.indexOf(q);
        while (i >= 0) {
          const j = stmt.indexOf(q, i + 1);
          if (j < 0) break;
          const key = stmt.slice(i + 1, j);
          if (key.includes('.') && stmt.slice(j + 1).trimStart().startsWith(':')) return true;
          i = stmt.indexOf(q, j + 1);
        }
      }
      return false;
    };
    for (const f of ['functions/boosts.js', 'functions/walletActions.js', 'functions/vpBonuses.js']) {
      let src;
      try { src = codeOnly(read(f)); } catch { continue; }
      let bad = null;
      for (let i = src.indexOf('.set('); i >= 0; i = src.indexOf('.set(', i + 1)) {
        // Bound the statement at its own close. A fixed window bled from a set()
        // into the NEXT statement and flagged a legal dotted update() sitting
        // right below it, which a control run caught.
        const close = src.indexOf(');', i);
        const stmt = src.slice(i, close < 0 ? i + 300 : close + 2);
        if (hasDottedKey(stmt)) { bad = stmt.slice(0, 80).trim(); break; }
      }
      check(`${f} uses no dotted key inside set()`, !bad,
        'set() would create a field literally named "a.b"; use update(), or a nested object with merge');
    }
  }

  // And the counter that will soon be displayed must not be client-writable.
  const rules = read('firestore.rules');
  check('viewCount is not client-writable',
    !/'likeCount', 'commentCount', 'saveCount', 'shareCount', 'viewCount'/.test(rules),
    'a visible view count anyone can inflate is worse than no view count');
}

// 2b. THE LADDER HAS NO HOLLOW LEVELS.
//
// ⚠ This is the check that should have existed from the start.
// `assertNoDeadLevels` proves every level has a ROW, and every level always did
// because every level carries a `vprate_` row — so it was GREEN while 56 of 100
// levels gave nothing but the +0.5% earn rate. A guard that measures the thing
// you can measure instead of the thing that matters is worse than no guard.
//
// A level is hollow when it has no row a player can SEE, equip or spend.
// Founder, 2026-08-27: boost tokens fill the gaps, so there is no longer any
// excuse for one. Do not silence this by adding a `vprate_`-like filler row.
{
  const { assertNoHollowLevels, assertNoDeadLevels } =
    await import(`file://${repo}/src/utils/rankUnlocks.js`);
  const hollow = assertNoHollowLevels();
  check('ladder has no hollow levels', hollow.length === 0,
    hollow.length ? `levels giving only the rate bump: ${hollow.join(', ')}` : undefined);
  check('ladder has no level without any row', assertNoDeadLevels().length === 0);
}

// 3. Every advertised earn action resolves to an amount.
for (const it of EARN_ITEMS) {
  check(`earn "${it.label}" has an amount`, !!(it.custom || VP_ACTIONS[it.key]));
}

// 4. Every theme has a gradient AND a seam glow; every accent has a colour.
const { PROFILE_THEME_CSS, themeSeamStyle } = await import(`file://${repo}/src/utils/profileThemes.js`);
for (const t of PROFILE_THEMES) {
  check(`theme "${t.id}" gradient`, !!PROFILE_THEME_CSS[t.id]);
  check(`theme "${t.id}" seam glow`, !themeSeamStyle(t.id).background.includes('undefined'));
}
for (const a of PROFILE_ACCENTS) check(`accent "${a.id}" colour`, /^#[0-9A-Fa-f]{6}$/.test(a.color));

// 4b. Every rank has entry-ribbon art at both densities. The ribbon falls back
// to a CSS gradient when art is missing, which looks fine and therefore hides
// the fact that a rank never got its banner.
const { RANK_BANNERS } = await import(`file://${repo}/src/utils/rankBanners.js`);
for (const r of RANK_BANNERS) {
  for (const s of ['', '@2x']) {
    check(`entry art ${r.id}${s}.webp`, existsSync(`${repo}/public/brand/entry/${r.id}${s}.webp`));
  }
}

// 4c. Every milestone badge reads a counter that some server file actually
// WRITES. This check exists because `users.streamMinutes` was read by the whole
// "On air" family and written by nothing at all — the badges were unearnable,
// and the only reason it surfaced was grepping for the increment rather than
// for the name. (`streamMinutesPerDay` in streaming.js is a per-tier LIMIT,
// which is exactly why a name grep looked fine.)
// Each badge NAMES the file that writes its counter, rather than this script
// guessing at write syntax. A first attempt pattern-matched for
// `field: FieldValue.increment` and produced two false negatives
// (`bestConsecutiveDays: Math.max(...)` and the dotted `'referrals.allTime':`),
// and a check that cries wolf is nearly as useless as no check — you learn to
// ignore it. The annotation also documents provenance where a reader will
// actually see it.
const { MILESTONES } = await import(`file://${repo}/src/utils/milestones.js`);
const fnFiles = new Set(readdirSync(`${repo}/functions`).filter((f) => f.endsWith('.js')));
for (const b of MILESTONES) {
  if (!b.writer) { check(`milestone "${b.name}" names a writer file`, false); continue; }
  if (!fnFiles.has(b.writer)) { check(`milestone "${b.name}" writer functions/${b.writer} exists`, false); continue; }
  const leaf = b.field.split('.').pop();
  check(`milestone "${b.name}": functions/${b.writer} writes ${b.field}`,
    read(`functions/${b.writer}`).includes(leaf));
}

// 4d. Typing indicator styles (docs/effects/06). Three ways this can silently
// half-ship, so three assertions per style:
//   - the id has no keyframes  → the indicator renders a motionless shape
//   - the id is not in firestore.rules → the picker offers what the server
//     rejects, and the tap fails with a permission error
//   - the level in rules drifts from TYPING_STYLE_LEVEL → someone can equip
//     early, or cannot equip what the screen says they have earned
const { TYPING_STYLES, TYPING_STYLE_LEVEL, TYPING_STYLE_IDS } =
  await import(`file://${repo}/src/utils/rankUnlocks.js`);
const typingCss = read('src/components/effects/triggers/TypingStyles.css');
const rulesSrc = read('firestore.rules');
for (const s of TYPING_STYLES) {
  check(`typing style "${s.id}" has a rule in its stylesheet`, typingCss.includes(`.vg-typing--${s.id}`));
  check(`typing style "${s.id}" animates`, new RegExp(`@keyframes vg-typing-${s.id}\\b`).test(typingCss)
    || s.id === 'orbit');   // orbit shares vg-typing-spin, asserted below
  check(`typing style "${s.id}" is in the firestore.rules enum`, rulesSrc.includes(`'${s.id}'`));
}
check('typing style "orbit" animates', /@keyframes vg-typing-spin\b/.test(typingCss));
check('typing enum size matches rules', (rulesSrc.match(/c\.typingStyle in \[([^\]]+)\]/)?.[1].split(',').length || 0) === TYPING_STYLE_IDS.length,
  `client has ${TYPING_STYLE_IDS.length}`);
check('typing unlock level mirrored in firestore.rules',
  rulesSrc.includes(`kind == 'typingStyle' ? ${TYPING_STYLE_LEVEL}`), `expected ${TYPING_STYLE_LEVEL}`);
// ⚠ ONE ROW PER STYLE SINCE 2026-08-27, not one row granting all six. This
// asserted a single `typing_style` row and would have gone green forever while
// the drip-feed silently granted nothing.
for (const s of TYPING_STYLES) {
  if (s.level <= 1) continue;   // `dots` is the default, not an unlock
  check(`typing style "${s.id}" has a ladder row at its own level`,
    RANK_UNLOCKS.some((r) => r.id === `typing_${s.id}` && r.level === s.level),
    `expected a row at L${s.level}`);
}
check('typing styles are spread, not stacked on one level',
  new Set(TYPING_STYLES.filter((s) => s.level > 1).map((s) => s.level)).size
    === TYPING_STYLES.filter((s) => s.level > 1).length,
  'two styles sharing a level wastes a ladder slot');
// Reduced motion is a rule, not a nicety: every style rests at a dim or shrunk
// pose, so switching animation off without a static form leaves the user with
// no indication anybody is typing at all.
check('typing styles degrade under prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\)/.test(typingCss) && /animation: none/.test(typingCss));

// 4e. Chat themes (docs/effects/12). Four ways this half-ships silently:
// a theme with no pattern file on disk renders a plain gradient with no icons;
// a theme missing from the firestore.rules enum makes the picker throw a
// permission error on tap; a colour that is not a hex is interpolated straight
// into a canvas fill; and a level drift means the screen offers what the ladder
// has not granted.
const { CHAT_THEMES, CHAT_THEME_LEVEL } = await import(`file://${repo}/src/utils/chatThemes.js`);
const rulesTxt = read('firestore.rules');
const rulesEnum = rulesTxt.match(/request\.resource\.data\.chatTheme in \[([^\]]+)\]/)?.[1] || '';
for (const t of CHAT_THEMES) {
  check(`chat theme "${t.id}" has a pattern tile`,
    existsSync(`${repo}/chat-pattern-tiles/${t.pattern}.png`),
    `chat-pattern-tiles/${t.pattern}.png`);
  check(`chat theme "${t.id}" is in the firestore.rules enum`, rulesEnum.includes(`'${t.id}'`));
  for (const mode of ['night', 'day']) {
    check(`chat theme "${t.id}" ${mode} has 3-4 hex colours`,
      Array.isArray(t[mode]) && t[mode].length >= 3 && t[mode].length <= 4
      && t[mode].every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
      JSON.stringify(t[mode]));
  }
}
check('chat theme enum size matches rules',
  (rulesEnum.split(',').length) === CHAT_THEMES.length, `client has ${CHAT_THEMES.length}`);
// ⚠ ONE ROW PER THEME SINCE 2026-08-27. The levels live in rankUnlocks
// (CHAT_THEME_LEVELS) because chatThemes.js already imports rankUnlocks and the
// reverse would be circular — so the two id lists MUST be asserted equal, or a
// theme added to one file becomes unlockable at level `undefined`.
{
  const { CHAT_THEME_LEVELS } = await import(`file://${repo}/src/utils/rankUnlocks.js`);
  const a = CHAT_THEMES.map((t) => t.id).sort().join(',');
  const b = CHAT_THEME_LEVELS.map((t) => t.id).sort().join(',');
  check('CHAT_THEMES and CHAT_THEME_LEVELS list the same themes', a === b,
    `look: ${a} | levels: ${b}`);
  for (const t of CHAT_THEME_LEVELS) {
    check(`chat theme "${t.id}" has a ladder row at its own level`,
      RANK_UNLOCKS.some((r) => r.id === `chattheme_${t.id}` && r.level === t.level),
      `expected a row at L${t.level}`);
  }
  check('chat themes are spread, not stacked on one level',
    new Set(CHAT_THEME_LEVELS.map((t) => t.level)).size === CHAT_THEME_LEVELS.length);
  check('CHAT_THEME_LEVEL is the floor of the drip-feed',
    CHAT_THEME_LEVEL === Math.min(...CHAT_THEME_LEVELS.map((t) => t.level)),
    `copy says themes unlock at ${CHAT_THEME_LEVEL}, first theme is at ${Math.min(...CHAT_THEME_LEVELS.map((t) => t.level))}`);
}

// Every typeface must have a ladder row at its own level, for the same reason.
{
  const { NAME_FONTS } = await import(`file://${repo}/src/utils/nameFonts.js`);
  const bundled = NAME_FONTS.filter((f) => (f.level || 1) <= 3).length;
  check('the three bundled faces share L3', bundled === 3,
    'default/display/mono trigger no download, so there is nothing to stagger');
  for (const f of NAME_FONTS) {
    if ((f.level || 1) <= 3) continue;
    check(`typeface "${f.id}" has a ladder row at L${f.level}`,
      RANK_UNLOCKS.some((r) => r.id === `font_${f.id}` && r.level === f.level));
  }
  check('typefaces are spread, not stacked',
    new Set(NAME_FONTS.filter((f) => f.level > 3).map((f) => f.level)).size
      === NAME_FONTS.filter((f) => f.level > 3).length);
}
// ⚠ The wallpapers are a separate, shipped feature. This asserts the chat-theme
// work never wrote over them, which the founder asked for explicitly.
for (const bg of ['bg_1', 'bg_2', 'bg_3', 'bg_4', 'bg_5', 'bg_6', 'bg_7']) {
  check(`wallpaper ${bg}.png untouched`, existsSync(`${repo}/public/backgrounds/static/${bg}.png`));
}

// 5. No dead levels: every level 1-100 grants something.
const levels = new Set(RANK_UNLOCKS.map((r) => r.level));
const dead = [...Array(100)].map((_, i) => i + 1).filter((l) => !levels.has(l));
check('no dead levels 1-100', dead.length === 0, dead.length ? `dead: ${dead.join(',')}` : '');

// ── EFFECT 09 mirrors: the level must agree in THREE places ────────
// EFFECTS[].level, the ladder row, and firestore.rules. A picker offering what
// the server refuses is the nameFont class of bug (CLAUDE.md).
{
  const amb = RANK_UNLOCKS.find((u) => u.id === 'ambiance');
  const fx = EFFECTS.find((e) => e.id === 'ambiance');
  const rules = readFileSync(`${repo}/firestore.rules`, 'utf8');
  check('ambiance: ladder row exists', !!amb, 'RANK_UNLOCKS');
  check('ambiance: EFFECTS row exists', !!fx, 'EFFECTS');
  check('ambiance: EFFECTS level matches the ladder', !!amb && !!fx && amb.level === fx.level,
    amb && fx ? `ladder ${amb.level} vs EFFECTS ${fx.level}` : '');
  check('ambiance: firestore.rules gates it at the same level',
    rules.includes("kind == 'ambiance'   ? " + (fx ? fx.level : '?')), 'firestore.rules');
  // ⚠ OPT-IN, not opt-out. Every other effect is visual and costs a visitor
  // nothing; this one makes NOISE at them. It must never switch itself on.
  check('ambiance: defaults OFF', !!fx && fx.defaultOn === false, 'defaultOn');
  // The URL is handed to an <audio> element, so rules must pin the host.
  check('ambiance: rules pin the audio host', rules.includes('cdn[.]vergr[.]app'), 'host pin');
}

// ── EVERY LADDER REWARD MUST HAVE A REAL IMPLEMENTATION ────────────
// ⚠ `assertNoDeadLevels` only proves every LEVEL 1-100 has a row. It does NOT
// prove the row's reward exists. `name_glow` at L100 promised "Immortal name
// glow" and NOTHING read it: UserName.jsx resolved font, colour, chat colour
// and the gradient, and had no glow at all. It sat inert on the ladder, the
// exact thing CLAUDE.md bans ("do not add a row to that table for something
// that does not exist yet"), and every existing check passed.
//
// ⚠ EACH ID NAMES ITS IMPLEMENTING FILE, rather than the script guessing from a
// grep. The milestone check learned this the hard way: pattern-matching
// produced false negatives, and a check that cries wolf gets ignored. Adding a
// ladder row now means naming the file that honours it, or this fails.
const REWARD_OWNERS = {
  // families, matched by prefix
  'vprate_': 'src/utils/rankUnlocks.js:rankVpBonus',
  'crest_':  'src/components/RankBadge.jsx',
  'accent_': 'src/utils/rankUnlocks.js:accentFor',
  'boost_':  'functions/vpLevel.js',   // server-side: it GRANTS the tokens
  // VP bonus packs. The GRANTER is the owner, same reasoning as boost tokens:
  // the pack table is data, vpLevel.js is what actually stamps it on the user.
  'bonus_':  'functions/vpLevel.js',
  'theme_':  'src/utils/profileThemes.js',
  // Drip-fed pools, 2026-08-27. One row per item instead of one row granting
  // the whole set — see the DRIP-FED POOLS block in rankUnlocks.js for why.
  // The owner is the RESOLVER that enforces the per-item level, not the table.
  'font_':      'src/utils/rankUnlocks.js:nameFontFor',
  'chattheme_': 'src/utils/chatThemes.js',
  'typing_':    'src/components/effects/triggers/TypingStyles.jsx',
  // one-offs
  chatcolor:      'src/components/UserName.jsx',
  name_font:      'src/components/UserName.jsx',
  name_color:     'src/components/UserName.jsx',
  name_effect:    'src/components/UserName.jsx',
  name_glow:      'src/components/UserName.jsx',
  chat_theme:     'src/utils/chatThemes.js',
  ambiance:       'src/components/effects/audio/ProfileAudio.jsx',
  typing_style:   'src/components/effects/triggers/TypingStyles.jsx',
  // ⚠ Two rows, two DIFFERENT owners on purpose. The static room is the CSS
  // backdrop; the weather is the canvas engine. If they shared an owner a
  // half-built tier would still pass this guard.
  // ⚠ Level OR Pro, like chat_theme. The plan half of the gate lives in
  // canUseStreamTts(), not in the ladder table.
  // ⚠ Owned by ChatPanel, NOT by utils/goldenThread.js. The drawn-path engine
  // was REJECTED on 2026-08-27 (it rendered as a jagged squiggle); the reward
  // is now a tint + accent bar on the followed viewer's rows, which lives in
  // ChatPanel. Pointing this at the dead engine would let the guard pass while
  // nothing implemented the reward.
  // ⚠ Owned by uploadAvatar, not by the ladder table: that function is what
  // actually skips compression for an animated file. If it ever goes back to
  // asking tier only, the row here would still pass while the reward was gone.
  // ⚠ Owned by RankBadge, NOT covered by the `crest_` prefix above. That prefix
  // matches `crest_veteran` and friends; `animated_crest` does not start with
  // it, so without this line the row has no owner and this guard fails.
  animated_crest:    'src/components/RankBadge.jsx',
  animated_banner:   'src/firebase/firestore.js',
  animated_avatar:   'src/firebase/firestore.js',
  golden_thread:     'src/components/streams/ChatPanel.jsx',
  tts_stream:        'src/utils/streamTts.js',
  squad_environment: 'src/utils/squadEnvironments.js',
  squad_weather:     'src/utils/squadWeather.js',
  entry_ribbon:   'src/components/streams/JoinAnnouncer.jsx',
  entry_sweep:    'src/components/streams/JoinAnnouncer.jsx',
  entry_shimmer:  'src/components/streams/JoinAnnouncer.jsx',
};
const ownerFor = (id) => REWARD_OWNERS[id]
  || REWARD_OWNERS[Object.keys(REWARD_OWNERS).find((k) => k.endsWith('_') && id.startsWith(k))];

for (const u of RANK_UNLOCKS) {
  const owner = ownerFor(u.id);
  check(`ladder '${u.id}' (L${u.level}) names an implementation`, !!owner,
    owner ? '' : 'no entry in REWARD_OWNERS — add the file that honours it');
  if (!owner) continue;
  const file = owner.split(':')[0];
  check(`ladder '${u.id}' -> ${file} exists`, existsSync(`${repo}/${file}`), file);
}

// `--list` prints every assertion, so a green run can be shown to be real
// rather than vacuous (a check that silently asserts nothing always passes).
// 4f. ⚠ A FILE THAT *CALLS* A LADDER GATE MUST ALSO *IMPORT* IT.
//
// This exists because `uploadAvatar` shipped calling `canUseAnimatedAvatar()`
// with no import on 2026-08-27, and `vite build` went green — the repo has no
// eslint, so nothing catches an undefined identifier. It would have thrown at
// runtime on the first avatar upload and nowhere else.
//
// Deliberately NARROW: only the exported gate//resolver helpers from
// rankUnlocks.js, only in src/. That keeps it free of the false positives a
// general "is this identifier defined" scan would produce, while covering the
// exact pattern this ladder work keeps using.
// ⚠ WIDENED 2026-08-27 AFTER IT HAPPENED TWICE IN ONE SESSION. `uploadAvatar`
// shipped calling `canUseAnimatedAvatar()` unimported, and an hour later
// `uploadBanner` shipped calling `compressVideo()` unimported. Both built green.
// So this list is not just ladder gates any more: it is the cross-module helpers
// this work keeps reaching for.
//
// ⚠ THIS IS A MITIGATION, NOT THE FIX. The real fix is a linter — the repo has
// NO eslint at all, so nothing catches an undefined identifier anywhere else.
// An `eslint` devDependency configured with `no-undef` alone would cover the
// whole codebase instead of a hand-kept list. Founder decision, since it adds a
// dependency.
const GATES = [
  'canUseAnimatedAvatar', 'canUseAnimatedBanner', 'isUnlocked', 'unlockLevel',
  'accentFor', 'isEffectOn',
  'compressVideo', 'compressMedia', 'canUseStreamTts', 'canUseChatThemes',
  // ⚠ AND THE REACT HOOKS, after a THIRD instance in the same session:
  // `PublicProfileScreen.jsx` used `useRef` without importing it. Hooks are
  // always named imports from 'react', so the same test covers them, and they
  // are the single most commonly forgotten import in a React codebase.
  'useRef', 'useState', 'useEffect', 'useMemo', 'useCallback',
];
const srcFiles = [];
(function walk(dir) {
  for (const e of readdirSync(`${repo}/${dir}`, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(e.name)) srcFiles.push(p);
  }
}('src'));

for (const f of srcFiles) {
  if (f.endsWith('utils/rankUnlocks.js')) continue;      // defines them
  const src = read(f);
  for (const g of GATES) {
    // a CALL, not a mention in a comment or a string
    // ⚠ Double-escaped on purpose: inside a template literal `\w` collapses to
    // a bare `w` and `\(` to `(`, which silently produced an unterminated group.
    const called = new RegExp(`(^|[^.\\w'"\`])${g}\\s*\\(`, 'm').test(
      src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
    if (!called) continue;
    // ⚠ A FILE MAY DEFINE THE NAME ITSELF, and then it needs no import.
    // First run of this check flagged `utils/rankCollections.js` for calling
    // accentFor() — but that file EXPORTS ITS OWN accentFor, a different
    // function that merely shares the name. A guard that cries wolf gets
    // ignored, which is worse than no guard.
    const definesOwn = new RegExp(
      `(export\\s+)?(const|let|function)\\s+${g}\\b`).test(src);
    if (definesOwn) continue;
    // ⚠ THREE WAYS A NAME CAN LEGITIMATELY ARRIVE, and the first version knew
    // only one. `StatusScreen.jsx:474` does
    // `const { compressVideo } = await import('...')` — a perfectly good dynamic
    // import that the static-only pattern flagged as a bug. Second false
    // positive this guard produced; a check that cries wolf gets ignored.
    const imported =
      // static: `import { x } from` AND `import Default, { x } from`.
      // ⚠ The optional default-import half is not optional in practice: without
      // it this produced FIFTY-ONE false positives in one run, because
      // `import React, { useState } from 'react'` is the commonest form in the
      // codebase. Third false-positive class this guard has thrown; each one
      // was worth fixing rather than narrowing the check.
      new RegExp(`import\\s+(?:[\\w$]+\\s*,\\s*)?\\{[^}]*\\b${g}\\b[^}]*\\}\\s*from`).test(src)
      // dynamic: const { x } = await import('...')   /  = require('...')
      || new RegExp(`\\{[^}]*\\b${g}\\b[^}]*\\}\\s*=\\s*(await\\s+import|require)\\s*\\(`).test(src)
      // namespace: import * as m from '...'  → m.x(), which the call test skips
      || new RegExp(`\\.\\s*${g}\\s*\\(`).test(src);
    check(`${f} calls ${g}() and imports it`, imported,
      imported ? '' : 'CALLED BUT NOT IMPORTED — this builds green and throws at runtime');
  }
}

// ── 9. The living crest (effect 21) ────────────────────────────────────────
// ⚠ THE DUTY CYCLE IS THE DESIGN. Doc 21 §4: the sweep is 900ms of a 5600ms
// cycle, so 84% of the time nothing moves. That is the whole answer to "what
// happens when several people in one chat have it". If someone later widens the
// keyframe to make the effect "more visible", they turn a restrained reward
// into continuous motion on every high-rank row, and this is what stops them.
{
  const css = read('src/styles/surface.css');
  const badge = read('src/components/RankBadge.jsx');
  const chat = read('src/components/streams/ChatPanel.jsx');

  check('crest sweep constants exported', CREST_SWEEP_MS > 0 && CREST_CYCLE_MS > 0);
  check('crest cycle mirrored in surface.css', css.includes(`--vg-crest-cycle, ${CREST_CYCLE_MS}ms`),
    `expected ${CREST_CYCLE_MS}ms in the .vg-crest-sheen animation shorthand`);

  // Read the lit fraction out of the KEYFRAMES rather than trusting the comment.
  const kf = css.match(/@keyframes vgCrestSheen\s*\{([\s\S]*?)\n\}/);
  check('vgCrestSheen keyframes exist', !!kf);
  if (kf) {
    const stops = [...kf[1].matchAll(/([\d.]+)%\s*\{/g)].map((m) => +m[1]);
    const lit = stops.find((s) => s > 0 && s < 100);
    check('crest duty cycle <= 20%', lit !== undefined && lit <= 20,
      `sweep occupies ${lit}% of the cycle; over 20% reads as continuous motion`);
    // The declared ms must agree with the percentage actually in the CSS.
    const impliedMs = Math.round((lit / 100) * CREST_CYCLE_MS);
    check('CREST_SWEEP_MS agrees with the keyframe percentage',
      Math.abs(impliedMs - CREST_SWEEP_MS) <= 20,
      `keyframe says ${impliedMs}ms, constant says ${CREST_SWEEP_MS}ms`);
    check('crest resting pose is off-screen right', /100%\s*\{\s*transform:\s*translateX\(130%\)/.test(kf[1]),
      'the Settings reduced-motion switch fast-forwards to the LAST keyframe, so it must be the invisible one');
  }

  // R1 + R6, asserted rather than remembered.
  check('crest wrapper clips its own light', /\.vg-crest\s*\{[^}]*overflow:\s*hidden/.test(css));
  check('crest wrapper isolates (R6)', /\.vg-crest\s*\{[^}]*isolation:\s*isolate/.test(css));
  check('crest sheen is masked to the art', css.includes('mask-size: contain'));

  // ── The three defects that shipped past a green run ────────────────────
  // Each was found by RENDERING and looking, never by a number. They are
  // assertions now so the next person cannot undo them by tidying.

  // 1. The mask must not travel with the band, or the sweep is a white cut-out
  //    of the badge sliding over the badge.
  const sheenBlock = css.slice(css.indexOf('.vg-crest-sheen {'),
    css.indexOf('.vg-crest-sheen::before'));
  check('crest sheen parent does not move', !/\b(transform|animation):/.test(sheenBlock),
    'a transform on the masked parent drags the mask with it — the sweep becomes a white copy of the badge');
  check('the travelling band is a separate pseudo-element',
    css.includes('.vg-crest-sheen::before'));

  // 2. Light adds. Normal blending over dark art is a grey sticker.
  check('crest sheen blends additively', /\.vg-crest-sheen\s*\{[^}]*mix-blend-mode:\s*screen/.test(css),
    'without an additive blend, semi-transparent white over dark art averages to grey and reads as occlusion');

  // 3. The glow needs room inside the clip, or it squares off.
  check('crest wrapper reserves room for its glow', /--vg-crest-pad:\s*[1-9]/.test(css),
    'zero padding + overflow:hidden turns the crest halo into a hard grey rectangle');
  check('crest padding is cancelled by a negative margin',
    /margin:\s*calc\(var\(--vg-crest-pad[^)]*\)\s*\*\s*-1\)/.test(css),
    'without it the padded crest would push the username sideways');
  check('padded crest cannot swallow hover', /\.vg-crest\s*\{[^}]*pointer-events:\s*none/.test(css));

  // Reduced motion has to target the pseudo, since that is where the animation
  // moved. A rule left on the parent would silently stop nothing.
  check('reduced motion targets the animated element',
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.vg-crest-sheen::before/.test(css));

  // §3.3: nothing in this block may animate `filter`.
  const block = css.slice(css.indexOf('THE LIVING CREST'));
  check('crest animates transform only, never filter',
    !/animation:[^;]*\bfilter\b/.test(block) && !/transition:[^;]*\bfilter\b/.test(block),
    'an animated filter promotes a permanent GPU layer per crest in a 100-row chat');

  // The static half must survive both reduced-motion switches.
  check('crest keeps a static lift when motion is off', css.includes('.vg-crest-live img'),
    'a reward that vanishes under reduced motion renders identically to L61');
  check('reduced motion kills only the sweep',
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.vg-crest-sheen::before\s*\{\s*animation:\s*none/.test(css));

  // Wiring, end to end.
  check('RankBadge gates on ANIMATED_CREST_LEVEL', badge.includes('ANIMATED_CREST_LEVEL'));
  check('RankBadge uses the small art', badge.includes('smallBadgeArt'),
    'the 1024px source is 167 KB average, to paint a 13px icon');
  check('ChatPanel passes uid for the phase offset', /<RankBadge[^>]*uid=\{m\.uid\}/.test(chat),
    'without a uid every crest sweeps in lockstep, which is exactly the noise this avoids');

  // ⚠ THE CREST SITS AFTER THE NAME. Founder, 2026-08-27. It was on the left
  // until then, which put a rank mark ahead of the person's own identity.
  // Asserted by source ORDER, because nothing else would catch a revert.
  check('crest renders to the RIGHT of the username',
    chat.indexOf('<RankBadge') > chat.indexOf('<UserName user={{ displayName: m.name'),
    'the crest must follow the name, not precede it');

  // The card is the whole point of making it tappable; a crest wired without
  // onOpen looks identical and does nothing.
  check('crest opens the rank card', /<RankBadge[^>]*onOpen=/.test(chat));
  check('ChatPanel mounts the rank card', chat.includes('<RankCrestPopover'));
  check('rank card imports the real progress helper',
    read('src/components/RankCrestPopover.jsx').includes('getVPProgress'),
    'the first draft called a levelProgress() that does not exist — green build, runtime throw');

  // Distinct phases. A hash that collapses would pass every other assertion.
  const phases = new Set(['a1b2c3', 'zzz999', 'uid-4', 'QWERTY', 'x'].map((u) => crestPhaseMs(u)));
  check('crest phase offsets are distinct per uid', phases.size >= 4, `got ${phases.size} distinct of 5`);
  check('crest phase offsets are negative', [...phases].every((p) => p <= 0),
    'a positive delay leaves every crest dark until its first turn comes round');

  // §5: every badge has its small variant, or chat serves a megabyte.
  const big = readdirSync(`${repo}/public/badges`).filter((f) => f.endsWith('.webp'));
  const small = existsSync(`${repo}/public/badges/sm`)
    ? new Set(readdirSync(`${repo}/public/badges/sm`)) : new Set();
  const gaps = big.filter((f) => !small.has(f));
  check('every badge has a 64px variant', gaps.length === 0,
    gaps.length ? `missing: ${gaps.join(', ')} — run node scripts/build-badge-sizes.mjs` : '');
  for (const f of big) {
    if (small.has(f)) {
      const b = statSync(`${repo}/public/badges/sm/${f}`).size;
      check(`sm/${f} is small`, b < 12000, `${(b / 1024).toFixed(1)} KB — expected well under 12 KB`);
    }
  }

  // ── Crest surface coverage (founder, 2026-08-27: everywhere above Rookie) ──
  // ⚠ THE SWEEP IS OPT-IN AND ONLY CHAT MAY ASK FOR IT. An `animated` crest in
  // a follower list is 20 moving objects in one column, which is precisely the
  // "permanently on fire" look RankBadge exists to avoid.
  const crestFiles = [
    'src/components/PostCard.jsx',
    'src/components/streams/ChatPanel.jsx',
    'src/screens/home/LeaderboardScreen.jsx',
    'src/screens/home/PostDetailScreen.jsx',
    'src/screens/messages/ChatThreadScreen.jsx',
    'src/screens/profile/FollowListScreen.jsx',
    'src/screens/profile/ProfileScreen.jsx',
    'src/screens/profile/PublicProfileScreen.jsx',
    'src/screens/profile/native/NativeProfileScreens.jsx',
    'src/screens/search/SearchResultsAllScreen.jsx',
    'src/screens/squads/SquadChatThreadScreen.jsx',
  ];
  for (const f of crestFiles) {
    const src = read(f);
    check(`${f} renders a crest`, src.includes('<RankBadge'));
    // ⚠ The defect that keeps slipping past a green build: JSX happily renders
    // an undefined component name only to throw at runtime.
    check(`${f} imports RankBadge`, /import RankBadge from/.test(src),
      'CALLED BUT NOT IMPORTED — builds green, throws when the screen opens');
    if (f !== 'src/components/streams/ChatPanel.jsx') {
      check(`${f} does NOT animate its crest`, !/<RankBadge[^>]*\banimated\b/.test(src),
        'only live chat may run the sweep');
    }
  }
  // ⚠ A CREST MUST NEVER FAKE A RANK. UserName and isEffectOn resolve admin to
  // level 100 so cosmetics can be previewed; RankBadge deliberately does not.
  // Given that allowance on 2026-08-27, the live profile rendered an ASCENDANT
  // crest beside the account's own ROOKIE pill. A colour makes no claim; a
  // crest does. Reverted, and asserted so it cannot come back by analogy.
  check('the crest never applies an admin level allowance',
    !/role === 'admin' ? 100/.test(read('src/components/RankBadge.jsx')),
    'a crest asserts a rank — it may not be previewed the way a cosmetic can');

  check('live chat is the one surface that animates',
    /<RankBadge[^>]*\banimated\b/.test(read('src/components/streams/ChatPanel.jsx')));

  // ⚠ The feed author cache MUST persist vpLevel, or a cold load renders every
  // feed name plain (no crest, no colour, no typeface) until a refetch lands
  // hours later. Same defect chatIdentity.js already fixed for DMs.
  const fsrc = read('src/firebase/firestore.js');
  check('author cache persists vpLevel', /obj\[k\] = \{[^}]*vpLevel/.test(fsrc),
    'without it the crest and every name cosmetic vanish on a cold feed load');
  check('author cache persists cosmetics', /obj\[k\] = \{[^}]*cosmetics/.test(fsrc));
  check('author cache key was bumped past v1', fsrc.includes("'vergr_author_cache_v2'"),
    'reusing v1 serves the old six-field projection from localStorage for 6h');

  // ── Stream Boost (2026-08-27) ──────────────────────────────────────────
  // ⚠ THE BOOST THIS REPLACED DID NOTHING: `boosted` drew a badge, every live
  // list ordered by viewerCount, and the reach multiplier sat in
  // `getLiveDiscoveryFeed`, which no screen called. These assertions exist so
  // it cannot quietly become decorative again.
  {
    const tiers = read('src/utils/streamBoost.js');
    const server = read('functions/streamBoost.js');
    const explore = read('src/screens/explore/ExploreScreen.jsx');

    // The tier table is mirrored client/server: the UI prices the button, the
    // server takes the coins. A drift charges a price the UI never showed.
    for (const [id, coins, minutes] of [['boost', 50, 15], ['super', 150, 30], ['mega', 500, 60]]) {
      const re = new RegExp(`id: '${id}',[^\\n]*coins: ${coins},[^\\n]*minutes: ${minutes}`);
      check(`boost tier "${id}" matches client and server`, re.test(tiers) && re.test(server),
        `expected ${coins} coins / ${minutes} min in BOTH streamBoost files`);
    }
    check('a VP token redeems as the entry tier only', server.includes('TOKEN_TIER_ID'),
      'pairing useToken with the top tier turns a free reward into the 500-coin product');
    check('boost reach has a hard ceiling', /BOOST_REACH_CEILING\s*=\s*[\d.]+/.test(tiers),
      'founder chose stacking WITH a ceiling — uncapped means reach is simply for sale');
    check('boosts expire', tiers.includes('boostRemainingMs') && server.includes('expiresAt'),
      'a boost with no end is a badge, which is the bug being fixed');

    // The part that was missing entirely: boost has to reach a list somebody sees.
    check('Explore ranks streams through rankStreams', explore.includes('rankStreams('),
      'without this the boost multiplier applies to nothing a user looks at');
    check('Explore fetches boosted streams separately',
      explore.includes("'boostExpiresAt', '>'"),
      'ordering the top-24-by-viewers cannot surface a boosted stream with few viewers, which is the entire point of a boost');
    check('Explore imports what it calls', /import \{[^}]*rankStreams[^}]*\} from/.test(explore),
      'CALLED BUT NOT IMPORTED — builds green, throws when Explore opens');
    // ⚠ BOOST LIVES IN THE GIFT MENU, NOT ON THE ACTION ROW. Founder,
    // 2026-08-27, after a first pass put a Boost pill beside Tip / Clip /
    // Share: it belongs where TikTok puts it, alongside the gifts. Both TipModal
    // copies must carry it — editing one leaves the mobile viewer with no entry
    // point at all, the same miss that shipped the avatar orbit to nobody.
    // ⚠ SCOPE, NOT PRESENCE. The first version of this check asked only whether
    // the FILE contained `<BoostPanel` and `giftTab`. It passed while both had
    // been inserted into ReportStreamSheet by a non-global regex — a component
    // with no `giftTab` in scope, so opening Report threw a ReferenceError.
    // A file-level grep cannot see that. This slices the function out and asks
    // where the markup actually landed.
    const sliceFn = (src, name) => {
      const start = src.indexOf(`function ${name}(`);
      if (start < 0) return '';
      // The BODY brace, not the destructured-parameter brace.
      let i = src.indexOf(') {', start);
      if (i >= 0) i = src.indexOf('{', i);
      if (i < 0) return '';
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
      }
      return '';
    };

    for (const f of ['src/screens/streams/ViewerStreamScreen.jsx',
                     'src/components/streams/MobileLiveViewer.jsx']) {
      const src = read(f);
      const tipModal = sliceFn(src, 'TipModal');
      const outside = src.replace(tipModal, '');

      check(`${f} offers Boost inside the gift modal`,
        tipModal.includes('<BoostSheet') && tipModal.includes('giftTab'),
        'the Tip/Boost switch must be INSIDE TipModal, not merely somewhere in the file');
      check(`${f} leaks no boost markup into other components`,
        !/giftTab|<BoostSheet/.test(outside),
        'a stray giftTab in another component is a ReferenceError when that component opens');
      // The Send button is a TIP action and must never render over boost tiers.
      const boostArm = tipModal.slice(
        tipModal.indexOf("{giftTab === 'boost' ? ("),
        tipModal.indexOf(') : (<>'),
      );
      check(`${f} boost tab renders no tip Send button`,
        boostArm.includes('<BoostSheet') && !/onSend|PRESETS/.test(boostArm),
        'the boost arm of the ternary must contain only the panel');
      check(`${f} fragments are balanced in TipModal`,
        (tipModal.match(/\(<>/g) || []).length === (tipModal.match(/<\/>\)\}/g) || []).length);
      check(`${f} imports BoostSheet`, /import BoostSheet from/.test(src),
        'CALLED BUT NOT IMPORTED — builds green, throws when the modal opens');
      check(`${f} passes the stream to the gift modal`, /<TipModal[\s\S]{0,220}streamId=/.test(src),
        'without streamId the Boost tab cannot name the stream it is boosting');
      // The pill must not come back.
      check(`${f} has no Boost pill on the action row`,
        !/pillAction\([^)]*\)\s*}>\s*\n?\s*<Icon name="rocket_launch"/.test(src),
        'boost belongs in the gift menu, not beside Tip / Clip / Share');
    }

    check('interest matching reuses ONE topic inference',
      read('src/utils/feedRank.js').includes('export const inferStreamTopics'),
      'a second copy of "what is this stream about" is how two theme systems drifted apart');
  }

  // ── Admin kill switches must be read by the CLIENT too ─────────────────
  // ⚠ "Min-Follower Requirement (Go Live)" was OFF for weeks and the founder
  // was still gated. The switch was written by /admin/config, allowlisted in
  // adminConfig.js, and honoured by functions/streaming.js — but
  // GoLiveSetupScreen hardcoded the 100 and disabled the button locally, so the
  // server that would have allowed the stream was never asked. A server gate
  // whose client does not read the same switch means the CLIENT is the real
  // policy, and the admin toggle is decoration.
  //
  // Same class as payoutsPaused / conversionsPaused / tipsPaused in CLAUDE.md.
  // ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The first version
  // of this check asked `read(client).includes(flag)` and PASSED after I
  // deliberately broke the client read — because the flag name still appeared
  // in the explanatory comment above it. A guard that greps for a NAME cannot
  // tell code from prose. Third time this exact weakness has bitten in one
  // session (the RankBadge import check and the ExploreScreen import check were
  // the other two), so this one strips comments and matches the READ.
  const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/^\s*\/\/.*$/gm, '')          // whole-line // comments
    .replace(/\/\/[^\n'"`]*$/gm, '');      // trailing // comments

  for (const [flag, client, server] of [
    ['streamFollowerGateEnabled',
     'src/screens/streams/GoLiveSetupScreen.jsx', 'functions/streaming.js'],
  ]) {
    check(`${flag} is honoured by the server`, codeOnly(read(server)).includes(flag));
    check(`${flag} is READ IN CODE by the client`,
      new RegExp(`${flag}\\s*!==\\s*false`).test(codeOnly(read(client))),
      `${client} enforces this gate locally — if it never reads the flag, turning the flag off does nothing and the admin toggle is decoration`);
    check(`${flag} is in the admin write allowlist`,
      codeOnly(read('functions/adminConfig.js')).includes(flag));
  }

  // The cache rule, because without it the art is re-fetched on EVERY load.
  const fb = JSON.parse(read('firebase.json'));
  check('/badges/** has a cache rule',
    (fb.hosting?.headers || []).some((h) => h.source === '/badges/**'),
    'without it the catch-all ** rule (no-store) re-downloads every crest on every page load');
}

if (process.argv.includes('--list')) ok.forEach((o) => console.log('  . ' + o));
console.log(`PASS ${ok.length}`);
if (fail.length) { console.log('FAIL ' + fail.length + ':'); fail.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('all VP mirrors agree');
