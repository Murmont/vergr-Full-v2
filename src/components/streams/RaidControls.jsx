// Raids — the two surfaces a raid needs, in the REAL app.
//
// ⚠⚠ THIS IS THE CANONICAL COPY AND THE SIMULATOR IMPORTS IT. The preview had a
// RaidBanner of its own for one afternoon and that is exactly how the repo ends up
// with two definitions that drift (the theme system failed that way, and so did
// previewGifters). Whatever is drawn here is what a real viewer sees.
//
// Founder decisions, 2026-09-02:
//   • the raider EARNS VP — "it would encourage streamers to be less competitive
//     and be good natured and they will receive a reward for it"
//   • NO minimum viewer count
//   • a raid may NOT land on an audio-only or a gated stream
//
// The server half is `functions/raids.js`; every rule above is enforced there,
// because a client-side check is a suggestion.

import { useEffect, useState } from 'react';
import Icon from '../Icon';

const C = {
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff',
};
// Solid values only — these sit over live video, where a semi-transparent wash
// turns to mud and reads as a smudge rather than a surface.
const S = { panel: '#12101e', row: '#1a1a2a', chip: '#191527' };

/**
 * A raid landing — you are being taken to another stream.
 *
 * ⚠⚠ THE COUNTDOWN AND THE WAY OUT ARE THE MECHANIC, not decoration. A raid moves
 * someone to a place they did not choose. Twitch does it with no consent at either
 * end and hate raids followed, badly enough to trigger a creator walkout in 2021.
 * Ten seconds and a "Stay here" keeps essentially all of the transfer — almost
 * nobody opts out — while changing what the thing IS: something people go along
 * with rather than something done to them.
 *
 * ⚠ IT NAMES WHO IS TAKING YOU AND WHERE. "You are being moved" with no subject
 * reads as the app malfunctioning.
 *
 * ⚠ IT MUST CLEAR THE FLOATING LIKE BUTTON. Every live viewer surface parks a
 * 44-48px heart in the bottom-right of this exact band, and it has now covered
 * three separate controls (Follow, Subscribe, Stay here). **A way out that cannot
 * be pressed is worse than no way out**, because the viewer believes they opted
 * out and is moved anyway. The default reserves the space so a call site that
 * forgets the prop is still correct.
 */
export function RaidBanner({ fromName, toName, seconds = 10, onStay, reserveRight = 56 }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      paddingRight: 12 + reserveRight, borderRadius: 12,
      background: S.panel, marginBottom: 6,
      boxShadow: `inset 3px 0 0 ${C.purpleLight}`,
    }}>
      <Icon name="rocket_launch" size={17} style={{ color: C.purpleLight, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>
          {fromName || 'The host'} is raiding {toName || 'another stream'}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
          Taking you there in {seconds}s.
        </div>
      </div>
      <button type="button" onClick={onStay} style={{
        flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: S.row, color: C.text, fontSize: 11.5, fontWeight: 800,
      }}>Stay here</button>
    </div>
  );
}

/**
 * The countdown a real viewer actually experiences.
 *
 * ⚠ THE TIMER LIVES HERE, NOT IN THE VIEWER SCREEN, so both viewers cannot drift
 * apart on how long a raid takes or what "stay" means.
 *
 * ⚠ `onArrive` FIRES ONCE. A raid that navigates twice would bounce someone
 * through two streams.
 */
export function RaidCountdown({ raid, hostName, onArrive, reserveRight }) {
  const [left, setLeft] = useState(10);
  const [stayed, setStayed] = useState(false);

  // ⚠ RESET WHEN THE RAID CHANGES. Without the key in the deps a second raid in
  // the same session would inherit the previous countdown, which by then is 0 and
  // would move the viewer instantly with no chance to opt out.
  const key = raid?.toStreamId || '';
  useEffect(() => { setLeft(10); setStayed(false); }, [key]);

  useEffect(() => {
    if (!key || stayed) return undefined;
    if (left <= 0) { onArrive?.(raid); return undefined; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [key, left, stayed, onArrive, raid]);

  if (!key || stayed) return null;
  return (
    <RaidBanner
      fromName={hostName}
      toName={raid?.toHostName}
      seconds={Math.max(0, left)}
      reserveRight={reserveRight}
      onStay={() => setStayed(true)}
    />
  );
}

/**
 * The host's raid picker, shown as a stream ends.
 *
 * ⚠ IT ONLY OFFERS VALID TARGETS. The server refuses an audio-only or gated
 * stream (founder decision), so offering one here would produce a button that
 * fails — the "control that leads nowhere" this codebase keeps producing.
 *
 * ⚠ RAIDING IS OPTIONAL AND SKIPPING IS A REAL CHOICE, not a dismissal. A host
 * with nobody they want to raid must not feel they have failed a step.
 */
export function RaidPicker({ candidates = [], onRaid, onSkip, busy = false }) {
  const [picked, setPicked] = useState(null);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, marginBottom: 8 }}>
        SEND YOUR VIEWERS SOMEWHERE
      </div>
      {candidates.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
          Nobody you follow is live right now. You can raid another time — your
          viewers will just see the stream end normally.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {candidates.map((c) => (
            <button key={c.id} type="button" onClick={() => setPicked(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
              borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: C.text,
              background: picked === c.id ? '#251A46' : S.row,
              border: `1px solid ${picked === c.id ? C.purple : 'transparent'}`,
            }}>
              <span style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                background: S.chip,
              }}><Icon name="sensors" size={16} style={{ color: C.purpleLight }} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{c.hostName}</span>
                <span style={{ display: 'block', fontSize: 11, color: C.textMuted }}>
                  Live now{c.viewers ? ` · ${c.viewers} watching` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onSkip} style={{
          flex: 1, padding: 13, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: S.row, color: C.textDim, fontSize: 13, fontWeight: 800,
        }}>Not this time</button>
        <button type="button" disabled={!picked || busy}
          onClick={() => picked && onRaid?.(picked)}
          style={{
            flex: 2, padding: 13, borderRadius: 12, border: 'none',
            cursor: picked && !busy ? 'pointer' : 'default',
            background: picked && !busy ? C.purple : S.row,
            color: picked && !busy ? '#fff' : C.textMuted,
            fontSize: 13, fontWeight: 800,
          }}>{busy ? 'Raiding…' : 'Raid'}</button>
      </div>
    </div>
  );
}
