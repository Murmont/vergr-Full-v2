// functions/tournaments.js
// Authoritative tournament backend. All coin movement (entry escrow,
// prize payout, mod cut) runs server-side inside transactions so the
// client SDK can't be tricked into crediting balances directly.
//
// Phase 1 (this module):
//   - createTournamentSecure   — validates Riot-disclosed limits + plan tier.
//   - joinTournamentSecure     — escrows entry fee inside a transaction.
//   - leaveTournamentSecure    — refunds while status='open'.
//   - startTournamentSecure    — host-only; generates bracket + match docs.
//   - reportMatchResultSecure  — player-side report; advances on agreement.
//   - finalizeTournamentSecure — pays winners per PRIZE_DISTRIBUTION.
//   - resolveTournamentDispute — admin override when reports disagree.
//
// Disputes:
//   When two participants in a match each report a different winner, the
//   match enters status='disputed'. Bracket does NOT advance until an admin
//   calls resolveTournamentDispute (default policy: 24h SLA, no auto-rematch).
//
// Idempotency:
//   - reportMatchResultSecure uses match-level transaction + per-uid report
//     doc so duplicate calls from the same player are no-ops.
//   - finalizeTournamentSecure flips tournament.status to 'completed' inside
//     the same tx that writes payouts, so retries can't double-pay.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const {
  BRACKET_TYPES,
  isBracketTypeAllowed,
  validateTournamentLimits,
  computePrizeBreakdown,
  MAX_ENTRY_FEE_COINS,
  buildSingleElimRound1,
  buildDoubleElimBracket,
  buildRoundRobinSchedule,
  buildBattleRoyaleGames,
  buildSwissRound1,
  buildNextSwissRound,
} = require('./tournamentRules');

const { gameById } = require('./games');

// Generates a short, human-readable, ALL-CAPS unique lobby code that both
// players display in-game (chat / name / lobby name / match screen — depends
// on verifyMethod). OCR uses this code to confirm both players are in the
// same lobby BEFORE the match is allowed to count.
//
// 7 chars from a 32-char ambiguity-free alphabet ≈ 2^35 entropy — plenty for
// per-match uniqueness without typos. Format: VERGR-XXXXXXX.
function makeLobbyCode() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let s = '';
  for (let i = 0; i < 7; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `VERGR-${s}`;
}

// Returns { verifyMethod, detection } for the game on a tournament doc.
function gameVerifyProfile(gameLabel) {
  const g = gameById(gameLabel);
  if (!g) return { verifyMethod: 'chat', detection: 'manual' };
  return { verifyMethod: g.verifyMethod, detection: g.detection };
}

// ─── Helpers ──────────────────────────────────────────────────────────

const HttpsError = functions.https.HttpsError;

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return uid;
}

async function requireAdmin(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
}

async function getUserPlan(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return 'free';
  const d = snap.data();
  // `subscription` (string) is what the purchase flows actually write; `tier`/
  // `plan` are legacy fallbacks. Reading only the latter treated every paying
  // user as free, blocking them from creating their plan's tournaments.
  const s = d.subscription;
  const t = (typeof s === 'string' ? s : (s && s.tier)) || d.tier || d.plan || 'free';
  return t === 'lite' || t === 'pro' ? t : 'free';
}

// Standard match doc id used everywhere.
const matchDocId = (round, matchNumber) => `r${round}_m${matchNumber}`;

// Month key for Vanguard monthly-action tracking. UTC because the
// distribution cron also runs in UTC. Format: "YYYY-MM".
const monthKeyForNow = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// ─── 1. createTournamentSecure ────────────────────────────────────────

// ── RETIRED 2026-08-16 ────────────────────────────────────────────────
// Tournaments do not exist as a product. Unrouting the screens did not stop
// these callables being invoked directly, and the money-moving ones could still
// escrow a user's coins. They now throw.
//
// Bodies are RETAINED, not deleted, exactly as requestWithdrawal was: the
// bracket, escrow and payout logic is still what the settle paths run on.
//
// Settle/refund paths stay LIVE on purpose so nothing already escrowed is
// stranded (leaveTournamentSecure, leaveBrawlQueue, finalizeTournamentSecure,
// reportMatchResultSecure, reportGameResultSecure, resolveTournamentDispute).
const TOURNAMENTS_RETIRED = () => new HttpsError(
  'failed-precondition',
  'Tournaments have been retired and are no longer available on Vergr.',
);

exports.createTournamentSecure = functions.https.onCall({ secrets: ['VERGR_GEO_TOKEN'] }, async (request) => {
  throw TOURNAMENTS_RETIRED();
  const uid = requireAuth(request);

  // Compliance gates — tournaments require KYC and a supported region.
  const { assertRegionAllowed } = require('./geo');
  const { assertKycVerified }   = require('./didit');
  await assertRegionAllowed(request);
  await assertKycVerified(uid);

  const {
    name, description = '', game,
    entryFee = 0, maxParticipants, type,
    squadId = null, streamRequired = false,
    brGameCount = null, swissRounds = null,
    scheduledStart = null,
    visibility = 'public',
    category = 'competitive', // cosmetic flavour (competitive/casual/community)
    titleColor = null, // host-chosen highlight colour (hex) for accented title words
    accentWords = [], // indices of title words painted with titleColor
    bannerUrl = null,
    invitedUserIds = [],
    // DS2 — optional "hosted by squad" attribution. The host can mark one of
    // their own squads as the organiser so it surfaces in that squad's
    // members' "My squads' events" filter. Distinct from squadId (which is
    // the competing squad in squad-mode tournaments).
    hostSquadId = null,
    // Phase 1 — series + seeding.
    seriesFormat = 'bo1',           // 'bo1' | 'bo3' | 'bo5'
    seriesFormatByRound = null,     // optional { 1:'bo1', 2:'bo3', 3:'bo5' }
    seedingMode = 'random',         // 'random' | 'manual' | 'rating'
    // Phase 2 — multi-stage tournaments. If non-null, this is the source
    // of truth for stage 1+'s format/seedingMode/seriesFormat. The legacy
    // top-level `type`/`seriesFormat`/`seedingMode` MUST equal stages[0]'s
    // values so existing code that reads tournament.type keeps working.
    stages = null,
    // Ticketed-event funding model (default). 'ticketed' = fans buy spectator
    // tickets, competitors register free, purse is host/ticket-funded.
    // 'prize_pool' = legacy pay-to-enter winner-takes-pool (gated OFF by
    // default via app_config.entryFeeTournamentsEnabled — see below).
    fundingModel = 'ticketed',
    ticket = null,            // { priceCoins, capacity, purseSlicePct, audience, seasonPassEnabled }
    hostTopUpCoins = 0,       // host pre-funds the purse from their own wallet
  } = request.data || {};

  if (typeof name !== 'string' || name.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'Name too short');
  }
  if (!game || typeof game !== 'string') {
    throw new HttpsError('invalid-argument', 'Game required');
  }
  const cfg = BRACKET_TYPES[type];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown bracket type');
  if (!cfg.allowedPlayers.includes(maxParticipants)) {
    throw new HttpsError('invalid-argument', `Invalid maxParticipants for ${type}`);
  }

  const plan = await getUserPlan(uid);
  if (!isBracketTypeAllowed(type, plan)) {
    throw new HttpsError('permission-denied', `${type} requires the ${cfg.minPlan} plan`);
  }

  // ─── Funding model ─────────────────────────────────────────────────
  // 'ticketed' (default): NO entry fee. Spectators buy tickets; competitors
  //   register free. Purse comes from a ticket-sale slice + optional host
  //   top-up. This is the non-gambling path.
  // 'prize_pool' (legacy): pay-to-enter winner-takes-pool. Gated OFF for
  //   everyone except admins unless app_config/general.entryFeeTournamentsEnabled
  //   is true. Code is preserved (never delete a feature) but disabled by default.
  const model = fundingModel === 'prize_pool' ? 'prize_pool' : 'ticketed';
  let effectiveEntryFee = Math.floor(entryFee) || 0;
  let normalizedTicket = null;
  let topUp = Math.max(0, Math.floor(hostTopUpCoins) || 0);

  if (model === 'prize_pool') {
    // The user doc was only read for the admin bypass that no longer exists.
    const cfgSnap = await db.collection('app_config').doc('general').get();
    const legacyEnabled = cfgSnap.exists && cfgSnap.data()?.entryFeeTournamentsEnabled === true;
    // NO ADMIN BYPASS. It used to read `!isAdmin && !legacyEnabled`, which meant
    // any admin could create a pay-to-enter, winner-takes-pool tournament at any
    // time, silently. Once the app is on Google Play that is a real-money contest
    // surface, and Play assesses what an app CAN do, not what it usually does —
    // that category needs per-country gambling licensing we do not have.
    //
    // The flag is now the single switch: flipping app_config/general
    // .entryFeeTournamentsEnabled is a deliberate, auditable act, whereas an
    // ambient role check is not. The feature is preserved, not deleted.
    if (!legacyEnabled) {
      throw new HttpsError('failed-precondition',
        'Pay-to-enter prize-pool tournaments are disabled. Create a ticketed event instead — fans buy tickets and competitors play free.');
    }
    topUp = 0; // legacy model funds the purse from entry fees, not a top-up
    const limit = validateTournamentLimits({ entryFee: effectiveEntryFee, maxParticipants });
    if (!limit.ok) throw new HttpsError('invalid-argument', limit.error);
  } else {
    // Ticketed: entry fee is meaningless — force to 0 (the legal invariant:
    // competitors never pay).
    effectiveEntryFee = 0;
    const tk = (ticket && typeof ticket === 'object') ? ticket : {};
    const priceCoins = Math.max(0, Math.floor(tk.priceCoins) || 0);
    if (priceCoins > MAX_ENTRY_FEE_COINS) {
      throw new HttpsError('invalid-argument',
        `Ticket price can't exceed ${MAX_ENTRY_FEE_COINS.toLocaleString()} coins.`);
    }
    // Capacity drives concurrent-viewer / server-load planning. Default to a
    // generous spectator cap; never below 1.
    const capacity = Math.max(1, Math.min(100000, Math.floor(tk.capacity) || 1000));
    const purseSlicePct = Math.max(0, Math.min(100, Math.floor(tk.purseSlicePct) || 0));
    const audience = ['public', 'followers', 'subscribers', 'invite'].includes(tk.audience) ? tk.audience : 'public';
    normalizedTicket = {
      priceCoins, capacity, sold: 0, purseSlicePct, audience,
      seasonPassEnabled: !!tk.seasonPassEnabled,
    };
  }

  // Phase 1 — series-format + seeding-mode validation.
  const { validateSeriesFormat } = require('./tournamentSeries');
  const sv = validateSeriesFormat(seriesFormat, game, type);
  if (!sv.ok) throw new HttpsError('invalid-argument', sv.error);
  if (seriesFormatByRound && typeof seriesFormatByRound === 'object') {
    for (const [, fmt] of Object.entries(seriesFormatByRound)) {
      const rv = validateSeriesFormat(fmt, game, type);
      if (!rv.ok) throw new HttpsError('invalid-argument', `seriesFormatByRound: ${rv.error}`);
    }
  }
  if (!['random', 'manual', 'rating'].includes(seedingMode)) {
    throw new HttpsError('invalid-argument', 'seedingMode must be random | manual | rating.');
  }

  // Phase 2 — multi-stage validation. If stages provided, validate + force
  // top-level fields to match stages[0] so legacy readers behave correctly.
  let normalizedStages = null;
  if (stages) {
    const { validateStages } = require('./tournamentStages');
    const v = validateStages(stages, game);
    if (!v.ok) throw new HttpsError('invalid-argument', `stages: ${v.error}`);
    normalizedStages = stages;
    const s0 = stages[0];
    if (s0.type !== type) {
      throw new HttpsError('invalid-argument',
        `stages[0].type (${s0.type}) must match top-level type (${type}).`);
    }
    if ((s0.seriesFormat || 'bo1') !== seriesFormat) {
      throw new HttpsError('invalid-argument',
        `stages[0].seriesFormat (${s0.seriesFormat}) must match top-level seriesFormat (${seriesFormat}).`);
    }
  }

  if (cfg.mode === 'squad' && !squadId) {
    throw new HttpsError('invalid-argument', 'Squad tournaments need a host squad');
  }

  // Per-game lobby-cap validation. BR titles only work for games whose
  // engine supports large-lobby FFA; other formats must fit within the
  // game's max lobby size as well (e.g. Tekken 8 can't host a 32-player
  // FFA in one room — must be a bracket).
  const { getMaxLobbySize, supportsBattleRoyale } = require('./games');
  const maxLobby = getMaxLobbySize(game);
  if (type === 'battle_royale') {
    if (!supportsBattleRoyale(game)) {
      throw new HttpsError(
        'failed-precondition',
        `"${game}" does not support battle-royale tournaments (max lobby ${maxLobby}). Use single_elim or another bracket.`,
      );
    }
    if (maxParticipants > maxLobby) {
      throw new HttpsError(
        'failed-precondition',
        `${game} caps lobbies at ${maxLobby} players — reduce maxParticipants or split into multiple BR games.`,
      );
    }
  }

  // ─── Scheduling buffer for no-API games ────────────────────────────
  // Games not in AUTO_DECIDED_GAMES need a Vanguard mod assigned to call
  // results. Mods claim slots, so the tournament needs to be scheduled
  // far enough in advance for someone to actually claim it. Enforce a
  // 1-hour minimum buffer for no-API games. Auto-decided games (CS2,
  // Dota2, OW2, Apex) skip this since GSI/wrapper resolves them.
  const { requiresManualMod, MIN_SCHEDULING_BUFFER_MIN } = require('./tournamentModeration');
  const needsManualMod = requiresManualMod({ game });
  if (needsManualMod) {
    if (!scheduledStart) {
      throw new HttpsError('invalid-argument',
        `Pick a start time for this tournament. Results for "${game}" are confirmed by a referee, so it needs to be scheduled at least ${MIN_SCHEDULING_BUFFER_MIN} minutes ahead to give one time to join.`);
    }
    const startMs = new Date(scheduledStart).getTime();
    if (!Number.isFinite(startMs)) {
      throw new HttpsError('invalid-argument', 'scheduledStart must be a valid date.');
    }
    const minStart = Date.now() + MIN_SCHEDULING_BUFFER_MIN * 60_000;
    if (startMs < minStart) {
      const minsFromNow = Math.ceil((minStart - Date.now()) / 60_000);
      throw new HttpsError('failed-precondition',
        `Your start time is too soon. A referee confirms results for "${game}" and needs at least ${MIN_SCHEDULING_BUFFER_MIN} minutes to join, so pick a start at least ${minsFromNow} minutes from now. (Games like CS2, Dota 2, Overwatch 2 and Apex Legends confirm results automatically and can start anytime.)`);
    }
  }

  // DS2 — validate the host-squad attribution: the caller must be a member of
  // the squad they're claiming hosts this event. Invalid/foreign → drop it.
  let validHostSquadId = null;
  if (hostSquadId) {
    try {
      const sqSnap = await db.collection('squads').doc(hostSquadId).get();
      const sq = sqSnap.data();
      const members = sq?.memberIds || [];
      if (sqSnap.exists && (members.includes(uid) || sq.ownerId === uid)) {
        validHostSquadId = hostSquadId;
      }
    } catch { /* drop silently */ }
  }

  // Mint an OBS overlay token — used by the streamer's overlay browser source
  // to POST AI-moderation signals (winner hotkey) back to our backend without
  // requiring Firebase Auth. Token is opaque, 32 bytes hex.
  const overlayToken = require('crypto').randomBytes(32).toString('hex');

  const docRef = db.collection('tournaments').doc();
  const tournamentDoc = {
    adminId: uid,
    squadId: squadId || null,
    name: name.trim(),
    description: description.trim?.() || '',
    game,
    entryFee: effectiveEntryFee,
    maxParticipants,
    type,
    mode: cfg.mode,
    streamRequired: !!streamRequired,
    brGameCount: type === 'battle_royale' ? (brGameCount || 3) : null,
    swissRounds: type === 'swiss' ? (swissRounds || null) : null,
    status: 'open',
    prizePool: 0,
    participants: [],
    bracketData: null,
    brResults: [],
    visibility: visibility === 'private' ? 'private' : 'public',
    category: ['competitive', 'casual', 'community'].includes(category) ? category : 'competitive',
    titleColor: (typeof titleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(titleColor)) ? titleColor : null,
    accentWords: Array.isArray(accentWords)
      ? accentWords.filter(n => Number.isInteger(n) && n >= 0 && n < 40).slice(0, 40)
      : [],
    bannerUrl: bannerUrl || null,
    hostSquadId: validHostSquadId,
    invitedUserIds: Array.isArray(invitedUserIds) ? invitedUserIds : [],
    scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
    requiresManualMod: needsManualMod,
    overlayToken,
    // Funding model — 'ticketed' (default) or 'prize_pool' (legacy, gated).
    fundingModel: model,
    ticket: normalizedTicket,        // null for prize_pool model
    declaredPurse: topUp,            // ticketed purse starts at the host top-up
    hostTopUpCoins: topUp,
    // Phase 1 — series + seeding (defaults preserve old behaviour).
    seriesFormat,
    seriesFormatByRound: seriesFormatByRound || null,
    seedingMode,
    // Phase 2 — multi-stage (null = implicit single-stage).
    stages: normalizedStages,
    currentStageId: normalizedStages ? normalizedStages[0].id : null,
    createdAt: FieldValue.serverTimestamp(),
  };

  // Escrow the host's optional purse top-up inside a transaction so the
  // doc + wallet debit + ledger row are atomic.
  if (topUp > 0) {
    await db.runTransaction(async (tx) => {
      const wRef = db.collection('wallets').doc(uid);
      const wSnap = await tx.get(wRef);
      const bal = wSnap.exists ? (wSnap.data().balance || 0) : 0;
      if (bal < topUp) {
        throw new HttpsError('failed-precondition', `Insufficient coins to fund the ${topUp}-coin prize top-up.`);
      }
      tx.update(wRef, {
        balance: FieldValue.increment(-topUp),
        totalSpent: FieldValue.increment(topUp),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(docRef, tournamentDoc);
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'tournament_purse_topup', amount: -topUp,
        description: `Prize top-up: ${tournamentDoc.name}`,
        tournamentId: docRef.id, createdAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    await docRef.set(tournamentDoc);
  }

  return { tournamentId: docRef.id, overlayToken };
});

// ─── 2. joinTournamentSecure ──────────────────────────────────────────
// Mode-aware:
//   solo / ffa / custom — caller's own uid is added to participants[],
//   entry fee paid from caller's wallet.
//
//   squad — caller MUST be the squad owner. `squadId` is required. The
//   squadId is added to participants[] (squad-vs-squad model per the
//   Tournament System doc). Entry fee is debited from `squads/{squadId}.
//   treasury` — the doc says "prize pool goes to the squad treasury",
//   the entry comes from there too.
exports.joinTournamentSecure = functions.https.onCall({ secrets: ['VERGR_GEO_TOKEN'] }, async (request) => {
  throw TOURNAMENTS_RETIRED();
  const uid = requireAuth(request);

  const { tournamentId, squadId = null, displayCaptureSupported = null } = request.data || {};
  if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

  const tRef = db.collection('tournaments').doc(tournamentId);

  // Compliance gates apply to PAID entry only. Free tournaments need no KYC /
  // region check, so friend-tests + casual free events work without identity
  // verification. (Pre-read the fee here; the tx below re-reads t atomically.)
  const preSnap = await tRef.get();
  const preFee = preSnap.exists ? Math.floor(preSnap.data().entryFee || 0) : 0;
  if (preFee > 0) {
    const { assertRegionAllowed } = require('./geo');
    const { assertKycVerified }   = require('./didit');
    await assertRegionAllowed(request);
    await assertKycVerified(uid);
  }

  // AC9 — high-stakes screen-capture gate (defense in depth). The client
  // feature-detects getDisplayMedia (the macOS 13+ / Safari 16 requirement for
  // the two-camera proof feed) and reports it. If it explicitly cannot capture,
  // reject the join up front so the player doesn't escrow coins then fail to
  // claim. NOTE: the hard enforcement remains the proof-feed wall in
  // recordMatchResultInternal — a spoofed `true` just hits that wall later.
  // Phase 2 result engine: ALL paid entries require screen capture (results
  // are auto-detected from the player's game window; there is no manual
  // "I won" path on paid events).
  if (preFee > 0 && displayCaptureSupported === false) {
    throw new HttpsError('failed-precondition',
      'Paid tournaments use automatic result detection, which needs screen capture. ' +
      'Your device/OS does not support it (use a desktop browser — Chrome/Edge, or macOS 13+). ' +
      'You can still spectate or join free tournaments.');
  }

  return db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const t = tSnap.data();

    if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Registration closed');
    const participants = t.participants || [];
    const fee = Math.floor(t.entryFee || 0);

    // LEGAL INVARIANT (ticketed events): a fan who bought a spectator ticket
    // can't ALSO be a prize-eligible competitor (that would re-create the
    // pay-in + chance-to-win combo). Block competitor registration if the
    // caller holds an active ticket for this event.
    if (t.fundingModel === 'ticketed') {
      const tkRef = db.collection('event_tickets').doc(`${tournamentId}_${uid}`);
      const tkSnap = await tx.get(tkRef);
      if (tkSnap.exists && tkSnap.data().status === 'active') {
        throw new HttpsError('failed-precondition',
          'You hold a spectator ticket for this event, so you can\'t also compete in it.');
      }
    }

    // Squad-vs-squad path: register the whole squad, not an individual.
    if (t.mode === 'squad') {
      if (!squadId) throw new HttpsError('invalid-argument', 'squadId required for squad tournaments');
      if (participants.includes(squadId)) throw new HttpsError('already-exists', 'Squad already entered');
      if (participants.length >= t.maxParticipants) throw new HttpsError('failed-precondition', 'Tournament is full');

      const sRef = db.collection('squads').doc(squadId);
      const sSnap = await tx.get(sRef);
      if (!sSnap.exists) throw new HttpsError('not-found', 'Squad not found');
      const s = sSnap.data();
      if (s.ownerId !== uid) throw new HttpsError('permission-denied', 'Only the squad owner can register the squad');

      if (t.visibility === 'private') {
        const invited = t.invitedUserIds || [];
        if (uid !== t.adminId && !invited.includes(uid) && !invited.includes(squadId)) {
          throw new HttpsError('permission-denied', 'This tournament is invite-only');
        }
      }

      if (fee > 0) {
        const treasury = s.treasury || 0;
        if (treasury < fee) throw new HttpsError('failed-precondition', 'Squad treasury has insufficient coins');
        tx.update(sRef, {
          treasury: FieldValue.increment(-fee),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('transactions').doc(), {
          squadId, type: 'tournament_entry_squad', amount: -fee,
          description: `Squad entry fee: ${t.name}`,
          tournamentId, createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(tRef, {
        participants: FieldValue.arrayUnion(squadId),
        // squadChampions field gets populated by selectSquadChampionsSecure
        // before the tournament starts. Default = all squad members until
        // the leader explicitly picks.
        [`squadChampions.${squadId}`]: s.memberIds || [],
        prizePool: FieldValue.increment(fee),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, mode: 'squad', squadId, prizePoolAfter: (t.prizePool || 0) + fee };
    }

    // Solo / FFA / custom — individual entry.
    if (participants.includes(uid)) throw new HttpsError('already-exists', 'Already registered');
    if (participants.length >= t.maxParticipants) throw new HttpsError('failed-precondition', 'Tournament is full');

    if (t.visibility === 'private') {
      const invited = t.invitedUserIds || [];
      if (uid !== t.adminId && !invited.includes(uid)) {
        throw new HttpsError('permission-denied', 'This tournament is invite-only');
      }
    }

    if (fee > 0) {
      const walletRef = db.collection('wallets').doc(uid);
      const wSnap = await tx.get(walletRef);
      if (!wSnap.exists) throw new HttpsError('failed-precondition', 'Wallet not found');
      const balance = wSnap.data().balance || 0;
      if (balance < fee) throw new HttpsError('failed-precondition', 'Insufficient coins');
      tx.update(walletRef, {
        balance: FieldValue.increment(-fee),
        totalSpent: FieldValue.increment(fee),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'tournament_entry', amount: -fee,
        description: `Entry fee: ${t.name}`,
        tournamentId, createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(tRef, {
      participants: FieldValue.arrayUnion(uid),
      prizePool: FieldValue.increment(fee),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, mode: 'solo', prizePoolAfter: (t.prizePool || 0) + fee };
  });
});

// ─── selectSquadChampionsSecure ───────────────────────────────────────
// Squad owner picks WHICH members will actually play in the tournament.
// Per the Tournament System doc: "squad members decide who will take part
// — elect their champions." We let the owner make the call; the doc
// doesn't require an internal vote, but a separate `createRosterVote`
// flow already exists if the owner wants to delegate the decision.
//
// Champions must be valid squad members. Count must match the game's
// team-size requirement (e.g. 5 for Valorant, 3 for Rocket League). The
// game registry doesn't yet store team sizes — accept any non-empty
// subset for now and add per-game caps when the registry is extended.
exports.selectSquadChampionsSecure = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { tournamentId, squadId, championUids, backupUids = [] } = request.data || {};
  if (!tournamentId || !squadId || !Array.isArray(championUids) || championUids.length === 0) {
    throw new HttpsError('invalid-argument', 'tournamentId + squadId + championUids[] required');
  }
  if (!Array.isArray(backupUids)) {
    throw new HttpsError('invalid-argument', 'backupUids must be an array');
  }
  const tRef = db.collection('tournaments').doc(tournamentId);
  const sRef = db.collection('squads').doc(squadId);

  await db.runTransaction(async (tx) => {
    const [tSnap, sSnap] = await Promise.all([tx.get(tRef), tx.get(sRef)]);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    if (!sSnap.exists) throw new HttpsError('not-found', 'Squad not found');
    const t = tSnap.data();
    const s = sSnap.data();
    if (s.ownerId !== uid) throw new HttpsError('permission-denied', 'Only the squad owner can pick champions');
    if (t.mode !== 'squad') throw new HttpsError('failed-precondition', 'Not a squad tournament');
    if (!(t.participants || []).includes(squadId)) {
      throw new HttpsError('failed-precondition', 'Squad is not entered in this tournament');
    }
    if (t.status !== 'open') {
      throw new HttpsError('failed-precondition', 'Tournament already started — champions locked');
    }
    const memberSet = new Set(s.memberIds || []);
    for (const cuid of championUids) {
      if (!memberSet.has(cuid)) {
        throw new HttpsError('invalid-argument', `${cuid} is not in this squad`);
      }
    }
    for (const buid of backupUids) {
      if (!memberSet.has(buid)) {
        throw new HttpsError('invalid-argument', `${buid} is not in this squad`);
      }
      if (championUids.includes(buid)) {
        throw new HttpsError('invalid-argument', `${buid} is already a champion`);
      }
    }
    tx.update(tRef, {
      [`squadChampions.${squadId}`]: championUids,
      [`squadBackupChampions.${squadId}`]: backupUids,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

// ─── startSquadChampionVote ────────────────────────────────────────────
// Creates a poll where squad members elect tournament champions. Members
// select up to `slotsNeeded + backupSlots` candidates (multi-select). The
// top `slotsNeeded` finalists become champions; the next `backupSlots`
// become backups (for last-minute replacements). Only the squad owner can
// open the vote, before the tournament starts.
exports.startSquadChampionVote = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { tournamentId, squadId, slotsNeeded, backupSlots = 2, durationHours = 24 } = request.data || {};
  if (!tournamentId || !squadId || !slotsNeeded) {
    throw new HttpsError('invalid-argument', 'tournamentId + squadId + slotsNeeded required');
  }
  const tSnap = await db.collection('tournaments').doc(tournamentId).get();
  const sSnap = await db.collection('squads').doc(squadId).get();
  if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
  if (!sSnap.exists) throw new HttpsError('not-found', 'Squad not found');
  const t = tSnap.data();
  const s = sSnap.data();
  if (s.ownerId !== uid) throw new HttpsError('permission-denied', 'Squad owner only');
  if (t.mode !== 'squad') throw new HttpsError('failed-precondition', 'Not a squad tournament');
  if (!(t.participants || []).includes(squadId)) {
    throw new HttpsError('failed-precondition', 'Squad not entered');
  }
  if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Tournament already started');

  const expiresAt = new Date(Date.now() + Math.max(1, Math.min(72, Number(durationHours))) * 3600_000);
  const candidateUids = (s.memberIds || []);
  const poll = await db.collection('polls').add({
    type: 'tournament_champion_vote',
    tournamentId,
    squadId,
    title: `Elect champions for "${t.name}"`,
    candidateUids,
    slotsNeeded: Number(slotsNeeded),
    backupSlots: Number(backupSlots),
    voteTallies: {},
    voters: {},
    status: 'active',
    expiresAt,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, pollId: poll.id };
});

// ─── castSquadChampionVote ─────────────────────────────────────────────
// Squad member casts (or recasts) their ballot. Ballot = up to
// (slotsNeeded + backupSlots) uids from candidateUids.
exports.castSquadChampionVote = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { pollId, picks } = request.data || {};
  if (!pollId || !Array.isArray(picks) || picks.length === 0) {
    throw new HttpsError('invalid-argument', 'pollId + picks[] required');
  }
  const pRef = db.collection('polls').doc(pollId);
  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists) throw new HttpsError('not-found', 'Poll not found');
    const p = pSnap.data();
    if (p.status !== 'active') throw new HttpsError('failed-precondition', 'Poll closed');
    if (p.expiresAt?.toMillis && p.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('failed-precondition', 'Poll expired');
    }
    const sSnap = await tx.get(db.collection('squads').doc(p.squadId));
    if (!(sSnap.data()?.memberIds || []).includes(uid)) {
      throw new HttpsError('permission-denied', 'Squad members only');
    }
    const cap = (p.slotsNeeded || 0) + (p.backupSlots || 0);
    if (picks.length > cap) {
      throw new HttpsError('invalid-argument', `Pick up to ${cap} candidates`);
    }
    const candidateSet = new Set(p.candidateUids || []);
    for (const c of picks) {
      if (!candidateSet.has(c)) throw new HttpsError('invalid-argument', `${c} not a candidate`);
    }

    // Reverse previous ballot if user already voted.
    const previous = (p.voters || {})[uid] || [];
    const updates = {};
    for (const prev of previous) {
      updates[`voteTallies.${prev}`] = FieldValue.increment(-1);
    }
    for (const pick of picks) {
      updates[`voteTallies.${pick}`] = FieldValue.increment(1);
    }
    updates[`voters.${uid}`] = picks;
    updates.updatedAt = FieldValue.serverTimestamp();
    tx.update(pRef, updates);
  });
  return { ok: true };
});

// ─── finalizeSquadChampionVote ─────────────────────────────────────────
// Squad owner closes the vote. Takes top N by tally as champions, next M
// as backups, stamps onto tournament.squadChampions[squadId] +
// squadBackupChampions[squadId]. Ties broken by member-join order
// (memberIds index). Idempotent — re-running on a finalized poll no-ops.
exports.finalizeSquadChampionVote = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { pollId } = request.data || {};
  if (!pollId) throw new HttpsError('invalid-argument', 'pollId required');
  const pRef = db.collection('polls').doc(pollId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) throw new HttpsError('not-found', 'Poll not found');
  const p = pSnap.data();

  const tRef = db.collection('tournaments').doc(p.tournamentId);
  const sRef = db.collection('squads').doc(p.squadId);
  const sSnap = await sRef.get();
  if (!sSnap.exists) throw new HttpsError('not-found', 'Squad not found');
  if (sSnap.data().ownerId !== uid) throw new HttpsError('permission-denied', 'Squad owner only');

  const memberOrder = sSnap.data().memberIds || [];
  const memberIdx = (id) => {
    const i = memberOrder.indexOf(id);
    return i < 0 ? 1e9 : i;
  };
  const tallies = p.voteTallies || {};
  const ranked = (p.candidateUids || [])
    .map((id) => ({ id, votes: tallies[id] || 0 }))
    .sort((a, b) => (b.votes - a.votes) || (memberIdx(a.id) - memberIdx(b.id)));

  const champions = ranked.slice(0, p.slotsNeeded).map((r) => r.id);
  const backups = ranked.slice(p.slotsNeeded, p.slotsNeeded + p.backupSlots).map((r) => r.id);

  await db.runTransaction(async (tx) => {
    tx.update(pRef, {
      status: 'closed',
      closedAt: FieldValue.serverTimestamp(),
      finalChampions: champions,
      finalBackups: backups,
    });
    tx.update(tRef, {
      [`squadChampions.${p.squadId}`]: champions,
      [`squadBackupChampions.${p.squadId}`]: backups,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, champions, backups };
});

// ─── 3. leaveTournamentSecure ─────────────────────────────────────────
exports.leaveTournamentSecure = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { tournamentId } = request.data || {};
  if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

  const tRef = db.collection('tournaments').doc(tournamentId);
  const walletRef = db.collection('wallets').doc(uid);

  return db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const t = tSnap.data();
    if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Cannot leave after start');
    if (!(t.participants || []).includes(uid)) throw new HttpsError('failed-precondition', 'Not registered');

    const fee = Math.floor(t.entryFee || 0);
    if (fee > 0) {
      tx.update(walletRef, {
        balance: FieldValue.increment(fee),
        totalSpent: FieldValue.increment(-fee),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const txRef = db.collection('transactions').doc();
      tx.set(txRef, {
        userId: uid,
        type: 'tournament_refund',
        amount: fee,
        description: `Refund: ${t.name}`,
        tournamentId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(tRef, {
      participants: FieldValue.arrayRemove(uid),
      prizePool: FieldValue.increment(-fee),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
});

// ─── 4. startTournamentSecure ─────────────────────────────────────────
// Host-only. Generates round-1 bracket and match docs. For now we only
// fully bracket single_elim / squad_single_elim server-side; other formats
// still get a tournament started with bracketData stub and the existing
// client-side helpers can fill in. Phase 1 focus is escrow + result reporting.
exports.startTournamentSecure = functions.https.onCall(async (request) => {
  throw TOURNAMENTS_RETIRED();
  const uid = requireAuth(request);
  const { tournamentId } = request.data || {};
  if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
  return startTournamentInternal(tournamentId, { uid });
});

// Underlying start logic. uid === null = system caller (the auto-start cron)
// which skips the host check; a real uid must be the host.
async function startTournamentInternal(tournamentId, { uid = null } = {}) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
  const t = tSnap.data();
  if (uid !== null && t.adminId !== uid) throw new HttpsError('permission-denied', 'Only the host can start');
  if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Already started');
  const participants = t.participants || [];
  if (participants.length < 2) throw new HttpsError('failed-precondition', 'Need ≥ 2 participants');

  // Phase 1 seeding — honour t.seedingMode.
  //   'random'  (default)  shuffle, then standard bracket seeding
  //   'manual'             host-provided order IS the seed (no shuffle)
  //   'rating'             sort by users.tournamentPoints desc (top seed = best record)
  let shuffled;
  const mode = t.seedingMode || 'random';
  if (mode === 'manual') {
    shuffled = [...participants];
  } else if (mode === 'rating') {
    // Pull tournamentPoints for each uid; missing = 0.
    const tpSnaps = await Promise.all(participants.map((pid) =>
      db.collection('users').doc(pid).get().catch(() => null)));
    const tpByUid = {};
    tpSnaps.forEach((s, i) => {
      tpByUid[participants[i]] = (s && s.exists ? s.data() : {}).tournamentPoints || 0;
    });
    shuffled = [...participants].sort((a, b) => (tpByUid[b] || 0) - (tpByUid[a] || 0));
  } else {
    shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }

  // Phase 1 series — resolve seriesFormat for each round (default Bo1).
  const { applyInitialSeriesFields } = require('./tournamentSeries');
  const baseSeriesFmt = t.seriesFormat || 'bo1';
  const seriesByRound = t.seriesFormatByRound || null;
  const seriesFormatForRound = (r) => (seriesByRound && seriesByRound[r]) || baseSeriesFmt;

  const batch = db.batch();
  let bracketData = null;
  let totalRounds = 1;

  if (t.type === 'single_elim' || t.type === 'squad_single_elim' || !t.type) {
    const round1 = buildSingleElimRound1(shuffled);
    totalRounds = Math.ceil(Math.log2(Math.max(2, shuffled.length)));
    bracketData = { format: 'single_elim', size: round1.length * 2, totalRounds };

    const verify = gameVerifyProfile(t.game);
    round1.forEach(m => {
      const id = matchDocId(1, m.matchNumber);
      const ref = db.collection('tournaments').doc(tournamentId).collection('matches').doc(id);
      const completed = !!m.autoWin;
      const isBye = !m.player1Id || !m.player2Id;
      batch.set(ref, {
        round: 1,
        matchNumber: m.matchNumber,
        player1: m.player1Id,
        player2: m.player2Id,
        winner: m.autoWin || null,
        loser: null,
        status: completed ? 'completed' : 'pending',
        bye: isBye,
        // Same-lobby verification scaffold.
        lobbyCode: isBye ? null : makeLobbyCode(),
        verifyMethod: isBye ? null : verify.verifyMethod,
        detection: verify.detection,
        verifyState: isBye ? null : {
          [m.player1Id]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2Id]: { status: 'pending', source: null, at: null, modUid: null },
        },
        // Phase 1 series fields (Bo1 default = back-compat).
        seriesFormat: seriesFormatForRound(1),
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: completed ? m.autoWin : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } else if (t.type === 'double_elim') {
    // Server-generated full WB + LB + GF skeleton. Each non-WB-R1 match
    // starts empty; players are filled in when their feeder match completes
    // (see fillDoubleElimFeeders below).
    const skeleton = buildDoubleElimBracket(shuffled);
    if (!skeleton) {
      throw new HttpsError('failed-precondition', 'Need at least 4 players for double-elim');
    }
    totalRounds = skeleton.wbRounds + skeleton.lbRounds + 1; // WB + LB + GF
    bracketData = {
      format: 'double_elim',
      size: skeleton.size,
      wbRounds: skeleton.wbRounds,
      lbRounds: skeleton.lbRounds,
      totalMatches: skeleton.matches.length,
    };
    const verify = gameVerifyProfile(t.game);
    for (const m of skeleton.matches) {
      const ref = tRef.collection('matches').doc(m.id);
      const hasBothPlayers = !!(m.player1 && m.player2);
      const isBye = m.player1 && !m.player2;
      batch.set(ref, {
        round: m.round,
        matchNumber: m.matchNumber,
        bracketSide: m.bracketSide,
        isGrandFinal: !!m.isGrandFinal,
        player1: m.player1 || null,
        player2: m.player2 || null,
        winner: isBye ? m.player1 : (m.autoWin || null),
        loser: null,
        status: isBye ? 'completed' : (hasBothPlayers ? 'pending' : 'awaiting_feeder'),
        bye: !!isBye,
        feedFrom: m.feedFrom || null,
        // Verification scaffolding only when both players are present.
        lobbyCode: hasBothPlayers ? makeLobbyCode() : null,
        verifyMethod: hasBothPlayers ? verify.verifyMethod : null,
        detection: verify.detection,
        verifyState: hasBothPlayers ? {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        } : null,
        seriesFormat: seriesFormatForRound(m.round),
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: isBye ? m.player1 : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (t.type === 'squad_round_robin' || t.type === 'round_robin') {
    // Every participant plays every other participant exactly once.
    // Server creates the full schedule upfront.
    const schedule = buildRoundRobinSchedule(shuffled);
    totalRounds = shuffled.length - (shuffled.length % 2 === 0 ? 1 : 0);
    bracketData = {
      format: t.type, size: shuffled.length,
      totalRounds, totalMatches: schedule.length,
    };
    const verify = gameVerifyProfile(t.game);
    for (const m of schedule) {
      const ref = tRef.collection('matches').doc(m.id);
      batch.set(ref, {
        round: m.round, matchNumber: m.matchNumber,
        player1: m.player1, player2: m.player2,
        winner: null, loser: null, status: 'pending',
        bye: false,
        lobbyCode: makeLobbyCode(),
        verifyMethod: verify.verifyMethod,
        detection: verify.detection,
        verifyState: {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        },
        // Phase 3 — RR honours the tournament's seriesFormat (Bo1/3/5).
        seriesFormat: baseSeriesFmt,
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (t.type === 'battle_royale') {
    // FFA — N participants, multiple games. Each game is a single match
    // doc that the host/mod resolves by writing brResults[].
    const gameCount = t.brGameCount || 3;
    const games = buildBattleRoyaleGames(shuffled, gameCount);
    totalRounds = gameCount;
    bracketData = {
      format: 'battle_royale', size: shuffled.length,
      totalRounds, gameCount, totalMatches: games.length,
    };
    const verify = gameVerifyProfile(t.game);
    for (const g of games) {
      const ref = tRef.collection('matches').doc(g.id);
      batch.set(ref, {
        round: g.round, matchNumber: g.matchNumber,
        gameNumber: g.gameNumber,
        participants: g.participants,
        // FFA — no player1/player2 pairing. Stash first two so generic
        // verifyState scaffolding still works for OCR-tier games where
        // the lobby code is shown in chat (everyone in the same lobby).
        player1: null, player2: null,
        winner: null, loser: null, status: 'pending',
        bye: false,
        brResults: [],
        lobbyCode: makeLobbyCode(),
        verifyMethod: verify.verifyMethod,
        detection: verify.detection,
        // FFA verifyState keyed by every participant.
        verifyState: Object.fromEntries(g.participants.map((uid) => [
          uid, { status: 'pending', source: null, at: null, modUid: null },
        ])),
        // BR is Bo1 by definition — each match doc IS one game.
        seriesFormat: 'bo1',
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (t.type === 'swiss') {
    // Round 1 = random pairings. Future rounds are generated by
    // `advanceSwissIfNeeded` after each round completes.
    const r1 = buildSwissRound1(shuffled);
    const swissRounds = Math.ceil(Math.log2(Math.max(2, shuffled.length)));
    totalRounds = swissRounds;
    bracketData = {
      format: 'swiss', size: shuffled.length,
      totalRounds: swissRounds, totalMatches: null,
    };
    const verify = gameVerifyProfile(t.game);
    for (const m of r1) {
      const ref = tRef.collection('matches').doc(m.id);
      const isBye = m.bye;
      batch.set(ref, {
        round: m.round, matchNumber: m.matchNumber,
        player1: m.player1, player2: m.player2,
        winner: isBye ? m.player1 : null,
        loser: null,
        status: isBye ? 'completed' : 'pending',
        bye: isBye,
        lobbyCode: isBye ? null : makeLobbyCode(),
        verifyMethod: isBye ? null : verify.verifyMethod,
        detection: verify.detection,
        verifyState: isBye ? null : {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        },
        // Phase 3 — Swiss honours the tournament's seriesFormat (Bo1/3/5).
        seriesFormat: baseSeriesFmt,
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: isBye ? m.player1 : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (t.type === 'invitational') {
    // Per founder mandate: even invitational uses structural rules — it's
    // single-elim under the hood with host-provided seed order (not the
    // random shuffle other types get). The participants list IS the seed.
    const round1 = buildSingleElimRound1(t.participants || shuffled);
    totalRounds = Math.ceil(Math.log2(Math.max(2, (t.participants || shuffled).length)));
    bracketData = { format: 'invitational', size: round1.length * 2, totalRounds };
    const verify = gameVerifyProfile(t.game);
    round1.forEach((m) => {
      const id = matchDocId(1, m.matchNumber);
      const ref = tRef.collection('matches').doc(id);
      const completed = !!m.autoWin;
      const isBye = !m.player1Id || !m.player2Id;
      batch.set(ref, {
        round: 1, matchNumber: m.matchNumber,
        player1: m.player1Id, player2: m.player2Id,
        winner: m.autoWin || null, loser: null,
        status: completed ? 'completed' : 'pending',
        bye: isBye,
        lobbyCode: isBye ? null : makeLobbyCode(),
        verifyMethod: isBye ? null : verify.verifyMethod,
        detection: verify.detection,
        verifyState: isBye ? null : {
          [m.player1Id]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2Id]: { status: 'pending', source: null, at: null, modUid: null },
        },
        seriesFormat: seriesFormatForRound(1),
        seriesScore: { a: 0, b: 0 },
        games: [],
        seriesWinner: completed ? m.autoWin : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    // Truly unknown type — refuse to start. Better an explicit error than
    // a silently-broken tournament.
    throw new HttpsError('invalid-argument', `Unsupported tournament type: ${t.type}`);
  }

  // Phase 2 — stage tracking. Stage 1 matches don't need an explicit
  // stageId stamp (advanceStageIfNeeded treats missing stageId as
  // belonging to stages[0]). Stage 2+ matches will get an explicit
  // stageId when advanceStageIfNeeded generates them.
  batch.update(tRef, {
    status: 'active',
    bracket: { totalRounds, currentRound: 1 },
    bracketData,
    startedAt: FieldValue.serverTimestamp(),
  });

  // Notify all participants.
  for (const pid of shuffled) {
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      recipientId: pid,
      type: 'tournament',
      title: 'Tournament started!',
      body: `${t.name} has begun.`,
      read: false,
      data: { tournamentId },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { ok: true, totalRounds };
}
exports._internal_startTournament = startTournamentInternal;

// ─── Phase 2 — multi-stage handoff ────────────────────────────────────
// Returns true if it advanced the tournament to a next stage (caller
// should NOT finalize). False = no next stage exists OR current stage
// not actually done; caller proceeds with finalize path as normal.
//
// Algorithm:
//   1. Load tournament. Exit false if no stages[] (legacy single-stage).
//   2. Find current stage. If no next stage queued → exit false (caller
//      finalizes). If next exists, proceed.
//   3. Compute current-stage standings via computeRankingForTournament
//      (scoped: temp-rewrite t.type to current stage's type if needed —
//      actually it already reads t.type so we pass a synthetic t with
//      the stage's type and the stage's matches only).
//   4. Take top advanceCount uids as the next stage's participants.
//   5. Seed: next stage's seedingMode='inherit' → use rank order directly.
//      Other modes shuffle/sort as Phase 1 does.
//   6. Build next stage's match docs (route to the existing per-format
//      builders). Stamp stageId on each.
//   7. Update tournament: type=nextStage.type, currentStageId=nextStage.id,
//      seriesFormat=nextStage.seriesFormat, swissRounds/brGameCount as
//      needed. Don't touch participants[] (full historical list stays).
async function advanceStageIfNeeded(tournamentId, currentStageJustCompleted = false) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) return false;
  const t = tSnap.data();
  if (!Array.isArray(t.stages) || t.stages.length === 0) return false;

  const { getStage, getNextStage } = require('./tournamentStages');
  const currentStage = getStage(t, t.currentStageId) || t.stages[0];
  const nextStage = getNextStage({ ...t, currentStageId: currentStage.id });
  if (!nextStage) return false;

  // Read stage's own matches (stageId === currentStage.id, OR stageId
  // missing AND currentStage is stages[0] = legacy match docs created
  // before stamping ran).
  const allMatchesSnap = await tRef.collection('matches').get();
  const allMatches = allMatchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const stageIsFirst = currentStage.id === t.stages[0].id;
  const stageMatches = allMatches.filter((m) =>
    m.stageId === currentStage.id || (!m.stageId && stageIsFirst));
  if (stageMatches.length === 0) return false;
  // Check stage actually completed.
  const stagePending = stageMatches.some((m) => m.status === 'pending'
    || m.status === 'in_progress' || m.status === 'awaiting_confirmation' || m.status === 'disputed');
  if (stagePending && !currentStageJustCompleted) return false;

  // Synthetic tournament view: type from stage, matches from stage.
  // computeRankingForTournament reads t.type + per-type match patterns;
  // pass it the stage's type so ranking obeys the stage's format.
  const stageView = { ...t, type: currentStage.type };
  // computeRankingForTournament uses tRef.collection('matches') itself, so
  // we need to filter by stage. Easiest: compute ranking ourselves here for
  // the stage. Reuse the helper by temporarily writing a synthetic
  // collection isn't possible; instead duplicate the per-type logic on
  // the stage's match slice.
  const ranking = await computeStageRanking(stageView, stageMatches);
  if (!Array.isArray(ranking) || ranking.length === 0) return false;

  const advanceN = Math.max(2, Math.floor(nextStage.advanceCount || currentStage.advanceCount || ranking.length));
  let advancers = ranking.slice(0, Math.min(advanceN, ranking.length));

  // Apply next stage's seedingMode. 'inherit' = keep computed rank order.
  if (nextStage.seedingMode === 'random') {
    advancers = [...advancers];
    for (let i = advancers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [advancers[i], advancers[j]] = [advancers[j], advancers[i]];
    }
  } else if (nextStage.seedingMode === 'rating') {
    const tpSnaps = await Promise.all(advancers.map((p) =>
      db.collection('users').doc(p).get().catch(() => null)));
    const tp = {};
    tpSnaps.forEach((s, i) => { tp[advancers[i]] = (s && s.exists ? s.data() : {}).tournamentPoints || 0; });
    advancers = [...advancers].sort((a, b) => (tp[b] || 0) - (tp[a] || 0));
  }
  // 'manual' and 'inherit' both use the computed rank order as-is.

  // Build next-stage matches. Route to existing per-format builders.
  const {
    buildSingleElimRound1, buildDoubleElimBracket,
    buildRoundRobinSchedule, buildSwissRound1, buildBattleRoyaleGames,
  } = require('./tournamentRules');
  const { gameById } = require('./games');
  const verify = (() => {
    const g = gameById(t.game);
    return { verifyMethod: g?.verifyMethod || 'chat', detection: g?.detection || 'manual' };
  })();

  const batch = db.batch();
  const stageId = nextStage.id;
  const seriesFmt = nextStage.seriesFormat || 'bo1';
  const prefix = `${stageId}__`;

  if (nextStage.type === 'single_elim' || nextStage.type === 'squad_single_elim') {
    const r1 = buildSingleElimRound1(advancers);
    for (const m of r1) {
      const docId = `${prefix}r1_m${m.matchNumber}`;
      const ref = tRef.collection('matches').doc(docId);
      const completed = !!m.autoWin;
      const isBye = !m.player1Id || !m.player2Id;
      batch.set(ref, {
        stageId,
        round: 1, matchNumber: m.matchNumber,
        player1: m.player1Id, player2: m.player2Id,
        winner: m.autoWin || null, loser: null,
        status: completed ? 'completed' : 'pending',
        bye: isBye,
        lobbyCode: isBye ? null : makeLobbyCode(),
        verifyMethod: isBye ? null : verify.verifyMethod,
        detection: verify.detection,
        verifyState: isBye ? null : {
          [m.player1Id]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2Id]: { status: 'pending', source: null, at: null, modUid: null },
        },
        seriesFormat: seriesFmt,
        seriesScore: { a: 0, b: 0 }, games: [],
        seriesWinner: completed ? m.autoWin : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (nextStage.type === 'double_elim') {
    const skel = buildDoubleElimBracket(advancers);
    if (!skel) {
      console.warn('next stage DE: not enough players', advancers.length);
      return false;
    }
    for (const m of skel.matches) {
      const docId = `${prefix}${m.id}`;
      const ref = tRef.collection('matches').doc(docId);
      const hasBoth = !!(m.player1 && m.player2);
      const isBye = m.player1 && !m.player2;
      batch.set(ref, {
        stageId,
        round: m.round, matchNumber: m.matchNumber,
        bracketSide: m.bracketSide, isGrandFinal: !!m.isGrandFinal,
        player1: m.player1 || null, player2: m.player2 || null,
        winner: isBye ? m.player1 : (m.autoWin || null),
        loser: null,
        status: isBye ? 'completed' : (hasBoth ? 'pending' : 'awaiting_feeder'),
        bye: !!isBye,
        feedFrom: m.feedFrom ? prefixFeedFrom(m.feedFrom, prefix) : null,
        lobbyCode: hasBoth ? makeLobbyCode() : null,
        verifyMethod: hasBoth ? verify.verifyMethod : null,
        detection: verify.detection,
        verifyState: hasBoth ? {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        } : null,
        seriesFormat: seriesFmt,
        seriesScore: { a: 0, b: 0 }, games: [],
        seriesWinner: isBye ? m.player1 : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (nextStage.type === 'round_robin' || nextStage.type === 'squad_round_robin') {
    const sched = buildRoundRobinSchedule(advancers);
    for (const m of sched) {
      const docId = `${prefix}${m.id}`;
      const ref = tRef.collection('matches').doc(docId);
      batch.set(ref, {
        stageId,
        round: m.round, matchNumber: m.matchNumber,
        player1: m.player1, player2: m.player2,
        winner: null, loser: null, status: 'pending', bye: false,
        lobbyCode: makeLobbyCode(),
        verifyMethod: verify.verifyMethod, detection: verify.detection,
        verifyState: {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        },
        seriesFormat: seriesFmt, seriesScore: { a: 0, b: 0 }, games: [], seriesWinner: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (nextStage.type === 'swiss') {
    const r1 = buildSwissRound1(advancers);
    for (const m of r1) {
      const docId = `${prefix}${m.id}`;
      const ref = tRef.collection('matches').doc(docId);
      const isBye = m.bye;
      batch.set(ref, {
        stageId,
        round: m.round, matchNumber: m.matchNumber,
        player1: m.player1, player2: m.player2,
        winner: isBye ? m.player1 : null,
        loser: null, status: isBye ? 'completed' : 'pending',
        bye: isBye,
        lobbyCode: isBye ? null : makeLobbyCode(),
        verifyMethod: isBye ? null : verify.verifyMethod,
        detection: verify.detection,
        verifyState: isBye ? null : {
          [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
          [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
        },
        seriesFormat: seriesFmt,
        seriesScore: { a: isBye ? (seriesFmt === 'bo5' ? 3 : seriesFmt === 'bo3' ? 2 : 1) : 0, b: 0 },
        games: [], seriesWinner: isBye ? m.player1 : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (nextStage.type === 'battle_royale') {
    const games = buildBattleRoyaleGames(advancers, nextStage.brGameCount || 3);
    for (const g of games) {
      const docId = `${prefix}${g.id}`;
      const ref = tRef.collection('matches').doc(docId);
      batch.set(ref, {
        stageId,
        round: g.round, matchNumber: g.matchNumber, gameNumber: g.gameNumber,
        participants: g.participants,
        player1: null, player2: null,
        winner: null, loser: null, status: 'pending', bye: false,
        brResults: [], lobbyCode: makeLobbyCode(),
        verifyMethod: verify.verifyMethod, detection: verify.detection,
        verifyState: Object.fromEntries(g.participants.map((uid) => [
          uid, { status: 'pending', source: null, at: null, modUid: null },
        ])),
        seriesFormat: 'bo1', seriesScore: { a: 0, b: 0 }, games: [], seriesWinner: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } else {
    console.warn('advanceStageIfNeeded: unsupported next stage type', nextStage.type);
    return false;
  }

  // Flip tournament onto the new stage. Keep status='active' (we're not
  // done; we're advancing). type rewrites so existing auto-complete
  // checks for the stage's format fire correctly.
  batch.update(tRef, {
    type: nextStage.type,
    seriesFormat: seriesFmt,
    seedingMode: nextStage.seedingMode || 'inherit',
    brGameCount: nextStage.type === 'battle_royale' ? (nextStage.brGameCount || 3) : null,
    swissRounds: nextStage.type === 'swiss' ? (nextStage.swissRounds || null) : null,
    currentStageId: nextStage.id,
    stageHistory: FieldValue.arrayUnion({
      stageId: currentStage.id,
      completedAt: new Date(),
      rankingTop: advancers,
    }),
    'bracket.currentRound': 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify advancers.
  for (const uid of advancers) {
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      recipientId: uid,
      type: 'tournament_stage_advance',
      title: `${t.name} — ${nextStage.name || 'Next stage'}`,
      body: 'You advanced! Next stage matches are live.',
      data: { tournamentId, stageId: nextStage.id },
      actionUrl: `/match/${tournamentId}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`Advanced tournament ${tournamentId} → stage ${nextStage.id} with ${advancers.length} players.`);
  return true;
}

function prefixFeedFrom(feedFrom, prefix) {
  const out = {};
  for (const k of Object.keys(feedFrom)) {
    const v = feedFrom[k];
    out[k] = { ...v, matchId: `${prefix}${v.matchId}` };
  }
  return out;
}

// Per-stage standings. Mirrors computeRankingForTournament logic but
// scoped to a single stage's match slice. v1 only supports the formats
// likely to appear as qualifier/playoff stages.
async function computeStageRanking(stageT, matches) {
  if (!stageT || !Array.isArray(matches)) return [];
  const participants = new Set();
  for (const m of matches) {
    if (m.player1) participants.add(m.player1);
    if (m.player2) participants.add(m.player2);
    if (Array.isArray(m.participants)) m.participants.forEach((p) => participants.add(p));
  }

  if (stageT.type === 'swiss') {
    const wins = new Map();
    const lossesBy = new Map();
    const opps = new Map();
    for (const p of participants) { wins.set(p, 0); lossesBy.set(p, []); opps.set(p, []); }
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      if (m.bye && m.player1) { wins.set(m.player1, (wins.get(m.player1) || 0) + 1); continue; }
      if (m.player1 && m.player2) {
        opps.get(m.player1).push(m.player2);
        opps.get(m.player2).push(m.player1);
      }
      if (m.winner) wins.set(m.winner, (wins.get(m.winner) || 0) + 1);
    }
    // Buchholz tiebreak: sum of opponents' wins.
    const buch = new Map();
    for (const p of participants) {
      buch.set(p, (opps.get(p) || []).reduce((s, o) => s + (wins.get(o) || 0), 0));
    }
    return [...participants].sort((a, b) =>
      (wins.get(b) - wins.get(a)) || (buch.get(b) - buch.get(a)));
  }

  if (stageT.type === 'round_robin' || stageT.type === 'squad_round_robin') {
    const wins = new Map();
    const gf = new Map(); // goals/games-for
    const ga = new Map();
    for (const p of participants) { wins.set(p, 0); gf.set(p, 0); ga.set(p, 0); }
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      const a = m.player1, b = m.player2;
      const sA = m.seriesScore?.a || 0;
      const sB = m.seriesScore?.b || 0;
      if (a) { gf.set(a, gf.get(a) + sA); ga.set(a, ga.get(a) + sB); }
      if (b) { gf.set(b, gf.get(b) + sB); ga.set(b, ga.get(b) + sA); }
      if (m.winner) wins.set(m.winner, (wins.get(m.winner) || 0) + 1);
    }
    return [...participants].sort((a, b) =>
      (wins.get(b) - wins.get(a)) ||
      ((gf.get(b) - ga.get(b)) - (gf.get(a) - ga.get(a))) ||
      (gf.get(b) - gf.get(a)));
  }

  if (stageT.type === 'single_elim' || stageT.type === 'squad_single_elim' || stageT.type === 'invitational') {
    // Rank by round eliminated (later round = better). Winner first.
    const eliminatedRound = new Map();
    let maxRound = 0;
    for (const m of matches) {
      if (m.status === 'completed' && m.loser) {
        eliminatedRound.set(m.loser, m.round || 1);
        maxRound = Math.max(maxRound, m.round || 1);
      }
    }
    // Winner = participant not eliminated.
    const remaining = [...participants].filter((p) => !eliminatedRound.has(p));
    const sorted = [...participants].sort((a, b) => {
      const ra = remaining.includes(a) ? maxRound + 1 : (eliminatedRound.get(a) || 0);
      const rb = remaining.includes(b) ? maxRound + 1 : (eliminatedRound.get(b) || 0);
      return rb - ra;
    });
    return sorted;
  }

  if (stageT.type === 'double_elim') {
    // Rank by 2nd-loss order. Surviving = top.
    const lossCount = new Map();
    const lossOrder = new Map();
    let order = 0;
    for (const m of matches.slice().sort((a, b) => (a.round - b.round) || (a.matchNumber - b.matchNumber))) {
      if (m.status === 'completed' && m.loser) {
        lossCount.set(m.loser, (lossCount.get(m.loser) || 0) + 1);
        if (lossCount.get(m.loser) === 2) lossOrder.set(m.loser, order++);
      }
    }
    return [...participants].sort((a, b) => {
      const la = lossOrder.has(a) ? lossOrder.get(a) : -1;
      const lb = lossOrder.has(b) ? lossOrder.get(b) : -1;
      // Not yet eliminated (-1) = top.
      if (la === -1 && lb !== -1) return -1;
      if (lb === -1 && la !== -1) return 1;
      // Both eliminated → later 2nd-loss = better. Both alive → tie (input order).
      return lb - la;
    });
  }

  if (stageT.type === 'battle_royale') {
    const points = new Map();
    const PTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1];
    for (const m of matches) {
      if (!Array.isArray(m.brResults)) continue;
      for (const r of m.brResults) {
        const pts = PTS[(r.placement || 99) - 1] || 0;
        points.set(r.uid, (points.get(r.uid) || 0) + pts);
      }
    }
    return [...participants].sort((a, b) => (points.get(b) || 0) - (points.get(a) || 0));
  }

  return [...participants];
}

exports._internal_advanceStageIfNeeded = advanceStageIfNeeded;

// ─── Internal: record a match result + agree/dispute logic ────────────
// Shared between the callable (auth-gated) and HTTP webhooks (GSI / game API
// hooks). Already-validated callers pass `reporterUid` directly.
//
// Trusted sources (host/admin/gameapi/gsi) advance immediately on a single
// report. Player ('manual') reports require both sides to agree.
async function recordMatchResultInternal({ tournamentId, matchId, winnerId, reporterUid, source = 'manual', evidenceUrl = null }) {
  if (!tournamentId || !matchId || !winnerId || !reporterUid) {
    throw new HttpsError('invalid-argument', 'tournamentId, matchId, winnerId, reporterUid required');
  }
  if (!['manual', 'gameapi', 'gsi', 'admin'].includes(source)) {
    throw new HttpsError('invalid-argument', 'invalid source');
  }

  const tRef = db.collection('tournaments').doc(tournamentId);
  const matchRef = tRef.collection('matches').doc(matchId);
  const reportRef = matchRef.collection('reports').doc(reporterUid);

  const result = await db.runTransaction(async (tx) => {
    const [tSnap, mSnap, rSnap] = await Promise.all([tx.get(tRef), tx.get(matchRef), tx.get(reportRef)]);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    if (!mSnap.exists) throw new HttpsError('not-found', 'Match not found');
    const t = tSnap.data();
    const m = mSnap.data();

    if (t.status !== 'active') throw new HttpsError('failed-precondition', 'Tournament not active');
    if (m.status === 'completed') throw new HttpsError('failed-precondition', 'Match already completed');

    if (winnerId !== m.player1 && winnerId !== m.player2) {
      throw new HttpsError('invalid-argument', 'Winner must be one of the match players');
    }

    const isHost = reporterUid === t.adminId;
    const isPlayer = reporterUid === m.player1 || reporterUid === m.player2;
    // `vanguard` is an authoritative source (Vanguard moderator manually
    // decided the winner). Same trust level as admin / gameapi / gsi —
    // auto-completes the match without two-player agreement.
    const trustedSource = source === 'admin' || source === 'gameapi' || source === 'gsi' || source === 'vanguard';

    // High-stakes proof gate. Entry > WEBCAM_PRIZE_THRESHOLD requires the
    // WINNER to have at least one proof-feed chunk uploaded via
    // `appendProofChunk` before they can claim the result. Trusted sources
    // bypass — a mod/admin/GSI decision is more authoritative than chunk
    // count, and we don't want a webcam outage to block legitimate calls.
    const { WEBCAM_PRIZE_THRESHOLD } = require('./tournamentRules');
    if (!trustedSource && (t.entryFee || 0) > WEBCAM_PRIZE_THRESHOLD) {
      const winnerProof = m.proofFeed?.[winnerId];
      if (!winnerProof?.chunks?.length) {
        throw new HttpsError(
          'failed-precondition',
          'High-stakes match requires the winner to have an active two-camera proof feed. ' +
          'Start the proof recorder (top-right corner of the match screen) before claiming a result, ' +
          'or ask a Vanguard moderator to call the match.'
        );
      }
    }
    if (!isHost && !isPlayer && !trustedSource) {
      throw new HttpsError('permission-denied', 'Only players, host, or trusted sources can report');
    }

    // Finding #2 — a player/host-reported result requires both sides to have
    // engaged lobby verification first (status 'verified' OR 'self_attested',
    // not 'pending'/'rejected'). Stops the same-lobby check being skipped.
    // Trusted automated/mod sources bypass (authoritative + can unstick a
    // match where a player refuses to verify). Only enforced when the match
    // actually carries a verification scaffold (byes/legacy docs have none).
    if (!trustedSource && m.verifyState && m.player1 && m.player2) {
      const engaged = (pid) => {
        const st = m.verifyState[pid]?.status;
        return st === 'verified' || st === 'self_attested';
      };
      if (!engaged(m.player1) || !engaged(m.player2)) {
        throw new HttpsError(
          'failed-precondition',
          'Both players must verify (or self-attest) the lobby code before a result can be reported. ' +
          'If your opponent will not verify, ask a Vanguard moderator to call the match.'
        );
      }
    }

    if (rSnap.exists && rSnap.data().winnerId === winnerId) {
      return { ok: true, status: m.status, alreadyReported: true };
    }

    // A host who is ALSO a player in this match does NOT get the trusted
    // fast-path — they could otherwise declare themselves winner of their own
    // match with no agreement. They go through the player path like anyone.
    const hostTrusted = isHost && !isPlayer;

    // ⚠️ Transactions require ALL reads before ANY write — read the other
    // side's report BEFORE tx.set below. (The old read-after-write here threw
    // "Firestore transactions require all reads to be executed before all
    // writes" on EVERY player-path report.)
    const otherPlayerId = reporterUid === m.player1 ? m.player2 : m.player1;
    const otherReportRef = matchRef.collection('reports').doc(otherPlayerId);
    const otherSnap = (!hostTrusted && !trustedSource)
      ? await tx.get(otherReportRef)
      : null;

    tx.set(reportRef, {
      winnerId,
      reportedBy: reporterUid,
      source,
      evidenceUrl: evidenceUrl || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (hostTrusted || trustedSource) {
      const loser = winnerId === m.player1 ? m.player2 : m.player1;
      tx.update(matchRef, {
        winner: winnerId,
        loser,
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: source,
      });
      return { ok: true, status: 'completed' };
    }

    // Manual player path: needs agreement from the other player.
    if (!otherSnap.exists) {
      // Auto-confirm window: if the opponent neither confirms nor contests
      // before the deadline, the cron records the claimed result. Keeps
      // results near-instant instead of waiting on a player who walked away.
      const confirmWindowMs = Number(t.confirmWindowMs) || (3 * 60 * 1000);
      const confirmDeadlineMs = Date.now() + confirmWindowMs;
      tx.update(matchRef, {
        status: 'awaiting_confirmation',
        firstReporter: reporterUid,
        firstReportedWinner: winnerId,
        firstReportedAt: FieldValue.serverTimestamp(),
        confirmDeadlineMs,
      });
      // Ping the opponent the moment a result is claimed — this was silent
      // before, which made result latency "whenever they reopen the app".
      if (otherPlayerId) {
        const claimedSelf = winnerId === reporterUid;
        tx.set(db.collection('notifications').doc(), {
          recipientId: otherPlayerId,
          type: 'tournament_result_confirm',
          title: claimedSelf
            ? 'Opponent reported they won — confirm or contest'
            : 'Opponent reported YOU won — confirm the result',
          body: `No response within ${Math.max(1, Math.round(confirmWindowMs / 60000))} minutes accepts the reported result.`,
          data: { tournamentId, matchId, claimedWinner: winnerId, confirmDeadlineMs: String(confirmDeadlineMs) },
          actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return { ok: true, status: 'awaiting_confirmation' };
    }
    const other = otherSnap.data();
    if (other.winnerId === winnerId) {
      const loser = winnerId === m.player1 ? m.player2 : m.player1;
      tx.update(matchRef, {
        winner: winnerId,
        loser,
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: source,
      });
      return { ok: true, status: 'completed' };
    }
    tx.update(matchRef, {
      status: 'disputed',
      disputedAt: FieldValue.serverTimestamp(),
    });
    const dRef = tRef.collection('disputes').doc(matchId);
    tx.set(dRef, {
      matchId,
      tournamentId,
      reports: [
        { uid: reporterUid, winnerId, source },
        { uid: otherPlayerId, winnerId: other.winnerId, source: other.source || 'manual' },
      ],
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, status: 'disputed' };
  });

  if (result.status === 'completed') {
    await advanceBracketAfterMatch(tournamentId, matchId);
    // Double-elim: fill the next-round feeders this match flows into.
    await fillDoubleElimFeeders(tournamentId, matchId);
    // Then the GF / GF-reset emerge from the format's "2 losses out" rule.
    await advanceDoubleElimIfNeeded(tournamentId);
    // Swiss: when the current round's matches all complete, pair the next.
    await advanceSwissIfNeeded(tournamentId);
    // Non-single-elim brackets need an explicit check + auto-complete pass.
    await autoCompleteNonSingleElimIfDone(tournamentId);
  }
  return result;
}

// Swiss round-by-round advancer. When every match in the current round
// finishes, generates the next round's pairings via buildNextSwissRound
// and writes them. No-ops if the configured round count is reached
// (autoCompleteNonSingleElimIfDone will then mark the tournament done).
async function advanceSwissIfNeeded(tournamentId) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const t = (await tRef.get()).data();
  if (!t || t.type !== 'swiss' || t.status !== 'active') return;

  const matchesSnap = await tRef.collection('matches').get();
  const matches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (matches.length === 0) return;
  const targetRounds = t.bracketData?.totalRounds || Math.ceil(Math.log2(Math.max(2, (t.participants || []).length)));

  const maxRound = matches.reduce((mx, m) => Math.max(mx, m.round || 0), 0);
  const currentRoundMatches = matches.filter((m) => m.round === maxRound);
  if (currentRoundMatches.some((m) => m.status === 'pending' || m.status === 'in_progress')) return;
  if (maxRound >= targetRounds) return; // tournament is done after this round

  // All matches in maxRound complete — generate next round pairings.
  const nextRound = maxRound + 1;
  const completed = matches.filter((m) => m.status === 'completed');
  const pairings = buildNextSwissRound(t.participants || [], completed, nextRound);
  if (pairings.length === 0) return;

  const verify = gameVerifyProfile(t.game);
  const batch = db.batch();
  for (const m of pairings) {
    const ref = tRef.collection('matches').doc(m.id);
    // Phase 3 — Swiss rounds inherit the tournament's seriesFormat.
    const swissSeriesFmt = t.seriesFormat || 'bo1';
    if (m.bye) {
      batch.set(ref, {
        round: m.round, matchNumber: m.matchNumber,
        player1: m.player1, player2: null,
        winner: m.player1, loser: null,
        status: 'completed', bye: true,
        seriesFormat: swissSeriesFmt,
        seriesScore: { a: swissSeriesFmt === 'bo5' ? 3 : swissSeriesFmt === 'bo3' ? 2 : 1, b: 0 },
        games: [], seriesWinner: m.player1,
        createdAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        completedBy: 'swiss_bye',
      });
      continue;
    }
    batch.set(ref, {
      round: m.round, matchNumber: m.matchNumber,
      player1: m.player1, player2: m.player2,
      winner: null, loser: null, status: 'pending', bye: false,
      lobbyCode: makeLobbyCode(),
      verifyMethod: verify.verifyMethod,
      detection: verify.detection,
      verifyState: {
        [m.player1]: { status: 'pending', source: null, at: null, modUid: null },
        [m.player2]: { status: 'pending', source: null, at: null, modUid: null },
      },
      seriesFormat: swissSeriesFmt, seriesScore: { a: 0, b: 0 }, games: [], seriesWinner: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Ping both players the new pairing is up.
    for (const uid of [m.player1, m.player2]) {
      const nRef = db.collection('notifications').doc();
      batch.set(nRef, {
        recipientId: uid, type: 'tournament_match_ready',
        title: `${t.name || 'Tournament'} — Round ${nextRound} paired`,
        body: 'Your next opponent is locked in.',
        data: { tournamentId, matchId: m.id },
        actionUrl: `/tournaments/${tournamentId}/match/${m.id}`,
        read: false, createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  batch.update(tRef, { 'bracket.currentRound': nextRound });
  await batch.commit();
}

// Walks the matches subcollection after a DE match completes, finding any
// match whose `feedFrom.player1.matchId` or `feedFrom.player2.matchId` is
// the just-completed match. Fills the slot with the appropriate winner or
// loser, generates verification scaffolding when both slots are populated,
// and flips status from 'awaiting_feeder' → 'pending'.
async function fillDoubleElimFeeders(tournamentId, completedMatchId) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const t = (await tRef.get()).data();
  if (!t || t.type !== 'double_elim') return;
  const completedSnap = await tRef.collection('matches').doc(completedMatchId).get();
  if (!completedSnap.exists) return;
  const completed = completedSnap.data();
  const winner = completed.winner;
  const loser = completed.loser;

  const fedSnap = await tRef.collection('matches')
    .where('status', '==', 'awaiting_feeder').get();
  if (fedSnap.empty) return;

  const verify = gameVerifyProfile(t.game);
  for (const md of fedSnap.docs) {
    const m = md.data();
    if (!m.feedFrom) continue;
    const updates = {};
    let player1 = m.player1;
    let player2 = m.player2;

    if (m.feedFrom.player1?.matchId === completedMatchId) {
      const role = m.feedFrom.player1.role;
      player1 = role === 'winner' ? winner : loser;
      if (player1) updates.player1 = player1;
    }
    if (m.feedFrom.player2?.matchId === completedMatchId) {
      const role = m.feedFrom.player2.role;
      player2 = role === 'winner' ? winner : loser;
      if (player2) updates.player2 = player2;
    }
    if (Object.keys(updates).length === 0) continue;

    if (player1 && player2) {
      // Both slots populated — match is now playable. Generate lobby code
      // + verifyState the same way matches created upfront get them.
      updates.status = 'pending';
      updates.lobbyCode = makeLobbyCode();
      updates.verifyMethod = verify.verifyMethod;
      updates.detection = verify.detection;
      updates.verifyState = {
        [player1]: { status: 'pending', source: null, at: null, modUid: null },
        [player2]: { status: 'pending', source: null, at: null, modUid: null },
      };
      // Ping both players: "your next match is ready".
      try {
        await db.collection('notifications').add({
          recipientId: player1,
          type: 'tournament_match_ready',
          title: `${t.name || 'Tournament'} — next match is ready`,
          body: `Round ${m.round} · ${m.bracketSide?.toUpperCase() || ''} — opponent locked in.`,
          data: { tournamentId, matchId: md.id },
          actionUrl: `/tournaments/${tournamentId}/match/${md.id}`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
        await db.collection('notifications').add({
          recipientId: player2,
          type: 'tournament_match_ready',
          title: `${t.name || 'Tournament'} — next match is ready`,
          body: `Round ${m.round} · ${m.bracketSide?.toUpperCase() || ''} — opponent locked in.`,
          data: { tournamentId, matchId: md.id },
          actionUrl: `/tournaments/${tournamentId}/match/${md.id}`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
      } catch { /* notifications are best-effort */ }
    }
    await md.ref.update(updates);
  }
}

// Double-elim auto-pairer. After any completed double-elim match, this
// counts losses per participant and:
//   - If only 1 player is still alive (< 2 losses) → tournament is done
//     (handled by autoCompleteNonSingleElimIfDone).
//   - If exactly 2 players are alive AND no pending matches exist → create
//     a Grand Final match between them. Works for BOTH the regular GF
//     (WB-champ vs LB-champ) AND the GF reset (when LB-champ won the first
//     GF and both still have 1 loss). Uses the format's own rule ("2 losses
//     to be out") instead of a client-set `isGrandFinal` flag.
async function advanceDoubleElimIfNeeded(tournamentId) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) return;
  const t = tSnap.data();
  if (t.type !== 'double_elim') return;
  if (t.status !== 'active') return;

  const matchesSnap = await tRef.collection('matches').get();
  const matches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (matches.length === 0) return;
  if (matches.some((m) => m.status === 'pending' || m.status === 'in_progress')) return;

  // Count losses per participant.
  const losses = new Map();
  for (const uid of (t.participants || [])) losses.set(uid, 0);
  for (const m of matches) {
    if (m.status !== 'completed' || !m.loser) continue;
    losses.set(m.loser, (losses.get(m.loser) || 0) + 1);
  }
  const alive = [...losses.entries()].filter(([, n]) => n < 2).map(([uid]) => uid);
  if (alive.length !== 2) return; // 1 = done (handled elsewhere); 3+ = bracket still mid-flow

  const [a, b] = alive;
  // De-duplicate: don't re-create if a match between these two is already
  // queued from a prior pass.
  const dup = matches.find((m) =>
    m.status === 'pending' &&
    ((m.player1 === a && m.player2 === b) || (m.player1 === b && m.player2 === a)),
  );
  if (dup) return;

  // Which of the two has zero losses gets `player1` (the "WB champion" slot,
  // visible in UI ordering — but the 2-loss rule treats both symmetrically).
  const wbChampFirst = (losses.get(a) || 0) === 0;
  const p1 = wbChampFirst ? a : b;
  const p2 = wbChampFirst ? b : a;

  // The GF round number = max round + 1. Match number 1 (only one match).
  const maxRound = matches.reduce((mx, m) => Math.max(mx, m.round || 0), 0);
  const round = maxRound + 1;
  const id = matchDocId(round, 1);
  const verify = gameVerifyProfile(t.game);
  // Tag bracketSide + isGrandFinal for UI display only — server logic
  // doesn't depend on either flag for any decision.
  const isReset = matches.some((m) => m.isGrandFinal && m.status === 'completed');
  await tRef.collection('matches').doc(id).set({
    round, matchNumber: 1,
    player1: p1, player2: p2,
    winner: null, loser: null, status: 'pending',
    bye: false,
    isGrandFinal: true,
    isGrandFinalReset: isReset,
    bracketSide: 'gf',
    lobbyCode: makeLobbyCode(),
    verifyMethod: verify.verifyMethod,
    detection: verify.detection,
    verifyState: {
      [p1]: { status: 'pending', source: null, at: null, modUid: null },
      [p2]: { status: 'pending', source: null, at: null, modUid: null },
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}

// For non-single-elim tournaments (BR / Swiss / RoundRobin / DoubleElim /
// Invitational), tournament-level status='completed' is never auto-flipped
// by the single-elim advance path. This helper checks "is the bracket done?"
// and flips status + triggers finalize when it is. Idempotent.
async function autoCompleteNonSingleElimIfDone(tournamentId) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) return;
  const t = tSnap.data();
  if (t.status === 'completed' || t.status === 'cancelled') return;
  // Single-elim is handled by advanceBracketAfterMatch already.
  if (t.type === 'single_elim' || t.type === 'squad_single_elim' || !t.type) return;

  const matchesSnap = await tRef.collection('matches').get();
  const matches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (matches.length === 0) return;

  const hasPending = matches.some((m) => m.status === 'pending' || m.status === 'in_progress');
  if (hasPending) return;

  // Per-type "is the tournament actually done" check.
  let done = false;
  if (t.type === 'battle_royale') {
    const want = t.brGameCount || 1;
    const completedGames = matches.filter((m) => m.status === 'completed').length;
    done = completedGames >= want;
  } else if (t.type === 'squad_round_robin' || t.type === 'round_robin') {
    // Full round-robin = N*(N-1)/2 matches when no draws/byes.
    const n = (t.participants || []).length;
    const wantMatches = Math.floor((n * (n - 1)) / 2);
    const completed = matches.filter((m) => m.status === 'completed').length;
    done = completed >= wantMatches && wantMatches > 0;
  } else if (t.type === 'swiss') {
    const rounds = t.swissRounds || 0;
    // Swiss is done when the highest completed round equals the configured count.
    const maxCompletedRound = matches.filter((m) => m.status === 'completed')
      .reduce((max, m) => Math.max(max, m.round || 0), 0);
    done = rounds > 0 && maxCompletedRound >= rounds;
  } else if (t.type === 'double_elim') {
    // Double-elim is done when every participant except one has taken
    // two losses (the rule of the format itself — no client flag needed).
    const losses = new Map();
    for (const m of matches) {
      if (m.status !== 'completed' || !m.loser) continue;
      losses.set(m.loser, (losses.get(m.loser) || 0) + 1);
    }
    const remaining = (t.participants || [])
      .filter((p) => (losses.get(p) || 0) < 2).length;
    done = remaining <= 1 && matches.length > 0;
  } else if (t.type === 'invitational') {
    // Invitational uses single-elim structure under the hood. Done when
    // only one player is undefeated, exactly like single-elim.
    const lostUids = new Set();
    for (const m of matches) {
      if (m.status === 'completed' && m.loser) lostUids.add(m.loser);
    }
    const remaining = (t.participants || []).filter((p) => !lostUids.has(p)).length;
    done = remaining <= 1 && matches.length > 0;
  }

  if (!done) return;

  // Phase 2 — multi-stage handoff. If there's a next stage queued,
  // advance instead of finalising. advanceStageIfNeeded re-stamps
  // tournament.type to next stage's type so subsequent auto-complete
  // checks fire for the new format.
  const advanced = await advanceStageIfNeeded(tournamentId, /* currentStageJustCompleted */ true);
  if (advanced) return;

  await tRef.update({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
  });
  try {
    await finalizeInternal(tournamentId, { uid: null });
  } catch (err) {
    console.error('auto-finalize failed (non-single-elim)', tournamentId, err);
  }
}

exports._internal_recordMatchResult = recordMatchResultInternal;
exports._internal_advanceBracket = advanceBracketAfterMatch;

// ─── 5. reportMatchResultSecure (auth-gated wrapper) ──────────────────
exports.reportMatchResultSecure = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { tournamentId, matchId, winnerId, source = 'manual', evidenceUrl = null } = request.data || {};
  if (source === 'admin') await requireAdmin(uid);
  if (source === 'gameapi' || source === 'gsi') {
    throw new HttpsError('permission-denied', 'gameapi/gsi sources can only be set by server hooks');
  }
  return recordMatchResultInternal({
    tournamentId, matchId, winnerId, reporterUid: uid, source, evidenceUrl,
  });
});

// ─── Bracket advancement (single-elim) ────────────────────────────────
// Called outside the report transaction so we don't block on cross-round
// reads. Idempotent: only writes round N+1 docs that don't already exist.
async function advanceBracketAfterMatch(tournamentId, matchId) {
  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) return;
  const t = tSnap.data();
  if (t.status !== 'active') return;

  // Parse round from doc id (rN_mM).
  const m = /^r(\d+)_m(\d+)$/.exec(matchId);
  if (!m) return;
  const round = parseInt(m[1], 10);

  const roundQ = await tRef.collection('matches').where('round', '==', round).get();
  const roundMatches = roundQ.docs.map(d => ({ id: d.id, ...d.data() }));
  if (roundMatches.some(rm => rm.status !== 'completed')) return;

  const winners = roundMatches
    .sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0))
    .map(rm => rm.winner)
    .filter(Boolean);

  // Tournament over — mark complete + auto-finalize payouts.
  if (winners.length <= 1) {
    // Phase 2 — if this is the final round of a stage in a multi-stage
    // tournament AND a next stage exists, advance instead of finalising.
    const advanced = await advanceStageIfNeeded(tournamentId, true);
    if (advanced) return;

    const finalMatch = roundMatches[0];
    const second = finalMatch?.loser || null;
    const semiQ = await tRef.collection('matches').where('round', '==', round - 1).get();
    const semiLosers = semiQ.docs.map(d => d.data().loser).filter(Boolean);
    await tRef.update({
      status: 'completed',
      winnerId: winners[0] || null,
      placements: { first: winners[0] || null, second, third: semiLosers },
      completedAt: FieldValue.serverTimestamp(),
      'bracket.currentRound': round,
    });
    // Auto-finalize. Idempotent — finalizeInternal short-circuits if
    // payoutStatus is already 'paid'. The host's manual "Finalize Now"
    // button is a safety net if this ever fails silently.
    try {
      await finalizeInternal(tournamentId, { uid: null });
    } catch (err) {
      console.error('auto-finalize failed', tournamentId, err);
    }
    return;
  }

  const nextRound = round + 1;
  const batch = db.batch();
  const tDoc = await tRef.get();
  const verify = gameVerifyProfile(tDoc.data()?.game);
  for (let i = 0; i < winners.length; i += 2) {
    const matchNumber = i / 2 + 1;
    const id = matchDocId(nextRound, matchNumber);
    const ref = tRef.collection('matches').doc(id);
    const existing = await ref.get();
    if (existing.exists) continue;
    const p1 = winners[i];
    const p2 = winners[i + 1] || null;
    const isBye = !p2;
    batch.set(ref, {
      lobbyCode: isBye ? null : makeLobbyCode(),
      verifyMethod: isBye ? null : verify.verifyMethod,
      detection: verify.detection,
      verifyState: isBye ? null : {
        [p1]: { status: 'pending', source: null, at: null, modUid: null },
        [p2]: { status: 'pending', source: null, at: null, modUid: null },
      },
      round: nextRound,
      matchNumber,
      player1: p1,
      player2: p2,
      winner: p2 ? null : p1,
      loser: null,
      status: p2 ? 'pending' : 'completed',
      bye: !p2,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(tRef, { 'bracket.currentRound': nextRound });
  await batch.commit();
}

// ─── 6. finalizeTournamentSecure ──────────────────────────────────────
// Pays out per PRIZE_DISTRIBUTION using the existing `placements` field.
// Host-only when called externally. Idempotent: tournament must be
// status='completed' & not yet 'paid'; flips to 'paid' inside the same tx
// that credits wallets.
//
// `finalizeInternal` is the underlying logic — same transaction shape, but
// no auth check. Used by `advanceBracketAfterMatch` to auto-finalize the
// moment the bracket resolves to a single winner (no host action needed).
// Returns a full ordered ranking ([uid1=winner, uid2, ...]) of every
// participant for any bracket type. Used by finalizeInternal to derive
// both `placements` (first/second/third) AND the per-place Tournament
// Points award. Reads must run OUTSIDE the calling transaction.
async function computeRankingForTournament(tRef, t) {
  const matchesSnap = await tRef.collection('matches').get();
  const matches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const participants = t.participants || [];
  const type = t.type;

  // ── single-elim / squad_single_elim ─────────────────────────────────
  // Place = bracket round you were eliminated in. Winner = round N+1 (never
  // eliminated). Players eliminated in the same round tie and are placed
  // by reverse match-completion order (later loss = better tiebreak).
  if (type === 'single_elim' || type === 'squad_single_elim' || !type) {
    const lossRound = new Map();   // uid → round eliminated
    let winner = null;
    let maxRound = 0;
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      if (m.round > maxRound) maxRound = m.round;
      if (m.loser) lossRound.set(m.loser, m.round);
    }
    for (const m of matches) {
      if (m.status === 'completed' && m.round === maxRound) winner = m.winner;
    }
    const ranked = [];
    if (winner) ranked.push(winner);
    const byRound = new Map();   // round → uid[]
    for (const [uid, r] of lossRound.entries()) {
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r).push(uid);
    }
    const rounds = [...byRound.keys()].sort((a, b) => b - a); // highest round = better place
    for (const r of rounds) ranked.push(...byRound.get(r));
    for (const p of participants) if (!ranked.includes(p)) ranked.push(p);
    return ranked;
  }

  // ── double-elim — last to accumulate 2 losses wins ───────────────────
  if (type === 'double_elim') {
    const losses = new Map();
    const lastLossOrder = new Map();  // uid → ts of 2nd loss
    let order = 0;
    for (const m of matches) {
      if (m.status !== 'completed' || !m.loser) continue;
      order++;
      const n = (losses.get(m.loser) || 0) + 1;
      losses.set(m.loser, n);
      if (n === 2) lastLossOrder.set(m.loser, order);
    }
    // Winner = participant who never reached 2 losses.
    const eliminated = [...lastLossOrder.keys()];
    const stillIn = participants.filter((p) => !lastLossOrder.has(p));
    // Order eliminated by time-of-2nd-loss descending (later = better place).
    eliminated.sort((a, b) => lastLossOrder.get(b) - lastLossOrder.get(a));
    return [...stillIn, ...eliminated];
  }

  // ── battle_royale — VERGR canonical points table (Tournament System doc).
  // 1st=15, 2nd=12, 3rd=10, 4th=8, 5th=6, 6th=5, 7th=4, 8th=3, 9th=2, 10th=1,
  // 11th+ = 0 (still appear in ranking but earn no game points; TP system
  // pays them participation TP separately).
  if (type === 'battle_royale') {
    const POINTS = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
    const total = new Map();
    for (const m of matches) {
      if (!Array.isArray(m.brResults)) continue;
      for (const r of m.brResults) {
        const pts = POINTS[r.place] || 0;
        total.set(r.playerId, (total.get(r.playerId) || 0) + pts);
      }
    }
    for (const p of participants) if (!total.has(p)) total.set(p, 0);
    return [...total.entries()].sort((a, b) => b[1] - a[1]).map(([uid]) => uid);
  }

  // ── round_robin / squad_round_robin — wins → goal diff → goals for ─
  if (type === 'squad_round_robin' || type === 'round_robin') {
    const table = new Map();
    const ensure = (id) => {
      if (!table.has(id)) table.set(id, { id, w: 0, l: 0, d: 0, gf: 0, ga: 0 });
      return table.get(id);
    };
    for (const p of participants) ensure(p);
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      const a = ensure(m.player1); const b = ensure(m.player2);
      const hs = m.homeScore, as = m.awayScore;
      if (hs == null || as == null) {
        if (m.winner === m.player1) { a.w++; b.l++; a.gf++; b.ga++; }
        else if (m.winner === m.player2) { b.w++; a.l++; b.gf++; a.ga++; }
        else { a.d++; b.d++; }
        continue;
      }
      a.gf += hs; a.ga += as; b.gf += as; b.ga += hs;
      if (hs > as) { a.w++; b.l++; }
      else if (hs < as) { b.w++; a.l++; }
      else { a.d++; b.d++; }
    }
    return [...table.values()]
      .sort((x, y) =>
        (y.w - x.w) ||
        ((y.gf - y.ga) - (x.gf - x.ga)) ||
        (y.gf - x.gf))
      .map((t2) => t2.id);
  }

  // ── swiss — wins → Buchholz (sum of opponent wins) ─────────────────
  if (type === 'swiss') {
    const wins = new Map();
    const opps = new Map();
    for (const p of participants) { wins.set(p, 0); opps.set(p, new Set()); }
    for (const m of matches) {
      if (m.status !== 'completed') continue;
      if (m.player1 && m.player2) {
        opps.get(m.player1)?.add(m.player2);
        opps.get(m.player2)?.add(m.player1);
      }
      if (m.winner) wins.set(m.winner, (wins.get(m.winner) || 0) + 1);
    }
    const buchholz = (uid) => {
      let s = 0;
      for (const o of opps.get(uid) || []) s += wins.get(o) || 0;
      return s;
    };
    return [...wins.entries()]
      .sort((a, b) => (b[1] - a[1]) || (buchholz(b[0]) - buchholz(a[0])))
      .map(([uid]) => uid);
  }

  // ── invitational — uses single-elim semantics on whatever bracket the
  // client built. Recurse with the type swapped so the same logic applies.
  if (type === 'invitational') {
    return computeRankingForTournament(tRef, { ...t, type: 'single_elim' });
  }

  return participants.slice();
}

// Convenience wrapper used by older callers that just want first/second/third.
function placementsFromRanking(ranking) {
  if (!ranking || ranking.length === 0) return null;
  return {
    first: ranking[0] || null,
    second: ranking[1] || null,
    third: ranking.slice(2, 4),
  };
}

// ─── Tournament Points (TP) ──────────────────────────────────────────────
// Separate from VP and from coin prizes. Awarded to every participant on
// tournament completion, scaled by placement + tournament size + entry fee.
// Drives the public Top Players leaderboard (users.tournamentPoints).
//
// Base table per finishing place (capped at place 32, then min-floor):
//   1st  →  1000   5th–8th   → 175 each
//   2nd  →   600   9th–16th  → 100 each
//   3rd  →   400   17th–32nd →  50 each
//   4th  →   250   33rd+     →  25 each (participation)
//
// Size multiplier:  log2(max(2, participantCount))   → 4p=2x, 8p=3x, 16p=4x, 32p=5x, 64p=6x, 128p=7x
// Stake multiplier: 1 + min(2, entryFee / 1000)      → 0c=1x, 500c=1.5x, 1000c=2x, 2000c+=3x
function tournamentPointsFor(place, participantCount, entryFee) {
  const baseTable = { 1: 1000, 2: 600, 3: 400, 4: 250 };
  let base;
  if (place <= 4)       base = baseTable[place];
  else if (place <= 8)  base = 175;
  else if (place <= 16) base = 100;
  else if (place <= 32) base = 50;
  else                  base = 25;
  const sizeMult = Math.log2(Math.max(2, participantCount));
  const feeMult  = 1 + Math.min(2, (entryFee || 0) / 1000);
  return Math.max(1, Math.floor(base * sizeMult * feeMult));
}

async function finalizeInternal(tournamentId, { uid = null } = {}) {
  const tRef = db.collection('tournaments').doc(tournamentId);

  // Pre-tx: compute the full participant ranking from match data. Used
  // both to fill `placements` (for prize payouts) and to award Tournament
  // Points to every participant. Queries can't run inside the tx so we
  // do them here and fold the writes into the tx below.
  const preSnap = await tRef.get();
  let ranking = null;
  let computedPlacements = null;
  if (preSnap.exists) {
    const td = preSnap.data();
    if (td.status === 'completed' && td.payoutStatus !== 'paid') {
      ranking = await computeRankingForTournament(tRef, td);
      if (!td.placements?.first) {
        computedPlacements = placementsFromRanking(ranking);
      }
    }
  }

  return db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const t = tSnap.data();
    // Auth check: skip entirely for internal (uid === null) calls.
    if (uid !== null && t.adminId !== uid) {
      const userSnap = await tx.get(db.collection('users').doc(uid));
      if (!userSnap.exists || userSnap.data()?.role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only the host or an admin can finalize');
      }
    }
    if (t.status !== 'completed') throw new HttpsError('failed-precondition', 'Tournament not completed');
    if (t.payoutStatus === 'paid') return { ok: true, alreadyPaid: true };

    // Ticketed events pay out the declared purse (ticket-sale slice + host
    // top-up) at 100% — the 10% platform cut was already taken at ticket
    // sale, so no mod cut here. Legacy prize-pool events pay from the
    // escrowed entry fees with the standard 5% mod cut.
    // Only EXPLICITLY-ticketed events pay from declaredPurse. Legacy docs with
    // no fundingModel field must keep paying from prizePool (entry fees).
    const isTicketed = t.fundingModel === 'ticketed';
    const payoutPool = isTicketed ? (t.declaredPurse || 0) : (t.prizePool || 0);
    const breakdown = computePrizeBreakdown(payoutPool, t.type, {
      squadTreasury: t.mode === 'squad' && !!t.squadId,
      ...(isTicketed ? { modCutPct: 0 } : {}),
    });

    // Fold in computed placements if needed.
    let placements = t.placements || {};
    if ((!placements.first) && computedPlacements) {
      placements = computedPlacements;
      tx.update(tRef, { placements });
    }
    const placeMap = {
      1: placements.first || null,
      2: placements.second || null,
      3: Array.isArray(placements.third) ? placements.third[0] : (placements.third || null),
      4: Array.isArray(placements.third) ? (placements.third[1] || null) : null,
    };

    // Squad tournaments: placement uids are SQUAD IDs (not individual uids).
    // Per the Tournament System doc: "Total prize pool goes to the squad
    // treasury to be distributed at the end of the month, not individual
    // players that took part." So for mode='squad', BOTH the player share
    // and the treasury share land on `squads/{squadId}.treasury`.
    const isSquadMode = t.mode === 'squad';

    // ─── COIN PAYOUT (winner-takes-all per PRIZE_DISTRIBUTION) ──────────
    // PRIZE_DISTRIBUTION is single-place (place 1 @ 100%). Solo = winner's
    // wallet; squad = winning squad's treasury.
    for (const p of breakdown.payouts) {
      const winnerId = placeMap[p.place];
      if (!winnerId) continue;

      if (isSquadMode) {
        const totalToSquad = (p.player || 0) + (p.treasury || 0);
        if (totalToSquad > 0) {
          const sRef = db.collection('squads').doc(winnerId);
          tx.update(sRef, {
            treasury: FieldValue.increment(totalToSquad),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('transactions').doc(), {
            squadId: winnerId,
            type: 'squad_tournament_prize',
            amount: totalToSquad,
            description: `Squad prize: ${t.name} (place ${p.place})`,
            tournamentId,
            place: p.place,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        if (p.player > 0) {
          const wRef = db.collection('wallets').doc(winnerId);
          tx.update(wRef, {
            balance: FieldValue.increment(p.player),
            // convertible: tournament prize (received value) — see coinLedger.js
            earnedBalance: FieldValue.increment(p.player),
            totalEarned: FieldValue.increment(p.player),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('transactions').doc(), {
            userId: winnerId,
            type: 'tournament_prize',
            amount: p.player,
            description: `Prize: ${t.name} (place ${p.place})`,
            tournamentId,
            place: p.place,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        if (p.treasury > 0 && t.squadId) {
          const sRef = db.collection('squads').doc(t.squadId);
          tx.update(sRef, {
            treasury: FieldValue.increment(p.treasury),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('transactions').doc(), {
            squadId: t.squadId,
            type: 'squad_treasury_credit',
            amount: p.treasury,
            description: `Treasury share: ${t.name} (place ${p.place})`,
            tournamentId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // ─── MP1 — winner notification + prize-receipt deep-link ───────────
    // Payouts were silent before; tell the winner they won and link to the
    // receipt screen. Pushes via the FCM allowlist (type tournament_won).
    const winnerPlace1 = placeMap[1];
    if (winnerPlace1) {
      const p1 = breakdown.payouts.find((p) => p.place === 1) || {};
      const winnerCoins = (p1.player || 0) + (isSquadMode ? (p1.treasury || 0) : 0);
      const recipients = isSquadMode
        ? ((t.squadChampions || {})[winnerPlace1] || [])
        : [winnerPlace1];
      const championUntil = Date.now() + 7 * 24 * 60 * 60 * 1000; // GR4 — 7-day frame
      for (const rid of recipients) {
        if (!rid) continue;
        tx.set(db.collection('notifications').doc(), {
          recipientId: rid,
          type: 'tournament_won',
          title: `You won ${t.name || 'the tournament'}!`,
          body: isSquadMode
            ? `Your squad took 1st — ${winnerCoins.toLocaleString()} coins to the treasury. Tap for your prize receipt.`
            : `${winnerCoins.toLocaleString()} coins added to your wallet. Tap for your prize receipt.`,
          data: { tournamentId, amount: String(winnerCoins) },
          actionUrl: `/prize-receipt/${tournamentId}`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
        // GR4 — gold champion avatar frame for 7 days (visible app-wide).
        tx.set(db.collection('users').doc(rid), {
          championFrameUntil: championUntil,
          championFrameTournament: t.name || null,
        }, { merge: true });
      }
    }

    // ─── PLACEMENT REWARDS (XP/VP for 1st/2nd/3rd, independent of coins) ─
    // Coins are winner-only, but XP/VP/squad-leaderboard-points still
    // distribute to top 3 — these are "leaderboard rewards", not money.
    const squadXpByPlace = { 1: 500, 2: 250, 3: 125 };
    const squadLbByPlace = { 1: 300, 2: 150, 3: 75 };
    const vpByPlace      = { 1: 200, 2: 100, 3: 50  };
    for (const place of [1, 2, 3]) {
      const recipientId = placeMap[place];
      if (!recipientId) continue;

      if (isSquadMode) {
        const sRef = db.collection('squads').doc(recipientId);
        const xpGain = squadXpByPlace[place];
        const lbGain = squadLbByPlace[place];
        tx.update(sRef, {
          xp: FieldValue.increment(xpGain),
          leaderboardPoints: FieldValue.increment(lbGain),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const champVp = vpByPlace[place];
        const champions = (t.squadChampions || {})[recipientId] || [];
        for (const cuid of champions) {
          tx.set(db.collection('wallets').doc(cuid), {
            vp: FieldValue.increment(champVp),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          tx.set(db.collection('transactions').doc(), {
            userId: cuid,
            type: 'tournament_champion_vp',
            amount: champVp,
            currency: 'vp',
            description: `${champVp} VP · place ${place} · ${t.name}`,
            tournamentId,
            squadId: recipientId,
            place,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        const soloVp = vpByPlace[place];
        tx.set(db.collection('wallets').doc(recipientId), {
          vp: FieldValue.increment(soloVp),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(db.collection('transactions').doc(), {
          userId: recipientId,
          type: 'tournament_placement_vp',
          amount: soloVp,
          currency: 'vp',
          description: `${soloVp} VP · place ${place} · ${t.name}`,
          tournamentId,
          place,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Mod cut routing:
    //   - If at least one Vanguard moderator presided over this tournament
    //     (`vanguardModerated === true` on the doc, set by
    //     vanguardCallTournamentWinner) → 5% mod cut flows into the
    //     Vanguard squad treasury. Monthly cron splits it across the
    //     active members weighted by rank × actions.
    //   - Moderator action credit (monthly bump + audit row + per-action VP)
    //     happens at CALL TIME inside vanguardCallTournamentWinner, NOT
    //     here. That way a tournament with 3 Vanguard-decided matches
    //     credits all 3 moderators correctly.
    //   - Otherwise the 5% stays on the platform.
    if (breakdown.modCut > 0) {
      if (t.vanguardModerated === true) {
        const cfgRef = db.collection('app_config').doc('general');
        const cfgSnap = await tx.get(cfgRef);
        const vanguardSquadId = cfgSnap.exists ? cfgSnap.data().vanguardSquadId : null;
        if (vanguardSquadId) {
          const treasuryRef = db.collection('squads').doc(vanguardSquadId).collection('wallet').doc('main');
          tx.set(treasuryRef, {
            balance: FieldValue.increment(breakdown.modCut),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          tx.set(db.collection('transactions').doc(), {
            userId: '__vanguard_treasury__',
            type: 'vanguard_treasury_inflow',
            amount: breakdown.modCut,
            description: `Vanguard treasury (5% of "${t.name}")`,
            tournamentId,
            squadId: vanguardSquadId,
            vanguardModerators: t.vanguardModerators || [],
            createdAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Flag set but config missing — never lose the cut.
          tx.set(db.collection('transactions').doc(), {
            userId: '__platform__',
            type: 'tournament_mod_cut',
            amount: breakdown.modCut,
            description: `Mod cut (5%): ${t.name} — Vanguard squad not configured`,
            tournamentId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        tx.set(db.collection('transactions').doc(), {
          userId: '__platform__',
          type: 'tournament_mod_cut',
          amount: breakdown.modCut,
          description: `Mod cut (5%): ${t.name}`,
          tournamentId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // ─── Tournament Points award ─────────────────────────────────────
    // Every participant gets TP scaled by their final placement, tournament
    // size, and entry fee. Drives users.tournamentPoints leaderboard.
    // Skipped if no ranking was computable (corrupt tournament data).
    const tpAwards = [];
    if (Array.isArray(ranking) && ranking.length > 0) {
      const participantCount = (t.participants || []).length || ranking.length;
      const entryFee = t.entryFee || 0;
      for (let i = 0; i < ranking.length; i++) {
        const rId = ranking[i];
        if (!rId) continue;
        const place = i + 1;
        const tp = tournamentPointsFor(place, participantCount, entryFee);
        if (tp <= 0) continue;

        // For squad mode the ranking entries are squadIds — fan TP out to
        // each champion who actually played. For solo mode it's a uid.
        const recipients = isSquadMode
          ? ((t.squadChampions || {})[rId] || [])
          : [rId];
        for (const uid of recipients) {
          tpAwards.push({ uid, place, tp });
          tx.update(db.collection('users').doc(uid), {
            tournamentPoints: FieldValue.increment(tp),
            [`tournamentPointsByType.${t.type || 'unknown'}`]: FieldValue.increment(tp),
          });
          tx.set(db.collection('transactions').doc(), {
            userId: uid,
            type: 'tournament_points',
            amount: tp,
            description: `${tp} TP · place ${place} · ${t.name || 'Tournament'}`,
            tournamentId,
            place,
            squadId: isSquadMode ? rId : null,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    tx.update(tRef, {
      payoutStatus: 'paid',
      payoutBreakdown: breakdown,
      ranking: ranking || null,
      tournamentPointsAwarded: tpAwards,
      paidAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, breakdown, ranking, tpAwards };
  });
}

exports._internal_finalizeTournament = finalizeInternal;

// ─── Battle Royale game-result internal API ────────────────────────────
// NOT a callable. Called by:
//   - `brOcrHook` (functions/brOcr.js) — OCR consensus across all
//     participants' streams determines placements automatically.
//   - Tier-A/B game APIs (Apex via apexlegendsapi.com, Fortnite via Epic
//     API where available) — direct authoritative result.
//
// `results` is [{ playerId, place }] one row per participant. All come
// from automated detection — there is no host/mod transcription path.
async function recordBrGameInternal({ tournamentId, matchId, results, source }) {
  if (!tournamentId || !matchId || !Array.isArray(results) || results.length === 0) {
    throw new HttpsError('invalid-argument', 'tournamentId + matchId + results[] required');
  }
  if (!['gameapi', 'gsi', 'ocr', 'wrapper', 'admin'].includes(source)) {
    throw new HttpsError('invalid-argument', `invalid source: ${source}`);
  }
  const tRef = db.collection('tournaments').doc(tournamentId);
  const mRef = tRef.collection('matches').doc(matchId);
  await db.runTransaction(async (tx) => {
    const [tSnap, mSnap] = await Promise.all([tx.get(tRef), tx.get(mRef)]);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    if (!mSnap.exists) throw new HttpsError('not-found', 'Game not found');
    const t = tSnap.data();
    const m = mSnap.data();
    if (t.type !== 'battle_royale') throw new HttpsError('failed-precondition', 'Not a BR tournament');
    if (m.status === 'completed') return; // idempotent
    const valid = new Set(m.participants || t.participants || []);
    for (const r of results) {
      if (!valid.has(r.playerId)) {
        throw new HttpsError('invalid-argument', `Unknown playerId in results: ${r.playerId}`);
      }
    }
    const top = results.find((r) => r.place === 1) || results[0];
    tx.update(mRef, {
      brResults: results,
      status: 'completed',
      winner: top?.playerId || null,
      completedAt: FieldValue.serverTimestamp(),
      completedBy: source,
    });
  });
  await autoCompleteNonSingleElimIfDone(tournamentId);
  return { ok: true };
}
exports._internal_recordBrGameResult = recordBrGameInternal;

// Auth-gated wrapper around finalizeInternal. Host or admin only.
exports.finalizeTournamentSecure = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  const { tournamentId } = request.data || {};
  if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
  return finalizeInternal(tournamentId, { uid });
});

// ─── 7. resolveTournamentDispute ──────────────────────────────────────
// Admin-only. Picks a winner for a disputed match, advances the bracket.
exports.resolveTournamentDispute = functions.https.onCall(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const { tournamentId, matchId, winnerId, note = '' } = request.data || {};
  if (!tournamentId || !matchId || !winnerId) {
    throw new HttpsError('invalid-argument', 'tournamentId, matchId, winnerId required');
  }
  const tRef = db.collection('tournaments').doc(tournamentId);
  const matchRef = tRef.collection('matches').doc(matchId);
  const dRef = tRef.collection('disputes').doc(matchId);

  await db.runTransaction(async (tx) => {
    const mSnap = await tx.get(matchRef);
    if (!mSnap.exists) throw new HttpsError('not-found', 'Match not found');
    const m = mSnap.data();
    if (winnerId !== m.player1 && winnerId !== m.player2) {
      throw new HttpsError('invalid-argument', 'Winner must be one of the match players');
    }
    const loser = winnerId === m.player1 ? m.player2 : m.player1;
    tx.update(matchRef, {
      winner: winnerId,
      loser,
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      completedBy: 'admin_resolution',
    });
    tx.update(dRef, {
      status: 'resolved',
      resolvedBy: uid,
      resolvedWinnerId: winnerId,
      adminNote: note || '',
      resolvedAt: FieldValue.serverTimestamp(),
    });
  });

  await advanceBracketAfterMatch(tournamentId, matchId);
  return { ok: true };
});

// ─── 8. applyToTournamentSecure ───────────────────────────────────────
// When a user wants into a PRIVATE tournament they weren't invited to,
// they file an application instead of joining directly. The host reviews
// it in the Applications inbox. No coins move at apply time — the entry
// fee is escrowed only when the user actually joins (after approval).
exports.applyToTournamentSecure = functions.https.onCall(async (request) => {
  throw TOURNAMENTS_RETIRED();
  const uid = requireAuth(request);
  const { tournamentId, message = '' } = request.data || {};
  if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

  const tRef = db.collection('tournaments').doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
  const t = tSnap.data();

  if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Registration closed');
  if (t.adminId === uid) throw new HttpsError('failed-precondition', 'You host this tournament');
  if ((t.participants || []).includes(uid)) throw new HttpsError('already-exists', 'Already registered');
  if ((t.invitedUserIds || []).includes(uid)) {
    throw new HttpsError('failed-precondition', 'You are already invited — just join.');
  }
  if (t.visibility !== 'private') {
    throw new HttpsError('failed-precondition', 'This tournament is public — join directly.');
  }

  // One pending application per user per tournament.
  const existing = await db.collection('tournament_applications')
    .where('tournamentId', '==', tournamentId)
    .where('applicantId', '==', uid)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!existing.empty) throw new HttpsError('already-exists', 'You already applied');

  // Snapshot the applicant's display name so the inbox doesn't need a join.
  let applicantName = 'Applicant';
  try {
    const u = await db.collection('users').doc(uid).get();
    if (u.exists) applicantName = u.data().displayName || u.data().username || 'Applicant';
  } catch {}

  const appRef = db.collection('tournament_applications').doc();
  await appRef.set({
    tournamentId,
    tournamentAdminId: t.adminId,   // inbox query key
    tournamentName: t.name || '',
    applicantId: uid,
    applicantName,
    message: String(message || '').slice(0, 500),
    kind: 'solo',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });

  // Notify the host.
  await db.collection('notifications').add({
    recipientId: t.adminId,
    type: 'tournament',
    title: 'New tournament application',
    body: `${applicantName} applied to ${t.name}`,
    read: false,
    data: { tournamentId, applicationId: appRef.id },
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, applicationId: appRef.id };
});

// ─── 9. approve / decline tournament applications ─────────────────────
// Host-only. Approve adds the applicant to invitedUserIds so they pass the
// invite check in joinTournamentSecure and can pay their entry fee. Decline
// just flags the doc. Both are idempotent on the application status.
async function resolveApplication(request, decision) {
  const uid = requireAuth(request);
  const { applicationId } = request.data || {};
  if (!applicationId) throw new HttpsError('invalid-argument', 'applicationId required');

  const appRef = db.collection('tournament_applications').doc(applicationId);

  return db.runTransaction(async (tx) => {
    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found');
    const app = appSnap.data();
    if (app.tournamentAdminId !== uid) {
      throw new HttpsError('permission-denied', 'Only the tournament host can do this');
    }
    if (app.status !== 'pending') {
      return { ok: true, alreadyResolved: true, status: app.status };
    }

    const tRef = db.collection('tournaments').doc(app.tournamentId);
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');

    if (decision === 'approved') {
      tx.update(tRef, { invitedUserIds: FieldValue.arrayUnion(app.applicantId) });
    }
    tx.update(appRef, {
      status: decision,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: uid,
    });
    // Tell the applicant.
    const nRef = db.collection('notifications').doc();
    tx.set(nRef, {
      recipientId: app.applicantId,
      type: 'tournament',
      title: decision === 'approved' ? 'Application approved' : 'Application declined',
      body: decision === 'approved'
        ? `You're in — open ${app.tournamentName || 'the tournament'} to pay your entry and join.`
        : `Your application to ${app.tournamentName || 'a tournament'} was declined.`,
      read: false,
      data: { tournamentId: app.tournamentId },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, status: decision };
  });
}

exports.approveTournamentApplication = functions.https.onCall((request) =>
  resolveApplication(request, 'approved'));

exports.declineTournamentApplication = functions.https.onCall((request) =>
  resolveApplication(request, 'declined'));
