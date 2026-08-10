// HighStakesProofExplainerModal
//
// Fires the FIRST time a high-stakes tournament match opens (entry fee
// > 5,000 coins). Tells the player exactly what's about to happen, what
// gets captured, who sees it, and what happens if they decline — BEFORE
// the OS screen-share picker fires. Closes when the player either starts
// the recorder or explicitly accepts the forfeit risk.
//
// One-time per match: dismissed state persisted in localStorage so the
// modal doesn't re-fire on every refresh.

import { useEffect, useState } from 'react';
import Icon from '../Icon';

export default function HighStakesProofExplainerModal({
  matchId,
  entryFee,
  onStart,
  onDeclineAcknowledge,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!matchId) return;
    const seenKey = `vergr.proofExplainer.${matchId}`;
    if (!localStorage.getItem(seenKey)) setOpen(true);
  }, [matchId]);

  if (!open) return null;

  const close = () => {
    localStorage.setItem(`vergr.proofExplainer.${matchId}`, '1');
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(11,11,20,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 520, background: '#14141F',
        border: '1px solid rgba(240,165,0,0.4)', borderRadius: 18,
        padding: 22, color: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Icon name="verified_user" size={22} style={{ color: '#F0A500' }} />
          <div style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 800, color: '#F0A500' }}>
            HIGH-STAKES MATCH · {entryFee?.toLocaleString()}c ENTRY
          </div>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, fontFamily: 'Syne, sans-serif' }}>
          Two-camera proof recording
        </h2>

        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)', marginBottom: 14 }}>
          Because the prize is significant, this match is recorded so a moderator can verify the
          result if it's disputed. Here's exactly what happens:
        </p>

        <Bullet
          icon="screen_share"
          title="Your game window only"
          body="When you click Start, your OS asks you to pick a window to share. Pick the game. We can't see your desktop or other apps — the OS enforces window-only capture."
        />
        <Bullet
          icon="videocam"
          title="Your webcam (already recording)"
          body="Goes into a small corner of the recording as proof you were at your machine. The 'PROOF CAM' tile in the bottom-right is the live preview."
        />
        <Bullet
          icon="visibility"
          title="Only mods and the founder see this"
          body="The feed is NOT public, never on a stream page, never on your profile. It's a private review feed for the Vanguard mod team if the match is disputed. Deleted 30 days after the match ends."
        />
        <Bullet
          icon="warning"
          title="No proof = you can't claim a win"
          body="If you don't have proof recording when you try to report yourself as winner, the report is rejected. The match either stays unresolved (a mod calls it) or your opponent's claim wins by default. Recording is the only way to safely win a high-stakes match."
        />

        <div style={{
          background: 'rgba(240,64,96,0.08)',
          border: '1px solid rgba(240,64,96,0.25)',
          borderRadius: 10, padding: 10, marginTop: 8, fontSize: 12,
          color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#F04060' }}>Heads up:</strong> Windows shows a thin yellow border around the captured
          window — that's the OS, not us. We can't hide it in this version.
          The screen-share picker also reappears each match. A future native overlay will remove both prompts.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            onClick={() => { close(); onStart?.(); }}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 10,
              background: '#F0A500', color: '#000', border: 'none',
              fontSize: 13, fontWeight: 800, cursor: 'pointer',
            }}
          >
            Start proof recording
          </button>
          <button
            onClick={() => { close(); onDeclineAcknowledge?.(); }}
            style={{
              padding: '12px 14px', borderRadius: 10,
              background: 'transparent', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Not now (forfeit risk)
          </button>
        </div>
      </div>
    </div>
  );
}

function Bullet({ icon, title, body }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'rgba(240,165,0,0.10)', border: '1px solid rgba(240,165,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={16} style={{ color: '#F0A500' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}
