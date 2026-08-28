// SpectatorPanels — viewer-side widgets for tournament streams:
//
//   <SpectatorBetPanel />     place coin bets pre-match (bonus payout)
//   <TipUnderdogButton />     boost trailing player's prize
//   <BracketChat />           bracket-wide chat for the tournament
//   <PiPCohost />             auto-stitched both-players composite
//
// All wire to functions/tournamentExtras.js callables.

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { IS_STORE_BUILD } from '../../utils/platform';
import UserAvatar from '../UserAvatar';
import HlsPlayer from '../streams/HlsPlayer';

const C = {
  surface: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  gold: '#F0A500', goldLight: '#F5C842',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
};

// ─── Match Pick panel (skill-prediction layer, NOT gambling) ─────────────
// Spectators back the player they think will win. Daily cap (3/day) keeps
// it a skill game. Correct picks share the pool pro-rata; coins are
// withdrawable. UI deliberately avoids casino visuals/language.
export function SpectatorBetPanel({ tournamentId, matchId }) {
  // Staking coins on a match outcome is wagering, and coins carry real-money
  // value, so on Google Play this falls under the Real-Money Gambling, Games,
  // and Contests policy — a licensed category we are not licensed for. Hidden
  // on the Play build ONLY: web, desktop and the sideloaded APK are untouched.
  const { showToast } = useUI();
  const fns = getFunctions(undefined, 'europe-west1');
  const [match, setMatch] = useState(null);
  const [side, setSide] = useState(null);
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (IS_STORE_BUILD) return undefined;
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId, 'matches', matchId), (s) => setMatch(s.data()));
    return () => unsub();
  }, [tournamentId, matchId]);

  // ⚠ Both guards sit BELOW every hook. This one used to return before the
  // hooks ran, which is a rules-of-hooks violation even though IS_STORE_BUILD is
  // compile-time constant. The effect above skips its listener on the Play build,
  // so the behaviour is unchanged: no subscription, nothing rendered.
  if (IS_STORE_BUILD) return null;
  if (!match || match.status === 'completed' || match.bothVerifiedAt) return null;

  const pools = match.bettingPools || {};
  const p1Pool = pools[match.player1] || 0;
  const p2Pool = pools[match.player2] || 0;
  const totalPool = p1Pool + p2Pool;
  // Support ratio (0-100%) — shown as a visual support bar, not as odds.
  const p1Support = totalPool ? Math.round((p1Pool / totalPool) * 100) : 50;
  const p2Support = 100 - p1Support;

  // Estimated reward if your pick wins, after your coins join the pool.
  const estimateReward = () => {
    if (!side || !amount) return 0;
    const sidePool = pools[side] || 0;
    const newSideTotal = sidePool + amount;
    const newGrandTotal = totalPool + amount;
    return Math.floor((amount / newSideTotal) * newGrandTotal);
  };
  const estimated = estimateReward();

  const place = async () => {
    if (!side || !amount) return;
    setBusy(true);
    try {
      await httpsCallable(fns, 'placeMatchBet')({ tournamentId, matchId, sideUid: side, amount });
      showToast(`Pick locked · ${amount} coins`, 'success');
      setSide(null);
    } catch (err) {
      showToast(err?.message || 'Pick failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: C.cyan, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 900 }}>
          🎯 Champion Pick
        </div>
        <div style={{ fontSize: 9, color: C.mute, fontFamily: 'DM Mono, monospace' }}>3 picks / day</div>
      </div>

      {/* Community support bar — visualisation of pool share, not numerical odds */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden',
          background: C.soft,
        }}>
          <div style={{ width: `${p1Support}%`, background: '#7B6FFF' }} />
          <div style={{ width: `${p2Support}%`, background: '#C87FFF' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4,
          fontSize: 10, color: C.dim, fontFamily: 'DM Mono, monospace' }}>
          <span>P1 support {p1Support}%</span>
          <span>P2 support {p2Support}%</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <SideBtn label={`Back P1`} active={side === match.player1} onClick={() => setSide(match.player1)} />
        <SideBtn label={`Back P2`} active={side === match.player2} onClick={() => setSide(match.player2)} />
      </div>

      <input type="range" min="10" max="5000" step="10" value={amount}
        onChange={(e) => setAmount(+e.target.value)} style={{ width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.dim, marginBottom: 8 }}>
        <span>10c</span><span style={{ color: C.cyan, fontWeight: 800 }}>{amount}c</span><span>5000c</span>
      </div>

      {/* Reward preview — framed as "if you predict correctly", no payout/odds language */}
      {side && (
        <div style={{
          padding: 12, marginBottom: 10, borderRadius: 10,
          background: `linear-gradient(135deg, #7B6FFF15, #C87FFF15)`,
          border: `1px solid #7B6FFF44`,
        }}>
          <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            If your pick is correct
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.text, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
            +{estimated} c reward
          </div>
        </div>
      )}

      <button onClick={place} disabled={busy || !side} style={{
        width: '100%', padding: 12, borderRadius: 10, border: 'none',
        background: side && !busy ? `linear-gradient(135deg, #7B6FFF, #C87FFF)` : C.soft,
        color: side && !busy ? '#fff' : C.mute,
        fontWeight: 900, fontSize: 13, cursor: side && !busy ? 'pointer' : 'not-allowed',
      }}>{busy ? 'Locking pick…' : `Lock pick · ${amount}c`}</button>
      <div style={{ fontSize: 10, color: C.mute, marginTop: 8, lineHeight: 1.5 }}>
        Skill-prediction game · build a streak · climb the Top Predictor leaderboard.
        Correct picks share the community pool. Locks at match start.
      </div>
    </div>
  );
}

// ─── Tip the underdog ────────────────────────────────────────────────────
export function TipUnderdogButton({ tournamentId, matchId, underdogUid, underdogUsername }) {
  const { showToast } = useUI();
  const fns = getFunctions(undefined, 'europe-west1');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns, 'tipUnderdog')({ tournamentId, matchId, underdogUid, amount: 50 });
      showToast(`+50 coins to ${underdogUsername || 'underdog'}`, 'success');
    } catch (err) { showToast(err?.message || 'Tip failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <button onClick={send} disabled={busy} style={{
      padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.amber}66`,
      background: 'transparent', color: C.amber, fontSize: 12, fontWeight: 800, cursor: 'pointer',
    }}>🐶 Tip the underdog · 50c</button>
  );
}

// ─── Bracket-wide chat ───────────────────────────────────────────────────
// Reuses existing chat infra by namespacing room id under the tournament.
// Lightweight client; uses Firestore for v1 (relay-side migration later).
export function BracketChat({ tournamentId }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const q = query(
      collection(db, 'tournaments', tournamentId, 'chat'),
      orderBy('createdAt', 'desc'), limit(50),
    );
    const unsub = onSnapshot(q, (snap) => {
      const m = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      setMsgs(m);
      setTimeout(() => scrollRef.current?.scrollTo(0, 9e6), 50);
    });
    return () => unsub();
  }, [tournamentId]);

  const send = async () => {
    if (!text.trim() || !currentUser) return;
    const fns = getFunctions(undefined, 'europe-west1');
    try {
      await httpsCallable(fns, 'moderateChatMessage')({
        text: text.trim(), roomId: `tournament_${tournamentId}`,
      }).catch(() => {});
      const { addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'tournaments', tournamentId, 'chat'), {
        uid: currentUser.uid, text: text.trim().slice(0, 280),
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch (err) { showToast(err?.message || 'Send failed', 'error'); }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
      display: 'flex', flexDirection: 'column', height: 360 }}>
      <div style={{ padding: 10, fontSize: 11, color: C.mute,
        textTransform: 'uppercase', letterSpacing: '0.12em', borderBottom: `1px solid ${C.border}` }}>
        Bracket Chat
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msgs.map((m) => (
          <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <UserAvatar uid={m.uid} size="xs" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: 'DM Mono, monospace' }}>{m.uid?.slice(0, 8)}</div>
              <div style={{ fontSize: 12, color: C.text }}>{m.text}</div>
            </div>
          </div>
        ))}
        {msgs.length === 0 && <div style={{ color: C.mute, fontSize: 12, textAlign: 'center', marginTop: 40 }}>No messages yet.</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: `1px solid ${C.border}` }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Say something…" maxLength={280}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 8,
            background: C.soft, border: `1px solid ${C.border}`,
            color: C.text, fontSize: 12,
          }} />
        <button onClick={send} style={{
          padding: '8px 14px', borderRadius: 8, border: 'none',
          background: C.gold, color: '#000', fontWeight: 900, fontSize: 12, cursor: 'pointer',
        }}>Send</button>
      </div>
    </div>
  );
}

// ─── Picture-in-picture both players ─────────────────────────────────────
export function PiPCohost({ p1StreamId, p2StreamId, p1HlsUrl, p2HlsUrl }) {
  const [primary, setPrimary] = useState('p1');
  const swap = () => setPrimary((p) => (p === 'p1' ? 'p2' : 'p1'));
  return (
    <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000', borderRadius: 14, overflow: 'hidden' }}>
      <HlsPlayer src={primary === 'p1' ? p1HlsUrl : p2HlsUrl} />
      <div onClick={swap} style={{
        position: 'absolute', bottom: 12, right: 12,
        width: '28%', aspectRatio: '16/9', borderRadius: 10,
        border: `2px solid ${C.cyan}`, overflow: 'hidden', cursor: 'pointer',
        background: '#000',
      }}>
        <HlsPlayer src={primary === 'p1' ? p2HlsUrl : p1HlsUrl} muted />
      </div>
    </div>
  );
}

function SideBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: 10, borderRadius: 8,
      background: active ? `${C.gold}22` : C.soft,
      border: `1px solid ${active ? C.gold : C.border}`,
      color: active ? C.gold : C.text, fontWeight: 800, fontSize: 12, cursor: 'pointer',
    }}>{label}</button>
  );
}
