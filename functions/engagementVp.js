// Server-owned VP for engagement actions (create post, get a comment, go live,
// stream time, boost a post). Wired 2026-08-23.
//
// ## Why this exists
//
// The /prestige "How to earn VP" table (src/components/prestige/prestigeData.js
// EARN_ITEMS, amounts in src/utils/vpSystem.js VP_ACTIONS) advertised VP for
// these actions, but NOTHING awarded it: only like / daily-login / tip /
// purchase / quests were ever wired server-side. So the table promised VP that
// never arrived, the same class of problem as the dead commission copy. This
// completes the wiring so the table is true.
//
// ## Amounts and caps
//
// `vp` mirrors VP_ACTIONS (the founder's numbers). Each action carries a DAILY
// cap (VP per UTC day) so it cannot become a farming faucet — posting 500 times
// or re-going-live all day does not mint rank. The caps are the founder-tunable
// economy knob; adjust ENGAGEMENT_VP and redeploy every function that requires
// this module (see the caller list at the bottom).
//
// The amount is server-owned; a caller only NAMES the action (and, for
// stream_hour, how many whole hours). It is called from Firestore TRIGGERS and
// inside other callables, so it is a plain async helper, not an onCall.

const { FieldValue } = require('firebase-admin/firestore');
const { planOf } = require('./plan');

const { activeBonusMult } = require('./vpBonuses');

/** Free 1x / Lite 1.5x / Pro 2x. Mirrors PLAN_VP_MULTIPLIER in vpSystem.js. */
const PLAN_VP_MULTIPLIER = { free: 1, lite: 1.5, pro: 2 };

// vp = per-event award (pre plan-multiplier); dailyCapVp = max VP/UTC-day for
// this action (pre plan-multiplier, scaled by the same multiplier as the award).
// boost_post is deliberately ABSENT: purchaseBoost (functions/walletActions.js)
// already awards its VP directly, and boosts cost coins so there is no faucet to
// cap. Everything here is an action with no natural cost limiter.
const ENGAGEMENT_VP = {
  create_post: { vp: 15, dailyCapVp: 75 },   // ~5 posts/day
  get_comment: { vp: 5,  dailyCapVp: 100 },  // post author, ~20 comments/day
  go_live:     { vp: 30, dailyCapVp: 30 },   // effectively once/day
  stream_hour: { vp: 20, dailyCapVp: 100 },  // ~5 hours/day
  // ⚠⚠ A RAID IS THE MOST VALUABLE ACT IN THIS TABLE AND IS PRICED THAT WAY.
  // Founder approved the reward (2026-09-02) “to encourage streamers to be less
  // competitive and be good natured”, then asked whether 40 was too low. It was:
  // levels cost 2,000 VP early and 12,000 at the top (648,000 to reach L100), so
  // 40 was 2% of ONE early level. A host who goes live and streams three hours
  // already earns 90 from go_live + stream_hour — MORE than the whole old daily
  // cap — so raiding paid less than an hour of sitting there, for the one act that
  // costs you your entire audience.
  //
  // 150 is 3x win_match and 5x go_live, which is right: a raid is rarer and costs
  // the giver more than anything else here.
  //
  // ⚠ THE REAL ANTI-FARMING CONTROL IS STRUCTURAL, NOT THIS CAP: you may raid ONCE
  // PER STREAM (functions/raids.js), so farming means completing a whole stream
  // every time — 4,320 of them to reach L100 on raids alone. The cap exists only to
  // stop someone going live for 30 seconds on a loop.
  raid_sent:   { vp: 150, dailyCapVp: 300 },  // 2 rewarded raids/day
};

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/**
 * Credit engagement VP to `uid` for `action`, capped per action per UTC day.
 * `units` lets stream_hour award several whole hours at once. Amount is
 * plan-multiplied. Returns the VP actually granted (0 if the cap is already hit,
 * the action is unknown, or units <= 0). Never throws — engagement rewards must
 * never break the action that earned them.
 *
 * @param {FirebaseFirestore.Firestore} db  the vgrdb instance
 */
async function creditEngagementVp(db, uid, action, units = 1) {
  try {
    const cfg = ENGAGEMENT_VP[action];
    if (!cfg || !uid || units <= 0) return 0;
    const day = utcDay();
    const capRef = db.collection('vp_daily_caps').doc(`${uid}_${action}_${day}`);
    const walletRef = db.collection('wallets').doc(uid);
    const userRef = db.collection('users').doc(uid);

    return await db.runTransaction(async (tx) => {
      // All reads before any write (Firestore requirement).
      const capSnap = await tx.get(capRef);
      const userSnap = await tx.get(userRef);
      const already = capSnap.exists ? (capSnap.data().vp || 0) : 0;
      const tier = planOf(userSnap.data());
      // Rank bonus rides the SAME userSnap this transaction already read, so
      // it adds no read. MIRROR of rankVpBonus() in src/utils/rankUnlocks.js.
      const lvl = Math.max(1, Number(userSnap.data()?.vpLevel) || 1);
      const rankMult = Math.min(1.5, 1 + (lvl - 1) * 0.005);
      // VP bonus packs. Rides the SAME userSnap this transaction already read, so
      // it adds no read — the same argument as the rank bonus above. Scoped
      // packs only pay on the actions they name, hence passing `action`.
      const bonusMult = activeBonusMult(userSnap.data(), action);
      const mult = (PLAN_VP_MULTIPLIER[tier] || 1) * rankMult * bonusMult;
      const want = Math.round(cfg.vp * mult) * units;
      const cap = Math.round(cfg.dailyCapVp * mult);
      const grant = Math.min(want, Math.max(0, cap - already));
      if (grant <= 0) return 0;
      tx.set(walletRef, {
        vp: FieldValue.increment(grant),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(capRef, {
        uid, action, day, vp: already + grant,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return grant;
    });
  } catch (e) {
    console.error('creditEngagementVp failed', action, e);
    return 0;
  }
}

module.exports = { ENGAGEMENT_VP, creditEngagementVp };
