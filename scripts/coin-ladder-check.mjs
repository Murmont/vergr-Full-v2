// ONE COIN LADDER, EVERYWHERE. This proves it.
//
// ── THE BUG THIS EXISTS TO STOP ─────────────────────────────────────
//
// `functions/playBilling.js` PLAY_PRODUCTS carried a SECOND, LARGER ladder
// (85/425/1000/2100/4250/8500/12500/21000) left from an abandoned design where
// Play got different quantities. It was live and it was wrong twice over:
//
//   1. The shelf showed 78 coins (`ACTIVE_COIN_PACKS = COIN_PACKS`) and the
//      server granted 85. A displayed-versus-granted mismatch is a documented
//      Play rejection reason.
//   2. Vergr netted $0.84 on a $0.99 sale — absorbing Google's cut and
//      discounting on top. Short $0.15 on Starter, $37.50 on Ascendant.
//
// Nothing caught it because the two files never referred to each other. This
// script is that reference.
//
// ⚠ functions/ CANNOT import from src/ (different module system, and src is not
// packaged into the deploy), which is exactly why the drift was possible. So
// this reads both files as TEXT and compares the numbers. That is deliberate:
// a check that imports one side would only prove that side agrees with itself.
//
//   node scripts/coin-ladder-check.mjs
//   node scripts/coin-ladder-check.mjs --list
import { readFileSync } from 'node:fs';

const LIST = process.argv.includes('--list');

// src/utils/vpSystem.js — the shelf. This is the authority.
const web = {};
{
  const src = readFileSync('src/utils/vpSystem.js', 'utf8');
  const block = src.slice(src.indexOf('export const COIN_PACKS'));
  const re = /id:\s*'([a-z]+)'[^}]*?coins:\s*(\d+)[^}]*?vpBonus:\s*(\d+)[^}]*?priceUSD:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(block))) web[m[1]] = { coins: +m[2], vpBonus: +m[3], priceUSD: +m[4] };
}

// functions/playBilling.js — what the server actually GRANTS on redemption.
const play = {};
{
  const src = readFileSync('functions/playBilling.js', 'utf8');
  const block = src.slice(src.indexOf('const PLAY_PRODUCTS'));
  const re = /coins_([a-z]+):\s*\{\s*coins:\s*(\d+),\s*vpBonus:\s*(\d+),\s*priceUSD:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(block))) play[m[1]] = { coins: +m[2], vpBonus: +m[3], priceUSD: +m[4] };
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

check('web ladder parsed', Object.keys(web).length === 8, `${Object.keys(web).length} packs`);
check('play ladder parsed', Object.keys(play).length === 8, `${Object.keys(play).length} products`);

for (const id of Object.keys(web)) {
  const w = web[id];
  const p = play[id];
  if (!p) { check(`coins_${id} exists on Play`, false, 'missing from PLAY_PRODUCTS'); continue; }
  check(`coins_${id} grants the shelf quantity`, w.coins === p.coins,
    `shelf ${w.coins} vs granted ${p.coins}`);
  check(`coins_${id} VP bonus matches`, w.vpBonus === p.vpBonus,
    `shelf ${w.vpBonus} vs granted ${p.vpBonus}`);
  check(`coins_${id} shelf price matches`, w.priceUSD === p.priceUSD,
    `shelf $${w.priceUSD} vs $${p.priceUSD}`);
}

// ── THE PLAY PRICE INVARIANT ────────────────────────────────────────
//
// ⚠⚠ THE RULE IS THE PER-COIN FLOOR, NOT THE SHELF PRICE. Two earlier versions
// of this check got it wrong, and the live Play Console is the proof of what is
// actually correct:
//
//   Play Console, Starter Pack, United States = USD 1.09
//
// $1.09 is exactly `playPriceFor(78)`. It nets $0.9265, which is LESS than the
// $0.99 shelf price — and that is fine, because the invariant a coin has to
// satisfy is the rate it REDEEMS at, not the rate one particular pack sells at.
// CLAUDE.md: a hard floor per coin that "holds WORLDWIDE because it is the rate
// the coin redeems at". Entry packs sell ABOVE the floor ($0.012692/coin);
// bulk packs approach it ($0.011627 at Ascendant).
//
// So a Console price is correct when NET PER COIN >= the floor. Asserting
// "nets the shelf price" instead produced $1.19 for Starter, which contradicts
// what is actually live and would have had the founder re-enter every price.
//
// Mirrors playPriceFor() in src/utils/storePricing.js. That function is the
// authority; this reproduces it so a drift is caught.
const FEE = 0.15;
const FLOOR = 0.011628;                     // TARGET_NET_USD_PER_COIN
const charmRound = (v) => {
  if (v < 5) return Math.ceil((v - 0.09) * 10) / 10 + 0.09;
  if (v < 100) return Math.floor(v) + 0.99 >= v ? Math.floor(v) + 0.99 : Math.floor(v) + 1.99;
  return Math.ceil(v / 10) * 10 - 0.01;
};
const playPriceFor = (coins) => +charmRound((coins * FLOOR) / (1 - FEE)).toFixed(2);

// What is ACTUALLY set in Play Console today, so the repo records it instead of
// re-deriving it every time. Verified against Console (US) 2026-08-28.
const LIVE_CONSOLE_US = { starter: 1.09 };

for (const id of Object.keys(web)) {
  const w = web[id];
  const price = playPriceFor(w.coins);
  const netPerCoin = (price * (1 - FEE)) / w.coins;
  check(`coins_${id} Console price clears the per-coin floor`,
    netPerCoin >= FLOOR,
    `Console $${price.toFixed(2)} -> nets $${netPerCoin.toFixed(6)}/coin vs floor $${FLOOR}`);
  if (LIVE_CONSOLE_US[id] != null) {
    check(`coins_${id} matches what is live in Play Console (US)`,
      LIVE_CONSOLE_US[id] === price,
      `Console shows $${LIVE_CONSOLE_US[id].toFixed(2)}, formula gives $${price.toFixed(2)}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// STORE ITEMS: 9 VP bonus packs + 7 boosts, priced in BOTH coins and cash.
// ════════════════════════════════════════════════════════════════════
//
// ── THE BUG THIS HALF EXISTS TO STOP ────────────────────────────────
//
// The cash price was first derived from the coin price, via
// playPriceFor(item.coins). That is the COIN REDEMPTION rate, and it produced:
//
//     vpb_flash      75 coins  ->  $1.09
//     coins_starter  78 coins  ->  $1.09      <- the same money
//
// Nobody would ever buy the first one: for identical money you take the coin
// pack, buy the bonus with the coins, and keep 3 coins over. It also says a coin
// is worth nothing beyond its face value, which undoes the entire ladder.
//
// The first fix for that was also wrong, and is worth recording because it looks
// right: anchor on the coin's NET floor ($0.011628, what a coin must be worth
// AFTER Google's cut) and double it. That gave flash = $2.09, which is WORSE for
// the buyer than the $1.09 it replaced. For $0.99 they buy 78 coins, spend 75 on
// the bonus and keep 3. A cash price above the retail cost of its own coins is a
// price nobody can rationally pay.
//
// THE RULE:
//
//     priceUSD = charmRound(max(coins x RETAIL_COIN_USD, $0.99))
//     RETAIL_COIN_USD = $0.99 / 78 = the ladder's WORST per-coin rate
//
// The anchor is what a buyer ACTUALLY PAYS for a coin, not what a coin nets.
// functions/orders.js already uses the identical number as CUSTOM_COIN_PRICE_USD
// so that a custom amount cannot undercut a pack; this is the mirror of it.
//
// A coin therefore has ONE value on both routes, which is the whole answer to
// "are you trying to devalue the coins": no, the cash price is DERIVED from the
// coin price, at retail.
//
// The $0.99 term is Google Play's US minimum. It binds on everything under 78
// coins, which is why five small items all sit at $0.99 in cash. That is the
// floor's doing, not a designed premium, and on those items coins really are the
// better buy. The card shows both prices, so the buyer can see it.
//
// ── AND THE SIX PLACES IT HAS TO BE THE SAME NUMBER ─────────────────
//
// src/utils/{vpBonuses,boosts}.js   the shelf
// functions/{vpBonuses,boosts}.js   what the COIN purchase charges
// functions/playBilling.js          what the PLAY purchase grants
// functions/orders.js               what the CARD purchase charges
//
// functions/ cannot import from src/, which is exactly why they can drift, so
// all six are read as TEXT and compared.
const ITEM_FEE = 0.15;
const ITEM_MIN_USD = 0.99;   // Google Play's US minimum
const RETAIL_COIN_USD = 0.99 / 78;   // Starter, the ladder's worst per-coin rate
const COIN_EQUIV = (coins) => coins * RETAIL_COIN_USD;
const expectedItemUSD = (coins) => +charmRound(Math.max(COIN_EQUIV(coins), ITEM_MIN_USD)).toFixed(2);

/** Pull { id: {coins, priceUSD} } out of a table, wherever it lives. */
function readItems(file, startMarker, idKey = 'id') {
  const src = readFileSync(file, 'utf8');
  const i = src.indexOf(startMarker);
  if (i < 0) return null;
  const block = src.slice(i, src.indexOf('];', i) + 2);
  const out = {};
  const re = new RegExp(idKey + String.raw`:\s*'([a-z_]+)'[^}]*?coins:\s*(\d+)[^}]*?priceUSD:\s*([\d.]+)`, 'g');
  let m;
  while ((m = re.exec(block))) out[m[1]] = { coins: +m[2], priceUSD: +m[3] };
  return out;
}

/** The two server maps are objects keyed by Play product id, not arrays. */
function readItemMap(file, startMarker) {
  const src = readFileSync(file, 'utf8');
  const i = src.indexOf(startMarker);
  if (i < 0) return null;
  const block = src.slice(i, src.indexOf('};', i) + 2);
  const out = {};
  const re = /(?:vpb|boost)_[a-z_]+:\s*\{[^}]*?id:\s*'([a-z_]+)'[^}]*?priceUSD:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = { priceUSD: +m[2] };
  return out;
}

const shelfBonus  = readItems('src/utils/vpBonuses.js', 'export const VP_BONUS_PACKS');
const shelfBoost  = readItems('src/utils/boosts.js', 'export const BOOSTS');
const srvBonus    = readItems('functions/vpBonuses.js', 'const VP_BONUS_PACKS = [');
const srvBoost    = readItems('functions/boosts.js', 'const BOOSTS = [');
const playItems   = readItemMap('functions/playBilling.js', 'const PLAY_ITEM_PRODUCTS = {');
const cardItems   = readItemMap('functions/orders.js', 'const STORE_ITEMS = {');

check('bonus shelf parsed', shelfBonus && Object.keys(shelfBonus).length === 9,
  `${Object.keys(shelfBonus || {}).length} packs`);
check('boost shelf parsed', shelfBoost && Object.keys(shelfBoost).length === 7,
  `${Object.keys(shelfBoost || {}).length} boosts`);
check('Play item map parsed', playItems && Object.keys(playItems).length === 16,
  `${Object.keys(playItems || {}).length} products`);
check('card item map parsed', cardItems && Object.keys(cardItems).length === 16,
  `${Object.keys(cardItems || {}).length} SKUs`);

const allShelf = { ...(shelfBonus || {}), ...(shelfBoost || {}) };
const allServer = { ...(srvBonus || {}), ...(srvBoost || {}) };

for (const [id, it] of Object.entries(allShelf)) {
  // 1. every item HAS a cash price
  check(`${id} has a cash price`, typeof it.priceUSD === 'number' && it.priceUSD > 0,
    `priceUSD ${it.priceUSD}`);

  // 2. it is the rule, not a hand-typed number
  const want = expectedItemUSD(it.coins);
  check(`${id} cash price follows the rule`, it.priceUSD === want,
    `${it.coins} coins -> expected $${want.toFixed(2)}, table says $${it.priceUSD.toFixed(2)}`);

  // 3. Cash must never UNDERCUT the coin route, or coins are devalued: the cash
  //    price is at least what its coins cost at retail.
  const equiv = COIN_EQUIV(it.coins);
  check(`${id} cash does not undercut coins`, it.priceUSD >= +equiv.toFixed(2) - 0.005,
    `${it.coins} coins cost $${equiv.toFixed(2)} at retail, cash price $${it.priceUSD.toFixed(2)}`);

  // 4. it clears Google's US floor once the fee is grossed up, and still nets
  //    at least the shelf price. (Unlike a coin pack, whose invariant is the
  //    per-coin floor, an item's invariant is its own price.)
  const console_ = +charmRound(it.priceUSD / (1 - ITEM_FEE)).toFixed(2);
  check(`${id} clears the Play US minimum`, console_ >= ITEM_MIN_USD,
    `Console $${console_.toFixed(2)} vs minimum $${ITEM_MIN_USD}`);
  check(`${id} Console price nets the shelf price`, console_ * (1 - ITEM_FEE) >= it.priceUSD - 0.005,
    `Console $${console_.toFixed(2)} nets $${(console_ * (1 - ITEM_FEE)).toFixed(2)} vs shelf $${it.priceUSD.toFixed(2)}`);

  // 5. all four mirrors agree
  const srv = allServer[id];
  check(`${id} server coin table matches the shelf`,
    !!srv && srv.priceUSD === it.priceUSD && srv.coins === it.coins,
    srv ? `server ${srv.coins}c/$${srv.priceUSD} vs shelf ${it.coins}c/$${it.priceUSD}` : 'missing');
  check(`${id} Play product matches the shelf`,
    !!playItems?.[id] && playItems[id].priceUSD === it.priceUSD,
    playItems?.[id] ? `Play $${playItems[id].priceUSD}` : 'missing from PLAY_ITEM_PRODUCTS');
  check(`${id} card SKU matches the shelf`,
    !!cardItems?.[id] && cardItems[id].priceUSD === it.priceUSD,
    cardItems?.[id] ? `card $${cardItems[id].priceUSD}` : 'missing from STORE_ITEMS');
}

// ⚠⚠ THE ASSERTION THAT CATCHES BOTH BUGS: an item must never cost MORE in cash
// than the cheapest coin pack that would buy it outright. Fail this and the cash
// button is irrational, because the buyer can pay less for the coins, buy the
// same item, and keep the change. Both wrong pricings above failed it; the
// retail-anchored one cannot, by construction.
//
// A TIE passes on purpose. Under 78 coins the $0.99 Play minimum and the Starter
// pack are the same money, so the buyer gets a few spare coins by routing
// through the pack. That is a real reason to prefer coins, not a defect.
for (const [id, it] of Object.entries(allShelf)) {
  const cheapestPack = Object.values(web)
    .filter((p) => p.coins >= it.coins)
    .sort((a, b) => a.priceUSD - b.priceUSD)[0];
  if (!cheapestPack) continue;
  check(`${id} is not dearer than a pack that buys it`,
    it.priceUSD <= cheapestPack.priceUSD,
    `item $${it.priceUSD.toFixed(2)} vs ${cheapestPack.coins} coins for $${cheapestPack.priceUSD.toFixed(2)}`);
}

// ── EVERY SKU MUST RESOLVE TO A COMPLETE BASKET ROW ────────────────
//
// ⚠ THE BUG THIS EXISTS TO STOP, and it shipped: the basket's line renderer
// resolved a coin pack and branched at each field. Forty lines below the
// resolve, the line TOTAL still read `pack.priceUSD * line.qty`. For a store
// item there is no pack, so adding a boost to the basket dereferenced null and
// took the whole cart to the ErrorBoundary. A green build and a green guard both
// said it was fine, because neither had ever resolved a boost SKU.
//
// The renderer now flattens both kinds into ONE non-null row up front, and this
// asserts every SKU the shop can add produces every field that row needs.
const { storeItemBySku, bonusSku, boostSku, isStoreItemSku } =
  await import('../src/utils/storeItems.js');

const ROW_FIELDS = ['name', 'detail', 'priceUSD', 'coins', 'kind', 'tone'];
for (const [id, it] of Object.entries(allShelf)) {
  const sku = shelfBonus?.[id] ? bonusSku(id) : boostSku(id);
  const row = storeItemBySku(sku);
  check(`${sku} resolves to a basket row`, !!row, row ? 'ok' : 'storeItemBySku returned null');
  if (!row) continue;
  const missing = ROW_FIELDS.filter((f) => row[f] === undefined || row[f] === null);
  check(`${sku} row has every field the basket renders`, missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : ROW_FIELDS.join(', '));
  check(`${sku} row price matches the shelf`, row.priceUSD === it.priceUSD,
    `row $${row.priceUSD} vs shelf $${it.priceUSD}`);
}

// A coin pack must NOT look like a store item, or the cart would resolve it
// through the wrong branch and the Play id would be built wrong.
for (const id of Object.keys(web)) {
  check(`coin SKU ${id} is not mistaken for a store item`, isStoreItemSku(id) === false,
    isStoreItemSku(id) ? 'isStoreItemSku said true' : 'correctly not an item');
}


// ── NO GAMING LANGUAGE IN THE PLAY CONSOLE DESCRIPTIONS ─────────────
//
// ⚠⚠ `desc` ON A BONUS PACK AND `short` ON A BOOST ARE RENDERED NOWHERE IN THE
// APP. scripts/playPricing.mjs is their ONLY consumer, and it writes them into
// docs/play/play-products.csv, which is what gets typed into Play Console and
// what Google shows a buyer in its own purchase sheet. That makes them the
// highest-risk copy in the repo and the least-read.
//
// It shipped `Double VP for a full day, whenever you play it.` Founder,
// 2026-09-11: *"Play what? it seems like you are trying to make it sound like
// its gaming again"*. The string had only become customer-facing the day before,
// when the generator stopped synthesising descriptions from mult+hours and
// started using the authored ones, so nothing had ever read it in that context.
//
// Vergr is a live streaming and creator platform. Google Play can pull the app
// over anything tournament-shaped (founder, 2026-09-10) and the whole of 1.0.208
// existed to strip that vocabulary out of the bundle. A product description is a
// far shorter path to a reviewer than a bundle string is.
//
// Name the platform's own actions instead: posting, going live, streaming,
// watching, commenting.
{
  const [{ VP_BONUS_PACKS: shelfB }, { BOOSTS: shelfBo }] = await Promise.all([
    import('../src/utils/vpBonuses.js'),
    import('../src/utils/boosts.js'),
  ]);

  const FORBIDDEN = [
    'play', 'playing', 'player', 'players', 'played',
    'game', 'games', 'gaming', 'gamer', 'gamers',
    'match', 'matches', 'lobby', 'session', 'grind',
    'quest', 'loot', 'esports', 'tournament', 'tournaments',
    'compete', 'competition', 'prize', 'bracket', 'wager', 'betting',
  ];
  // Word boundaries, so `display`, `replay` and `gameplay` cannot trip `play`
  // and a legitimate compound is not caught by a bare substring test.
  const RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i');

  const SHIPPED = [
    ...shelfB.map((b) => [`vpb_${b.id}`, 'name', b.name]),
    ...shelfB.map((b) => [`vpb_${b.id}`, 'desc', b.desc]),
    ...shelfBo.map((b) => [`boost_${b.id}`, 'name', b.name]),
    ...shelfBo.map((b) => [`boost_${b.id}`, 'short', b.short]),
  ];

  for (const [sku, field, text] of SHIPPED) {
    const hit = String(text || '').match(RE);
    check(`${sku}.${field} has no gaming language`, !hit,
      hit ? `"${text}" contains "${hit[0]}"` : String(text));
  }
}


// ── NO EARN-BY-COMPETING COPY IN THE HELP CENTRE ────────────────────
//
// ⚠⚠ The help articles ship INSIDE the Play build. 2026-09-13, while verifying
// the 1.0.210 AAB, two earning articles still told users to "win the pot" in
// Brawl 1v1s and "predict match winners to earn from the prediction pool", the
// age article said Vergr "involves real-money skill competition", and a getting-
// started article said Coins earned "by competing" could be cashed out. All of
// it predates 1.0.208 and survived that sweep because it was help copy, not a
// screen. This is wagering and prize-competition copy in a Play app.
//
// A bare `compete` ban cannot work here: the "Is VERGR gambling?" and "Is VERGR
// legit?" articles must NAME what Vergr does not offer. So this bans the
// AFFIRMATIVE phrases, and strips line comments first (one article documents
// the removed Champion Picks copy in a comment).
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const HELP = 'src/screens/marketing/help/articles';
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const FILES = [...walk(HELP), 'src/components/LoadingScreen.jsx'];
  const EARN_BY_COMPETING = /\b(win the pot|for the pot|champion picks?|prediction pool|predict(?:ing)? match|real-money skill|compete to earn|by competing|you compete|competing is free|brawl|trophy|matchmaker|compete as a team|competes well|fix matches|result reporting|high-stakes competition|competition fair)\b/i;
  let hits = 0;
  for (const f of FILES) {
    const code = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const hit = code.match(EARN_BY_COMPETING);
    if (hit) { hits++; check(`${f} has no earn-by-competing copy`, false, `contains "${hit[0]}"`); }
  }
  check(`help centre (${FILES.length} files) has no earn-by-competing copy`, FILES.length > 100 && hits === 0,
    FILES.length > 100 ? `${hits} file(s) hit` : `only ${FILES.length} files found, the walk is broken`);
}


const failed = results.filter((r) => !r.ok);
if (LIST) for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}  — ${r.detail}`);
console.log(`\ncoin-ladder-check: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const r of failed) console.error(`FAIL ${r.name}\n     ${r.detail}`);
  process.exit(1);
}
