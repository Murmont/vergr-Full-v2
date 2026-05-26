// TournamentMatchScreen — per-match play surface.
//
// Route: /tournaments/:tournamentId/match/:matchId
//
// Centres on the same-lobby verification gate: each match has a unique
// `lobbyCode` (VERGR-XXXXXXX) both players display in-game per the game's
// `verifyMethod` (chat / name / lobby_name / match_screen). The match can't
// proceed to "play" until BOTH sides flip to verifyState.<uid>.status='verified'
// via OCR (auto), a Vanguard mod (manual), or self-attestation (fallback).
//
// Real-time: subscribes to the match doc with onSnapshot so a verification
// flip on either side updates the UI instantly (no polling, no refresh).

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getTournament, getUser, reportMatchResultSecure } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { VERIFY_METHOD_LABEL, gameById } from '../../utils/tournamentGames';
import { computeTournamentFingerprint } from '../../utils/tournamentFingerprint';
import LobbyCodeReveal from '../../components/tournament/LobbyCodeReveal';
import LaunchGameDropdown from '../../components/tournament/LaunchGameDropdown';
import WalkOnIntro from '../../components/tournament/WalkOnIntro';
import TrustBadge from '../../components/tournament/TrustBadge';
import DisputeTimeline from '../../components/tournament/DisputeTimeline';
import MatchCardShare from '../../components/tournament/MatchCardShare';
import {
  WarmupLobby, DoubleOrNothingButton, DoubleOrNothingPrompt,
  ReplayOnDemandButton, SchedulingDmButton,
  RescheduleControls, DisputeEvidenceUpload, AppealReviewButton, FollowMatchButton,
} from '../../components/tournament/MatchFlowExtras';
import { SpectatorBetPanel, TipUnderdogButton } from '../../components/tournament/SpectatorPanels';
import { isTauri, openHud, closeHud, scanProcesses, emitHudMatch, emitHudClear } from '../../utils/tauriHud';
import AntiCheatConsentModal, { SCAN_SCOPE_VERSION } from '../../components/tournament/AntiCheatConsentModal';
import TwoCameraProofRecorder from '../../components/tournament/TwoCameraProofRecorder';
import TwoCameraProofViewer from '../../components/tournament/TwoCameraProofViewer';
import HighStakesProofExplainerModal from '../../components/tournament/HighStakesProofExplainerModal';
import CheatFlagShareList from '../../components/tournament/CheatFlagShareList';
import NextMatchHint from '../../components/tournament/NextMatchHint';
import { MatchClaimButton, AiSuggestionBanner, BackupChampionsRow } from '../../components/tournament/MatchClaimAndAi';
import SeriesScoreboard from '../../components/tournament/SeriesScoreboard';
import { motion, AnimatePresence } from 'framer-motion';
import { isVanguard } from '../../utils/vanguard';

const WEBCAM_PRIZE_THRESHOLD = 5000;

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  gold: '#F0A500', goldLight: '#F5C842',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b', cyan: '#4DFFD4',
};

// Per-verifyMethod risk warning. Some games TOS-prohibit changing the
// in-game name mid-session (Riot, Battle.net) or showing chat to anyone
// not in the lobby. We surface these explicitly so the player can't claim
// ignorance if their game bans them.
const BAN_RISK = {
  chat:        { level: 'low',  text: 'Type the code in your lobby/in-game chat. Most games allow this; lobby chat is not policed for short alphanumeric codes.' },
  name:        { level: 'med',  text: 'Temporarily set your in-game name to include the code. Some games (Riot, Blizzard) rate-limit name changes — change it back AFTER the match. We do NOT recommend changing names more than once per day.' },
  lobby_name:  { level: 'low',  text: 'Host: create a custom lobby named with the code. Lobby names are public to lobby members only; zero ban risk.' },
  match_screen:{ level: 'low',  text: 'Both opponent gamertags must be visible in the match-setup / friend-invite screen. Nothing is changed in-game; OCR reads the screenshot.' },
};

export default function TournamentMatchScreen() {
  const { tournamentId, matchId } = useParams();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const iAmMod = profile?.role === 'admin' || (isVanguard(profile) && profile?.vanguard?.rank !== 'recruit');
  const navigate = useNavigate();
  const fns = getFunctions(undefined, 'europe-west1');

  const [tournament, setTournament] = useState(null);
  const [match, setMatch] = useState(null);
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revealShown, setRevealShown] = useState(false);
  const [introShown, setIntroShown] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [webcamStream, setWebcamStream] = useState(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  // Bumped by the high-stakes explainer modal "Start" button — triggers the
  // recorder to fire getDisplayMedia without a second click from the player.
  const [proofStartTrigger, setProofStartTrigger] = useState(0);
  // Bumped after the user accepts consent → re-triggers the scan effect.
  const [consentEpoch, setConsentEpoch] = useState(0);

  // Load tournament + subscribe to match doc + enroll hardware fingerprint.
  useEffect(() => {
    let unsub = null;
    (async () => {
      const t = await getTournament(tournamentId);
      setTournament(t);
      const mRef = doc(db, 'tournaments', tournamentId, 'matches', matchId);
      unsub = onSnapshot(mRef, async (snap) => {
        if (!snap.exists()) return;
        const m = { id: snap.id, ...snap.data() };
        setMatch(m);
        if (m.player1 && !p1) setP1(await getUser(m.player1));
        if (m.player2 && !p2) setP2(await getUser(m.player2));
      });
      // Silent hardware-fingerprint enroll/check.
      try {
        const fp = await computeTournamentFingerprint();
        await httpsCallable(fns, 'enrollOrCheckFingerprint')({ fingerprint: fp, tournamentId });
      } catch { /* non-blocking */ }
    })().catch((err) => showToast(err?.message || 'Could not load match', 'error'));
    return () => { if (unsub) unsub(); };
  }, [tournamentId, matchId]); // eslint-disable-line

  // Webcam capture for high-stakes tournaments (>5000 coin entry).
  // Webcam preview goes into a small on-screen tile and into the spectator
  // stream composite (handled in cohost pipeline).
  useEffect(() => {
    if (!tournament || !match) return;
    const isPlayer = match.player1 === currentUser?.uid || match.player2 === currentUser?.uid;
    if (!isPlayer) return;
    const requireCam = (tournament.entryFee || 0) > WEBCAM_PRIZE_THRESHOLD;
    if (!requireCam || webcamStream) return;
    navigator.mediaDevices?.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 24 } },
      audio: false,
    }).then((s) => setWebcamStream(s))
      .catch(() => showToast('Webcam required for tournaments above 5,000 coins. Please grant permission.', 'error'));
    // eslint-disable-next-line
  }, [tournament, match]);
  useEffect(() => () => webcamStream?.getTracks().forEach((t) => t.stop()), [webcamStream]);

  // ─── HUD overlay + anti-cheat scan (Tauri desktop only) ──────────────
  // Player consents at tournament entry; this effect honours that flag
  // (users/{uid}.tournamentScanConsent.acceptedAt). Scans run pre-match
  // and every 30s. HUD closes on screen unmount regardless of match status.
  useEffect(() => {
    if (!isTauri() || !match || !tournament || !currentUser?.uid) return;
    const isPlayer = match.player1 === currentUser.uid || match.player2 === currentUser.uid;
    if (!isPlayer) return;

    let interval = null;
    let cancelled = false;
    (async () => {
      // P0 #10 — consent gate. Scan only runs if user accepted the
      // tournament-scan ToS clause (set by the consent modal).
      const { getDoc, doc: docRef } = await import('firebase/firestore');
      const uSnap = await getDoc(docRef(db, 'users', currentUser.uid));
      const consent = uSnap.data()?.tournamentScanConsent;
      setConsentChecked(true);
      // Re-prompt if: no consent, OR the consented scope version is stale
      // (we expanded what we scan since they last accepted — they must
      // re-consent to the new scope before scans resume).
      const scopeMismatch = consent?.scopeVersion && consent.scopeVersion !== SCAN_SCOPE_VERSION;
      if (!consent?.acceptedAt || scopeMismatch) {
        // No consent yet (or stale scope) — open HUD with informational
        // state, show the consent modal, skip scans until the player accepts.
        emitHudMatch(tournamentId, matchId);
        openHud();
        setNeedsConsent(true);
        return;
      }
      setNeedsConsent(false);
      if (cancelled) return;
      localStorage.setItem('vergr.hud.matchPath', `${tournamentId}|${matchId}`);
      openHud();
      const runScan = async () => {
        try {
          const r = await scanProcesses();
          if (!r) return;
          await httpsCallable(fns, 'submitAntiCheatScan')({
            tournamentId, matchId,
            processes: r.processes, scannedAtMs: r.scanned_at_ms,
          });
        } catch (err) { console.warn('anti-cheat scan failed', err); }
      };
      runScan();
      interval = setInterval(runScan, 30_000);
    })();

    // P0 #9 — always tear down on unmount, not just on match-complete.
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      emitHudClear();
      closeHud();
    };
    // eslint-disable-next-line
  }, [match?.id, match?.status, tournament?.id, currentUser?.uid, consentEpoch]);

  const myUid = currentUser?.uid;
  const iAmPlayer = match && (match.player1 === myUid || match.player2 === myUid);
  const mySide = match?.player1 === myUid ? 'p1' : match?.player2 === myUid ? 'p2' : null;
  const myState = match?.verifyState?.[myUid] || { status: 'pending' };
  const opponentUid = mySide === 'p1' ? match?.player2 : match?.player1;
  const opponentState = match?.verifyState?.[opponentUid] || { status: 'pending' };
  const bothVerified = !!match?.bothVerifiedAt;

  const gameMeta = useMemo(() => gameById(tournament?.game), [tournament?.game]);
  const verifyMethod = match?.verifyMethod || gameMeta?.verifyMethod || 'chat';
  const methodLabel = VERIFY_METHOD_LABEL[verifyMethod] || VERIFY_METHOD_LABEL.chat;
  const ban = BAN_RISK[verifyMethod];

  const handleSelfAttest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns, 'selfAttestMatchVerification')({ tournamentId, matchId });
      showToast('Attested — waiting on opponent / mod.', 'success');
    } catch (err) {
      showToast(err?.message || 'Attestation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReport = async (winnerUid) => {
    if (busy) return;
    setBusy(true);
    try {
      await reportMatchResultSecure({ tournamentId, matchId, winnerId: winnerUid, source: 'manual' });
      showToast('Result reported.', 'success');
    } catch (err) {
      showToast(err?.message || 'Report failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!match) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
        <TopBar showBack title="Match" />
        <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, paddingBottom: 80 }}>
      {/* Anti-cheat consent — blocks scan until user explicitly accepts.
          Decline triggers leaveTournamentSecure (refunds entry). */}
      {needsConsent && (
        <AntiCheatConsentModal
          tournamentId={tournamentId}
          onAccept={() => {
            setNeedsConsent(false);
            setConsentEpoch((e) => e + 1); // re-runs the scan effect
          }}
          onDecline={() => navigate(`/match/${tournamentId}`)}
        />
      )}
      {/* Lobby-code reveal — plays once on first mount with a code. */}
      {match.lobbyCode && !revealShown && !bothVerified && (
        <LobbyCodeReveal code={match.lobbyCode} onDone={() => setRevealShown(true)} />
      )}
      {/* Walk-on intro — plays once per match, ever. Persists via match doc. */}
      {bothVerified && !match.walkOnShownAt && !introShown && match.status !== 'completed' && (
        <WalkOnIntro player1={p1} player2={p2} onDone={async () => {
          setIntroShown(true);
          try {
            const { doc: docRef, updateDoc, serverTimestamp } = await import('firebase/firestore');
            await updateDoc(docRef(db, 'tournaments', tournamentId, 'matches', matchId), {
              walkOnShownAt: serverTimestamp(),
            });
          } catch { /* idempotent — replays would be harmless cosmetic */ }
        }} />
      )}

      <TopBar showBack title={`Round ${match.round} · Match ${match.matchNumber}`} />

      {/* First-time explainer modal — fires once per match on first open
          for high-stakes participants. Click Start → bumps proofStartTrigger
          → recorder fires getDisplayMedia automatically (no second click). */}
      {webcamStream && match && tournament && (match.player1 === currentUser?.uid || match.player2 === currentUser?.uid) && (
        <HighStakesProofExplainerModal
          matchId={matchId}
          entryFee={tournament.entryFee || 0}
          onStart={() => setProofStartTrigger((n) => n + 1)}
        />
      )}

      {/* Two-camera proof recorder (high-stakes only) — composites this
          player's game window + webcam into 10s WebM chunks, uploads to R2,
          registers chunks on match.proofFeed[uid] for mod review. */}
      {webcamStream && match && (match.player1 === currentUser?.uid || match.player2 === currentUser?.uid) && (
        <TwoCameraProofRecorder
          tournamentId={tournamentId}
          matchId={matchId}
          webcamStream={webcamStream}
          startTrigger={proofStartTrigger}
        />
      )}
      {/* Webcam preview tile (high-stakes only) */}
      {webcamStream && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, width: 160, height: 120,
          borderRadius: 12, overflow: 'hidden', zIndex: 50,
          border: `2px solid ${C.gold}`, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          background: '#000',
        }}>
          <video
            autoPlay muted playsInline
            ref={(el) => { if (el && el.srcObject !== webcamStream) el.srcObject = webcamStream; }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{
            position: 'absolute', top: 4, left: 6, fontSize: 9, fontWeight: 900,
            color: C.gold, fontFamily: 'DM Mono, monospace',
            background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 4,
          }}>● PROOF CAM</div>
        </div>
      )}

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Players row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          <PlayerCell user={p1} state={match.verifyState?.[match.player1]} side="left" />
          <div style={{ flex: '0 0 auto', fontFamily: 'DM Mono, monospace',
            fontSize: 12, color: C.mute, padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: 8 }}>
            VS
          </div>
          <PlayerCell user={p2} state={match.verifyState?.[match.player2]} side="right" />
        </div>

        {/* AI suggestion banner — visible to mods, players, spectators alike.
            Drives transparency: AI is suggesting, mod still confirms. */}
        <AiSuggestionBanner
          suggestion={match.aiSuggestion}
          p1={p1} p2={p2}
          commanderReviewRequired={!!match.commanderReviewRequired}
        />

        {/* Mod-only: per-match claim. Other mods can see it's held. */}
        {iAmMod && match.status !== 'completed' && match.status !== 'cancelled' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: 10, background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12,
          }}>
            <Icon name="shield_person" size={16} style={{ color: C.cyan }} />
            <div style={{ flex: 1, fontSize: 12, color: C.dim }}>
              {match.claimedModeratorId
                ? (match.claimedModeratorId === myUid
                  ? 'You are moderating this match.'
                  : `Held by mod ${match.claimedModeratorId.slice(0, 6)}.`)
                : 'No mod has claimed this match yet.'}
            </div>
            <MatchClaimButton
              tournamentId={tournamentId} matchId={matchId}
              currentUid={myUid} onToast={showToast}
            />
          </div>
        )}

        {/* Two-camera proof feed playback — mods + founder only. Surfaces
            the player-side proof recorder output for high-stakes match
            verification. Null when no feed recorded. Evidence purge lives
            on /admin/tournaments → Evidence tab, NOT here. */}
        {iAmMod && match.proofFeed && Object.keys(match.proofFeed).length > 0 && (
          <TwoCameraProofViewer
            match={match}
            participants={[p1, p2].filter(Boolean)}
          />
        )}

        {/* AI cheat-flag clip share list — mod-only. Each flagged moment
            gets Watch (deep-link to clip viewer with auto-seek) + Share
            (copies the mod-internal link to clipboard). */}
        {iAmMod && (
          <CheatFlagShareList
            tournamentId={tournamentId}
            matchId={matchId}
            match={match}
          />
        )}

        {/* Squad roster + backups — only for squad matches. */}
        {tournament?.mode === 'squad' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <BackupChampionsRow tournament={tournament} squadId={match.squad1Id || match.team1Id} label="Side 1" />
            <BackupChampionsRow tournament={tournament} squadId={match.squad2Id || match.team2Id} label="Side 2" />
          </div>
        )}

        {/* Lobby code — the centrepiece + launch shortcut */}
        {match.lobbyCode && !bothVerified && (
          <div style={{ padding: 18, borderRadius: 14, background: `linear-gradient(135deg, ${C.gold}11, ${C.goldLight}22)`,
            border: `1px solid ${C.gold}44`, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Your lobby code
            </div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 32, fontWeight: 900,
              color: C.text, marginTop: 6, letterSpacing: '0.04em' }}>
              {match.lobbyCode}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={() => { navigator.clipboard?.writeText(match.lobbyCode); showToast('Copied', 'info'); }}
                style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.gold}`,
                  background: 'transparent', color: C.gold, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Copy code
              </button>
              <LaunchGameDropdown game={gameMeta} compact />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
              {methodLabel}
            </div>
          </div>
        )}

        {/* Ban-risk warning */}
        {ban && !bothVerified && (
          <div style={{ padding: 12, borderRadius: 12, background: C.soft,
            border: `1px solid ${ban.level === 'med' ? C.amber + '55' : C.border}`,
            display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name={ban.level === 'med' ? 'warning' : 'info'}
              size={18} className="" style={{ color: ban.level === 'med' ? C.amber : C.cyan, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5 }}>{ban.text}</div>
          </div>
        )}

        {/* My verification row */}
        {iAmPlayer && !bothVerified && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
              Your verification: <strong style={{ color: statusColor(myState.status) }}>{statusText(myState.status)}</strong>
              {myState.source && <span style={{ color: C.mute }}> · via {myState.source}</span>}
            </div>
            <button onClick={handleSelfAttest} disabled={busy || myState.status === 'verified'}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none',
                background: myState.status === 'verified'
                  ? C.green
                  : `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
                color: '#000', fontSize: 14, fontWeight: 900, cursor: 'pointer',
                opacity: busy ? 0.6 : 1 }}>
              {myState.status === 'verified' ? "You're verified" : "I've displayed the code"}
            </button>
            <div style={{ fontSize: 10, color: C.mute, marginTop: 8, lineHeight: 1.5 }}>
              Lower-trust than OCR/mod. A Vanguard mod or OCR signal must still confirm.
            </div>
          </div>
        )}

        {/* Phase 1 — series scoreboard. Renders only for Bo3/Bo5; Bo1 falls
            through to the legacy "I won / They won" CTAs below. */}
        {bothVerified && match.status !== 'completed' && match.seriesFormat && match.seriesFormat !== 'bo1' && (
          <SeriesScoreboard
            match={{ id: matchId, ...match }}
            tournamentId={tournamentId}
            p1={p1} p2={p2}
            currentUid={myUid}
            iAmPlayer={iAmPlayer}
            onToast={showToast}
          />
        )}

        {/* Both-verified play CTAs — Bo1 only (Bo3/Bo5 uses SeriesScoreboard above). */}
        {iAmPlayer && bothVerified && match.status !== 'completed'
          && (!match.seriesFormat || match.seriesFormat === 'bo1') && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.green}55`, borderRadius: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.green, marginBottom: 4 }}>
              Both sides verified. Play your match.
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
              After it ends, report who won.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleReport(myUid)} disabled={busy}
                style={ctaPrimary}>I won</button>
              <button onClick={() => handleReport(opponentUid)} disabled={busy}
                style={ctaSecondary}>They won</button>
            </div>
          </div>
        )}

        {/* Match completed */}
        {match.status === 'completed' && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.green}55`, borderRadius: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.green }}>Match completed</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
              Winner: {match.winner === match.player1 ? p1?.username : p2?.username || 'TBA'}
            </div>
            {/* Winner can route 1% sportsmanship bonus to opponent. */}
            {iAmPlayer && match.winner === myUid && !match.sportsmanshipSentAt && (
              <button onClick={async () => {
                try {
                  setBusy(true);
                  await httpsCallable(fns, 'routeSportsmanshipBonus')({
                    tournamentId, matchId, recipientUid: opponentUid,
                  });
                  showToast('Sportsmanship bonus sent to opponent.', 'success');
                } catch (err) {
                  showToast(err?.message || 'Send failed', 'error');
                } finally { setBusy(false); }
              }} disabled={busy} style={{
                marginTop: 10, padding: '8px 14px', borderRadius: 8,
                border: `1px solid ${C.cyan}66`, background: 'transparent',
                color: C.cyan, fontSize: 11, fontWeight: 800, cursor: 'pointer',
              }}>Send 1% sportsmanship bonus</button>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setShowShare(true)} style={{
                flex: 1, padding: 10, borderRadius: 8, border: 'none',
                background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
                color: '#000', fontSize: 12, fontWeight: 900, cursor: 'pointer',
              }}>Share result</button>
              <button onClick={() => setShowTimeline((v) => !v)} style={{
                padding: 10, borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.dim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>Integrity report</button>
            </div>
          </div>
        )}

        {/* Bracket path — where the winner / loser of this match goes next. */}
        <NextMatchHint
          tournamentId={tournamentId} matchId={matchId}
          match={match} currentUid={currentUser?.uid}
        />

        {showTimeline && <DisputeTimeline tournamentId={tournamentId} matchId={matchId} />}
        {showShare && (
          <MatchCardShare match={{ id: matchId, ...match }} tournament={{ id: tournamentId, ...tournament }}
            p1={p1} p2={p2} onClose={() => setShowShare(false)} />
        )}

        {/* Pre-match scheduling + warmup (player-side, before verification done) */}
        {iAmPlayer && !bothVerified && match.status !== 'completed' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SchedulingDmButton tournamentId={tournamentId} matchId={matchId} otherUid={opponentUid} />
            <WarmupLobby tournamentId={tournamentId} matchId={matchId} opponentUid={opponentUid} />
            <ReplayOnDemandButton tournamentId={tournamentId} matchId={matchId} currentTimeSec={0} />
          </div>
        )}

        {/* NT2 — mutual reschedule (pauses the auto-forfeit timer when agreed) */}
        {iAmPlayer && match.status !== 'completed' && match.status !== 'cancelled' && (
          <RescheduleControls tournamentId={tournamentId} matchId={matchId} match={match} myUid={myUid} />
        )}

        {/* Double-or-nothing: prompt to winner, button for loser */}
        {iAmPlayer && match.status === 'completed' && match.winner === myUid
          && match.doubleOrNothing?.status === 'pending' && (
          <DoubleOrNothingPrompt
            tournamentId={tournamentId} matchId={matchId}
            cost={match.doubleOrNothing.cost}
            onResolved={() => {}}
          />
        )}
        {iAmPlayer && match.status === 'completed' && match.winner === opponentUid
          && !match.doubleOrNothing && (
          <DoubleOrNothingButton tournamentId={tournamentId} matchId={matchId} />
        )}

        {/* Spectator view — non-player sees follow + betting + tip-underdog */}
        {!iAmPlayer && match.status !== 'completed' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <FollowMatchButton
                tournamentId={tournamentId} matchId={matchId}
                match={match} myUid={myUid}
              />
            </div>
            <SpectatorBetPanel tournamentId={tournamentId} matchId={matchId} />
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <TipUnderdogButton
                tournamentId={tournamentId} matchId={matchId}
                underdogUid={match.player2} underdogUsername={p2?.username}
              />
            </div>
          </>
        )}

        {match.status === 'disputed' && iAmPlayer && (
          <DisputeEvidenceUpload
            tournamentId={tournamentId} matchId={matchId} match={match}
            myUid={myUid} opponentUid={opponentUid}
          />
        )}
        {match.status === 'disputed' && !iAmPlayer && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.amber}55`, borderRadius: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>Disputed</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>A Vanguard mod will resolve.</div>
          </div>
        )}

        {/* NT5 — flagged-for-review appeal path */}
        {iAmPlayer && match.cheatFlag?.overall && match.cheatFlag.overall !== 'clean' && (
          <div style={{ padding: 12, borderRadius: 12, background: `${C.amber}11`, border: `1px solid ${C.amber}55` }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.amber }}>This match was flagged for review</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 3, marginBottom: 8 }}>
              An automated check flagged this match. A moderator will review it. If you believe it's a mistake, you can appeal.
            </div>
            <AppealReviewButton matchId={matchId} />
          </div>
        )}

        <button onClick={() => navigate(`/match/${tournamentId}`)}
          style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.dim, fontSize: 12, cursor: 'pointer' }}>
          Back to tournament
        </button>
      </div>
    </div>
  );
}

function PlayerCell({ user, state, side }) {
  const status = state?.status || 'pending';
  const source = state?.source;
  const color = statusColor(status);
  // OCR scanning detection: source='ocr' + within last 8s = active scan window.
  const scannedAtMs = state?.at?.toMillis?.() || 0;
  const isScanning = status === 'pending' && source === 'ocr'
    && scannedAtMs && (Date.now() - scannedAtMs < 8000);
  // Pulsing ring around the avatar while pending — tells the player
  // we're actively watching for verification, not frozen.
  const isPending = status === 'pending';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      alignItems: side === 'left' ? 'flex-start' : 'flex-end', gap: 6 }}>

      <div style={{ position: 'relative' }}>
        {isPending && (
          <>
            <motion.span
              style={{
                position: 'absolute', inset: -4, borderRadius: '50%',
                border: `2px solid ${color}`, pointerEvents: 'none',
              }}
              animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.span
              style={{
                position: 'absolute', inset: -4, borderRadius: '50%',
                border: `2px solid ${color}`, pointerEvents: 'none',
              }}
              animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.8 }}
            />
          </>
        )}
        <UserAvatar uid={user?.id} size="md" username={user?.username} />
        {/* Verified checkmark flash — fires once when status flips to verified. */}
        <AnimatePresence>
          {status === 'verified' && (
            <motion.div
              key="verified-flash"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 14 }}
              style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 18, height: 18, borderRadius: '50%',
                background: C.green, color: '#0B0B14',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 900,
                boxShadow: `0 0 14px ${C.green}88`,
              }}
            >✓</motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, maxWidth: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {user?.username || '…'}
      </div>

      {/* Status chip */}
      <motion.div
        layout
        animate={status === 'verified' ? {
          background: [color + '00', color + '55', color + '22'],
        } : {}}
        transition={{ duration: 0.6 }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 9px', borderRadius: 999,
          background: color + '15', border: `1px solid ${color}55`,
          fontSize: 10, fontWeight: 800, color,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        {/* Pending = pulsing dot. Verified = solid green. Others = solid. */}
        {isPending ? (
          <motion.span
            animate={{ scale: [1, 1.35, 1], opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.1, repeat: Infinity }}
            style={{
              width: 6, height: 6, borderRadius: '50%', background: color,
            }}
          />
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
        )}
        {isScanning ? <ScanningText /> : statusText(status)}
      </motion.div>

      {source === 'ocr' && status === 'verified' && (
        <div style={{ fontSize: 9, color: C.dim, fontFamily: 'DM Mono, monospace' }}>
          via OCR
        </div>
      )}

      <TrustBadge uid={user?.id} size="sm" showLabel={false} />
    </div>
  );
}

// Animated "OCR scanning…" text — dot count cycles 0→3 to read as live.
function ScanningText() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v + 1) % 4), 400);
    return () => clearInterval(id);
  }, []);
  return <span>OCR scanning{'.'.repeat(n)}</span>;
}

function statusColor(s) {
  return ({
    verified: C.green,
    self_attested: C.amber,
    pending: C.cyan,
    rejected: C.red,
  })[s] || C.mute;
}
function statusText(s) {
  return ({
    verified: 'Verified',
    self_attested: 'Attested',
    pending: 'Waiting',
    rejected: 'Rejected',
  })[s] || s;
}

const ctaPrimary = {
  flex: 1, padding: 12, borderRadius: 10, border: 'none',
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
  color: '#000', fontSize: 13, fontWeight: 900, cursor: 'pointer',
};
const ctaSecondary = {
  flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer',
};

