// previewSoloParts — shared building blocks for the SOLO live-viewer preview
// screens (PreviewSoloPortrait / PreviewSoloLandscape). These reproduce the
// founder's solo-stream mobile designs for the admin Stream Preview tab.
//
// SELF-CONTAINED on purpose: no co-host imports, no Firestore, no relay. The
// video + facecam are CSS placeholders (a solo facecam is its OWN thing, NOT the
// co-host grid). Real stream art drops straight into PreviewVideoStage later.
// Only generic stream-UI icon assets are reused.

import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import modBadgeIcon from '../../../assets/stream/mod-badge.webp';
import watchingIcon from '../../../assets/stream/watching.webp';
import waveIcon from '../../../assets/stream/wave.webp';
import inviteIcon from '../../../assets/stream/invite.webp';
import vcCoinIcon from '../../../assets/stream/vc-coin.webp';
import giftboxIcon from '../../../assets/stream/giftbox.webp';
import sendIcon from '../../../assets/stream/send.webp';
import likeIcon from '../../../assets/stream/like.webp';

export const C = {
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#8a8aa0',
  purple: '#7c3aed', purpleLight: '#b44fff', gold: '#F5C842',
};

export const glass = { background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(16px) saturate(140%)', WebkitBackdropFilter: 'blur(16px) saturate(140%)', border: '1px solid rgba(255,255,255,0.18)' };
export const glassDark = { background: 'rgba(10,8,22,0.42)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', border: '1px solid rgba(255,255,255,0.12)' };

export function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// ── Video stage placeholder ────────────────────────────────────────────────
// scene = 'game' (gameplay capture) or 'cam' (camera-only / just chatting). A
// solo broadcaster's main feed — distinct from a co-host grid. CSS only so it
// reads under the glass blur without shipping a binary; swap for live <video>.
export function PreviewVideoStage({ scene = 'game', src = null }) {
  // The video region — the ONLY part of a preview screenshot that is not real
  // UI. Everything around it (host capsule, chat, dock, gifters) is a faithful
  // reproduction of production and must be captured as-is.
  //
  // Renders a flat grey block that MEASURES ITSELF and prints its own pixel
  // size, because this same component is rendered at three different sizes:
  //   - PreviewSoloPortrait  16:9 (desktop source), centred in its band
  //   - PreviewSoloLandscape full-bleed, fills the frame
  //   - PreviewDesktopViewer 16:9, full width
  // Printing the measured size means the number is right at whatever resolution
  // the screenshot is taken, instead of a hardcoded guess.
  //
  // Pass `src` to drop real footage in and render it instead of the placeholder.
  const boxRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (src) {
    return (
      <div ref={boxRef} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  const ratio = dims.w && dims.h ? (dims.w / dims.h) : 0;
  const ratioLabel = !ratio ? ''
    : Math.abs(ratio - 16 / 9) < 0.03 ? '16:9'
    : Math.abs(ratio - 4 / 5)  < 0.03 ? '4:5'
    : Math.abs(ratio - 9 / 16) < 0.03 ? '9:16'
    : ratio.toFixed(2) + ':1';

  return (
    <div ref={boxRef} style={{
      position: 'absolute', inset: 0, background: '#8C8C94',
      display: 'grid', placeItems: 'center', overflow: 'hidden',
    }}>
      {/* Corner ticks so the fill region is unambiguous once cropped out. */}
      {[
        { top: 8, left: 8, borderTop: '2px solid #4A4A52', borderLeft: '2px solid #4A4A52' },
        { top: 8, right: 8, borderTop: '2px solid #4A4A52', borderRight: '2px solid #4A4A52' },
        { bottom: 8, left: 8, borderBottom: '2px solid #4A4A52', borderLeft: '2px solid #4A4A52' },
        { bottom: 8, right: 8, borderBottom: '2px solid #4A4A52', borderRight: '2px solid #4A4A52' },
      ].map((st, i) => (
        <div key={i} style={{ position: 'absolute', width: 18, height: 18, ...st }} />
      ))}
      <div style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#3A3A42', textAlign: 'center', lineHeight: 1.7, userSelect: 'text',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em' }}>
          {scene === 'cam' ? 'CAMERA AREA' : 'GAMEPLAY AREA'}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {dims.w} × {dims.h}
        </div>
        {ratioLabel && <div style={{ fontSize: 11, opacity: 0.75 }}>{ratioLabel}</div>}
      </div>
    </div>
  );
}

// ── Solo facecam picture-in-picture ─────────────────────────────────────────
// The small camera tile a solo broadcaster overlays on their gameplay (Twitch
// facecam pattern). Its OWN component — nothing to do with co-host tiles.
export function FacecamPip({ w = 132, style }) {
  return (
    <div style={{ width: w, aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', background: 'radial-gradient(90% 70% at 50% 30%, #2a2440 0%, #14101f 60%, #0a0810 100%)', ...style }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.32)' }}>
        <Icon name="person" size={30} filled />
      </div>
      <span style={{ position: 'absolute', top: 5, right: 5, color: C.gold }}><Icon name="auto_awesome" size={13} filled /></span>
    </div>
  );
}

// ── Host capsule ────────────────────────────────────────────────────────────
// IDENTICAL to the immersive (current) viewer's host card so the top bar reads
// the same across every solo layout (founder: "they are supposed to look the
// same not change"). Verified check sits INLINE by the name (TikTok pattern), NOT
// overlaid on the avatar. Tapping the capsule opens the profile sheet (Follow
// lives there); there is no inline Follow pill.
export function HostCapsule({ host, hearts }) {
  return (
    <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
      <UserAvatar src={host?.avatar} size={38} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, maxWidth: 150 }}>{host?.displayName || 'Live'}</span>
          {host?.isVerified && (
            <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={10} />
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>{compactNum(hearts || 0)} Likes</span>
      </div>
    </button>
  );
}

// ── Top-gifters cluster ──────────────────────────────────────────────────────
// IDENTICAL to the immersive viewer's cluster: clean overlapping avatars, #1
// ringed gold, NO coin pills (those overlapped each other + diverged from the
// current screen). Per-gifter totals live in the tap-through leaderboard.
export function GiftersClusterCoins({ gifters }) {
  const top = (gifters || []).slice(0, 3);
  if (!top.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {top.map((g, i) => (
        <span key={g.uid} style={{ marginLeft: i ? -7 : 0, display: 'inline-flex', borderRadius: '50%', border: `2px solid ${i === 0 ? C.gold : 'rgba(10,8,22,0.6)'}`, zIndex: 3 - i }}>
          <UserAvatar src={g.avatar} size={24} />
        </span>
      ))}
    </div>
  );
}

export function ViewerPill({ count }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, ...glassDark }}>
      <Icon name="visibility" size={14} />{compactNum(count || 0)}
    </span>
  );
}

export function CloseBtn() {
  return <button type="button" style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>;
}

// Fullscreen toggle — same glass treatment as the dock / heart controls.
export function FullscreenBtn({ style }) {
  return (
    <button type="button" title="Fullscreen" style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...glass, ...style }}>
      <Icon name="fullscreen" size={20} />
    </button>
  );
}

export function FloatingHeart({ style }) {
  return (
    <button type="button" aria-label="Like" style={{ width: 46, height: 46, borderRadius: 16, cursor: 'pointer', padding: 0, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.20)', ...style }}>
      <img src={likeIcon} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
    </button>
  );
}

// ── Gift drops (TikTok-style combo feed) ─────────────────────────────────────
// A gift toast is TRANSIENT — it appears when someone sends a gift and auto-fades
// (it is NOT permanently parked on the video). When the SAME person keeps sending
// the SAME gift, that row's combo counter climbs (x1 → x2 …) instead of adding a
// new row; DIFFERENT senders stack as separate rows (max 3 visible). Drive it
// with `useGiftFeed` and render `<GiftFeed>` where the drops should appear.

const GIFT_COMBO_MS = 4200; // a row lives this long after its last hit

// One transient row: avatar · name · "Sent {gift}" · gift icon · big xN combo.
function GiftRow({ t }) {
  return (
    <div style={{ animation: 'vgrGiftIn 0.22s ease-out', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 12px 4px 4px', borderRadius: 999, maxWidth: '88%', boxShadow: '0 6px 18px rgba(0,0,0,0.42)', ...glassDark }}>
      <UserAvatar src={t.avatar} size={30} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.18 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
        <span style={{ fontSize: 9.5, color: C.textDim, whiteSpace: 'nowrap' }}>Sent {t.gift}</span>
      </div>
      <img src={vcCoinIcon} alt="" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
      {/* keyed on count so each combo hit re-runs the pop animation */}
      <span key={t.count} style={{ animation: 'vgrGiftPop 0.34s cubic-bezier(0.2,1.6,0.4,1)', fontSize: 19, fontWeight: 900, fontStyle: 'italic', color: C.gold, flexShrink: 0, textShadow: '0 1px 6px rgba(245,200,66,0.5)' }}>x{compactNum(t.count)}</span>
    </div>
  );
}

// Renders the active gift rows (oldest at the top, newest at the bottom).
export function GiftFeed({ toasts, style }) {
  if (!toasts?.length) return null;
  // ABSOLUTE BY DEFAULT. Gift drops are transient chrome that appear and vanish;
  // in normal flow they push the chat (and anything else in the column) every
  // time one fires. Callers may override the anchor, but not the positioning.
  return (
    <div style={{ position: 'absolute', left: 12, bottom: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, pointerEvents: 'none', ...style }}>
      <style>{'@keyframes vgrGiftIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes vgrGiftPop{0%{transform:scale(0.55)}45%{transform:scale(1.3)}100%{transform:scale(1)}}'}</style>
      {toasts.map((t) => <GiftRow key={t.id} t={t} />)}
    </div>
  );
}

// Hook: manages the transient combo feed. `lastGift` (from the admin "Fire tip"
// button via the mock doc) pushes a drop; `sendGift` lets in-screen controls (the
// VC dock button) push one too. Same name+gift within the combo window stacks the
// counter; otherwise a new row is added (cap 3, oldest drops).
export function useGiftFeed(lastGift) {
  const [toasts, setToasts] = useState([]);

  const sendGift = useCallback((g) => {
    const name = g?.name || 'TestFan';
    const gift = g?.gift || 'Galaxy';
    const qty = g?.qty || 1;
    const avatar = g?.avatar || null;
    setToasts((prev) => {
      const i = prev.findIndex((t) => t.name === name && t.gift === gift);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = { ...next[i], count: next[i].count + qty, ts: Date.now() };
        return next;
      }
      const row = { id: `${name}-${gift}-${Date.now()}`, name, gift, avatar, count: qty, ts: Date.now() };
      return [...prev, row].slice(-3);
    });
  }, []);

  // Expire rows GIFT_COMBO_MS after their last hit.
  useEffect(() => {
    if (!toasts.length) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.ts < GIFT_COMBO_MS));
    }, 600);
    return () => clearInterval(id);
  }, [toasts.length]);

  // Admin "Fire tip" → new drop (deduped on the doc timestamp).
  const seen = useRef(0);
  useEffect(() => {
    if (lastGift?.ts && lastGift.ts !== seen.current) {
      seen.current = lastGift.ts;
      sendGift(lastGift);
    }
  }, [lastGift, sendGift]);

  return { toasts, sendGift };
}

// ── Chat ────────────────────────────────────────────────────────────────────
function ModBadge() {
  return <img src={modBadgeIcon} alt="moderator" style={{ height: 15, width: 'auto', objectFit: 'contain', verticalAlign: '-3px' }} />;
}
function SubPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', padding: '1px 5px 1px 3px', borderRadius: 6, fontSize: 8.5, fontWeight: 900, letterSpacing: '0.04em', color: '#fff', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})` }}>
      <Icon name="star" size={9} filled style={{ color: C.gold }} />SUB
    </span>
  );
}

// `inline` = immersive overlay (badges before name, one wrapping line).
// stacked (default) = name+badges line, message below (the portrait panel).
export function SoloChatRow({ user, text, mod = false, sub = false, inline = false, avatarSize = 'sm' }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}><UserAvatar src={null} size={inline ? 'xs' : avatarSize} /></span>
      <div style={{ flex: 1, minWidth: 0, fontSize: inline ? 12 : 13, lineHeight: 1.4 }}>
        {inline ? (
          <>
            {mod && <span style={{ marginRight: 4 }}><ModBadge /></span>}
            {sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
            <span style={{ fontWeight: 800, color: '#fff', marginRight: 6 }}>{user}</span>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{text}</span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
              <span style={{ fontWeight: 800, color: '#fff' }}>{user}</span>
              {mod && <ModBadge />}
              {sub && <SubPill />}
            </div>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{text}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function JoinRow() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>
      <img src={waveIcon} alt="" aria-hidden style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />
      <span><b style={{ fontWeight: 800 }}>ZERO_taeyeon</b> joined via share invitation</span>
    </div>
  );
}

export function WatchingRow() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.82)', width: 'fit-content' }}>
      <img src={watchingIcon} alt="" aria-hidden style={{ width: 18, height: 18, objectFit: 'contain' }} />
      <span><b style={{ fontWeight: 800 }}>Priya_S</b> started watching</span>
    </div>
  );
}

// ── Composer dock ───────────────────────────────────────────────────────────
function DockGlassBtn({ src, alt, onClick }) {
  return (
    <button type="button" title={alt} onClick={onClick} style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, padding: 0, overflow: 'hidden', cursor: 'pointer', ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} alt={alt} style={{ width: 28, height: 28, objectFit: 'contain' }} />
    </button>
  );
}

// Composer: input + invite / Tips&VC / Gift Box / Share. Tapping Tips & VC fires
// a gift drop (`onTip`) — the gift component only shows on this action, it is not
// parked on screen.
export function SoloDock({ onTip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...glassDark }}>Add a comment…</div>
      <DockGlassBtn src={inviteIcon} alt="Invite" />
      <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={onTip} />
      <DockGlassBtn src={giftboxIcon} alt="Gift Box" />
      <DockGlassBtn src={sendIcon} alt="Share" />
    </div>
  );
}
