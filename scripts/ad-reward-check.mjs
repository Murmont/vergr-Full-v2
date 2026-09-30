// scripts/ad-reward-check.mjs — guards "watch 3 ads, get boost coins".
// Fails the build if:
//   - the client counter and the server that pays disagree on the numbers
//   - anything outside the boost and VP spend paths touches wallets.boostCoins
//     (a boost coin must never reach a tip, gift or anything that pays a creator)
//   - the ad reward credits normal coins or accrues revenue share again
//   - the rules stop keeping boostCoins / adProgress server-only
//   - the counter maths stops paying on the Nth ad or stops capping
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.error('FAIL ' + msg); } };

// 1. Mirrors.
const server = read('functions/admobReward.js');
const client = read('src/utils/adReward.js');
for (const name of ['DEFAULT_ADS_PER_REWARD', 'DEFAULT_REWARD_BOOST_COINS', 'DEFAULT_REWARDS_PER_DAY']) {
  const re = new RegExp(name + ' = (\\d+)');
  const a = server.match(re), b = client.match(re);
  check(a && b && a[1] === b[1], `${name} differs between server and client`);
}
const list = (src) => (src.match(/DEFAULT_REWARD_COUNTRIES = \[([^\]]*)\]/) || [, ''])[1].replace(/\s/g, '');
check(list(server) && list(server) === list(client), 'DEFAULT_REWARD_COUNTRIES differs between server and client');

// 2. Who may touch boostCoins on the server. The CREDIT-only files (index.js
// plan bonus, hypeTrain.js, orders.js / playBilling.js / huaweiBilling.js promo
// bonus) are checked in 2b.
const ALLOWED = new Set(['boostCoins.js', 'admobReward.js', 'boosts.js', 'vpBonuses.js', 'streamBoost.js', 'walletActions.js', 'streamingBoost.js', 'index.js', 'hypeTrain.js', 'orders.js', 'playBilling.js', 'huaweiBilling.js', 'planBonus.js']);
// Admin → Economy → Payments shows the buyer's boost-coin balance.
const READ_ONLY = new Set(['paymentAdmin.js']);
for (const f of readdirSync(path.join(root, 'functions')).filter((x) => x.endsWith('.js'))) {
  const src = read('functions/' + f);
  const touches = /boostCoins/.test(src.replace(/\/\/.*$/gm, ''));
  // READ-ONLY readers (they display the balance, never write it) are allowed
  // only while no write form (boostCoins: ...) appears in them.
  if (touches && READ_ONLY.has(f)) {
    // A write is a line that mentions boostCoins AND a Firestore write helper.
    const writes = src.split('\n').some((l) => l.includes('boostCoins') && /FieldValue|\.set\(|\.update\(/.test(l));
    check(!writes, `functions/${f} is read-only for boostCoins but writes it`);
    continue;
  }
  if (touches) check(ALLOWED.has(f), `functions/${f} references boostCoins but is not a boost/VP spend path`);
}
for (const f of ['boosts.js', 'vpBonuses.js', 'streamBoost.js', 'walletActions.js', 'streamingBoost.js']) {
  check(read('functions/' + f).includes("require('./boostCoins')"), `functions/${f} no longer spends through boostCoins.js`);
}

// 2b. The Lite/Pro plan bonus pays BOOST coins, never tippable ones (founder,
// 2026-09-27: bonus coins buy boosts and VP packs; a tipped coin becomes money
// Vergr owes a creator). It wrote `balance` until 2026-09-27. Since 2026-09-28 it
// is paid per paid period by functions/planBonus.js, which every rail calls.
{
  const body = read('functions/planBonus.js').replace(/\/\/.*$/gm, '');
  check(body.includes('boostCoins: FieldValue.increment(coins)'), 'plan bonus no longer credits boostCoins');
  check(!/balance:\s*FieldValue\.increment/.test(body) && !/totalEarned/.test(body), 'plan bonus credits the tippable balance or counts as earned');
  for (const f of ['subscriptions.js', 'orders.js', 'playBilling.js', 'huaweiBilling.js', 'adminSubscriptions.js', 'index.js']) {
    check(read('functions/' + f).includes("require('./planBonus')"), `functions/${f} no longer grants the plan bonus through planBonus.js`);
  }
}
// The hype train's boost branch credits boost coins (founder, 2026-09-27).
check(read('functions/hypeTrain.js').includes('boostCoins: FieldValue.increment(bonus.boostCoins)'),
  'hypeTrain.js no longer credits boostCoins on the boost branch');

// 3. The ad reward pays boost coins only.
const code = server.replace(/\/\/.*$/gm, '');
check(!/earnedCoinCredit|settleEarnedShare/.test(code), 'admobReward.js credits normal coins or accrues revenue share');
check(!/balance\s*:/.test(code), 'admobReward.js writes wallets.balance');
check(code.includes('boostCoins = FieldValue.increment(step.coins)'), 'admobReward.js no longer credits boostCoins');

// 4. Rules.
const rules = read('firestore.rules');
const walletBlock = rules.slice(rules.indexOf('match /wallets/{userId}'), rules.indexOf('match /daily_caps/{day}'));
check(/'boostCoins', 'adProgress'/.test(walletBlock), 'wallets rules no longer lock boostCoins / adProgress on update');
check(/keys\(\)\.hasAny\(\['boostCoins', 'adProgress'\]\)/.test(walletBlock), 'wallets rules allow boostCoins / adProgress on create');

// 5. Counter maths (the real function, not a copy).
const require = createRequire(import.meta.url);
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin/firestore') return { getFirestore: () => ({}), FieldValue: {} };
  if (req === 'firebase-functions/v2') return { https: { onRequest: () => () => {} }, logger: {} };
  if (req === 'axios') return {};
  return origLoad.call(this, req, ...rest);
};
const { nextAdProgress, adRewardConfig } = require(path.join(root, 'functions/admobReward.js'))._internal;
Module._load = origLoad;
const conf = adRewardConfig({});
let p, paid = 0, statuses = [];
for (let i = 0; i < conf.adsPerReward * conf.rewardsPerDay + 2; i++) {
  const r = nextAdProgress(p, '2026-01-01', conf);
  statuses.push(r.status); paid += r.coins; p = r.progress;
}
check(statuses[conf.adsPerReward - 1] === 'rewarded' && statuses.slice(0, conf.adsPerReward - 1).every((s) => s === 'counted'),
  'the reward is not paid on exactly the Nth ad');
check(paid === conf.rewardCoins * conf.rewardsPerDay, 'daily boost coins exceed rewardsPerDay x rewardCoins');
check(statuses.slice(-2).every((s) => s === 'capped'), 'views after the daily cap are not capped');
check(nextAdProgress({ day: '2026-01-01', watched: 2, rewardsToday: conf.rewardsPerDay }, '2026-01-02', conf).status === 'counted',
  'the counter does not reset on a new UTC day');

console.log(`ad-reward-check: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
