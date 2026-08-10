// WarmupLobbyScreen — pre-match voice + readiness room.
//
// Route: /squads/warmup/:tag  where tag = `${tournamentId}_${matchId}`.
// Linked from <WarmupLobbyButton /> in MatchFlowExtras.
//
// What it does:
//   1. Loads the match + tournament + both players.
//   2. Establishes a WebRTC P2P voice call between the two players. The
//      uid that sorts first alphabetically is the caller (createOffer), the
//      other answers (answerCall). Firestore handles signaling at
//      calls/{warmupId}. Mic only — no video, no screen-share (deferred).
//   3. Per-player readiness toggle written to `match.warmupReady[uid]`.
//      Both ready → green "Both ready" banner with a "Jump to match" CTA.
//   4. Auto-redirects to TournamentMatchScreen when match.status flips to
//      'active' so players never get stuck in warmup once the match starts.
//   5. Surfaces the match's lobby code + verify method up-front so players
//      can sync the in-game part while talking.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getTournament, getUser } from '../../firebase/firestore';
import { createPeerConnectionWithTurn, createOffer, answerCall, endCallCleanup, getMediaStream } from '../../utils/webrtc';
import { VERIFY_METHOD_LABEL, gameById } from '../../utils/tournamentGames';
import LaunchGameDropdown from '../../components/tournament/LaunchGameDropdown';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)', dim: 'rgba(255,255,255,0.65)',
  mute: 'rgba(255,255,255,0.45)', text: '#fff',
  cyan: '#B44FFF', green: '#22c55e', red: '#ef4444', gold: '#F0A500',
};

export default function WarmupLobbyScreen() {
  const { tag } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();

  // tag format: `${tournamentId}_${matchId}`. Split on the last underscore
  // so IDs containing underscores still parse correctly (rare but safe).
  const { tournamentId, matchId } = useMemo(() => {
    const i = (tag || '').lastIndexOf('_');
    if (i < 0) return { tournamentId: null, matchId: null };
    return { tournamentId: tag.slice(0, i), matchId: tag.slice(i + 1) };
  }, [tag]);

  const [tournament, setTournament] = useState(null);
  const [match, setMatch] = useState(null);
  const [me, setMe] = useState(null);
  const [opp, setOpp] = useState(null);
  const [callState, setCallState] = useState('idle'); // idle|connecting|connected|failed
  const [micOn, setMicOn] = useState(true);
  const [oppLevel, setOppLevel] = useState(0);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const cleanupRef = useRef(null);
  const audioCtxRef = useRef(null);
  const levelRafRef = useRef(0);

  const uid = currentUser?.uid;
  const oppUid = match ? (match.player1 === uid ? match.player2 : match.player1) : null;
  const isParticipant = match && (match.player1 === uid || match.player2 === uid);
  // Deterministic caller/callee — uid that sorts first creates the offer.
  const isCaller = uid && oppUid && uid < oppUid;
  const warmupId = tournamentId && matchId ? `warmup_${tournamentId}_${matchId}` : null;

  // Load tournament + subscribe to match doc.
  useEffect(() => {
    if (!tournamentId || !matchId) return;
    let unsub = null;
    (async () => {
      try {
        const t = await getTournament(tournamentId);
        setTournament(t);
      } catch (err) { console.warn('warmup tournament load', err); }
      const mRef = doc(db, 'tournaments', tournamentId, 'matches', matchId);
      unsub = onSnapshot(mRef, (snap) => {
        if (snap.exists()) setMatch({ id: snap.id, ...snap.data() });
      });
    })();
    return () => { if (unsub) unsub(); };
  }, [tournamentId, matchId]);

  // Auto-redirect into the match once it goes active.
  useEffect(() => {
    if (match?.status === 'active') {
      navigate(`/tournaments/${tournamentId}/match/${matchId}`, { replace: true });
    }
  }, [match?.status, tournamentId, matchId, navigate]);

  // Load both players for the roster strip.
  useEffect(() => {
    if (!match || !uid) return;
    (async () => {
      try {
        const [u, o] = await Promise.all([
          getUser(uid),
          oppUid ? getUser(oppUid) : null,
        ]);
        setMe(u);
        setOpp(o);
      } catch (err) { console.warn('warmup players load', err); }
    })();
  }, [match, uid, oppUid]);

  // Set up the P2P call once both uids are known.
  useEffect(() => {
    if (!isParticipant || !warmupId || !oppUid) return;
    let cancelled = false;

    (async () => {
      setCallState('connecting');
      try {
        const stream = await getMediaStream('audio');
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;

        // Create / claim the call doc. Caller creates it; callee finds it.
        await setDoc(doc(db, 'calls', warmupId), {
          warmup: true, tournamentId, matchId,
          callerUid: isCaller ? uid : oppUid,
          calleeUid: isCaller ? oppUid : uid,
          createdAt: Date.now(),
        }, { merge: true });

        // Fetch TURN creds first so symmetric-NAT pairs fall back through
        // our self-hosted coturn instead of failing outright.
        const pc = await createPeerConnectionWithTurn();
        pcRef.current = pc;

        // Wire remote stream to the hidden <audio> element. Also drive the
        // opponent-volume indicator so the player can tell their opponent
        // is actually transmitting.
        pc.ontrack = (event) => {
          const remoteStream = event.streams[0];
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.play().catch(() => {});
          }
          startLevelMeter(remoteStream);
        };
        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          if (s === 'connected') setCallState('connected');
          if (s === 'failed' || s === 'disconnected') setCallState('failed');
        };

        const cleanup = isCaller
          ? await createOffer(warmupId, pc, stream)
          : await answerCall(warmupId, pc, stream);
        cleanupRef.current = cleanup;
      } catch (err) {
        if (!cancelled) {
          setCallState('failed');
          showToast(err?.message || 'Could not start voice', 'error');
        }
      }
    })();

    return () => {
      cancelled = true;
      try { cleanupRef.current?.(); } catch {}
      try { cancelAnimationFrame(levelRafRef.current); } catch {}
      try { audioCtxRef.current?.close(); } catch {}
      if (pcRef.current && localStreamRef.current) {
        endCallCleanup(warmupId, pcRef.current, localStreamRef.current);
        pcRef.current = null;
        localStreamRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, [isParticipant, warmupId, oppUid, isCaller, uid]);

  function startLevelMeter(stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setOppLevel(Math.min(1, (sum / data.length) / 128));
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  }

  const toggleMic = () => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
  };

  const myReady = !!match?.warmupReady?.[uid];
  const oppReady = !!(oppUid && match?.warmupReady?.[oppUid]);
  const bothReady = myReady && oppReady;

  const toggleReady = async () => {
    if (!match || !tournamentId || !matchId) return;
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId, 'matches', matchId), {
        [`warmupReady.${uid}`]: !myReady,
      });
    } catch (err) {
      showToast(err?.message || 'Could not toggle ready', 'error');
    }
  };

  // Render guards.
  if (!tournamentId || !matchId) {
    return <Shell title="Warmup"><Empty msg="Bad warmup link." /></Shell>;
  }
  if (!match || !tournament) {
    return <Shell title="Warmup"><Empty msg="Loading…" spinner /></Shell>;
  }
  if (!isParticipant && profile?.role !== 'admin') {
    return <Shell title="Warmup"><Empty msg="Only the two players in this match can join the warmup lobby." /></Shell>;
  }

  const stateColor = callState === 'connected' ? C.green
                   : callState === 'connecting' ? C.gold
                   : C.red;

  return (
    <Shell title="Warmup lobby">
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
      <div style={{ padding: 16, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Match info */}
        <Card>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 800, color: C.cyan, marginBottom: 6 }}>
            ● PRE-MATCH WARMUP
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
            {tournament.name || 'Tournament'} · Round {match.round ?? '?'} / Match {match.matchNumber ?? '?'}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
            {tournament.game || 'Game'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <Tag label="Lobby code" value={match.lobbyCode || '—'} mono color={C.gold} />
            <Tag label="Verify" value={VERIFY_METHOD_LABEL[tournament.verifyMethod] || tournament.verifyMethod || '—'} />
            <Tag label="Status" value={match.status || '—'} />
            <LaunchGameDropdown game={gameById(tournament.game)} compact />
          </div>
        </Card>

        {/* Players row */}
        <Card>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 800, color: C.mute, marginBottom: 10 }}>
            PLAYERS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PlayerCard
              user={me} label="You" side="left"
              ready={myReady} onReadyToggle={toggleReady}
              micOn={micOn} onMicToggle={toggleMic}
            />
            <PlayerCard
              user={opp} label="Opponent" side="right"
              ready={oppReady}
              speakingLevel={oppLevel}
              connectionState={callState}
            />
          </div>
        </Card>

        {/* Voice status */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: stateColor,
              boxShadow: `0 0 12px ${stateColor}`,
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                Voice {callState === 'connected' ? 'connected'
                  : callState === 'connecting' ? 'connecting…'
                  : callState === 'failed' ? 'failed' : 'idle'}
              </div>
              <div style={{ fontSize: 11, color: C.dim }}>
                Peer-to-peer WebRTC. {isCaller ? 'You are calling.' : 'You are answering.'} Both players must be on this screen.
              </div>
            </div>
            {callState === 'failed' && (
              <button onClick={() => window.location.reload()} style={btn(C.cyan)}>
                Retry
              </button>
            )}
          </div>
        </Card>

        {/* Both-ready banner / CTA */}
        {bothReady ? (
          <div style={{
            padding: 14, borderRadius: 12,
            background: 'rgba(34,197,94,0.10)', border: `1px solid ${C.green}66`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Icon name="check_circle" size={18} style={{ color: C.green }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.green }}>
              Both players ready. Jump into the match.
            </div>
            <button
              onClick={() => navigate(`/tournaments/${tournamentId}/match/${matchId}`)}
              style={btn(C.green)}
            >
              Go to match
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.mute, textAlign: 'center' }}>
            Toggle Ready when you're set. Match auto-starts when the host hits play.
          </div>
        )}

        <button
          onClick={() => navigate(`/tournaments/${tournamentId}/match/${matchId}`)}
          style={{
            ...btn(C.dim), background: 'transparent', border: `1px solid ${C.border}`,
            color: C.dim, alignSelf: 'center',
          }}
        >
          Back to match screen
        </button>
      </div>
    </Shell>
  );
}

// ─── small helpers ─────────────────────────────────────────────────────────

function Shell({ title, children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar showBack title={title} />
      {children}
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{
      padding: 14, borderRadius: 14,
      background: C.surface, border: `1px solid ${C.border}`,
    }}>
      {children}
    </div>
  );
}

function Empty({ msg, spinner = false }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: C.dim }}>
      {spinner && (
        <div style={{
          width: 26, height: 26, borderRadius: '50%', margin: '0 auto 12px',
          border: `3px solid ${C.border}`, borderTopColor: C.cyan,
          animation: 'spin 1s linear infinite',
        }} />
      )}
      <div style={{ fontSize: 13 }}>{msg}</div>
    </div>
  );
}

function Tag({ label, value, mono = false, color }) {
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 8,
      background: 'rgba(255,255,255,0.04)', border: `1px solid ${color ? color + '55' : C.border}`,
      minWidth: 90,
    }}>
      <div style={{ fontSize: 9, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.10em' }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 800,
        color: color || C.text,
        fontFamily: mono ? 'DM Mono, monospace' : 'inherit',
        marginTop: 2,
      }}>{value}</div>
    </div>
  );
}

function PlayerCard({ user, label, ready, onReadyToggle, micOn, onMicToggle, speakingLevel = 0, connectionState }) {
  return (
    <div style={{
      padding: 12, borderRadius: 12,
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 10, color: C.mute, letterSpacing: '0.12em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <UserAvatar user={user} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.displayName || user?.username || '—'}
          </div>
          <div style={{ fontSize: 11, color: ready ? C.green : C.dim, fontWeight: 700, marginTop: 2 }}>
            {ready ? '● Ready' : '○ Not ready'}
          </div>
        </div>
      </div>

      {/* Local: ready toggle + mic toggle */}
      {onReadyToggle && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={onReadyToggle} style={btn(ready ? C.green : C.gold)}>
            {ready ? '✓ Ready' : "I'm ready"}
          </button>
          <button onClick={onMicToggle} style={btn(micOn ? C.cyan : C.red)}>
            <Icon name={micOn ? 'mic' : 'mic_off'} size={14} />
          </button>
        </div>
      )}

      {/* Opponent: speaking-level indicator */}
      {speakingLevel !== undefined && !onReadyToggle && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${Math.round((speakingLevel || 0) * 100)}%`,
              background: `linear-gradient(90deg, ${C.cyan}, ${C.green})`,
              transition: 'width 80ms linear',
            }} />
          </div>
          <div style={{ fontSize: 10, color: C.mute, marginTop: 4 }}>
            {connectionState === 'connected'
              ? (speakingLevel > 0.02 ? 'Speaking' : 'Silent')
              : connectionState === 'connecting' ? 'Connecting…'
              : connectionState === 'failed' ? 'Voice failed' : 'Idle'}
          </div>
        </div>
      )}
    </div>
  );
}

const btn = (color) => ({
  padding: '6px 12px', borderRadius: 8,
  background: color + '15', color, border: `1px solid ${color}55`,
  fontSize: 12, fontWeight: 800, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
});
