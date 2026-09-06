// previewSoloParts — shared building blocks for the SOLO live-viewer preview
// screens (PreviewSoloPortrait / PreviewSoloLandscape). These reproduce the
// founder's solo-stream mobile designs for the admin Stream Preview tab.
//
// SELF-CONTAINED on purpose: no co-host imports, no Firestore, no relay. The
// video + facecam are CSS placeholders (a solo facecam is its OWN thing, NOT the
// co-host grid). Real stream art drops straight into PreviewVideoStage later.
// Only generic stream-UI icon assets are reused.

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
// ⚠ THE REAL COMPONENTS. Every cosmetic the VP ladder sells is resolved
// inside them from `vpLevel` alone, so a plain name here means a capture
// that shows none of it. Prop-driven, so importing is read-only.
import UserName from '../../../components/UserName';
import RankBadge from '../../../components/RankBadge';
import ComboMeter from '../../../components/streams/ComboMeter';
import { StreamGoalBar } from '../../../components/streams/StreamGoalAndAlerts';
import { useFaces, usePreviewSim } from './previewAssetsContext';
import { ComposerPill } from './previewStates';
// ⚠ MovableGoal MOVED to components/streams/states so the real broadcaster can
// use it. Imported back and RE-EXPORTED, so no preview call site changed.
import { MovableGoal } from '../../../components/streams/states';
export { MovableGoal };
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { TipComboFeed, useTipCombo, useAboveChat } from '../../../components/streams/TipComboFeed';
export { useAboveChat };
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

// ⚠⚠ A THIRD COPY OF THE SAME TWO TOKENS. previewChrome and MobileLiveViewer each
// had their own, and this file a third — so solidifying two of them left the split and
// landscape viewers still drawing the old wash, which is exactly what the live probe
// then reported. Same value, same reasoning: these are PILLS ON GAMEPLAY, and a
// translucent fill with a BRIGHTER hairline is the border-soup the founder has now
// rejected three times.
export const glass = { background: '#1E1A2E', border: 'none' };
export const glassDark = { background: '#100C1C', border: 'none' };

export function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// ── Video stage placeholder ────────────────────────────────────────────────
// scene = 'game' (gameplay capture) or 'cam' (camera-only / just chatting). A
// solo broadcaster's main feed — distinct from a co-host grid. CSS only so it
// reads under the glass blur without shipping a binary; swap for live <video>.
export function PreviewVideoStage({ scene = 'game', src = null, videoUrl = null }) {
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

  // ⚠ AN UPLOADED VIDEO OUTRANKS EVERYTHING. The measured grey block below is a
  // developer aid, not something anyone should ever screenshot; once a real clip
  // is supplied it is the stage.
  if (videoUrl) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
        <video src={videoUrl} autoPlay muted loop playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

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
        <div style={{ fontSize: 16, fontWeight: 700 }}>
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
//
// ⚠ THIS IS THE SECOND VIDEO, AND IT MUST NOT BE THE STAGE'S. A PiP layout is
// two sources by definition: the stage plays the gameplay, this plays the
// camera. Feeding both from one upload renders the same frames twice, which
// reads as a mirror rather than a broadcast, so the simulator carries a
// separate `facecamVideo` upload and this is its only consumer besides the
// broadcaster's own PiP inset.
// ⚠⚠ NO FACECAM VIDEO MEANS NO PiP, NOT AN EMPTY GREY BOX.
// THE WHOLE POINT OF THIS TOOL IS CAPTURING STORE SCREENSHOTS, and with no facecam
// uploaded this drew a grey rectangle with a person glyph over the video on EVERY
// surface, with no way to remove it. Founder, 2026-09-03: *"how the fuck am i supposed
// to capture content if there is a constant PiP on the screen that has no way to be
// turned off"*. A placeholder that cannot be dismissed is worse than no placeholder:
// it is in every frame he ships.
//
// The upload slot in the rail is how you put a facecam here. Until something is in it,
// this draws nothing.

export function FacecamPip({ w = 132, style, videoUrl = null }) {
  // ⚠ NO EARLY RETURN ON A MISSING CLIP. The Game+cam / Camera only toggle decides
  // whether this renders; returning null when the facecam slot is empty made that
  // toggle look broken and turned the placeholder below into dead code.
  return (
    <div style={{ width: w, aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', position: 'relative', border: 'none', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', background: 'radial-gradient(90% 70% at 50% 30%, #2a2440 0%, #14101f 60%, #0a0810 100%)', ...style }}>
      {videoUrl ? (
        <video src={videoUrl} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.32)' }}>
          <Icon name="person" size={30} filled />
        </div>
      )}
      {/* ⚠ NO BADGE ON THE PiP. A gold auto_awesome sparkle used to sit here with no
          comment, no prop and no condition — it rendered unconditionally, so it reported
          nothing. In the rest of the product that glyph means an AR filter ("Angel") or
          "Share to my Status", neither of which is a facecam. So it either meant nothing
          or it implied a filter was on and lied, in every store screenshot. Founder asked
          what it was, which is the answer: an unexplained mark is a defect. */}
    </div>
  );
}

// ── Host capsule ────────────────────────────────────────────────────────────
// IDENTICAL to the immersive (current) viewer's host card so the top bar reads
// the same across every solo layout (founder: "they are supposed to look the
// same not change"). Verified check sits INLINE by the name (TikTok pattern), NOT
// overlaid on the avatar. Tapping the capsule opens the profile sheet (Follow
// lives there); there is no inline Follow pill.
export function HostCapsule({ host, hearts, onOpen }) {
  const faceOf = useFaces();
  return (
    <button type="button" onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
      <UserAvatar src={faceOf(host)} size={38} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, maxWidth: 150 }}>{host?.displayName || 'Live'}</span>
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
  const faceOf = useFaces();
  const top = (gifters || []).slice(0, 3);
  if (!top.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {top.map((g, i) => (
        <span key={g.uid} style={{ marginLeft: i ? -7 : 0, display: 'inline-flex', borderRadius: '50%', border: `2px solid ${i === 0 ? C.gold : 'rgba(10,8,22,0.6)'}`, zIndex: 3 - i }}>
          <UserAvatar src={faceOf(g)} size={24} />
        </span>
      ))}
    </div>
  );
}

// ⚠ THE VIEWER COUNT OPENS THE VIEWER LIST. It was a dead label on every
// surface, and "who is watching?" had no answer anywhere in the product —
// measured zero references to a viewer list in the real screens too. This is
// where people already look to ask the question, so it is the way in.
export function ViewerPill({ count, onClick }) {
  return (
    <button type="button" aria-label="Viewers" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, border: 'none', color: '#fff', cursor: onClick ? 'pointer' : 'default', ...glassDark }}>
      <Icon name="visibility" size={14} />{compactNum(count || 0)}
    </button>
  );
}

export function CloseBtn({ onClose }) {
  return <button aria-label="Close" type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#100C1C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>;
}

// Fullscreen toggle — same glass treatment as the dock / heart controls.
export function FullscreenBtn({ style, onClick }) {
  return (
    <button aria-label="Fullscreen" type="button" onClick={onClick} title="Fullscreen" style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...glass, ...style }}>
      <Icon name="fullscreen" size={20} />
    </button>
  );
}

// ⚠⚠ THIS BUTTON HAD NO onClick AT ALL. It rendered, it looked pressable, and
// it did nothing on every surface except the immersive viewer — so the hearts
// work was only ever half-delivered, and the founder found it rather than me.
// It pulls the emitter out of the sim context itself instead of waiting for a
// caller to remember a prop, which is what went wrong the first three times.
// ⚠ THE METER IS PART OF THE BUTTON, NOT A SIBLING. Mounting <ComboMeter>
// separately meant five surfaces each had to place it at the right offset above
// their own heart, and one of them had a meter with no button at all. Bundled,
// the bar is always directly above the thing being tapped, there is no offset
// to tune per screen, and a surface cannot have one without the other.
export function FloatingHeart({ style }) {
  const { fireReaction, combo = 0, comboMax } = usePreviewSim();
  const { width = 46, height = 46, ...pos } = style || {};
  return (
    <div style={{ position: 'absolute', width, height, ...pos }}>
      {/* Anchored to the button's own top edge, so it rides whatever position
          the caller chose. `right:auto` cancels the meter's own default. */}
      <ComboMeter combo={combo} max={comboMax}
        style={{ bottom: '100%', right: 'auto', left: '50%', marginBottom: 8, transform: 'translateX(-50%)' }} />
      <button type="button" aria-label="Like" onClick={() => fireReaction?.(1)} style={{ width: '100%', height: '100%', borderRadius: 16, cursor: 'pointer', padding: 0, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#100C1C' }}>
        <img src={likeIcon} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
      </button>
    </div>
  );
}

// ── Tip drops (TikTok-style combo feed) ─────────────────────────────────────
//
// ⚠⚠ THERE ARE NO GIFTS. COINS (VC) ARE THE ONLY THING A VIEWER CAN SEND.
// Gifting is DEFERRED in CLAUDE.md ("do NOT start without explicit go-ahead")
// and there is no gift catalogue anywhere in the product. This feed used to
// render "Sent Rose" / "Sent Galaxy" from hardcoded names, which advertises a
// feature that does not exist — in a screen whose captures go on the Play
// listing. The row shows the coin and the amount, nothing else.
//
// ⚠ THE `gift` VOCABULARY IN THIS FILE IS LEGACY NAMING (GiftFeed, useGiftFeed,
// sendGift, lastGift). It does NOT mean a gift system exists. Do not build one
// off the back of these names.
// A gift toast is TRANSIENT — it appears when someone sends a gift and auto-fades
// (it is NOT permanently parked on the video). When the SAME person keeps sending
// the SAME gift, that row's combo counter climbs (x1 → x2 …) instead of adding a
// new row; DIFFERENT senders stack as separate rows (max 3 visible). Drive it
// with `useGiftFeed` and render `<GiftFeed>` where the drops should appear.

// ⚠ THE TIP FEED NOW LIVES IN PRODUCTION (components/streams/TipComboFeed).
// It was built here and the real screens never got it, so the design the
// founder approved rendered only inside the simulator. These two are thin
// adapters kept so no preview call site changed: GiftFeed resolves the cast
// faces the admin uploaded, and useGiftFeed keeps the name the sim writes.
export function GiftFeed({ toasts, style }) {
  const faceOf = useFaces();
  const tips = (toasts || []).map((t) => ({ ...t, avatar: faceOf(t) }));
  return <TipComboFeed tips={tips} style={style} />;
}

export function useGiftFeed(lastGift) {
  const { tips, push } = useTipCombo(lastGift);
  return { toasts: tips, sendGift: push };
}

// ── Chat ────────────────────────────────────────────────────────────────────
// ⚠ EXPORTED SO THERE IS ONE MOD BADGE AND ONE SUB PILL, not four. The chat
// row in previewChrome hand-rolled its own of each; the MOD one was a cyan
// pill, which is both a second visual language in the same list and against
// [[project-brand-no-cyan]] — violet, pink and gold only. The real badge is
// founder-supplied ART, which no hand-rolled pill was ever going to match.
export function ModBadge() {
  return <img src={modBadgeIcon} alt="moderator" style={{ height: 15, width: 'auto', objectFit: 'contain', verticalAlign: '-3px' }} />;
}
export function SubPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', padding: '1px 5px 1px 3px', borderRadius: 8, fontSize: 9, fontWeight: 900, letterSpacing: '0.04em', color: '#fff', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})` }}>
      <Icon name="star" size={9} filled style={{ color: C.gold }} />SUB
    </span>
  );
}

// `inline` = immersive overlay (badges before name, one wrapping line).
// stacked (default) = name+badges line, message below (the portrait panel).
// ⚠  was hardcoded to null here, so every row drew an empty disc and an
// uploaded face would have been silently ignored.
export function SoloChatRow({ user, text, uid = null, vpLevel = 0, mod = false, sub = false, inline = false, avatarSize = 'sm', avatar = null }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}><UserAvatar src={avatar} size={inline ? 'xs' : avatarSize} /></span>
      {/* ⚠⚠ `inline` ROWS ARE DRAWN STRAIGHT ONTO THE VIDEO with no backing, and they
          carried NO text shadow. Over a dark frame that reads fine, which is why it
          survived; over a lit close-up of the broadcaster's face it is white-on-white and
          the messages disappear into the picture. Measured on the landscape viewer, where
          four rows sat across the host's face.

          A shadow, not a plate: a backing panel would cover the video the rows are
          deliberately floating over, and the founder's landscape reference has none. The
          stacked variant sits in a real panel and needs nothing. */}
      <div style={{ flex: 1, minWidth: 0, fontSize: inline ? 12 : 13, lineHeight: 1.4,
        textShadow: inline ? '0 1px 3px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.7)' : undefined }}>
        {inline ? (
          <>
            {mod && <span style={{ marginRight: 4 }}><ModBadge /></span>}
            {sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
            <span style={{ fontWeight: 800, color: '#fff', marginRight: 6 }}><UserName user={{ displayName: user, vpLevel }} masked context="chat" fallback="guest" /><RankBadge level={vpLevel} uid={uid} size={12} animated style={{ marginLeft: 4, verticalAlign: '-2px' }} /></span>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{text}</span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
              <span style={{ fontWeight: 800, color: '#fff' }}><UserName user={{ displayName: user, vpLevel }} masked context="chat" fallback="guest" /><RankBadge level={vpLevel} uid={uid} size={12} animated style={{ marginLeft: 4, verticalAlign: '-2px' }} /></span>
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
      <span><b style={{ fontWeight: 800 }}>ZER0_kade</b> joined via share invitation</span>
    </div>
  );
}

export function WatchingRow() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.82)', width: 'fit-content' }}>
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
export function SoloDock({ onTip, onInvite, onGift, onShare }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <ComposerPill />
      {/* ⚠ THREE OF THESE FOUR HAD NO HANDLER. Only Tips & VC did anything; Invite,
          Gift Box and Share were dock buttons that swallowed the press. Each now opens the
          sheet the real product opens. */}
      <DockGlassBtn src={inviteIcon} alt="Invite" onClick={onInvite} />
      <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={onTip} />
      <DockGlassBtn src={giftboxIcon} alt="Gift Box" onClick={onGift} />
      <DockGlassBtn src={sendIcon} alt="Share" onClick={onShare} />
    </div>
  );
}
