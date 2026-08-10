// TrophyCeremony — post-final podium with animated prize counter.
// Shown when tournament.status flips to 'completed' and current user is
// on the final results screen.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import { haptic } from '../../utils/haptics';
import { compactNum } from '../creator/charts';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { sendCoins } from '../../firebase/firestore';

const C = {
  gold: '#F0A500', goldLight: '#F5C842',
  silver: '#C0C0C0', bronze: '#CD7F32',
  text: '#fff', dim: 'rgba(255,255,255,0.65)',
};

const PODIUM_COLORS = [C.gold, C.silver, C.bronze];
const PODIUM_HEIGHTS = [180, 130, 100];

export default function TrophyCeremony({ standings, prizes, onClose }) {
  // standings = [{ uid, username, avatar }, ...] in order 1st, 2nd, 3rd
  // prizes    = [coinsForFirst, coinsForSecond, coinsForThird]
  const top3 = (standings || []).slice(0, 3);
  if (top3.length === 0) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'radial-gradient(circle at center, rgba(20,15,5,0.95), rgba(0,0,0,0.98))',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
      >
        <motion.div
          initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
          style={{ textAlign: 'center', marginBottom: 40 }}
        >
          <div style={{
            fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 900,
            color: C.gold, textTransform: 'uppercase', letterSpacing: '0.4em',
          }}>Tournament Complete</div>
          <div style={{
            fontFamily: 'Syne, sans-serif', fontSize: 40, fontWeight: 900,
            color: C.text, marginTop: 6,
            textShadow: `0 0 40px ${C.gold}66`,
          }}>Champions</div>
        </motion.div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 36 }}>
          {[1, 0, 2].map((rank) => {
            const winner = top3[rank];
            if (!winner) return <div key={rank} style={{ width: 120 }} />;
            return (
              <PodiumSpot
                key={rank}
                rank={rank}
                winner={winner}
                prize={prizes?.[rank] || 0}
              />
            );
          })}
        </div>

        {/* Tip-the-winner CTA — hidden when the viewer IS the winner.
            Real tip via sendCoins (10% platform fee handled inside). */}
        <TipWinnerPanel winner={top3[0]} />

        <button onClick={onClose} style={{
          padding: '12px 32px', borderRadius: 12, border: 'none',
          background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
          color: '#000', fontSize: 14, fontWeight: 900, cursor: 'pointer',
        }}>Continue</button>
      </motion.div>
    </AnimatePresence>
  );
}

const PRESETS = [50, 100, 500, 1000];

function TipWinnerPanel({ winner }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [amount, setAmount] = useState(100);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);
  const [sentAmount, setSentAmount] = useState(0);

  if (!winner) return null;
  // Self-tip block: winners can't tip themselves. Also hide for guests.
  if (!currentUser?.uid || currentUser.uid === winner.uid) return null;

  const effective = custom ? Math.max(1, Math.min(50_000, parseInt(custom, 10) || 0)) : amount;

  const send = async () => {
    if (sending || !effective) return;
    setSending(true);
    try {
      await sendCoins(currentUser.uid, winner.uid, effective,
        `Champion tip · ${winner.username || 'winner'}`);
      setSentAmount(effective);
      haptic.success();
      showToast(`Sent ${effective.toLocaleString()}c to ${winner.username || 'the winner'}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Tip failed', 'error');
    }
    setSending(false);
  };

  // Post-send confirmation state — replaces the form with a thank-you.
  if (sentAmount > 0) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={{
          padding: '14px 22px', borderRadius: 14,
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)',
          color: '#22c55e', fontSize: 13, fontWeight: 800,
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 18,
        }}
      >
        <Icon name="check_circle" size={18} style={{ color: '#22c55e' }} />
        Tip sent — {sentAmount.toLocaleString()}c to {winner.username || 'champion'}.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 1.4 }}
      style={{
        padding: 16, borderRadius: 14, marginBottom: 18,
        background: 'rgba(20,20,31,0.85)', border: `1px solid ${C.gold}55`,
        maxWidth: 460, width: '100%',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '0.16em', fontWeight: 900,
        color: C.gold, textAlign: 'center', marginBottom: 8,
        textTransform: 'uppercase',
      }}>
        Tip the champion · {winner.username || 'winner'}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => {
          const active = !custom && amount === p;
          return (
            <button
              key={p}
              onClick={() => { setCustom(''); setAmount(p); }}
              style={{
                padding: '6px 14px', borderRadius: 999,
                background: active ? C.gold : 'transparent',
                color: active ? '#000' : C.text,
                border: `1px solid ${active ? C.gold : 'rgba(255,255,255,0.15)'}`,
                fontSize: 12, fontWeight: 800, cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
              }}
            >
              {compactNum?.(p) || p}c
            </button>
          );
        })}
        <input
          type="number" min="1" max="50000"
          placeholder="Custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
          style={{
            width: 90, padding: '6px 10px', borderRadius: 999,
            background: 'transparent', color: C.text,
            border: `1px solid ${custom ? C.gold : 'rgba(255,255,255,0.15)'}`,
            fontSize: 12, fontWeight: 700, textAlign: 'center',
            fontFamily: 'DM Mono, monospace', outline: 'none',
          }}
        />
      </div>

      <button
        onClick={send}
        disabled={sending || !effective}
        style={{
          width: '100%', padding: '10px 18px', borderRadius: 10, border: 'none',
          background: sending ? 'rgba(240,165,0,0.4)' : `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
          color: '#000', fontSize: 13, fontWeight: 900, cursor: sending ? 'not-allowed' : 'pointer',
        }}
      >
        {sending ? 'Sending…' : `Send ${effective?.toLocaleString() || 0}c tip`}
      </button>
    </motion.div>
  );
}

function PodiumSpot({ rank, winner, prize }) {
  const color = PODIUM_COLORS[rank];
  const height = PODIUM_HEIGHTS[rank];
  const delay = rank === 0 ? 1.0 : 0.4 + rank * 0.3;
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    if (rank === 0) haptic.success();
    const t = setTimeout(() => {
      const start = Date.now();
      const target = prize;
      const dur = 1400;
      const tick = () => {
        const p = Math.min(1, (Date.now() - start) / dur);
        setCounter(Math.floor(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, (delay + 0.6) * 1000);
    return () => clearTimeout(t);
  }, [prize, rank, delay]);

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 100 }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
    >
      {rank === 0 && (
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: delay + 0.4, type: 'spring', stiffness: 250 }}
        >
          <Icon name="emoji_events" size={40} className="" style={{ color: C.gold }} />
        </motion.div>
      )}
      <div style={{
        padding: 3, borderRadius: '50%',
        background: `linear-gradient(135deg, ${color}, ${color}aa)`,
        boxShadow: `0 0 30px ${color}88`,
      }}>
        <UserAvatar uid={winner.uid} username={winner.username} size={rank === 0 ? 'xl' : 'lg'} />
      </div>
      <div style={{
        fontFamily: 'Syne, sans-serif', fontSize: rank === 0 ? 16 : 13, fontWeight: 900,
        color: C.text, textAlign: 'center', maxWidth: 140,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {winner.username}
      </div>
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 900,
        color, tabularNums: 'tabular-nums',
      }}>
        {compactNum?.(counter) || counter} c
      </div>
      <div style={{
        width: 110, height,
        background: `linear-gradient(180deg, ${color}33, ${color}11)`,
        border: `1px solid ${color}66`,
        borderRadius: '8px 8px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Syne, sans-serif', fontSize: 40, fontWeight: 900, color,
      }}>
        {rank + 1}
      </div>
    </motion.div>
  );
}
