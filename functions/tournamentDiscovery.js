// VERGR tournament discovery + VOD intelligence.
//
//   - tournamentOfTheDayCron: nightly featured slot (highest combined
//     prize pool + participants + host reputation).
//   - startingSoonPushCron: pushes follower notifications for tournaments
//     starting in ~5 minutes whose participants the user follows.
//   - aiCheatFlagVod: queues a Gemini Vision pass over completed-match VOD
//     for wallhack/aim-snap heuristics. Result stamped on the match.
//   - autoCutVodHighlights: best-of clips per round picked by Gemini.

const functions = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
// Cron-consolidation shim (see index.js cronMinute): exports raw handler, same cadence.
const defer = (_opts, fn) => fn;
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');
const GEMINI_POST_VIDEO_KEY = defineSecret('GEMINI_POST_VIDEO_KEY');

// ─── Tournament of the Day ───────────────────────────────────────────────
// Each midnight (UTC), pick the most attractive upcoming tournament for the
// next 24h and write `featured/tournament_of_the_day`.
//
// Score = prizePool * 0.6 + participantCount * 30 + hostFollowerCount * 0.05
//         + (vanguardModerated ? 500 : 0) + (sponsor ? sponsor.contributionCoins : 0)
exports.tournamentOfTheDayCron = onSchedule(
  { region: REGION, schedule: '5 0 * * *', timeZone: 'UTC' },
  async () => {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60_000);
    const snap = await db.collection('tournaments')
      .where('status', 'in', ['open', 'registration'])
      .where('scheduledStart', '>=', now)
      .where('scheduledStart', '<=', in24h)
      .limit(200).get();
    let best = null; let bestScore = 0;
    for (const d of snap.docs) {
      const t = d.data();
      const prize = (t.entryFee || 0) * (t.participants?.length || 0);
      const score = prize * 0.6 + (t.participants?.length || 0) * 30
        + (t.hostFollowerCount || 0) * 0.05
        + (t.vanguardModerated ? 500 : 0)
        + (t.sponsor?.contributionCoins || 0);
      if (score > bestScore) { bestScore = score; best = { id: d.id, ...t }; }
    }
    if (!best) return;
    await db.collection('featured').doc('tournament_of_the_day').set({
      tournamentId: best.id, name: best.name, game: best.game,
      scheduledStart: best.scheduledStart, score: bestScore,
      pickedAt: FieldValue.serverTimestamp(),
    });
    // Optional house boost — adds bonus coins to the prize pool.
    const houseBoost = Math.min(5000, Math.floor(bestScore / 100));
    if (houseBoost > 0) {
      await db.collection('tournaments').doc(best.id).update({
        houseBoostCoins: houseBoost,
        prizeBonusCoins: FieldValue.increment(houseBoost),
      });
    }
  },
);

// ─── Starting-soon push notifications ────────────────────────────────────
// Every 1 min, find tournaments starting in 5-6 min and push to every
// follower of each participant. De-duped per (uid, tournamentId).
exports.startingSoonPushCron = defer(
  { region: REGION, schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const lower = new Date(now + 4.5 * 60_000);
    const upper = new Date(now + 6 * 60_000);
    const snap = await db.collection('tournaments')
      .where('scheduledStart', '>=', lower)
      .where('scheduledStart', '<=', upper).limit(40).get();
    for (const d of snap.docs) {
      const t = d.data();
      if (t.startingSoonNotified) continue;

      // Resolve the actual PLAYER uids. Squad tournaments store squad IDs in
      // `participants`, so fan out to each squad's memberIds.
      const playerUids = new Set();
      const isSquad = t.mode === 'squad';
      for (const pid of (t.participants || [])) {
        if (!pid) continue;
        if (isSquad) {
          try {
            const sq = await db.collection('squads').doc(pid).get();
            (sq.data()?.memberIds || []).forEach((u) => u && playerUids.add(u));
          } catch { /* ignore */ }
        } else {
          playerUids.add(pid);
        }
      }

      const batch = db.batch();

      // NT1 — push to the PLAYERS themselves ("get ready / check in").
      for (const uid of playerUids) {
        batch.set(db.collection('notifications').doc(), {
          recipientId: uid, type: 'tournament_starting_soon',
          title: `${t.name || 'Your tournament'} starts in 5 min`,
          body: 'Your match is about to begin. Open it now and get ready to check in.',
          data: { tournamentId: d.id },
          actionUrl: `/tournaments/${d.id}`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Spectator ping — followers of each player ("tap to watch"). Skip
      // anyone already pinged as a player.
      const followerUidsToNotify = new Set();
      for (const pUid of playerUids) {
        try {
          const followers = await db.collection('users').doc(pUid)
            .collection('followers').limit(500).get();
          followers.forEach((f) => { if (!playerUids.has(f.id)) followerUidsToNotify.add(f.id); });
        } catch { /* ignore */ }
      }
      for (const fid of followerUidsToNotify) {
        batch.set(db.collection('notifications').doc(), {
          recipientId: fid, type: 'tournament_starting_soon',
          title: `${t.name || 'Tournament'} starts in 5 min`,
          body: `${t.participants?.length || 0} players · tap to watch`,
          data: { tournamentId: d.id },
          actionUrl: `/match/${d.id}`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }

      batch.update(d.ref, { startingSoonNotified: true });
      await batch.commit();
    }
  },
);

// ─── AI cheat-flag VOD pass ──────────────────────────────────────────────
// Triggered when a tournament match flips to completed AND archiveVodUrl is
// set. Runs a single Gemini multimodal call asking for impossible-stat
// heuristics. Stamps the match doc and notifies the assigned mod.
exports.aiCheatFlagVod = onDocumentWritten(
  { region: REGION, document: 'tournaments/{tId}/matches/{mId}', database: 'vgrdb',
    secrets: [GEMINI_POST_VIDEO_KEY] },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return;
    if (after.cheatFlagPass === 'done') return;
    if (after.status !== 'completed' || !after.archiveVodUrl) return;
    if (before && before.archiveVodUrl === after.archiveVodUrl && before.cheatFlagPass) return;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_POST_VIDEO_KEY.value()}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: `Tournament match VOD review. STRICT JSON response: { flags: [{ type: ("wallhack"|"aim_snap"|"impossible_reaction"|"name_change_mid_match"|"audio_cue"|"clean"), tSec: number, severity: (1-5), note: string }], overall: ("clean"|"suspicious"|"likely_cheat") }. Lobby code: ${after.lobbyCode}.` },
                { fileData: { fileUri: after.archiveVodUrl, mimeType: 'video/mp4' } },
              ],
            }],
          }),
        },
      );
      const j = await res.json();
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(cleaned);
      await event.data.after.ref.update({
        cheatFlag: parsed, cheatFlagPass: 'done',
        cheatFlagAtMs: Date.now(),
      });
      if (parsed.overall && parsed.overall !== 'clean') {
        await db.collection('tournament_review_queue').add({
          tournamentId: event.params.tId, matchId: event.params.mId,
          severity: parsed.overall, flags: parsed.flags || [],
          status: 'pending', createdAt: FieldValue.serverTimestamp(),
        });
        // NT5 — pre-emptively tell the participants their match is under
        // review, with a path to appeal. A mod may still clear it.
        const subjects = [after.player1 || after.player1Id, after.player2 || after.player2Id].filter(Boolean);
        let tName = 'Tournament';
        try { tName = (await db.collection('tournaments').doc(event.params.tId).get()).data()?.name || tName; } catch { /* ignore */ }
        for (const uid of subjects) {
          await db.collection('notifications').add({
            recipientId: uid,
            type: 'tournament_flagged_for_review',
            title: 'Your match is under review',
            body: `An automated check flagged your ${tName} match for review. A moderator will take a look. If you think this is a mistake, you can appeal from the match page.`,
            data: { tournamentId: event.params.tId, matchId: event.params.mId, canAppeal: 'true' },
            actionUrl: `/tournaments/${event.params.tId}/match/${event.params.mId}`,
            read: false, createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (err) {
      console.warn('aiCheatFlagVod failed', err);
      await event.data.after.ref.update({ cheatFlagPass: 'error' });
    }
  },
);

// ─── Auto-cut VOD highlights (1 clip per round) ──────────────────────────
exports.autoCutVodHighlights = onSchedule(
  { region: REGION, schedule: 'every 30 minutes', timeZone: 'UTC',
    secrets: [GEMINI_POST_VIDEO_KEY] },
  async () => {
    const snap = await db.collectionGroup('matches')
      .where('status', '==', 'completed')
      .where('highlightsExtracted', '==', false).limit(10).get();
    for (const d of snap.docs) {
      const m = d.data();
      if (!m.archiveVodUrl) continue;
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_POST_VIDEO_KEY.value()}`,
          {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Pick up to 3 highlight moments from this match VOD. STRICT JSON: { clips: [{ startSec, endSec, title (<=50 chars), reason }] }. Each clip 8-25s.` },
                  { fileData: { fileUri: m.archiveVodUrl, mimeType: 'video/mp4' } },
                ],
              }],
            }),
          },
        );
        const j = await res.json();
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
        const parsed = JSON.parse(cleaned);
        await d.ref.update({
          highlights: parsed.clips || [],
          highlightsExtracted: true,
          highlightsAtMs: Date.now(),
        });
      } catch (err) {
        console.warn('autoCutVodHighlights failed', err);
        await d.ref.update({ highlightsExtracted: true });
      }
    }
  },
);

// ─── tournamentMatchFollowerPush (DS7 + DS8) ─────────────────────────────
// One match-write trigger covering two spectator pushes:
//   DS7 — match flips to in_progress: ping everyone in match.spectatorFollowers
//         ("a match you follow is live").
//   DS8 — match completes with a winner who ADVANCED (did not win the whole
//         tournament): ping that player's account-followers.
// Notification docs are written with pushable types (see index.js allowlist);
// onNotificationCreated fans out the FCM push.
exports.tournamentMatchFollowerPush = onDocumentWritten(
  { region: REGION, document: 'tournaments/{tId}/matches/{mId}', database: 'vgrdb' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    const { tId, mId } = event.params;

    // DS7 — match just went live.
    const startedNow = after.status === 'in_progress' && before?.status !== 'in_progress';
    if (startedNow && Array.isArray(after.spectatorFollowers) && after.spectatorFollowers.length) {
      try {
        const tSnap = await db.collection('tournaments').doc(tId).get();
        const tName = tSnap.data()?.name || 'A tournament';
        const batch = db.batch();
        for (const uid of after.spectatorFollowers) {
          batch.set(db.collection('notifications').doc(), {
            recipientId: uid, type: 'tournament_match_starting',
            title: 'A match you follow is live',
            body: `${tName}: tap to watch now.`,
            data: { tournamentId: tId, matchId: mId },
            actionUrl: `/tournaments/${tId}/match/${mId}`,
            read: false, createdAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (e) { console.warn('DS7 match-start push', e.message); }
    }

    // DS8 — match just completed with a winner.
    const completedNow = after.status === 'completed' && after.winner && before?.winner !== after.winner;
    if (completedNow) {
      try {
        const tSnap = await db.collection('tournaments').doc(tId).get();
        const t = tSnap.data() || {};
        if (t.mode === 'squad') return; // per-user followers only
        // The eventual tournament winner gets tournament_won instead.
        if (t.status === 'completed' && t.winnerId === after.winner) return;
        const winnerSnap = await db.collection('users').doc(after.winner).get();
        const name = winnerSnap.data()?.username || winnerSnap.data()?.displayName || 'Your player';
        const followers = await db.collection('users').doc(after.winner)
          .collection('followers').limit(500).get();
        if (followers.empty) return;
        const batch = db.batch();
        followers.forEach((f) => {
          batch.set(db.collection('notifications').doc(), {
            recipientId: f.id, type: 'tournament_player_advanced',
            title: `${name} advanced`,
            body: `${name} won their match in ${t.name || 'a tournament'}. Tap to follow their run.`,
            data: { tournamentId: tId, matchId: mId, playerId: after.winner },
            actionUrl: `/match/${tId}`,
            read: false, createdAt: FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      } catch (e) { console.warn('DS8 advance push', e.message); }
    }
  },
);
