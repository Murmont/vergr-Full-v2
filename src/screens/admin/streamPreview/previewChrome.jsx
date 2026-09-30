// Shared chrome for the stream simulator.
//
// ⚠ COPIES OF THE SHIPPED DESIGN, NOT A SECOND IMPLEMENTATION. Everything here
// reproduces markup from the real streaming screens so admin screenshots match
// what ships. Nothing calls Firestore, the relay, a callable or the camera, and
// no production file is modified by any of it.
//
// ⚠ THIS FILE EXISTS SO THERE IS ONE COPY, NOT SIX. Every preview surface had
// grown its own hardcoded chat constant, which is how the previews drifted from
// the product in the first place (the "ZER0_kade joined via share invitation"
// strings lived in three separate preview files and nowhere in the app). A
// surface now drops in <PreviewChat>, <JoinAnnouncer> and <PreviewSheets>.
//
// Source of each copied block, so a future edit can diff against it:
//   glass / glassDark / iconBtn   MobileLiveViewer.jsx:70,71,1515
//   chat row treatment            ChatPanel.jsx ~838-856
//   overlay vs side layout        ChatPanel.jsx:94-98
//   TipModal                      MobileLiveViewer.jsx:1518
//   UserQuickSheet                components/streams/UserQuickSheet.jsx

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EmptyChat } from './previewStates';
import { CoinIcon } from '../../../components/CoinIcon';
// .vg-beam-violet and .vg-grain live here: the founder's own material system.
import '../../../styles/surface.css';
// Solid surface values — see the note on `S` in previewStates.jsx.
import { S } from './previewStates';
// ⚠⚠ THE REAL COMPONENTS, IMPORTED. `UserName` appears in 97 files across the
// app and in ZERO of the preview, so the chat — the single most-captured
// surface in the product — rendered a plain bold name and showed none of the
// typeface, colour, gradient, glow or rank crest the whole VP ladder exists to
// sell. Both are pure prop-driven and fetch nothing, so importing them is
// read-only and cannot drift, the same rule the alerts and the entry ribbon
// follow.
import UserName from '../../../components/UserName';
import RankBadge from '../../../components/RankBadge';
// The shipped badge art, not a second hand-rolled pill.
import { ModBadge, SubPill } from './previewSoloParts';
// ⚠ THE REAL, FOUNDER-LOCKED PRICE LADDER. Never a local copy.
import { COIN_PACKS } from '../../../utils/vpSystem';
import { DEFAULT_MEMBERSHIP_TIERS } from '../../../utils/membershipDefaults';
import { useFaces, usePreviewRole, usePreviewSim } from './previewAssetsContext';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { castByUid, CAST } from './previewCast';
import { canModerate, canConfigureChat } from './previewRoles';

// ── copied verbatim from MobileLiveViewer.jsx:70,71,1515 ──────────────
// ⚠⚠ SOLID, NOT GLASS. Founder, 2026-09-03, for the third time: *"there are still
// pills and other things using the fake glass. and there are still buttons and ui using
// the gross outline that is lighter than the componenet/button background"*.
//
// Measured on the live page, these were BOTH violations at once:
//   glass      fill rgba(255,255,255,0.10)  border rgba(255,255,255,0.18)  — same white,
//              stroke ~2x the fill, so the hairline did all the separating
//   glassDark  fill rgba(10,8,22,0.42)      border rgba(255,255,255,0.12)  — ditto
//
// These are PILLS AND BUTTONS SITTING ON LIVE GAMEPLAY, which is the worst place for a
// wash: it has no value of its own, it changes with whatever is behind it, and over a
// bright frame it turns to mud. The exemption in the guard was for a full-bleed SCRIM,
// whose job IS to let the video through. A scrim is not a pill.
//
// `backdropFilter` goes with the transparency — it does nothing behind an opaque fill,
// and it was running on every chip in the header and dock.
export const glass = { background: '#1E1A2E', border: 'none' };
export const glassDark = { background: '#100C1C', border: 'none' };
export const iconBtn = { width: 34, height: 34, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, border: 'none', ...glassDark };

export const C = {
  bg: '#0a0a14', card: '#1A1A2A',
  // ⚠ MEASURED ON THE DEPLOYED PAGE, INSIDE THE SHEETS. #a0a0b8 came out at 3.84:1 on
  // the #12121e sheet card — nine viewer-list handles, the tip sheet's moderation note
  // and more — and #6b7280 drove the disabled "Pin message" CTA to 2.92:1.
  // ⚠ AND RED IS TWO TOKENS HERE TOO: white on #ef4444 measured 3.76:1 on "Clear chat",
  // which is a DESTRUCTIVE confirm — the one button that must not be misread.
  // ⚠ THE LADDER, NOT THE STROKE. card was #12121e, a 0.0032 luminance step off the
  // page behind it, so every sheet needed a hairline to be seen and every hairline read
  // as a cage. card is now a real step and the strokes are gone; a sheet detaches with a
  // SHADOW, which is what a thing floating over content actually casts.
  // `border` survives for ONE job: the edge of a text input, which is the affordance
  // that says type here. At 0.09 alpha it was not even doing that, so it is a real value.
  border: 'rgba(255,255,255,0.09)', fieldEdge: '#2E2E42',
  sheetShadow: '0 -20px 56px rgba(0,0,0,0.72)',
  // ⚠ SELECTION IS NOT A RING. Rich rows take a solid 3px accent BAR so their own
  // contents stay readable; label-only segmented buttons take a solid accent FILL.
  selBar: 'inset 3px 0 0 #b44fff', selBarRed: 'inset 3px 0 0 #ff6b6b',
  text: '#e8e8f0', textDim: '#b7b7cb', textMuted: '#9298ab',
  redFill: '#c62828', onGreen: '#06240F',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: '#251A46',
  // ⚠ purpleLight IS A FILL AND AN ICON COLOUR, NOT INK. On the raised card it
  // measures 4.47:1. purpleInk is for TYPE: 6.37:1 on #1A1A2A, 5.93:1 on #251A46.
  purpleInk: '#C77DFF',   // solid: the old rgba(124,58,237,0.18) flattened onto the card
  amber: '#f59e0b', red: '#ef4444', green: '#22c55e',
};


// ⚠ A rule that stops at full strength reads as a cage edge, so these fade at both
// ends. They exist only where a real division needs marking.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };
const ruleTop = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'top' };

export const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n ?? 0));

// ── the "gameplay" behind the UI ──────────────────────────────────────
// ⚠ A FLAT GRADIENT READS AS A MOCKUP IN A SCREENSHOT. Drop a real frame at
// public/brand/live/preview-scene.webp (9:16) or preview-scene-wide.webp (16:9)
// and it is used automatically. The gradient is only the fallback so the tool is
// never broken while those files do not exist.
/**
 * What sits behind the UI when no photograph has been supplied.
 *
 * ⚠ A FLAT GRADIENT READS AS A MOCKUP, and the whole point of the side rail is
 * that nothing renders empty. This draws a plausible scene — a lit room behind a
 * silhouetted figure, or a gameplay HUD — so a capture has real depth behind the
 * chrome instead of a wash.
 *
 * ⚠ IT IS DELIBERATELY NOT A FACE. Every capture here is published material, so
 * a real or generated person would be a likeness claim about a user who does not
 * exist. A rim-lit silhouette reads as "someone is streaming" without asserting
 * who. Drop a real frame at public/brand/live/preview-scene.webp (9:16) or
 * preview-scene-wide.webp (16:9) and it replaces this with no code change.
 */
function SceneFallback({ scene = 'gameplay' }) {
  if (scene === 'camera') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {/* room */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(90% 70% at 22% 18%, rgba(123,111,255,0.42) 0%, transparent 55%),
                       radial-gradient(80% 60% at 82% 30%, rgba(255,77,106,0.30) 0%, transparent 58%),
                       linear-gradient(170deg, #1d1636 0%, #100c1e 55%, #0a0a14 100%)`,
        }} />
        {/* wall panels, the hex-light look a streamer room usually has */}
        <div style={{
          position: 'absolute', right: '6%', top: '14%', width: '38%', height: '26%',
          background: `repeating-linear-gradient(60deg, rgba(180,79,255,0.16) 0 14px, transparent 14px 30px)`,
          filter: 'blur(0.5px)',
        }} />
        {/* desk glow */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%',
          background: 'linear-gradient(0deg, rgba(61,127,255,0.22), transparent)',
        }} />
        {/* silhouette: head + shoulders, rim lit */}
        <div style={{
          position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)',
          width: '58%', height: '62%',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)',
            width: '46%', aspectRatio: '1', borderRadius: '50%',
            background: 'linear-gradient(180deg, #1b1730, #0d0b16)',
            boxShadow: 'inset -8px -6px 18px rgba(255,120,180,0.22), inset 10px 4px 20px rgba(120,160,255,0.20)',
          }} />
          <div style={{
            position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)',
            width: '100%', height: '62%', borderRadius: '46% 46% 0 0',
            background: 'linear-gradient(180deg, #171327, #0b0a13)',
            boxShadow: 'inset -14px 0 26px rgba(255,120,180,0.16), inset 16px 0 26px rgba(120,160,255,0.16)',
          }} />
        </div>
      </div>
    );
  }

  // gameplay: a dark arena with a horizon, a HUD corner and some depth
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, #241a3a 0%, #14102a 46%, #0a0a14 100%)`,
      }} />
      {/* sky glow + sun line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '18%', height: '30%',
        background: 'radial-gradient(60% 100% at 50% 100%, rgba(255,140,90,0.35) 0%, transparent 70%)',
      }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '46%', height: 1, background: 'rgba(255,180,120,0.45)' }} />
      {/* ground grid for depth */}
      <div style={{
        position: 'absolute', left: '-25%', right: '-25%', top: '46%', bottom: 0,
        background: `repeating-linear-gradient(90deg, rgba(123,111,255,0.20) 0 1px, transparent 1px 46px),
                     repeating-linear-gradient(0deg, rgba(123,111,255,0.16) 0 1px, transparent 1px 34px)`,
        transform: 'perspective(240px) rotateX(62deg)',
        transformOrigin: 'top center',
      }} />
      {/* structures on the horizon */}
      {[14, 26, 40, 62, 78].map((x, i) => (
        <div key={x} style={{
          position: 'absolute', left: `${x}%`, top: `${34 - (i % 3) * 4}%`,
          width: `${5 + (i % 3) * 3}%`, height: `${12 + (i % 3) * 5}%`,
          background: 'linear-gradient(180deg, #1a1530, #0d0b18)',
          boxShadow: 'inset 1px 0 0 rgba(180,79,255,0.28)',
        }} />
      ))}
      {/* HUD corner, kept abstract — no real game's UI */}
      <div style={{ position: 'absolute', left: '5%', bottom: '22%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ width: 92, height: 5, borderRadius: 3, background: 'rgba(45,220,140,0.55)' }} />
        <div style={{ width: 62, height: 5, borderRadius: 3, background: 'rgba(61,127,255,0.55)' }} />
      </div>
      <div style={{
        position: 'absolute', right: '6%', bottom: '24%', width: 34, height: 34,
        borderRadius: '50%', border: '2px solid rgba(255,255,255,0.30)',
      }} />
    </div>
  );
}


// ⚠⚠ `frame` IS THE DUAL-FORMAT RECT AND NULL MEANS DO NOT CROP. The founder's
// standing rule is never crop the broadcaster; he granted one exception on
// 2026-09-06 — a crop the HOST chose and previewed. So this only reframes when a
// frame exists, and every existing caller passes nothing and is untouched.
//
// The maths is one line because a 16:9 source in a 9:16 box is already the
// `cover` case: cover scales to fill the height and crops the width, which IS
// the 0.3164-of-the-width window at zoom 1. `objectPosition` pans it, `scale()`
// zooms further in. No canvas, no second encode, no transcode.
// A 16:9 source drawn at a 9:16 box's height is (16/9)^2 of that box's WIDTH.
const FRAME_WIDE_PCT = 316.0494;
// A 9:16 window at a 16:9 frame's full height, as a fraction of its width:
// (9/16) / (16/9). The lines cannot be dragged wider than this because there is
// no more source behind them.
const FRAME_WINDOW = 0.31640625;

export function Scene({ wide = false, scene = 'gameplay', videoUrl = null, frame = null }) {
  const [hasArt, setHasArt] = useState(true);
  const src = wide ? '/brand/live/preview-scene-wide.webp' : '/brand/live/preview-scene.webp';
  // ⚠⚠ THREE STATES, AND THE MIDDLE ONE IS WHY. `frame` is:
  //   null / undefined  -> untouched. Every pre-existing caller, unchanged.
  //   'letterbox'       -> `contain`. Bars, nothing cut.
  //   { x, zoom }       -> the host's crop.
  //
  // The first version had only two states and the OFF state was a lie: Scene's
  // base style is ALREADY `objectFit: cover`, so a card reading "Letterbox /
  // Nothing is cut" cover-cropped exactly like the framed one. Measured on the
  // deployed preview — both states returned `cover / 50% 50%` and differed only
  // by a no-op `scale(1)`. A toggle whose two halves are pixel-identical is
  // worse than no toggle, because it teaches the host the wrong thing about what
  // their viewers see.
  const framed = frame === 'letterbox'
    ? { objectFit: 'contain' }
    : frame ? {
      objectFit: 'cover',
      objectPosition: `${Math.round((frame.x ?? 0.5) * 100)}% 50%`,
      transform: `scale(${frame.zoom || 1})`,
      transformOrigin: `${Math.round((frame.x ?? 0.5) * 100)}% 50%`,
    } : null;
  const rect = frame && frame !== 'letterbox' ? frame : null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0a14' }}>
      {/* ⚠ AN UPLOADED VIDEO WINS. autoPlay+muted+playsInline is what lets it
          start without a gesture; loop is the point — the founder captures a
          screen recording, so the backdrop has to keep moving. */}
      {videoUrl ? (
        <video
          src={videoUrl} autoPlay muted loop playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...framed }}
        />
      ) : hasArt && (
        <img src={src} alt="" onError={() => setHasArt(false)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...framed }} />
      )}
      {/* ⚠⚠ THE FALLBACK NEEDS FRAMING TOO, AND IT IS THE PATH THAT ACTUALLY
          RUNS. `/brand/live/preview-scene.webp` DOES NOT EXIST — measured:
          it answers 200 with `text/html`, which is the SPA rewrite serving
          index.html, so `onError` fires and every scene in the preview is this
          drawn fallback. Applying the crop only to <img>/<video> made the whole
          feature invisible. [[reference-spa-rewrite-masks-404]]
          ⚠ `objectFit` cannot help here because nothing is an image. A 16:9
          source at the container's height is (16/9)^2 = 3.1605x the container's
          WIDTH, so the fallback is drawn at that width and panned by x. At
          x=0.5 the offset is -108%, which centres it; at 0 and 1 it lands
          exactly on each edge. */}
      {!videoUrl && !hasArt && (rect ? (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          width: `${FRAME_WIDE_PCT}%`,
          left: `${-((rect.x ?? 0.5) * (FRAME_WIDE_PCT - 100))}%`,
          transform: `scale(${rect.zoom || 1})`,
          transformOrigin: `${Math.round((rect.x ?? 0.5) * 100)}% 50%`,
        }}>
          <SceneFallback scene={scene} />
        </div>
      ) : <SceneFallback scene={scene} />)}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 26%, transparent 52%, rgba(0,0,0,0.62) 100%)' }} />
    </div>
  );
}

// ── chat ──────────────────────────────────────────────────────────────
// ⚠ TWO LAYOUTS, MATCHING ChatPanel.jsx:94-98. `overlay` is the TikTok-style
// transparent feed over the video (scrim chips, fit-content rows); `side` is the
// docked panel (full-width rows, transparent background, header). Getting these
// mixed up is the difference between a screenshot that matches the product and
// one that quietly does not.
function ChatRow({ m, overlay, avatars = {} }) {
  const isTip = !!m.tipCoins;
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: overlay ? '5px 9px' : '6px 10px',
      marginBottom: overlay ? 5 : 2,
      borderRadius: overlay ? 10 : 8,
      ...(overlay ? { width: 'fit-content', maxWidth: '82%' } : {}),
      background: isTip
        // ⚠ SOLID AMBER, NOT A WASH. A tipped row is a highlight and should read as
        // a deliberate one; the old rgba tint shifted with whatever frame was behind
        // it and turned to mud on a bright scene.
        ? (overlay ? '#3D2A08' : '#2A2008')
        : (overlay ? 'rgba(0,0,0,0.38)' : 'transparent'),
      borderLeft: isTip ? `3px solid ${C.amber}` : 'none',
    }}>
      {/* ⚠⚠ `data-uid` IS THE WHOLE POINT OF THIS ROW BEING INTERACTIVE.
          PreviewChat's click handler reads `e.target.dataset.uid` and opens the
          person sheet — and NOTHING in this file ever emitted it, so the handler
          was unreachable on all four surfaces. Measured: `[data-uid]` count was
          ZERO across the whole simulator.
          That one missing attribute is why nobody could be moderated, gifted to,
          promoted or reported: every one of those asks "which person?", and the
          chat is the only place a live stream can answer it.
          It goes on the avatar AND the name, because people tap both. */}
      <span data-uid={m.uid} style={{ cursor: 'pointer', display: 'grid' }}>
        <UserAvatar src={avatars[m.uid] || m.avatar} size="xs" />
      </span>
      <div style={{ minWidth: 0, fontSize: overlay ? 12.5 : 13, lineHeight: 1.42, color: '#fff' }}>
        {m.sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
        {/* ⚠ A STREAM MODERATOR IS AN AUTHORITY MARK, NOT A COSMETIC, so it sits
            ahead of the name and is not something a user can equip. */}
        {m.isMod && <span style={{ marginRight: 5 }}><ModBadge /></span>}
        <b data-uid={m.uid} style={{ fontWeight: 800, marginRight: 5, cursor: 'pointer' }}>
          {/* ⚠ `vpLevel` IS WHAT SWITCHES EVERY COSMETIC ON, and it already rides
              every message (previewCast.makeMessage). Passing it costs nothing and
              is the difference between a capture that sells the ladder and one that
              shows plain text. */}
          <UserName user={{ displayName: m.name, vpLevel: m.vpLevel }}
                    masked context="chat" fallback="guest" />
          {/* ⚠ THE CREST SITS TO THE RIGHT OF THE NAME (founder, 2026-08-27). On
              the left it puts a rank mark ahead of the person's own identity and
              pushes every name in the room out of alignment. It is silent below
              L11 by design: if every account carries one it stops being a signal. */}
          <RankBadge level={m.vpLevel} uid={m.uid} size={13} animated feed
                     style={{ marginLeft: 4, verticalAlign: '-2px' }} />
        </b>
        <span style={{ color: 'rgba(255,255,255,0.92)' }}>{m.text}</span>
      </div>
    </div>
  );
}

// ⚠ `fill` EXISTS BECAUSE `height: 100%` DOES NOT ALWAYS RESOLVE. On the desktop
// broadcaster this list measured **1,753px tall inside a 620px frame** — the
// percentage fell back to content height, so the composer ended up ~1,100px
// below the visible area and the panel looked like it had no way to type in it.
// `position: absolute; inset: 0` against a positioned parent cannot fall back.
export function PreviewChat({ messages = [], layout = 'overlay', height, fill = false, onOpenProfile, avatars = {}, scrollRef }) {
  const ref = useRef(null);
  // The tip feed is placed against the top of the visible messages, so the
  // caller needs the scroller itself. Accepts an object ref or a callback.
  const attach = useCallback((el) => {
    ref.current = el;
    if (typeof scrollRef === 'function') scrollRef(el);
    else if (scrollRef) scrollRef.current = el;
  }, [scrollRef]);
  const overlay = layout === 'overlay';
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div
      ref={attach}
      onClick={(e) => {
        // Tapping a name or an avatar opens the person sheet.
        // ⚠ `closest`, NOT `e.target.dataset`. The avatar is an <img> inside the
        // tagged <span>, so a tap on the picture — the bigger, more obvious
        // target — reports the img as e.target and would find no uid.
        const uid = e.target?.closest?.('[data-uid]')?.dataset?.uid;
        if (uid && onOpenProfile) onOpenProfile(uid);
      }}
      // ⚠⚠ `overlay` USED TO DEFAULT TO `30vh` HERE, AND THAT IS WHY CHAT DREW
      // THROUGH THE COMPOSER ON THREE SCREENS. The broadcaster wraps this in its
      // own `30vh` box and then renders a composer BENEATH it in the same box —
      // so the list claimed the parent's entire height and the composer was
      // pushed past the bottom edge, landing on top of the list's own last rows.
      // Measured: chat rows at y=808 against a composer band starting at y=800.
      //
      // A list must FILL what its parent gives it and never name its own height.
      // The caller owns the box; this owns the scroll.
      //
      // ⚠ AND `vh` IS THE WRONG UNIT IN THIS DIRECTORY ANYWAY. The simulator
      // frame is a fixed 393x852 whatever the admin's browser is doing, so a
      // viewport unit made the layout of a SCREENSHOT TOOL depend on the window
      // it was being screenshotted from.
      style={{
        ...(fill ? { position: 'absolute', inset: 0 } : { height: height || '100%' }),
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', scrollbarWidth: 'none', minHeight: 0,
        // Older messages fade out at the top instead of being sliced by the
        // container edge — the solo viewer already does this and the broadcaster
        // did not, so its top row started abruptly under the tip goal.
        ...(overlay ? {
          maskImage: 'linear-gradient(to top, #000 0%, #000 72%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 72%, transparent 100%)',
        } : null),
      }}
    >
{messages.length === 0 && <EmptyChat />}
      {messages.map((m) => <ChatRow key={m.id} m={m} overlay={overlay} avatars={avatars} />)}
    </div>
  );
}

/** The docked chat column used by the desktop surfaces. */
export function PreviewChatPanel({ messages, onOpenProfile, width = 320 }) {
  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', background: C.card }}>
      <div style={{ padding: '11px 14px', ...ruleBottom, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Live chat</span>
        <span style={{ marginLeft: 'auto', color: C.textMuted, display: 'grid' }}><Icon name="settings" size={15} /></span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '8px 6px' }}>
        <PreviewChat fill messages={messages} layout="side" onOpenProfile={onOpenProfile} />
      </div>
      <div style={{ padding: 10, ...ruleTop }}>
        <div style={{ padding: '10px 13px', borderRadius: 12, background: S.row, fontSize: 13, color: C.textMuted }}>
          Say something...
        </div>
      </div>
    </div>
  );
}

// ── tip sheet — copied from MobileLiveViewer.jsx:1518 ─────────────────
// ⚠ THE TIERS ARE THE SHIPPED ONES, read off src/utils/boosts.js rather than
// retyped: 50c/1.5x/15min, 150c/2.5x/30min, 500c/4x/60min. A preview that shows
// a price the product does not charge is a screenshot that lies, and these go to
// the Play listing.
// ⚠⚠ THE PALETTE AND THE GEOMETRY HERE WERE SAMPLED OUT OF THE FOUNDER'S OWN
// MOCKUPS, NOT CHOSEN. "ChatGPT Image Sep 5, 2026, 03_54_48/03_55_01 PM.png",
// read with sharp. Founder, 2026-09-05: "I want it pixel by pixel the same, you
// do not have creative freedom with this."
//
// ⚠ AND THE SURFACES ARE RAMPS, NOT FLAT FILLS, because the mockup's are. A
// vertical slice through the note card reads lum 22 at its top and 14 at its
// foot; the primary button runs #9a43f8 top-left to #7427f4 bottom-right with a
// violet spill BELOW it (lum 71 -> 44 -> 32 in the three rows under its edge).
// Painting those as one flat colour is what made the first pass read dull.
const SHEET = {
  modal: '#100f1f',
  modalEdge: '#422b6b',
  // measured ramp, top-lit
  card: 'linear-gradient(180deg, #17132f 0%, #131228 55%, #0e0d22 100%)',
  cardFlat: '#131228',
  cardEdge: '#2e2a46',
  cardLip: 'inset 0 1px 0 rgba(255,255,255,0.055)',
  well: 'linear-gradient(180deg, #100e26 0%, #0c0b1f 100%)',
  field: 'linear-gradient(180deg, #150f2e 0%, #0f0d21 100%)',
  fieldEdge: '#8f45de',
  chip: 'linear-gradient(180deg, #23203c 0%, #1a1830 100%)',
  chipEdge: '#302b49',
  sel: 'linear-gradient(180deg, #7d33e2 0%, #6a2bcb 100%)',
  selEdge: '#a259f0',
  tabSel: 'linear-gradient(180deg, #3b1d69 0%, #2c1550 100%)',
  tabSelEdge: '#7c3aed',
  rowSel: 'linear-gradient(180deg, #271552 0%, #1a1038 100%)',
  tileOff: 'linear-gradient(135deg, #4f208a 0%, #191030 100%)',
  tileOn: 'linear-gradient(135deg, #9a4cf5 0%, #5a20a8 100%)',
  cancel: 'linear-gradient(180deg, #1c1c3c 0%, #141530 100%)',
  cancelEdge: '#423a5f',
  cta: 'linear-gradient(135deg, #a84dff 0%, #9a43f8 38%, #7427f4 100%)',
  ctaGlow: '0 10px 26px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.34)',
  gold: '#F5C842',
  text: '#f2f0f8',
  dim: '#9c96b4',
  muted: '#7a7490',
};

const BOOST_TIERS = [
  { id: 'stream_boost', name: 'Stream Boost', price: 50, detail: '1.5x · 15 min', tag: 'Great for a quick boost' },
  { id: 'stream_super', name: 'Super Boost', price: 150, detail: '2.5x · 30 min', tag: 'Most popular' },
  { id: 'stream_mega', name: 'Mega Boost', price: 500, detail: '4x · 60 min', tag: 'Maximum impact' },
];

// ⚠⚠ ONE SHELL FOR EVERY SHEET. Seventeen sheets each hand-rolled their own
// scrim and card, so the tip sheet got the founder's treatment and the other
// sixteen stayed flat: square-cornered slabs on #1A1A2A with no edge, no ramp
// and no light. Founder, 2026-09-05: "use the same type of design for the other
// sheets... it looks like shit and not on par with platforms like tiktok".
//
// The edge light has to live on a NON-SCROLLING wrapper, which is why this owns
// the scroller rather than leaving it to the caller: an inset:0 ::after inside
// an overflow:auto box scrolls away with the content.
//
// ⚠⚠ IT DOCKS TO THE BOTTOM, AND THAT IS THE DEFAULT. I shipped these centred
// because the tip/boost mockup is a centred modal, and then applied that to the
// profile card and every utility sheet. It is not what the platforms this is
// being measured against do: a profile card, a report form and a confirm all
// slide up from the bottom edge on TikTok, Instagram and YouTube, where the
// thumb is. Founder, 2026-09-05: "on so now tiktok has the sheet in the middle
// of the screen does it?".
// The tip/boost sheet stays centred because that IS the drawn mockup; it owns
// its own shell. `dock={false}` is the exception here, never the default.
// ⚠ THE NUMBERS BELOW ARE FROM SPECS, NOT FROM ME:
//   • 40% black scrim and a 28px top corner radius, from the Material 3 bottom
//     sheet spec. The scrim was 72%, which hid the broadcast the sheet is
//     supposed to sit in front of; a lighter scrim is the whole reason NN/g
//     prefers this pattern to a dialog.
//   • 4x32 grabber, centred, from the same spec.
//   • Two detents, medium at half height and large at full, from Apple's HIG:
//     "medium is about half of the fully expanded height... consider supporting
//     the medium detent to allow progressive disclosure". Material's own
//     half-expanded ratio default is the same 0.5.
//   • "Include a grabber in a resizable sheet... a grabber also works with
//     VoiceOver so people can resize the sheet without seeing the screen"
//     (Apple HIG). So it drags, and tapping it cycles the detents.
//   • Nielsen Norman: "provide a clear Close button (usually styled as an X or
//     the word Close)" and never rely on the gesture alone. Every sheet has one.
//
// ⚠ DETENTS ARE OFFERED ONLY WHEN THERE IS SOMETHING TO EXPAND. Apple: "you
// might not want to support the medium detent if a sheet's content is more
// useful when it displays at full height." A confirm is 180px tall; opening it
// at half height with a fold in it would be theatre. The natural content height
// is measured and a short sheet stays content-sized.
// ⚠ `openAt` EXISTS FOR SHEETS WHOSE CONTENT *IS* A CHOICE. Apple's own line,
// already quoted above: "you might not want to support the medium detent if a
// sheet's content is more useful when it displays at full height." A dial that
// opens at half height hides both the options and which one is currently set,
// so the host has to scroll to find out what their own setting is. Measured on
// the auto-moderation sheet: 1 of 4 options visible, and not the selected one.
// Still draggable down to medium; this only decides where it OPENS.
function SheetShell({ children, onClose, dock = true, maxWidth = 420, pad = 17, scroll = true, openAt = 'medium' }) {
  const [shellEl, setShellEl] = useState(null);
  const [contentEl, setContentEl] = useState(null);
  const [medium, setMedium] = useState(0);
  const [detent, setDetent] = useState(null);   // null = content-sized
  const [dragY, setDragY] = useState(0);

  // ⚠⚠ THE MEASUREMENT CONTROLS THE THING IT MEASURES, SO IT IS ONLY VALID
  // ONCE. `scroll={false}` sheets hand scrolling to an inner child, so the
  // moment a detent constrains the shell, `contentEl.scrollHeight` collapses to
  // the constrained height and reports the content as short enough to fit. The
  // naive read then dropped the detent, the shell sprang back to `auto`, the
  // content measured tall again, and it took the detent back. Measured live on
  // the Shield sheet: 426px (scrollHeight 398) <-> auto/583px (scrollHeight 555)
  // ON EVERY FRAME. A 50ms sampling probe read a flat 426 because the flip is
  // per-frame and aliased with the interval; the two-state capture is what
  // showed it. So: never re-derive the natural height while constrained, and
  // require a real margin before taking a detent at all.
  const detentRef = useRef(null);
  const applyDetent = useCallback((v) => { detentRef.current = v; setDetent(v); }, []);

  useLayoutEffect(() => {
    if (!dock || !shellEl || !contentEl) return undefined;
    const measure = () => {
      const avail = shellEl.parentElement?.getBoundingClientRect().height || 0;
      if (!avail) return;
      const half = Math.round(avail * 0.5);
      setMedium(half);
      if (detentRef.current) return;   // constrained: this box's height is ours, not the content's
      const natural = contentEl.scrollHeight + 26;      // + the grabber strip
      // Dead band of one grabber strip. Within that, the sheet effectively fits
      // and a detent would only put a fold in it.
      if (natural > half + 26) applyDetent(openAt);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(contentEl);
    ro.observe(shellEl);
    return () => ro.disconnect();
  }, [dock, shellEl, contentEl, applyDetent, openAt]);

  const onGrab = (e) => {
    const startY = e.clientY;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => setDragY(ev.clientY - startY);
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const dy = ev.clientY - startY;
      setDragY(0);
      // A tap with no travel cycles the detents, which is what the HIG says a
      // grabber does. Otherwise: up expands, down collapses then dismisses.
      if (Math.abs(dy) < 6) {
        if (detent) applyDetent(detent === 'medium' ? 'large' : 'medium');
        return;
      }
      if (dy < -40 && detent === 'medium') { applyDetent('large'); return; }
      if (dy > 90) {
        if (detent === 'large') applyDetent('medium'); else onClose?.();
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const height = !dock || !detent ? 'auto' : (detent === 'large' ? '92%' : medium || 'auto');
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
        display: 'flex', justifyContent: 'center',
        alignItems: dock ? 'flex-end' : 'center', padding: dock ? 0 : 10,
      }}
    >
      <div
        ref={setShellEl}
        className="vg-beam vg-beam-violet vg-grain"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', isolation: 'isolate',
          width: '100%', maxWidth: dock ? 480 : maxWidth,
          maxHeight: dock ? '92%' : '100%',
          height,
          background: SHEET.modal,
          border: `1px solid ${SHEET.modalEdge}`,
          borderRadius: dock ? '28px 28px 0 0' : 22,
          boxShadow: '0 26px 70px rgba(0,0,0,0.72), 0 0 46px rgba(124,58,237,0.22)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column', color: SHEET.text,
          transform: dragY > 0 ? `translateY(${dragY}px)` : 'none',
          transition: dragY ? 'none' : 'transform .22s cubic-bezier(.22,1,.36,1), height .28s cubic-bezier(.22,1,.36,1)',
        }}
      >
        {dock && (
          <div
            onPointerDown={onGrab}
            aria-hidden
            style={{ flexShrink: 0, height: 26, display: 'grid', placeItems: 'center', cursor: 'grab', touchAction: 'none' }}
          >
            <span style={{ width: 32, height: 4, borderRadius: 999, background: detent ? SHEET.dim : SHEET.cardEdge }} />
          </div>
        )}
        {/* ⚠ scroll={false} hands the scrolling to the caller, for a sheet that
            pins its header and its CTA and lets only the middle move. */}
        <div ref={setContentEl} style={{ flex: 1, minHeight: 0, overflowY: scroll ? 'auto' : 'hidden', padding: pad, paddingTop: dock ? 4 : pad, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// The title block every sheet opens with, and the close control that used to be
// missing from half of them.
function SheetHead({ title, sub, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em' }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: SHEET.dim, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {onClose && (
        <button type="button" aria-label="Close" onClick={onClose} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`, boxShadow: SHEET.cardLip, color: SHEET.text, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="close" size={17} />
        </button>
      )}
    </div>
  );
}

// A raised panel on a sheet: the ramp, the edge and the lit lip in one place so
// no sheet has to remember all three.
const sheetCard = (extra) => ({
  background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`,
  boxShadow: SHEET.cardLip, borderRadius: 16, ...extra,
});

const sheetCta = (extra) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: 15, borderRadius: 16, border: 'none', background: SHEET.cta,
  boxShadow: SHEET.ctaGlow, color: '#fff', fontSize: 14, fontWeight: 800,
  cursor: 'pointer', ...extra,
});

const sheetGhost = (extra) => ({
  padding: 15, borderRadius: 16, background: SHEET.cancel,
  border: `1px solid ${SHEET.cancelEdge}`, boxShadow: SHEET.cardLip,
  color: SHEET.text, fontSize: 14, fontWeight: 800, cursor: 'pointer', ...extra,
});

// The portrait treatment from the tip sheet, so one definition decides how a
// ring hugs an avatar anywhere on a sheet.
// ⚠ IT RESOLVES THE FACE ITSELF. Taking a resolved `src` meant every call site
// had to remember faceOf(), which is the exact hop the uploads context exists to
// remove — and the guard says so.
function SheetAvatar({ person, size = 62, ring = true }) {
  const faceOf = useFaces();
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      {ring && (
        <span aria-hidden style={{
          position: 'absolute', inset: -2, borderRadius: '50%', padding: 2,
          background: 'conic-gradient(from 210deg, #c07bff, #7526f5 35%, #3d1a80 55%, #7526f5 78%, #c07bff)',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor', maskComposite: 'exclude',
          boxShadow: '0 0 22px rgba(124,58,237,0.6)',
        }} />
      )}
      <UserAvatar src={faceOf(person)} size={size} showLiftRing={false} />
    </div>
  );
}

function compactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(v);
}

function SheetBalanceRow({ balance, short, onTopUp }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 16, background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`, boxShadow: SHEET.cardLip, marginBottom: 14 }}>
      <CoinIcon size={20} />
      <span style={{ fontSize: 13, color: SHEET.dim }}>Your balance</span>
      <span className="vg-mono" style={{ fontSize: 14, fontWeight: 800, color: short ? C.amber : SHEET.text }}>{balance.toLocaleString()}c</span>
      {short > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>{short.toLocaleString()}c short</span>}
      <button type="button" onClick={() => onTopUp?.(Math.max(short, 1))} style={{
        marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, padding: 0,
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 800, color: C.purpleLight,
      }}>Top up<Icon name="chevron_right" size={15} /></button>
    </div>
  );
}

function TipSheet({ host, onClose, onSend, onBoost, balance = 240, onTopUp }) {
  const faceOf = useFaces();
  const [tab, setTab] = useState('tip');
  const [amount, setAmount] = useState(100);
  const [boost, setBoost] = useState('stream_super');
  const [message, setMessage] = useState('');
  const PRESETS = [10, 50, 100, 500, 1000];
  const MSG_MAX = 50;
  const boosting = tab === 'boost';
  const hostName = host?.displayName || 'the host';
  // ⚠⚠ A SHORTFALL MUST NEVER DISABLE THE BUTTON. Founder, on exactly this:
  // "we cant create a design that prevents the user from checking out if they
  // are already there and willing to pay." So the CTA changes what it does,
  // it does not stop working — and it tops up IN PLACE, because leaving a
  // live stream to buy coins means missing the moment you were paying for.
  const cost = boosting ? (BOOST_TIERS.find((b) => b.id === boost)?.price || 0) : amount;
  const short = Math.max(0, cost - balance);
  const tabBtn = (id) => ({
    position: 'relative', zIndex: 1,
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '13px 8px', borderRadius: 12, cursor: 'pointer',
    fontSize: 14, fontWeight: 800, background: 'transparent', border: 'none',
    color: tab === id ? SHEET.text : SHEET.dim,
    transition: 'color .22s ease',
  });
  // ⚠⚠ THE TWO TABS ARE DIFFERENT HEIGHTS AND ALWAYS WILL BE: three tier rows
  // and an explainer against five chips and two fields. A centred modal
  // RE-CENTRES when its content changes height, so switching tab threw the
  // whole sheet 64px up the screen. Removing the info box narrowed the gap and
  // did not close it. Founder, 2026-09-05: "it is making the whole sheet resize
  // when clicked".
  //
  // So the height is measured and TRANSITIONED. The modal then grows into the
  // new tab over the same 300ms the knob takes, and re-centres continuously
  // instead of teleporting.
  //
  // ⚠ overflow: clip WITH A MARGIN, not hidden. The selected chip and the CTA
  // carry glows that reach ~24px outside their own boxes; a plain hidden would
  // slice them off at the panel edge for the life of the sheet, not just during
  // the animation.
  const [panelEl, setPanelEl] = useState(null);
  const [panelH, setPanelH] = useState(null);
  useLayoutEffect(() => {
    if (!panelEl) return undefined;
    const read = () => setPanelH(panelEl.getBoundingClientRect().height);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(panelEl);
    return () => ro.disconnect();
  }, [panelEl, tab]);

  const cta = {
    flex: 1.7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 15, borderRadius: 16, border: 'none', background: SHEET.cta,
    boxShadow: SHEET.ctaGlow, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
  };
  return (
    // ⚠ A CENTRED MODAL WITH FOUR ROUNDED CORNERS, NOT A BOTTOM SHEET. That is
    // how both mockups are drawn and it was the largest single miss.
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
      {/* ⚠⚠ THE EDGE IS ALIVE. `.vg-beam-violet` is the founder's own approved
          treatment (surface.css): a conic gradient rotated through a registered
          @property and masked to a 1px ring, so light travels the perimeter
          instead of sitting there as a dead hairline. It has to live on a
          NON-SCROLLING wrapper — an inset:0 ::after inside the scroller would
          scroll away with the content. */}
      <div
        className="vg-beam vg-beam-violet vg-grain"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', isolation: 'isolate',
          width: '100%', maxWidth: 420, maxHeight: '100%',
          background: SHEET.modal, border: `1px solid ${SHEET.modalEdge}`, borderRadius: 22,
          boxShadow: '0 26px 70px rgba(0,0,0,0.72), 0 0 46px rgba(124,58,237,0.22)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column', color: SHEET.text,
        }}
      >
      <div style={{ overflowY: 'auto', padding: 17 }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 15 }}>
          {/* ⚠⚠ THE RING GOES AROUND THE PORTRAIT, IT IS NOT A COLLAR THE
              PORTRAIT SITS IN. Twice I built it as padding on a wrapper, so the
              "ring" was a thick band and the photo was whatever was left in the
              middle; when that read wrong I widened the band, which is the same
              mistake again. Founder, 2026-09-05: "the ring needs to be around
              the avatar".
              ⚠ AND THERE IS NO LIVE BADGE. This sheet opens from inside the
              broadcast, so a LIVE chip tells the viewer where they already are.
              Founder, same day: "the user already knows that the broadcaster is
              live considering they are on the fucking live".
              The ring is now a SEPARATE element sitting OUTSIDE the avatar's own
              box (inset -5), 2px thick, cut hollow by the same xor mask
              surface.css uses for .vg-beam. The portrait keeps its full 62px and
              the gap between them is the page showing through, which is exactly
              the Instagram / TikTok construction. */}
          <div style={{ position: 'relative', flexShrink: 0, width: 62, height: 62, marginRight: 4 }}>
            <span aria-hidden style={{
              // ⚠ inset MUST EQUAL padding, or there is a gap. At inset -5 with a
              // 2px band the ring orbited 3px clear of the portrait, which is the
              // gap reported three times. inset -2 / padding 2 puts the band
              // immediately outside the photo, touching it: ring outer 66,
              // hole 62, avatar 62.
              position: 'absolute', inset: -2, borderRadius: '50%', padding: 2,
              background: 'conic-gradient(from 210deg, #c07bff, #7526f5 35%, #3d1a80 55%, #7526f5 78%, #c07bff)',
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor', maskComposite: 'exclude',
              boxShadow: '0 0 22px rgba(124,58,237,0.6)',
            }} />
            <UserAvatar src={faceOf(host)} size={62} showLiftRing={false} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: boosting ? C.purpleLight : SHEET.dim, transition: 'color .22s ease' }}>
              {boosting ? 'Boost the stream' : 'Tip the host'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, margin: '2px 0 4px' }}>
              <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{hostName}</span>
              <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, #b44fff, #7526f5)', boxShadow: '0 2px 8px rgba(124,58,237,0.55)', display: 'grid', placeItems: 'center' }}>
                <Icon name="check" size={11} />
              </span>
            </div>
            <div style={{ fontSize: 13, color: SHEET.dim, lineHeight: 1.45 }}>
              {boosting ? `Help ${hostName} grow and reach more viewers!` : 'Show your support and get noticed!'}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`, boxShadow: SHEET.cardLip, color: SHEET.text, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* ⚠ ONE KNOB THAT TRAVELS, not two buttons swapping fills. Founder:
            "it should be a slide animation not a flicker". The indicator is a
            single element and only its transform changes, so the browser moves
            it on the compositor. */}
        <div style={{ position: 'relative', display: 'flex', padding: 3, borderRadius: 16, border: `1px solid ${SHEET.cardEdge}`, marginBottom: 13 }}>
          <span aria-hidden data-vg="tabknob" style={{
            position: 'absolute', top: 3, bottom: 3, left: 3, width: 'calc(50% - 3px)',
            borderRadius: 12, background: SHEET.tabSel, border: `1px solid ${SHEET.tabSelEdge}`,
            boxShadow: '0 4px 14px rgba(124,58,237,0.32), inset 0 1px 0 rgba(255,255,255,0.09)',
            transform: boosting ? 'translateX(100%)' : 'translateX(0)',
            transition: 'transform .3s cubic-bezier(.22,1,.36,1)',
          }} />
          <button type="button" onClick={() => setTab('tip')} style={tabBtn('tip')}>
            <CoinIcon size={21} />Tip
          </button>
          <button type="button" onClick={() => setTab('boost')} style={tabBtn('boost')}>
            <Icon name="rocket_launch" size={19} />Boost
          </button>
        </div>

        {/* keyed on the tab so the entry animation re-runs, and it enters from
            the side the tab sits on */}
        <div style={{ height: panelH == null ? undefined : panelH, overflow: 'clip', overflowClipMargin: '26px', transition: 'height .3s cubic-bezier(.22,1,.36,1)' }}>
        {/* ⚠ flow-root, so the last block's bottom margin is CONTAINED. Without a
            block formatting context it collapses straight through this element,
            the measured height comes up 14px short and the balance row sits
            tighter under the tiers than the tiers sit under each other. */}
        <div ref={setPanelEl} key={tab} style={{ display: 'flow-root', animation: `${boosting ? 'vgSlideFromRight' : 'vgSlideFromLeft'} .3s cubic-bezier(.22,1,.36,1)` }}>
        {boosting ? (
          <>
            <div style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 16, background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`, boxShadow: SHEET.cardLip, marginBottom: 12 }}>
              <span style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: SHEET.modal, border: `1px solid ${SHEET.cardEdge}`, color: C.purpleLight, display: 'grid', placeItems: 'center' }}>
                <Icon name="rocket_launch" size={21} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>Boost the stream</div>
                <div style={{ fontSize: 12, color: SHEET.dim, lineHeight: 1.45 }}>
                  Boosting increases visibility and helps {hostName} reach more viewers.
                </div>
              </div>
            </div>

            {/* ⚠ THE THREE TIERS WERE PLAIN DIVS. You could read them and not pick
                one, and there was no confirm button on this tab at all — so the
                boost purchase was a price list, not a flow. Tiers, durations and
                multipliers are the shipped ones from src/utils/boosts.js. */}
            <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
              {BOOST_TIERS.map(({ id, name, price, detail, tag }) => {
                const on = boost === id;
                return (
                  <button key={id} type="button" onClick={() => setBoost(id)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, cursor: 'pointer',
                    textAlign: 'left', color: SHEET.text, width: '100%',
                    background: on ? SHEET.rowSel : SHEET.card,
                    border: `1px solid ${on ? SHEET.tabSelEdge : SHEET.cardEdge}`,
                    boxShadow: on ? '0 6px 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.08)' : SHEET.cardLip,
                    transition: 'background .2s ease, border-color .2s ease, box-shadow .2s ease',
                  }}>
                    <span style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: on ? SHEET.tileOn : SHEET.tileOff, boxShadow: on ? '0 4px 14px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.28)' : 'inset 0 1px 0 rgba(255,255,255,0.12)', color: on ? '#fff' : C.purpleLight, display: 'grid', placeItems: 'center' }}>
                      <Icon name="rocket_launch" size={21} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                        <span className="vg-mono" style={{ flexShrink: 0, fontSize: 16, fontWeight: 900, color: SHEET.gold }}>{price}c</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                        <span className="vg-mono" style={{ flexShrink: 0, fontSize: 12, color: SHEET.dim }}>{detail}</span>
                        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, fontWeight: 700, color: on ? '#fff' : SHEET.dim, background: on ? 'linear-gradient(180deg, #9a4cf5, #7526f5)' : SHEET.well, border: `1px solid ${on ? '#a259f0' : SHEET.cardEdge}`, padding: '2px 8px', borderRadius: 999 }}>{tag}</span>
                      </div>
                    </div>
                    {on
                      ? <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(180deg, #9a4cf5, #7526f5)', boxShadow: '0 3px 10px rgba(124,58,237,0.6)', display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="check" size={14} /></span>
                      : <CoinIcon size={24} />}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {PRESETS.map((p) => {
                const on = amount === p;
                return (
                  <button key={p} type="button" onClick={() => setAmount(p)} style={{
                    flex: 1, padding: '12px 2px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800,
                    background: on ? SHEET.sel : SHEET.chip,
                    border: `1px solid ${on ? '#a259f0' : SHEET.chipEdge}`,
                    boxShadow: on
                      ? '0 6px 20px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.28)'
                      : SHEET.cardLip,
                    color: on ? '#fff' : SHEET.dim,
                    transition: 'background .18s ease, box-shadow .18s ease, color .18s ease',
                  }}>{p}c</button>
                );
              })}
            </div>

            <div className="vg-field" style={{ display: 'flex', alignItems: 'center', gap: 12, background: SHEET.field, border: `1px solid ${SHEET.fieldEdge}`, borderRadius: 16, padding: '13px 15px', marginBottom: 11, boxShadow: '0 0 18px rgba(143,69,222,0.16), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
              <CoinIcon size={26} />
              <input type="number" min={1} value={amount} aria-label="Tip amount in coins"
                onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value || '0', 10)))}
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: SHEET.text, fontSize: 24, fontWeight: 800, outline: 'none', padding: 0 }} />
              <span style={{ fontSize: 16, color: SHEET.muted }}>c</span>
            </div>

            <div className="vg-field" style={{ background: SHEET.well, border: `1px solid ${SHEET.cardEdge}`, borderRadius: 16, padding: '13px 14px', marginBottom: 11 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Icon name="chat_bubble" size={16} style={{ color: SHEET.muted, marginTop: 2, flexShrink: 0 }} />
                <textarea value={message} maxLength={MSG_MAX} rows={3} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a message (optional)" aria-label="Message with your tip"
                  style={{ flex: 1, minWidth: 0, resize: 'none', background: 'transparent', border: 'none', color: SHEET.text, fontSize: 14, outline: 'none', padding: 0, fontFamily: 'inherit', lineHeight: 1.45 }} />
              </div>
              <div className="vg-mono" style={{ textAlign: 'right', fontSize: 12, color: SHEET.muted, marginTop: 2 }}>{message.length} / {MSG_MAX}</div>
            </div>

          </>
        )}
        </div>
        </div>

        {/* The balance is always visible, not only when it is short — being
            surprised at the last step is what makes people abandon. */}
        <SheetBalanceRow balance={balance} short={short} onTopUp={onTopUp} />

        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 15, borderRadius: 16, background: SHEET.cancel, border: `1px solid ${SHEET.cancelEdge}`, boxShadow: SHEET.cardLip, color: SHEET.text, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          {/* ⚠⚠ `Send` USED TO BE `onClose`. The sheet dismissed and nothing
              happened — no tip in the feed, no alert, no counter. The single
              most-captured interaction in the product did nothing, and it looked
              fine because the sheet closing reads as success.
              Both buttons now fire the real simulator events, so what you
              capture is the same overlay a viewer would see. */}
          {boosting ? (
            <button onClick={() => { if (short) { onTopUp?.(short); return; } onBoost?.(boost); onClose(); }} style={cta}>
              {short ? `Top up ${short.toLocaleString()}c` : `Boost · ${cost}c`}
              {!short && <Icon name="rocket_launch" size={17} />}
            </button>
          ) : (
            <button onClick={() => { if (short) { onTopUp?.(short); return; } onSend?.(amount); onClose(); }} style={cta}>
              {short ? `Top up ${short.toLocaleString()}c` : `Send ${amount.toLocaleString()}c`}
              {!short && <Icon name="send" size={17} />}
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Top up, without leaving the stream.
 *
 * ⚠ THE COIN PACKS ARE THE REAL LADDER, NOT INVENTED ONES. `COIN_PACKS` in
 * `src/utils/vpSystem.js` is the shipped, founder-locked price list and every
 * price here is read from it. Inventing a pack, a price or a bonus here would
 * put a number on a capture that Vergr does not charge
 * ([[feedback-no-unilateral-financial-choices]]).
 *
 * ⚠ IT PRESELECTS THE SMALLEST PACK THAT ACTUALLY COVERS THE SHORTFALL. Making
 * someone work out which pack is big enough, while a stream runs behind the
 * sheet, is how a purchase gets abandoned.
 *
 * ⚠ IT IS A SHEET OVER THE STREAM, NOT A ROUTE. Founder: "if I am on a stream I
 * won't want to leave the stream in order to purchase more coins."
 */
function TopUpSheet({ short = 0, balance = 0, onClose }) {
  const packs = (COIN_PACKS || []).filter((p) => p && p.coins);
  const need = Math.max(0, short);
  const covers = packs.filter((p) => p.coins >= need);
  const best = (covers.length ? covers : packs)[0];
  const [picked, setPicked] = useState(best?.id);
  const sel = packs.find((p) => p.id === picked) || best;
  return (
    <SheetShell onClose={onClose}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Top up</div>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
          You are {need.toLocaleString()}c short. The stream keeps playing behind this.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {packs.map((p) => {
            const on = p.id === picked;
            // ⚠ A BADGE ON EVERY ROW SAYS NOTHING. With a 50c shortfall every
            // pack covers it, so “covers it” was noise on all eight. Badge only
            // the SMALLEST pack that clears the shortfall — that is the one
            // useful fact, and it is the row already preselected.
            const enough = p.id === best?.id && p.coins >= need;
            return (
              <button key={p.id} type="button" onClick={() => setPicked(p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px',
                borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                background: on ? C.purpleSoft : S.row, border: 'none',
                boxShadow: on ? C.selBar : 'none',
                color: C.text,
              }}>
                <CoinIcon size={16} />
                <span className="vg-mono" style={{ fontWeight: 800, fontSize: 14 }}>{p.coins.toLocaleString()}</span>
                {/* ⚠ THE ONLY LABEL IS WHETHER IT COVERS THE SHORTFALL. Anything
                    else here would be a value claim I am not authorised to make. */}
                {enough && <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: C.purple, padding: '2px 7px', borderRadius: 8 }}>enough</span>}
                <span className="vg-mono" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800 }}>${Number(p.priceUSD).toFixed(2)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: S.row, color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Not now</button>
          <button onClick={onClose} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            {sel ? `Buy ${sel.coins.toLocaleString()}c · $${Number(sel.priceUSD).toFixed(2)}` : 'Buy coins'}
          </button>
        </div>
    </SheetShell>
  );
}

/**
 * Appeal a mute or a ban.
 *
 * ⚠ AN ENFORCEMENT ACTION WITH NO WAY TO CONTEST IT IS A PLAY REVIEW ITEM, and
 * the stream had none: the banned viewer was simply told no. It also has to be
 * honest about what happens next, because "we will look into it" with no
 * timeframe is what makes people write to the store instead.
 *
 * ⚠ IT SAYS WHO DECIDED. A viewer muted by a channel moderator and a viewer
 * actioned by Vergr are appealing to different people, and telling them the
 * wrong one wastes everybody's time.
 */
function AppealSheet({ kind = 'ban', onClose }) {
  const [note, setNote] = useState('');
  const timeout = kind === 'timeout';
  return (
    <Sheet title={timeout ? 'Appeal this timeout' : 'Appeal this ban'}
      sub={timeout
        ? 'A timeout ends by itself. If you think it was a mistake, the channel\u2019s moderators see this.'
        : 'A ban does not expire. The channel\u2019s moderators review appeals, and Vergr reviews anything that involves safety.'}
      onClose={onClose}
      cta={<button type="button" disabled={!note.trim()} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: note.trim() ? 'pointer' : 'default', background: note.trim() ? C.purple : S.track, color: note.trim() ? '#fff' : C.textMuted, fontSize: 14, fontWeight: 800 }}>
        Send appeal
      </button>}>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4}
        maxLength={500}
        placeholder="What happened, in your own words?"
        style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
        {note.length}/500 · You can still watch the stream while this is reviewed.
      </div>
      {/* ⚠ 24x24 IS THE WCAG 2.2 AA TARGET MINIMUM (2.5.8) and this link measured
          197x20 — the only control in the whole preview under the floor, and it was
          one I had just added. A standalone block link gets no inline exception. */}
      <a href="/platform/acceptable-use" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
        minHeight: 24, padding: '4px 2px',
        fontSize: 12, fontWeight: 700, color: C.purpleInk, textDecoration: 'none',
      }}>
        <Icon name="menu_book" size={13} /> Read the community guidelines
      </a>
    </Sheet>
  );
}

/**
 * Stream settings — the host's own controls for this broadcast.
 *
 * ⚠ "Stream settings" WAS A DEAD ROW. Its onClick was `() => setMoreOpen(false)`,
 * so it closed the menu and did nothing — a control that looks like a route and
 * is not one. Found while wiring the founder decisions, not by the audit.
 *
 * It answers three of them in the one place a host would look for them:
 *   4. audio-only broadcasts        (format)
 *   5. paid / subscriber-only       (who can watch)
 *   7. who may clip                 (who can clip)
 */
function StreamSettingsSheet({ onClose, audioOnly, onAudioOnly, gate, onGate, clipWho, onClipWho }) {
  // ⚠ THESE MIRROR `entitlements.js`, WHICH ALREADY SUPPORTS BOTH GATES. The
  // preview could draw the resulting paywall since Stage 3; this is the control
  // that produces it.
  const WATCH = [
    ['none', 'Everyone', 'Anyone can watch. Discovery works normally.'],
    ['subs', 'Subscribers', 'Only your members. It still appears in discovery, gated.'],
    ['paid', 'Ticketed', 'A one-off price. Buyers keep access, including the replay.'],
  ];
  // ⚠⚠ TWO SEPARATE LIMITS, AND CONFLATING THEM WOULD BREAK THE PLANS. This picks
  // WHO may clip; HOW MUCH they may clip is the CLIPPER's own plan and is
  // untouched by it — Free 30s/3, Lite 60s/5, Pro 90s/unlimited
  // (`functions/streamClips.js:24`). A Pro subscriber on a followers-only stream
  // still gets 90s and unlimited; a Free viewer on an open stream still gets 30s
  // and 3. The host gate never raises or lowers a plan allowance.
  const CLIP = [
    ['everyone', 'Everyone'],
    ['followers', 'Followers'],
    ['subs', 'Subscribers'],
  ];
  return (
    <Sheet title="Stream settings" sub="Only you can see these. They apply to this broadcast." onClose={onClose}>

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '2px 0 8px' }}>FORMAT</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[[false, 'videocam', 'Camera'], [true, 'graphic_eq', 'Audio only']].map(([v, icon, label]) => (
          <button key={label} type="button" onClick={() => onAudioOnly?.(v)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '11px 10px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: !!audioOnly === v ? C.purple : S.row, border: 'none',
            color: !!audioOnly === v ? '#fff' : C.textDim,
          }}><Icon name={icon} size={16} /> {label}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16, lineHeight: 1.55 }}>
        Audio only still carries chat, tips and your goal. Use it for a podcast, or
        when you would rather not be on camera.
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '2px 0 8px' }}>WHO CAN WATCH</div>
      {WATCH.map(([id, label, note]) => (
        <button key={id} type="button" onClick={() => onGate?.(id)} style={{
          display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
          padding: '11px 12px', borderRadius: 12, cursor: 'pointer', color: C.text,
          background: gate === id ? C.purpleSoft : S.row, border: 'none',
          boxShadow: gate === id ? C.selBar : 'none',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
            <Icon name={gate === id ? 'radio_button_checked' : 'radio_button_unchecked'} size={16} style={{ color: gate === id ? C.purpleLight : C.textMuted }} />
            {label}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 3, paddingLeft: 24, lineHeight: 1.5 }}>{note}</span>
        </button>
      ))}

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '16px 0 8px' }}>WHO CAN CLIP</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {CLIP.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onClipWho?.(id)} style={{
            flex: 1, padding: '10px 8px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: clipWho === id ? C.purple : S.row, border: 'none',
            color: clipWho === id ? '#fff' : C.textDim,
          }}>{label}</button>
        ))}
      </div>
      {/* ⚠ THE PLAN LIMITS ARE STATED SO THE HOST CANNOT MISREAD THIS AS A LENGTH
          CONTROL. They belong to the CLIPPER and this setting does not touch them. */}
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
        This picks who may clip, not how much. Length and count come from the
        clipper’s own plan: Free 30s and 3 per session, Lite 60s and 5, Pro 90s and
        unlimited.
      </div>
    </Sheet>
  );
}

// ── moderator context, on the card a moderator already has open ─────────
//
// ⚠⚠ THE PROFILE SHEET SHOWED THE WRONG THINGS TO THE PERSON DECIDING A BAN.
// Followers, following, likes and a bio are the right payload for a viewer
// working out whether to follow someone. A moderator is answering a completely
// different question and none of those numbers help. Twitch's mod card carries
// account creation date, prior timeouts, the chat log and mod notes, and that is
// the difference between a judgement and a guess.
//
// ⚠ IT IS THE SAME SHEET, GATED BY ROLE. Building a second card would give the
// two roles two designs to keep in step, which is how the tip alert ended up
// with two placements.
//
// ⚠ ACCOUNT AGE IS THE SIGNAL, NOT THE DATE. "Created 2 September" makes a
// moderator do arithmetic mid-stream. Three days old is the fact that matters,
// and it is highlighted amber under a week because a fresh account plus a first
// offence is the ban-evasion shape.
// How long ago, in the shortest form that is still unambiguous. A moderator is
// reading this mid-stream, so "2m" beats "14:32:07".
function agoOf(ts) {
  const secs = Math.max(0, Math.round((Date.now() - (Number(ts) || Date.now())) / 1000));
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  return Math.round(secs / 3600) + 'h';
}

function ModeratorContext({ person, messages = [] }) {
  const [note, setNote] = useState('');
  const days = Number(person?.accountDays) || 0;
  const fresh = days < 7;
  const timeouts = Number(person?.priorTimeouts) || 0;
  const theirs = messages.filter((m) => m.uid === person?.uid).slice(-4);
  const age = accountAgeLabel(days);
  return (
    <div style={{ ...sheetCard({ padding: 12, marginTop: 12 }) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon name="shield_person" size={14} style={{ color: SHEET.muted }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: SHEET.muted }}>MODERATOR VIEW</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: theirs.length ? 12 : 0 }}>
        <div style={{ flex: 1, padding: '8px 12px', borderRadius: 12, background: SHEET.well, border: `1px solid ${fresh ? '#5a4410' : SHEET.cardEdge}` }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: SHEET.muted }}>ACCOUNT AGE</div>
          <div className="vg-mono" style={{ fontSize: 14, fontWeight: 800, color: fresh ? C.amber : SHEET.text, marginTop: 2 }}>{age}</div>
        </div>
        <div style={{ flex: 1, padding: '8px 12px', borderRadius: 12, background: SHEET.well, border: `1px solid ${timeouts > 0 ? '#5a4410' : SHEET.cardEdge}` }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: SHEET.muted }}>TIMED OUT HERE</div>
          <div className="vg-mono" style={{ fontSize: 14, fontWeight: 800, color: timeouts > 0 ? C.amber : SHEET.text, marginTop: 2 }}>
            {timeouts === 0 ? 'never' : timeouts + (timeouts === 1 ? ' time' : ' times')}
          </div>
        </div>
      </div>

      {/* ⚠ THE MESSAGES ARE THE EVIDENCE. Deciding on a name alone is what makes
          moderation feel arbitrary; the reason someone is about to be banned is
          almost always still on screen. */}
      {theirs.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: SHEET.muted, marginBottom: 6 }}>RECENT MESSAGES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {/* ⚠ EACH LINE IS TIMED, AND DUPLICATES ARE NOT COLLAPSED. Seen on
                the live page: the same line twice in a row reads as a render
                bug, and the reflex is to dedupe it. That would be wrong —
                repetition IS the evidence when the case is spam. A timestamp
                makes the repeat legible as behaviour instead. */}
            {theirs.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 8px', borderRadius: 8, background: SHEET.well }}>
                <span className="vg-mono" style={{ flexShrink: 0, fontSize: 9, color: SHEET.muted }}>{agoOf(m.ts)}</span>
                <span style={{ minWidth: 0, fontSize: 12, color: SHEET.dim, lineHeight: 1.45 }}>{m.text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* A note outlives the moderator who wrote it, which is the point: the next
          one should not have to rediscover why this person was watched. */}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
        placeholder="Add a note for other moderators" aria-label="Moderator note"
        className="vg-field"
        style={{ width: '100%', boxSizing: 'border-box', background: SHEET.well, border: `1px solid ${SHEET.cardEdge}`, borderRadius: 12, padding: '10px 12px', color: SHEET.text, fontSize: 12, outline: 'none' }} />
    </div>
  );
}

// ── profile sheet — the on-stream UserQuickSheet ──────────────────────
//
// ⚠⚠ THIS WAS THE FLATTEST SURFACE IN THE PRODUCT and the founder named it:
// "especially the profile sheet, it looks like shit and not on par with
// platforms like tiktok". What it had was an avatar, a name, a handle, a text
// pill reading "LEVEL 94", two buttons and a list of grey rows. What every
// comparable card has and this did not:
//
//   • a STATS ROW. Followers / following / likes is the first thing anyone
//     looks at on a person and there was no number on the card at all.
//   • a BIO. The card said nothing about who the person is.
//   • the RANK AS ART. `RankBadge` renders the founder's own crest files out of
//     /badges/sm/ and the sheet was drawing a Material "military_tech" glyph
//     next to the word LEVEL instead — inventing a worse badge while the real
//     one shipped in the same repo.
//   • a HEADER PLATE behind the portrait, so the identity block reads as a
//     card rather than as a row of text.
//
// ⚠ THE ACTIONS DID NOT CHANGE. Every row still routes to the screen that asks
// the remaining question, and the host-only / moderator gating is untouched.
function QuickSheet({ person, isHost, onClose, role = 'viewer', onAction, messages = [] }) {
  const [following, setFollowing] = useState(false);
  if (!person) return null;
  const stat = (n, label) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div className="vg-mono" style={{ fontSize: 16, fontWeight: 900, color: SHEET.text }}>{compactCount(n)}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: SHEET.muted, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <SheetShell onClose={onClose}>
      {/* Identity plate. The ramp and the edge are the same ones the tip sheet
          uses, so a person reads as the same class of object everywhere. */}
      <div style={{ ...sheetCard({ padding: 15, marginBottom: 11 }) }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <SheetAvatar person={person} size={64} />
          {/* ⚠ A VISIBLE CLOSE, NOT JUST THE SCRIM AND THE HANDLE. Nielsen
              Norman on bottom sheets: "provide a clear Close button (usually
              styled as an X or the word Close)" and "avoid depending exclusively
              on swipe gestures, which create ambiguity and accessibility
              issues". This sheet had no close control at all after the rebuild. */}
          <div style={{ minWidth: 0, flex: 1, paddingTop: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{person.displayName}</span>
              {isHost && (
                <span style={{ flexShrink: 0, width: 17, height: 17, borderRadius: '50%', background: 'linear-gradient(135deg, #b44fff, #7526f5)', boxShadow: '0 2px 8px rgba(124,58,237,0.55)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="check" size={10} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: SHEET.dim, marginTop: 1 }}>@{person.username}</div>
            {/* ⚠ THE REAL CREST, NOT A GLYPH IN A PILL. RankBadge resolves the
                founder's art from the level alone and costs no read. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
              {/* ⚠ `feed` MAKES IT tabIndex -1. Without it the crest is the
                  first focusable thing in the sheet, so SheetHost put the
                  opening focus on a decorative badge instead of Follow — and
                  the focus ring drew a violet box around the crest, which read
                  as a bordered square in the live capture. */}
              <RankBadge level={person.vpLevel} uid={person.uid} size={17} feed />
              <span className="vg-mono" style={{ fontSize: 11, fontWeight: 800, color: SHEET.dim }}>LEVEL {person.vpLevel}</span>
              {person.isMod && (
                <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.06em', color: '#fff', background: 'linear-gradient(180deg, #9a4cf5, #7526f5)', padding: '2px 7px', borderRadius: 999 }}>MOD</span>
              )}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: SHEET.modal, border: `1px solid ${SHEET.cardEdge}`, color: SHEET.dim, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="close" size={17} />
          </button>
        </div>

        {person.bio && (
          <div style={{ fontSize: 13, color: SHEET.dim, lineHeight: 1.5, marginTop: 12 }}>{person.bio}</div>
        )}

        {/* ⚠ THE DIVIDERS FADE AT BOTH ENDS. A rule that stops at full strength
            is the cage edge the material notes already warn about. */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 13, paddingTop: 13, borderTop: `1px solid ${SHEET.cardEdge}` }}>
          {stat(person.followers, 'Followers')}
          <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: `linear-gradient(180deg, transparent, ${SHEET.cardEdge} 30%, ${SHEET.cardEdge} 70%, transparent)` }} />
          {stat(person.following, 'Following')}
          <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: `linear-gradient(180deg, transparent, ${SHEET.cardEdge} 30%, ${SHEET.cardEdge} 70%, transparent)` }} />
          {stat(person.likes, 'Likes')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button onClick={() => setFollowing((v) => !v)} style={following
          ? sheetGhost({ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 })
          : sheetCta({ flex: 2 })}>
          <Icon name={following ? 'check' : 'person_add'} size={16} />{following ? 'Following' : 'Follow'}
        </button>
        <button onClick={() => onAction?.('message', person)} style={sheetGhost({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 })}>
          <Icon name="chat_bubble" size={16} />Message
        </button>
      </div>

      {/* ⚠⚠ THIS BLOCK IS THE POINT OF THE SHEET, and it is what was missing
          from the entire product. Everything a live stream does TO A PERSON —
          gift them a sub, report them, block them, time them out, ban them,
          make them a moderator — needs somewhere to be asked, and there was
          nowhere. A gavel with no viewer picker behind it is not moderation.

          ⚠ THE HOST-ONLY / MOD ROWS ARE GATED BY THE SAME RESOLVER THE REST OF
          THE APP USES, mirroring functions/streamChatMod.js: mute/ban/timeout
          are host-OR-moderator (`loadStreamForMod`), appointing a moderator is
          host-only (`loadStream`). Offering a moderator a button the server
          answers with permission-denied is the same defect as offering it to
          a stranger. */}
      {!isHost && (
        <div style={{ ...sheetCard({ padding: 6 }) }}>
          <ActionRow icon="redeem" label="Gift a sub" onClick={() => onAction?.('giftsub', person)} />
          <ActionRow icon="volunteer_activism" label="Send coins" onClick={() => onAction?.('tip', person)} />
          <ActionRow icon="flag" label="Report" danger onClick={() => onAction?.('report', person)} />
          <ActionRow icon="block" label="Block" danger onClick={() => onAction?.('block', person)} />

          {canModerate(role) && (
            <>
              <ModeratorContext person={person} messages={messages} />
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: SHEET.muted, margin: '10px 10px 4px' }}>MODERATION</div>
              <ActionRow icon="timer_off" label="Time out" onClick={() => onAction?.('timeout', person)} />
              <ActionRow icon="gavel" label="Ban from this stream" danger onClick={() => onAction?.('ban', person)} />
            </>
          )}
          {canConfigureChat(role) && (
            <ActionRow icon="shield_person" label={person.isMod ? 'Remove as moderator' : 'Make moderator'} onClick={() => onAction?.('appoint', person)} />
          )}
        </div>
      )}
    </SheetShell>
  );
}

/**
 * The viewer list — the SECOND way to reach a person, and the one a broadcaster
 * actually uses.
 *
 * ⚠⚠ NEITHER THE SIMULATOR NOR THE REAL LIVE SCREENS HAD ONE. Measured: zero
 * references to a viewer list in MobileLiveViewer, ViewerStreamScreen or the
 * whole preview. A host running a room could not see who was in it — so there
 * was no way to moderate someone who had not just spoken, and no way to gift a
 * sub to anyone at all. Chat only shows you people while they are talking.
 *
 * ⚠ SEARCH IS NOT OPTIONAL HERE. The founder's own example: gifting a sub from a
 * list of six hardcoded faces is not a picker when the stream says 1,284 viewers.
 */
function ViewerListSheet({ onClose, onPick, role = 'viewer' }) {
  const faceOf = useFaces();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const term = q.trim().toLowerCase();
  const rows = CAST.filter((c) => {
    if (tab === 'subs' && !c.sub) return false;
    if (tab === 'mods' && !c.isMod) return false;
    if (!term) return true;
    return c.displayName.toLowerCase().includes(term) || c.username.toLowerCase().includes(term);
  });
  const TABS = [['all', 'All'], ['subs', 'Subscribers'], ['mods', 'Moderators']];
  return (
    <SheetShell onClose={onClose} pad={16}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Icon name="group" size={18} style={{ color: C.purpleLight }} />
          <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>In this stream</div>
          <button aria-label="Close" onClick={onClose} style={{ ...iconBtn, width: 30, height: 30 }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 10px', padding: '9px 12px', borderRadius: 12, background: S.row, flexShrink: 0 }}>
          <Icon name="search" size={17} style={{ color: C.textMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search viewers"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 14 }} />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'grid' }}><Icon name="close" size={15} /></button>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexShrink: 0 }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '6px 13px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              border: 'none', background: tab === id ? C.purple : S.row,
              color: tab === id ? '#fff' : C.textDim,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {rows.length === 0 && (
            <div style={{ padding: '28px 8px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              No one matches “{q}”.
            </div>
          )}
          {rows.map((c) => (
            <button key={c.uid} onClick={() => onPick?.(c.uid)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '9px 6px', borderRadius: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: C.text,
            }}>
              <UserAvatar src={faceOf(c)} size="sm" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.displayName}
                  {c.sub && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 999, background: C.purple }}>SUB</span>}
                  {c.isMod && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 999, background: C.green, color: C.onGreen }}>MOD</span>}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted }}>@{c.username} · Level {c.vpLevel}</div>
              </div>
              <Icon name="chevron_right" size={18} style={{ color: C.textMuted }} />
            </button>
          ))}
        </div>
        {canModerate(role) && (
          <div style={{ flexShrink: 0, paddingTop: 8, ...ruleTop, fontSize: 11, color: C.textMuted }}>
            Tap anyone to moderate, gift a sub or report.
          </div>
        )}
    </SheetShell>
  );
}

/**
 * Report — required for a Play listing with live UGC, and it had 2 references in
 * the whole simulator against 33 in the real viewer. It must be reachable in two
 * taps from any person, which it now is: chat row or viewer list → Report.
 */
function ReportSheet({ person, onClose }) {
  const [reason, setReason] = useState(null);
  const REASONS = [
    ['harassment', 'Harassment or bullying'],
    ['hate', 'Hate speech'],
    ['sexual', 'Sexual content'],
    ['violence', 'Violence or threats'],
    ['spam', 'Spam or scam links'],
    ['selfharm', 'Self-harm'],
    ['minor', 'Child safety'],
    ['other', 'Something else'],
  ];
  return (
    <Sheet title={`Report ${person?.displayName || 'this person'}`}
      sub="Reports are reviewed by our moderation team. We never tell the person who reported them."
      onClose={onClose}
      cta={<button type="button" disabled={!reason} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: reason ? 'pointer' : 'default', background: reason ? C.red : S.track, color: reason ? '#fff' : C.textMuted, fontSize: 14, fontWeight: 800 }}>
        Submit report
      </button>}>
      {REASONS.map(([id, label]) => (
        <button key={id} onClick={() => setReason(id)} style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', marginBottom: 6,
          padding: '12px 12px', borderRadius: 12, cursor: 'pointer', color: C.text, fontSize: 14,
          background: reason === id ? S.dangerDim : S.row,
          border: 'none', boxShadow: reason === id ? C.selBarRed : 'none',
        }}>
          <Icon name={reason === id ? 'radio_button_checked' : 'radio_button_unchecked'} size={17} style={{ color: reason === id ? C.red : C.textMuted }} />
          {label}
        </button>
      ))}
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
        If someone is in immediate danger, contact your local emergency services.
      </div>
      {/* ⚠ THE RULES HAVE TO BE READABLE FROM THE PLACE THEY ARE ENFORCED.
          Google asks for an in-app path to the community guidelines from chat
          for any app with live UGC, and there was none anywhere on the stream.
          The route is the real one — /platform/acceptable-use (AppRouter:820) —
          not an invented page. */}
      {/* ⚠ 24x24 IS THE WCAG 2.2 AA TARGET MINIMUM (2.5.8) and this link measured
          197x20 — the only control in the whole preview under the floor, and it was
          one I had just added. A standalone block link gets no inline exception. */}
      <a href="/platform/acceptable-use" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
        minHeight: 24, padding: '4px 2px',
        fontSize: 12, fontWeight: 700, color: C.purpleInk, textDecoration: 'none',
      }}>
        <Icon name="menu_book" size={13} /> Read the community guidelines
      </a>
    </Sheet>
  );
}

// ⚠ ONE DEFINITION OF ACCOUNT AGE. The held queue printed "Account 412 days
// old" while the moderator card two taps away said "1.1 years" about the same
// person. The fact that matters is whether the account is NEW, so the scale
// coarsens as it gets older and the caller colours it amber under a week.
export function accountAgeLabel(days) {
  const d = Number(days) || 0;
  if (d < 1) return 'today';
  if (d === 1) return '1 day';
  if (d < 30) return `${d} days`;
  if (d < 365) return `${Math.round(d / 30)} months`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} years`;
}

/**
 * Auto moderation — the dial, and what each notch actually holds.
 *
 * ⚠⚠ IT COSTS NOTHING EXTRA TO RUN. The relay already calls Gemini Flash once
 * per message and gets back pass | flag | block (infra/chat/src/main.go:9-21).
 * Today a 'flag' fans out and is only written to streams/{id}/chat_moderation
 * for Vanguard to read afterwards, which means the viewer saw it. The dial does
 * not add a scan; it decides whether that same verdict HOLDS the message
 * instead. Same one call, no second model, no new spend.
 *
 * ⚠ NO PER-CATEGORY DIALS, AND THAT IS DELIBERATE. Twitch offers four category
 * sliders because its model returns per-category scores. Ours returns one
 * verdict and a free-text reason (parseVerdict, main.go:1447), so a category
 * slider would be a control the server cannot honour — the exact defect §0 of
 * the competitive doc opens with. Levels it is, until the verdict shape changes.
 *
 * ⚠ THE TOP TWO NOTCHES USE SIGNALS THAT NEED NO AI AT ALL. Has this person
 * spoken here before, does the text carry a link, how old is the account. All
 * three are already on the doc, all three are free, and they catch the raid
 * pattern the scanner is worst at: a hundred accounts each saying one bland
 * thing.
 */
function AutoModSheet({ onClose, level, onLevel, heldCount = 0, onOpenHeld }) {
  const [pick, setPick] = useState(level || 'standard');
  const LEVELS = [
    ['off', 'Off', 'Nothing is held. Chat still refuses anything the scanner blocks outright, which is not something you can turn off.'],
    ['light', 'Light', 'Holds messages the scanner reads as hostile or sexual before anyone sees them.'],
    ['standard', 'Standard', 'Everything in Light, plus the first message from anyone who has never spoken in your chat.'],
    ['strict', 'Strict', 'Everything in Standard, plus links, and anyone whose account is less than a week old.'],
  ];
  return (
    <Sheet title="Auto moderation"
      sub="Held messages are not shown to anyone until you approve them. The sender sees their own as pending."
      onClose={onClose}
      openAt="large"
      cta={(
        <button type="button" onClick={() => { onLevel?.(pick); onClose?.(); }} style={sheetCta({ width: '100%' })}>
          {pick === 'off' ? 'Turn auto moderation off' : `Set to ${LEVELS.find(([k]) => k === pick)[1]}`}
        </button>
      )}
    >
      {/* ⚠ THE QUEUE IS REACHABLE FROM THE SETTING. A host who has just made the
          dial stricter is the single most likely person to want to see what it
          caught, and making them close this and hunt for it is how a queue goes
          unread. */}
      {heldCount > 0 && (
        <button type="button" onClick={() => { onClose?.(); onOpenHeld?.(); }} style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
          padding: 13, borderRadius: 16, marginBottom: 12, cursor: 'pointer',
          background: 'linear-gradient(180deg, #2a1015 0%, #1a0a0f 100%)', border: '1px solid #5a2230',
        }}>
          <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 12, background: 'linear-gradient(135deg, #ff6b6b, #a3122b)', display: 'grid', placeItems: 'center', color: '#fff' }}>
            <Icon name="inventory_2" size={16} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#ff9d9d' }}>
              {heldCount} message{heldCount === 1 ? '' : 's'} waiting on you
            </span>
            <span style={{ display: 'block', fontSize: 12, color: SHEET.dim, marginTop: 2 }}>Nobody has seen them yet</span>
          </span>
          <Icon name="chevron_right" size={16} style={{ color: SHEET.muted, flexShrink: 0 }} />
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LEVELS.map(([key, label, hint]) => {
          const on = pick === key;
          return (
            <button key={key} type="button" onClick={() => setPick(key)} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left',
              padding: 13, borderRadius: 16, cursor: 'pointer',
              background: on ? SHEET.rowSel : SHEET.card,
              border: `1px solid ${on ? SHEET.tabSelEdge : SHEET.cardEdge}`,
              boxShadow: on ? '0 6px 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.08)' : SHEET.cardLip,
            }}>
              {/* A radio is a filled disc in a ring, not a tick and not a pill. */}
              <span aria-hidden style={{
                flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: 999,
                border: `2px solid ${on ? '#a259f0' : '#3a3552'}`, display: 'grid', placeItems: 'center',
              }}>
                {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: '#c79bff' }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: SHEET.text }}>{label}</span>
                <span style={{ display: 'block', fontSize: 12, color: SHEET.dim, marginTop: 2, lineHeight: 1.45 }}>{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, padding: 13, borderRadius: 16, background: SHEET.well, border: `1px solid ${SHEET.cardEdge}` }}>
        <Icon name="bolt" size={16} style={{ color: SHEET.muted, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: SHEET.dim, lineHeight: 1.5 }}>
          Your banned words run before any of this and are never held for review, they are simply refused. Moderators are never held.
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The held queue — the half of auto moderation that makes it honest.
 *
 * ⚠⚠ HOLDING WITHOUT A QUEUE IS JUST DELETING. If a message is withheld and
 * nobody can release it, the host has silently muted a viewer who may have said
 * nothing wrong, and neither of them ever finds out. The queue is not a nicety
 * attached to the dial, it is the thing that makes holding defensible.
 *
 * ⚠ EVERY ROW SAYS WHY IT WAS HELD. "Held by auto moderation" teaches nobody
 * anything and gives the host no way to tell their dial is set wrong. A row that
 * says `link` when the host wanted hostility caught is how the dial gets tuned.
 *
 * ⚠ DENY OFFERS THE NEXT STEP, IT DOES NOT TAKE IT. Someone posting a scam link
 * usually wants a timeout, not just a dropped message, and making the host
 * reopen the profile sheet to do it is how the same account posts it four more
 * times. It is offered, never automatic: an auto-timeout on an AI verdict is the
 * auto-DQ this repo already refused for cheat flags.
 */
function HeldQueueSheet({ onClose, held = [], onApprove, onDeny, onTimeout, level }) {
  const faceOf = useFaces();
  // ⚠⚠ THE LIVE LIST, NOT THE SNAPSHOT IT WAS OPENED WITH. Measured on the
  // deployed preview: approving a message dropped the banner from 4 to 3 and
  // left all four rows sitting in the open sheet, because the array arrived
  // through the `openSheet` payload and payloads do not re-render. The host
  // would have approved the same message repeatedly and posted it four times.
  // The prop stays as the fallback so the isolated harness can still drive this
  // sheet with fixtures.
  const sim = usePreviewSim();
  const rows = sim?.held ?? held;
  const approve = sim?.approveHeld ?? onApprove;
  const deny = sim?.denyHeld ?? onDeny;
  return (
    <Sheet title="Held for review"
      sub={rows.length
        ? 'Nobody watching has seen these. Approving one puts it in chat where it would have been.'
        : 'Messages auto moderation holds land here before anyone sees them.'}
      onClose={onClose}
      openAt="large"
      cta={<button type="button" onClick={onClose} style={sheetGhost({ width: '100%' })}>Done</button>}
    >
      {rows.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 16, background: SHEET.well, border: `1px solid ${SHEET.cardEdge}`, display: 'grid', placeItems: 'center' }}>
            <Icon name="check" size={20} style={{ color: SHEET.muted }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: SHEET.text }}>Nothing waiting</div>
          <div style={{ fontSize: 12, color: SHEET.dim, marginTop: 4, lineHeight: 1.5 }}>
            {level === 'off'
              ? 'Auto moderation is off, so nothing will be held.'
              : 'Chat is running clean at your current setting.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((h) => {
            const who = castByUid(h.uid);
            return (
              <div key={h.id} style={{ padding: 13, borderRadius: 16, background: SHEET.card, border: `1px solid ${SHEET.cardEdge}`, boxShadow: SHEET.cardLip }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserAvatar src={faceOf(who)} size={24} showLiftRing={false} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: SHEET.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.displayName}</span>
                  {/* ⚠ THE REASON IS A CHIP, NOT BODY TEXT. It is the one thing
                      on the row the host scans for.
                      ⚠ AND IT IS ONLY RED WHEN THE SCANNER ACCUSED SOMEBODY. A
                      message held because the host asked to see first messages
                      is a precaution, not a finding, and painting it the same
                      red as a scam link trains the host to deny newcomers. */}
                  <span style={{
                    marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 800,
                    padding: '2px 8px', borderRadius: 999,
                    ...(h.by === 'scanner'
                      ? { color: '#ff9d9d', background: 'linear-gradient(180deg, #2a1015 0%, #1a0a0f 100%)', border: '1px solid #5a2230' }
                      : { color: SHEET.dim, background: SHEET.chip, border: `1px solid ${SHEET.chipEdge}` }),
                  }}>{h.why}</span>
                </div>
                <div style={{ fontSize: 13, color: SHEET.text, lineHeight: 1.5, margin: '8px 0 4px', wordBreak: 'break-word' }}>{h.text}</div>
                <div style={{ fontSize: 11, marginBottom: 12, color: (Number(who.accountDays) || 0) < 7 ? C.amber : SHEET.muted }}>
                  Account {accountAgeLabel(who.accountDays)} old
                  {who.priorTimeouts ? ` · ${who.priorTimeouts} prior timeout${who.priorTimeouts === 1 ? '' : 's'}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => approve?.(h.id)} style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', cursor: 'pointer', background: SHEET.cta, color: '#fff', fontSize: 13, fontWeight: 800 }}>Approve</button>
                  <button type="button" onClick={() => deny?.(h.id)} style={{ flex: 1, padding: 12, borderRadius: 12, cursor: 'pointer', background: SHEET.cancel, border: `1px solid ${SHEET.cancelEdge}`, color: SHEET.text, fontSize: 13, fontWeight: 800 }}>Deny</button>
                  <button type="button" aria-label={`Time out ${who.displayName}`} title="Time out" onClick={() => onTimeout?.(h.uid)} style={{ flexShrink: 0, width: 44, padding: 12, borderRadius: 12, cursor: 'pointer', background: SHEET.cancel, border: `1px solid ${SHEET.cancelEdge}`, color: '#ff9d9d', display: 'grid', placeItems: 'center' }}>
                    <Icon name="timer_off" size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Vertical framing — Dual Format without a second encode.
 *
 * ⚠⚠ THE HOST CHOOSES THE CROP AND SEES IT BEFORE IT SHIPS. "Never crop the
 * broadcaster, letterbox instead" is a standing founder rule; the exception
 * granted on 2026-09-06 was for a crop the host picked and previewed. So this
 * screen IS the exception's condition, not a nicety attached to it. Leaving it
 * unset keeps the old behaviour exactly.
 *
 * ⚠⚠ ONE ENCODE, AND THE ALTERNATIVE WAS MEASURED RATHER THAN ASSUMED. A
 * server-side 9:16 transcode benchmarked on box 1 at 2.89x realtime for free
 * 480p, 1.69x for lite 720p and **0.85x for Pro 1080p** — it cannot keep up with
 * a single Pro stream, on a 2-vCPU box that also runs the chat relay, ingest,
 * the SFU and the PayRam node. Framing costs nothing and behaves identically at
 * every tier, which is why it is the route.
 *
 * ⚠ TWO CONTROLS, NOT A VIDEO EDITOR. A 9:16 window at full source height is
 * 0.3164 of a 16:9 frame's width, so the only real choices are where it sits and
 * how far it zooms.
 *
 * ⚠ THE RESULT PANEL IS THE POINT. A draggable rectangle over a wide frame tells
 * a host nothing about what a phone shows, so the 9:16 panel sits beside it and
 * the two always agree.
 */
function VerticalFramingSheet({ onClose }) {
  const { vFrame, setFrameX, setFrameZoom, clearVFrame, setVFrame } = usePreviewSim();
  const [box, setBox] = useState(null);
  const on = !!vFrame;
  const zoom = vFrame?.zoom ?? 1;
  const winW = FRAME_WINDOW / zoom;
  const half = winW / 2;
  const x = Math.min(1 - half, Math.max(half, vFrame?.x ?? 0.5));
  const L = x - half;
  const R = x + half;

  // ⚠⚠ THE LINES ARE THE WHOLE CONTROL, INCLUDING THE ZOOM. Founder, 2026-09-06:
  // *"we should allow them to move lines so that will see what will be visible
  // and what wont be visible."* A 9:16 window at full source height is exactly
  // FRAME_WINDOW of a 16:9 frame's width, so a NARROWER gap between the lines
  // can only be achieved by cropping height too — which IS zooming in. The gap
  // therefore encodes the zoom and there is nothing left for a slider to do.
  // Widening past FRAME_WINDOW is refused rather than clamped silently: there is
  // no more source to show, so the line simply stops.
  const drag = (which) => (e) => {
    if (!box) return;
    e.stopPropagation();
    const at = (ev) => {
      const r = box.getBoundingClientRect();
      return (ev.clientX - r.left) / Math.max(1, r.width);
    };
    const start = at(e);
    const from = { L, R, x };
    const move = (ev) => {
      const p = at(ev);
      if (which === 'pan') { setFrameX(from.x + (p - start)); return; }
      const w = which === 'left' ? from.R - p : p - from.L;
      const clamped = Math.min(FRAME_WINDOW, Math.max(FRAME_WINDOW / 2, w));
      setFrameZoom(FRAME_WINDOW / clamped);
      setFrameX(which === 'left' ? from.R - clamped / 2 : from.L + clamped / 2);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const Handle = ({ side }) => (
    <div onPointerDown={drag(side)} style={{
      position: 'absolute', top: 0, bottom: 0, width: 22,
      [side]: -11, cursor: 'ew-resize', display: 'grid', placeItems: 'center',
      touchAction: 'none', zIndex: 3,
    }}>
      <span style={{ width: 3, height: '100%', background: '#c79bff', borderRadius: 999, boxShadow: '0 0 12px rgba(180,79,255,0.9)' }} />
      <span style={{
        position: 'absolute', width: 18, height: 34, borderRadius: 8,
        background: 'linear-gradient(180deg, #9a4cf5, #7526f5)',
        display: 'grid', placeItems: 'center', color: '#fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}>
        <Icon name="drag_indicator" size={14} />
      </span>
    </div>
  );

  return (
    <Sheet title="Vertical framing"
      sub="Phones fill the screen. Leave it automatic and it centres, or drag the lines to say exactly what shows. Desktop always gets the whole picture."
      onClose={onClose}
      openAt="large"
      cta={(
        <button type="button" onClick={onClose} style={sheetCta({ width: '100%' })}>
          {on ? 'Use this framing' : 'Keep it automatic'}
        </button>
      )}
    >
      {/* ⚠ OFF IS AN EQUAL CHOICE, not a disabled state. The founder's standing
          rule is never crop; this feature exists only because he granted an
          exception for a crop the HOST sets, so refusing it must stay one tap. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[[false, 'Automatic', 'Fills the screen, centred'], [true, 'Choose what shows', 'You draw the lines']].map(([val, label, hint]) => {
          const sel = on === val;
          return (
            <button key={label} type="button"
              onClick={() => (val ? setVFrame({ x: 0.5, zoom: 1 }) : clearVFrame())}
              style={{
                flex: 1, textAlign: 'left', padding: 13, borderRadius: 16, cursor: 'pointer',
                background: sel ? SHEET.rowSel : SHEET.card,
                border: `1px solid ${sel ? SHEET.tabSelEdge : SHEET.cardEdge}`,
                boxShadow: sel ? '0 6px 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.08)' : SHEET.cardLip,
              }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: SHEET.text }}>{label}</div>
              <div style={{ fontSize: 12, color: SHEET.dim, marginTop: 2 }}>{hint}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: SHEET.muted, marginBottom: 6 }}>WHAT YOU SEND</div>
          <div ref={setBox} style={{
            position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12,
            overflow: 'hidden', background: '#0a0a14', touchAction: 'none',
          }}>
            <Scene scene="gameplay" />
            {on && (
              <>
                {/* ⚠ BOTH SIDES ARE LABELLED. "What will be visible and what
                    wont be" was the ask, and a dimmed area with no words on it
                    only says "something is different here". */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${L * 100}%`, background: 'rgba(0,0,0,0.66)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - R) * 100}%`, background: 'rgba(0,0,0,0.66)' }} />
                <div onPointerDown={drag('pan')} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${L * 100}%`, width: `${winW * 100}%`,
                  cursor: 'grab', touchAction: 'none',
                }}>
                  <Handle side="left" />
                  <Handle side="right" />
                  {/* ⚠ THE LABEL HIDES WHEN IT NO LONGER FITS INSIDE THE LINES.
                      At full zoom the window is half its widest and the pill is
                      wider than the gap, so it spilled across the CUT area and
                      labelled the wrong region — the exact opposite of what it
                      is for. The lines and the CUT markers still say everything
                      it said. */}
                  {winW > 0.22 && (
                    <span style={{
                      position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
                      whiteSpace: 'nowrap', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                      color: '#fff', background: 'linear-gradient(180deg, #9a4cf5, #7526f5)',
                      padding: '2px 8px', borderRadius: 999,
                    }}>ON PHONES</span>
                  )}
                </div>
                {L > 0.06 && (
                  <span style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: '#8b8ba7' }}>CUT</span>
                )}
                {R < 0.94 && (
                  <span style={{ position: 'absolute', right: 6, top: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: '#8b8ba7' }}>CUT</span>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ width: 92, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: SHEET.muted, marginBottom: 6 }}>ON A PHONE</div>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', background: '#0a0a14' }}>
            <Scene scene="gameplay" frame={on ? { x, zoom } : null} />
          </div>
        </div>
      </div>

      {on && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {[['Left', 0.2], ['Centre', 0.5], ['Right', 0.8]].map(([label, val]) => {
              const sel = Math.abs(x - val) < 0.03;
              return (
                <button key={label} type="button" onClick={() => setFrameX(val)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 800,
                  background: sel ? SHEET.sel : SHEET.chip,
                  border: `1px solid ${sel ? SHEET.selEdge : SHEET.chipEdge}`,
                  color: SHEET.text,
                }}>{label}</button>
              );
            })}
          </div>
          {/* ⚠ SAYS WHAT DESKTOP GETS. The fear this answers is "am I ruining my
              stream for everyone else", and the answer is no. */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, padding: 13, borderRadius: 16, background: SHEET.well, border: `1px solid ${SHEET.cardEdge}` }}>
            <Icon name="desktop_windows" size={16} style={{ color: SHEET.muted, flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: SHEET.dim, lineHeight: 1.5 }}>
              Desktop, tablets and anyone who turns their phone sideways still get the full
              wide picture. You are only choosing what a phone held upright shows.
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Slow mode — "how many seconds?" was the missing question. */
function SlowModeSheet({ onClose }) {
  const [secs, setSecs] = useState(5);
  const OPTS = [0, 3, 5, 10, 30, 60];
  return (
    <Sheet title="Slow mode"
      sub="How long each viewer must wait between messages. Moderators and subscribers are exempt."
      onClose={onClose}
      cta={<button type="button" onClick={onClose} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
        {secs === 0 ? 'Turn slow mode off' : `Set to ${secs}s`}
      </button>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {OPTS.map((s) => (
          <button key={s} onClick={() => setSecs(s)} style={{
            padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: secs === s ? C.purple : S.row,
            border: 'none', color: secs === s ? '#fff' : C.text,
          }}>{s === 0 ? 'Off' : `${s}s`}</button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Shield Mode — every chat lever at once, on one control.
 *
 * ⚠⚠ THE POINT IS THAT IT IS ONE PRESS. Vergr already has followers-only, slow
 * mode, subscribers-only and banned words, and a host being raided has to find
 * four separate sheets and set each one while the thing is happening. Twitch's
 * Shield Mode is a panic button precisely because the moment you need it is the
 * moment you cannot be navigating settings.
 *
 * ⚠ IT REMEMBERS WHAT IT CHANGED, AND TURNING IT OFF PUTS IT BACK. A blunt
 * "restore defaults" would silently wipe a host's own slow-mode setting, so the
 * previous state is captured on the way in and restored on the way out. That is
 * the difference between a panic button and a foot-gun.
 *
 * ⚠ THE LEVERS ARE PICKABLE, WITH A SENSIBLE DEFAULT. Twitch lets a channel
 * configure what Shield Mode does. A host who never opens this still gets a
 * working shield; one who has been raided before can tune it.
 */
function ShieldSheet({ onClose }) {
  // ⚠⚠ RAISING IT NOW ACTUALLY MOVES THE CHAT RULES. Until this was wired, the
  // shield flipped a banner inside its own sheet and changed nothing on the
  // stream — a panic button that panicked alone. `raiseShield` sets the levers
  // the host picked and `lowerShield` puts their own settings back, which is
  // what the copy on this sheet has been promising.
  const { raiseShield, lowerShield } = usePreviewSim();
  const [armed, setArmed] = useState(false);
  const [levers, setLevers] = useState({
    followersOnly: true, slowMode: true, subsOnly: false, clearChat: true,
  });
  const LEVERS = [
    ['followersOnly', 'Followers only', 'Only people who already follow you can type.'],
    ['slowMode', 'Slow mode, 30s', 'One message per viewer every 30 seconds.'],
    ['subsOnly', 'Subscribers only', 'The hardest setting. Your regulars go quiet too.'],
    ['clearChat', 'Clear what is on screen', 'Removes the messages already posted.'],
  ];
  const count = Object.values(levers).filter(Boolean).length;
  return (
    <Sheet
      title={armed ? 'Shield is up' : 'Shield mode'}
      sub={armed
        ? 'Chat is locked down. Turning this off puts every setting back the way you had it.'
        : 'One press when a stream is being raided or brigaded. It sets everything below at once.'}
      onClose={onClose}
      cta={(
        <button type="button" onClick={() => { if (armed) { lowerShield?.(); } else { raiseShield?.(levers); } setArmed((v) => !v); }} style={armed
          ? { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 16, cursor: 'pointer', background: 'linear-gradient(180deg, #1c1c3c 0%, #141530 100%)', border: '1px solid #423a5f', color: SHEET.text, fontSize: 14, fontWeight: 800 }
          : { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 16, cursor: 'pointer', border: 'none', background: 'linear-gradient(135deg, #ff6b6b 0%, #e0364f 45%, #a3122b 100%)', boxShadow: '0 10px 26px rgba(224,54,79,0.45), inset 0 1px 0 rgba(255,255,255,0.3)', color: '#fff', fontSize: 14, fontWeight: 800 }}>
          <Icon name={armed ? 'lock_open' : 'shield'} size={17} />
          {armed ? 'Lower the shield' : `Raise the shield · ${count} setting${count === 1 ? '' : 's'}`}
        </button>
      )}
    >
      {armed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, background: 'linear-gradient(180deg, #2a1015 0%, #1a0a0f 100%)', border: '1px solid #5a2230', marginBottom: 12 }}>
          <span style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#ff6b6b' }} />
            <span style={{ position: 'absolute', inset: -4, borderRadius: 999, border: '1px solid #ff6b6b', opacity: 0.45 }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#ff9d9d' }}>Shield is up</span>
          <span className="vg-mono" style={{ marginLeft: 'auto', fontSize: 12, color: SHEET.dim }}>{count} active</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LEVERS.map(([key, label, hint]) => {
          const on = !!levers[key];
          return (
            <button key={key} type="button" onClick={() => setLevers((p) => ({ ...p, [key]: !p[key] }))} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: 13, borderRadius: 16, cursor: 'pointer',
              background: on ? SHEET.rowSel : SHEET.card,
              border: `1px solid ${on ? SHEET.tabSelEdge : SHEET.cardEdge}`,
              boxShadow: on ? '0 6px 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.08)' : SHEET.cardLip,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: SHEET.text }}>{label}</div>
                <div style={{ fontSize: 12, color: SHEET.dim, marginTop: 2, lineHeight: 1.45 }}>{hint}</div>
              </div>
              {/* a switch is a track with a knob, never a pill */}
              <span aria-hidden style={{
                flexShrink: 0, width: 40, height: 24, borderRadius: 999, padding: 2,
                background: on ? 'linear-gradient(180deg, #9a4cf5, #7526f5)' : '#2A2A38',
                display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
                transition: 'background 200ms cubic-bezier(0.2, 0.6, 0.25, 1)',
              }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: '#fff' }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* ⚠ SAYS WHAT COMES BACK. The reason a host hesitates over a panic button
          is not knowing what it will cost them afterwards. */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, padding: 13, borderRadius: 16, background: SHEET.well, border: `1px solid ${SHEET.cardEdge}` }}>
        <Icon name="history" size={16} style={{ color: SHEET.muted, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: SHEET.dim, lineHeight: 1.5 }}>
          Your own chat settings are saved when the shield goes up and put back when it comes down. Moderators can raise and lower it too.
        </div>
      </div>
    </Sheet>
  );
}

/** Banned words — "which words?" was the missing question. */
function BannedWordsSheet({ onClose }) {
  const [words, setWords] = useState(['free coins', 'check my bio', 'crypto giveaway']);
  const [draft, setDraft] = useState('');
  const add = () => { const w = draft.trim().toLowerCase(); if (w && !words.includes(w)) setWords([...words, w]); setDraft(''); };
  return (
    <Sheet title="Banned words"
      sub="Messages containing these are held for review instead of appearing in chat."
      onClose={onClose}
      cta={<button type="button" onClick={onClose} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
        Save {words.length} {words.length === 1 ? 'word' : 'words'}
      </button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add a word or phrase"
          style={{ flex: 1, background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: '11px 13px', color: C.text, fontSize: 14, outline: 'none' }} />
        <button onClick={add} style={{ padding: '0 16px', borderRadius: 12, border: 'none', background: C.purple, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {words.map((w) => (
          <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px 7px 12px', borderRadius: 8, background: S.row, fontSize: 13 }}>
            {w}
            <button aria-label={`Remove ${w}`} onClick={() => setWords(words.filter((x) => x !== w))} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, minWidth: 24, minHeight: 24 }}><Icon name="close" size={14} /></button>
          </span>
        ))}
        {words.length === 0 && <span style={{ fontSize: 13, color: C.textMuted }}>No banned words. Chat is only filtered by the automatic scan.</span>}
      </div>
    </Sheet>
  );
}

/** Pin a message — "which message?" was the missing question. */
function PinSheet({ messages = [], onClose }) {
  const faceOf = useFaces();
  const [pick, setPick] = useState(null);
  const recent = messages.slice(-8).reverse();
  return (
    <Sheet title="Pin a message"
      sub="A pinned message stays at the top of chat for everyone until you remove it."
      onClose={onClose}
      cta={<button type="button" disabled={!pick} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: pick ? 'pointer' : 'default', background: pick ? `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})` : S.track, color: pick ? '#fff' : C.textMuted, fontSize: 14, fontWeight: 800 }}>
        Pin message
      </button>}>
      {recent.length === 0 && <div style={{ fontSize: 13, color: C.textMuted, padding: '20px 0' }}>Nothing in chat to pin yet.</div>}
      {recent.map((m) => (
        <button key={m.id} onClick={() => setPick(m.id)} style={{
          display: 'flex', gap: 12, width: '100%', textAlign: 'left', marginBottom: 6, padding: 11, borderRadius: 12, cursor: 'pointer',
          background: pick === m.id ? C.purple : S.row,
          border: 'none', color: C.text,
        }}>
          <UserAvatar src={faceOf(castByUid(m.uid))} size="xs" />
          <div style={{ minWidth: 0, fontSize: 13 }}>
            <b style={{ fontWeight: 800 }}>{m.name}</b>{' '}
            <span style={{ color: C.textDim }}>{m.text}</span>
          </div>
        </button>
      ))}
    </Sheet>
  );
}

/** Time out — "how long?" is the question the old label never asked. */
function TimeoutSheet({ person, onClose }) {
  const [mins, setMins] = useState(10);
  const OPTS = [[1, '1 min'], [5, '5 min'], [10, '10 min'], [60, '1 hour'], [1440, '24 hours']];
  return (
    <Sheet title={`Time out ${person?.displayName || ''}`}
      // ⚠ IT SAYS WHAT IT DOES, because it now does more. Matching TikTok's
      // mute (founder decision 2026-09-05) means the person's earlier messages
      // go too, and a moderation control that silently deletes is worse than
      // one that says so.
      sub="They stay in the stream but cannot chat until it expires. Their earlier messages are removed for everyone."
      onClose={onClose}
      cta={<button type="button" onClick={onClose} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
        Time out for {OPTS.find(([m]) => m === mins)?.[1]}
      </button>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {OPTS.map(([m, label]) => (
          <button key={m} onClick={() => setMins(m)} style={{
            padding: '10px 16px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: mins === m ? C.purple : S.row,
            border: 'none', color: mins === m ? '#fff' : C.text,
          }}>{label}</button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * One confirm for every destructive action.
 *
 * ⚠ BAN, BLOCK AND APPOINT ALL USED TO BE ROWS THAT CLOSED A MENU. Each is
 * irreversible from the person's point of view, and none of them asked.
 */
function ConfirmSheet({ title, body, confirmLabel, danger, onClose }) {
  return (
    <Sheet title={title} sub={body} onClose={onClose}
      cta={<div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: S.row, color: C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: danger ? C.redFill : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{confirmLabel}</button>
      </div>}
    />
  );
}

/** One row in the person sheet. Kept tiny so every action looks identical. */
function ActionRow({ icon, label, onClick, danger }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: '11px 8px', borderRadius: 12, border: 'none', background: 'transparent',
      color: danger ? C.red : C.text, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    }}>
      <Icon name={icon} size={19} style={{ color: danger ? C.red : C.textDim }} />{label}
    </button>
  );
}


// ── top supporters — copied from MobileLiveViewer.jsx:1464 ────────────
function GiftersSheet({ gifters = [], hostName, onClose }) {
  const faceOf = useFaces();
  const MEDAL = ['#F5C842', '#C0C0CF', '#CD7F32'];
  return (
    <SheetShell onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="leaderboard" size={18} style={{ color: '#F5C842' }} />
          <div style={{ fontSize: 16, fontWeight: 800 }}>Top supporters{hostName ? ` · ${hostName}` : ''}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {gifters.map((g, i) => (
            <div key={g.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 12, background: S.row }}>
              <span className="vg-mono" style={{ width: 20, textAlign: 'center', fontSize: 13, fontWeight: 900, color: MEDAL[i] || C.textMuted }}>{i + 1}</span>
              <UserAvatar src={faceOf(g)} size="sm" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.displayName}</span>
              <span className="vg-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, color: '#F5C842' }}>
                <CoinIcon size={13} />{compact(g.coins)}
              </span>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Send a tip</button>
    </SheetShell>
  );
}

// ── SheetBtn — copied from MobileLiveViewer.jsx:1316 ──────────────────
function SheetBtn({ icon, label, danger = false, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
      padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6,
      background: S.row, color: danger ? C.red : '#fff',
      fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
    }}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
}

// ── the "…" sheet — MobileLiveViewer.jsx:1142-1146 ────────────────────
// ⚠ TWO ROWS ONLY. The real sheet offers Fullscreen and Report stream and
// nothing else; padding it out with plausible-looking extras would be inventing
// product in a tool whose whole purpose is to show what actually ships.
function MoreSheet({ onClose }) {
  return (
    <SheetShell onClose={onClose}>
        <SheetBtn icon="fullscreen" label="Fullscreen" onClick={onClose} />
        <SheetBtn icon="flag" label="Report stream" danger onClick={onClose} />
    </SheetShell>
  );
}

// ── share — StreamShareSheet.jsx ──────────────────────────────────────
function ShareSheet({ onClose }) {
  const rows = [['link', 'Copy link'], ['chat', 'Send in a message'], ['group', 'Share to a squad'], ['ios_share', 'More…']];
  return (
    <SheetShell onClose={onClose}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Share this stream</div>
        {rows.map(([ic, l]) => <SheetBtn key={l} icon={ic} label={l} onClick={onClose} />)}
    </SheetShell>
  );
}


/** Every sheet a stream surface can show, driven by one `openSheet` value. */
// ── Memberships ────────────────────────────────────────────────────────────
//
// ⚠⚠ THE TIERS AND PRICES ARE THE SHIPPED ONES, NOT INVENTED FOR THE PREVIEW.
// `src/screens/creator/MembershipTiersScreen.jsx` seeds Supporter 100c / VIP 500c
// / Legend 1000c, and `functions/memberships.js subscribeMembership` charges
// `tier.priceCoins` and pays the creator 90%. A preview that shows a price the
// product does not charge is a screenshot that lies, and these captures go to
// the Play store. [[feedback-no-unilateral-financial-choices]]
// ⚠ IMPORTED, NOT RESTATED. This block used to be a hand-written copy of the
// creator screen's defaults and it had ALREADY DRIFTED: Supporter said "Exclusive
// posts" where the real default says "Exclusive posts & behind-the-scenes", and
// VIP and Legend were each missing their Discord perk. So the subscribe and
// gift-a-sub sheets, which get captured for the store, advertised a slightly
// different product from the one a creator is actually handed.
const MEMBERSHIP_TIERS = DEFAULT_MEMBERSHIP_TIERS;

function TierRow({ t, selected, onPick }) {
  return (
    <button type="button" onClick={onPick} style={{
      width: '100%', textAlign: 'left', cursor: 'pointer', padding: 12, borderRadius: 12, marginBottom: 8,
      background: selected ? C.purple : S.row,
      border: 'none', color: C.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{t.name}</span>
        {t.popular && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: C.purple, color: '#fff' }}>POPULAR</span>}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800 }}>
          <CoinIcon size={14} />{t.priceCoins}
          <span style={{ color: selected ? '#fff' : C.textMuted, fontWeight: 600 }}>/mo</span>
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: selected ? '#fff' : C.textDim, lineHeight: 1.6 }}>{t.perks.join(' · ')}</div>
    </button>
  );
}

// The shell most of the small sheets render through, so converting THIS one
// carried the appeal, report, confirm, slow-mode, banned-words, pin, timeout
// and stream-settings sheets with it.
//
// ⚠ THE CTA MUST BE ON SCREEN. A sheet that scrolls is fine to use and useless
// to SCREENSHOT — the first capture of this one had "Gift · 100 coins" below
// the fold. The header and the button are pinned; only the middle scrolls.
function Sheet({ title, sub, onClose, children, cta, openAt }) {
  return (
    <SheetShell onClose={onClose} scroll={false} openAt={openAt}>
      <SheetHead title={title} sub={sub} onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
      {cta && <div style={{ flexShrink: 0, paddingTop: 12 }}>{cta}</div>}
    </SheetShell>
  );
}

function SubscribeSheet({ host, onClose }) {
  const [pick, setPick] = useState(1);
  return (
    <Sheet title={`Subscribe to ${host?.displayName || 'this creator'}`}
      sub="Monthly, paid in coins. Cancel any time." onClose={onClose}
      cta={<button type="button" onClick={onClose} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
        Subscribe · {MEMBERSHIP_TIERS[pick].priceCoins} coins
      </button>}>
      {MEMBERSHIP_TIERS.map((t, i) => <TierRow key={t.name} t={t} selected={i === pick} onPick={() => setPick(i)} />)}
    </Sheet>
  );
}

/**
 * Gift a sub — you pay, someone ELSE gets the membership.
 *
 * ⚠ THIS IS THE DIFFERENCE THE FOUNDER ASKED FOR. Before, "Subscribe" and "Gift
 * a Sub" sat side by side doing the same nothing, and no `giftSub` callable
 * exists anywhere in the repo. The economics are deliberately IDENTICAL to
 * subscribing — same tier, same `priceCoins`, same 90% to the creator — so this
 * introduces no new rate. What differs is only who receives it.
 */
/**
 * Gift a sub.
 *
 * ⚠ FOUNDER ACCEPTED THE RECOMMENDATION, 2026-09-02. Three decisions, and the
 * reasoning matters because each one is a thing that could be built the other way:
 *
 * 1. **The gifter does NOT have to be subscribed.** Every gate on a purchase
 *    reduces purchases, and an unsubscribed gifter costs nothing — the coins were
 *    still bought at retail. There is deliberately no check here; do not add one.
 *
 * 2. **A gifted sub does NOT renew.** One period, then it lapses. Renewing on the
 *    GIFTER's wallet is a silent recurring charge on someone else's behalf —
 *    chargeback risk, and the exact shape an underwriter reads as a subscription
 *    trap. Renewing on the RECIPIENT's wallet charges someone for a gift. Lapsing
 *    is also the better commercial outcome: it creates the moment where the
 *    recipient decides to continue on their own wallet.
 *
 * 3. **Bulk is quantity × price, with NO discount.** This is not a preference, it
 *    falls out of a rule already locked: `RETAIL_COIN_USD` ($0.99/78) is the floor
 *    `payram.js` uses so a custom coin amount cannot undercut a pack. "10 for the
 *    price of 8" is a coin discount by another name and reopens that arbitrage.
 *
 * ⚠ THE QUANTITIES BELOW ARE PRESETS, NOT ECONOMY. The PRICE is always the tier's
 * own price times the count; changing 5/10/25 changes nothing anyone is charged
 * per sub. Anything that changed the RATE would be a founder decision.
 */
function GiftSubSheet({ host, onClose, balance = 240, onTopUp }) {
  const [pick, setPick] = useState(0);
  const [qty, setQty] = useState(1);
  const QTY = [1, 5, 10, 25];
  const cost = MEMBERSHIP_TIERS[pick].priceCoins * qty;
  const short = Math.max(0, cost - balance);
  const [to, setTo] = useState(CAST[0]?.uid || null);
  const faceOf = useFaces();
  const RANDOM = '__random__';
  const chosen = to === RANDOM ? null : castByUid(to);
  return (
    <Sheet title="Gift a sub"
      sub={`Give someone a membership to ${host?.displayName || 'this creator'}. You pay, they get the perks.`}
      onClose={onClose}
      cta={<button type="button" onClick={() => { if (short) onTopUp?.(short); }} style={{ width: '100%', marginTop: 6, padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
        {/* ⚠ A SHORTFALL CHANGES WHAT THE BUTTON DOES, IT NEVER DISABLES IT — the
            same rule as the tip sheet, and the founder ruled it out by name. */}
        {short ? `Top up ${short.toLocaleString()}c` : `Gift ${qty > 1 ? qty + ' \u00d7 ' : ''}${MEMBERSHIP_TIERS[pick].name} \u00b7 ${cost.toLocaleString()} coins`}
      </button>}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '0 0 8px' }}>WHO IS IT FOR</div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, marginBottom: 6 }}>
        <button type="button" onClick={() => setTo(RANDOM)} style={{
          flexShrink: 0, width: 74, padding: '10px 6px', borderRadius: 12, cursor: 'pointer', color: C.text,
          background: to === RANDOM ? C.purpleSoft : S.row, border: 'none',
          boxShadow: to === RANDOM ? C.selBar : 'none',
        }}>
          <Icon name="casino" size={22} style={{ color: C.purpleLight }} />
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>Someone in chat</div>
        </button>
        {CAST.slice(0, 6).map((p) => (
          <button key={p.uid} type="button" onClick={() => setTo(p.uid)} style={{
            flexShrink: 0, width: 74, padding: '10px 6px', borderRadius: 12, cursor: 'pointer', color: C.text,
            background: to === p.uid ? C.purpleSoft : S.row, border: 'none',
            boxShadow: to === p.uid ? C.selBar : 'none',
          }}>
            <UserAvatar src={faceOf(p)} size={34} />
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '6px 0 8px' }}>HOW MANY</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        {QTY.map((q) => (
          <button key={q} type="button" onClick={() => setQty(q)} style={{
            flex: 1, padding: '9px 6px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 800,
            background: qty === q ? C.purple : S.row,
            border: 'none', color: qty === q ? '#fff' : C.textDim,
          }}>{q}</button>
        ))}
      </div>
      {/* ⚠ NO BULK DISCOUNT, AND THE LINE SAYS SO. A discount here would undercut
          RETAIL_COIN_USD, which payram.js already uses as the floor so a custom coin
          amount cannot beat a pack. */}
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
        {qty > 1 ? `${qty} \u00d7 ${MEMBERSHIP_TIERS[pick].priceCoins}c \u2014 the same price each, no bulk discount.` : 'Gifts go to different people, one month each.'}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '6px 0 8px' }}>TIER</div>
      {MEMBERSHIP_TIERS.map((t, i) => <TierRow key={t.name} t={t} selected={i === pick} onPick={() => setPick(i)} />)}
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.6 }}>
        {chosen ? `${chosen.displayName} gets the badge and perks straight away.` : 'A viewer in chat who is not already subscribed gets it.'}
        {' '}It runs for one month and does not renew, so you are never billed again for it.
      </div>
    </Sheet>
  );
}

/**
 * ⚠⚠ NONE OF THE SHEETS TRAPPED FOCUS, AND NONE ANNOUNCED ITSELF AS A DIALOG.
 * Measured 2026-09-03 with a sheet open: **46 controls behind the scrim were still
 * keyboard-reachable**, and focus really did land on them — the sheet stays visually on
 * top while the keyboard walks around behind it, so the focus ring is somewhere the
 * user cannot see. Worse than having no dialog at all. No sheet carried `role="dialog"`
 * or `aria-modal` either, so a screen reader never announced one had opened.
 *
 * One host fixes all sixteen kinds, because they all dispatch from PreviewSheets.
 *
 * ⚠ `inert` ON THE SIBLINGS IS THE MECHANISM, not a keydown handler that re-cycles Tab.
 * A handler has to guess at the tab order and gets shift-Tab, the address bar and
 * browser chrome wrong; `inert` removes the rest of the surface from the tab order AND
 * from the accessibility tree in one attribute, which is what a modal actually means.
 */
function SheetHost({ children, onClose }) {
  const ref = useRef(null);
  // ⚠⚠ THIS EFFECT RUNS ONCE PER SHEET, AND THE EMPTY DEPS ARE THE WHOLE POINT.
  // It depended on [onClose], and all nine call sites pass an inline arrow, so
  // the identity changed on every render and the effect re-ran on every render.
  // Its setup MOVES FOCUS to the first control in the sheet.
  //
  // Consequence: typing one character into the tip message re-rendered the
  // sheet, focus was ripped back to the close button, and no text field in any
  // of the seventeen sheets could take more than one keystroke. The simulator's
  // own one-second tick did it unprompted as well. Founder, 2026-09-05: "tip
  // sheet, optional message doesn't work in preview".
  //
  // The close handler is read through a ref so a fresh identity can never
  // restart a mount-only effect.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const prev = document.activeElement;
    // ⚠ SIBLINGS, NOT THE WHOLE PAGE. The sheet renders inside the device frame, so
    // inerting document.body would inert the sheet with it.
    const marked = [];
    for (const sib of Array.from(host.parentElement?.children || [])) {
      if (sib === host || sib.inert) continue;
      sib.inert = true;
      marked.push(sib);
    }
    // Move focus in, so the first Tab lands inside rather than back at the top.
    const first = host.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    (first || host).focus?.();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); } };
    host.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('keydown', onKey);
      marked.forEach((el) => { el.inert = false; });
      // ⚠ PUT FOCUS BACK WHERE IT CAME FROM. Without this it falls to <body> and the
      // next Tab restarts at the top of the page.
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, []);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
      style={{ position: 'absolute', inset: 0, zIndex: 200, outline: 'none' }}>
      {children}
    </div>
  );
}

function PreviewSheetBody({ openSheet, host, onClose, onOpen }) {
  // ⚠ ROLE COMES FROM THE PROVIDER, NOT A PROP. Nine surfaces render this; a
  // prop would have to be remembered at all nine and this repo has a four-time
  // history of exactly that going wrong.
  const role = usePreviewRole();
  const sim = usePreviewSim();
  if (!openSheet) return null;
  // ⚠ THE SHEET FIRES THE REAL SIMULATOR EVENTS. Reading them off the context
  // rather than taking props means the nine surfaces that render <PreviewSheets>
  // cannot each forget to pass them — the failure mode this repo has had four
  // times.
  // ⚠ TOP-UP OPENS THE BASKET OVER THE STREAM, IT NEVER NAVIGATES. Founder:
  // "if I am on a stream I won't want to leave the stream in order to purchase
  // more coins". Leaving means missing the moment you were paying for.
  if (openSheet.kind === 'streamsettings') return <StreamSettingsSheet onClose={onClose}
    audioOnly={sim.audioOnly} onAudioOnly={sim.setAudioOnly}
    gate={sim.gate} onGate={sim.setGate}
    clipWho={sim.clipWho} onClipWho={sim.setClipWho} />;
  if (openSheet.kind === 'appeal') return <AppealSheet kind={openSheet.appealKind} onClose={onClose} />;
  if (openSheet.kind === 'topup') return <TopUpSheet short={openSheet.short} balance={sim.balance ?? 0} onClose={onClose} />;
  if (openSheet.kind === 'tip') return <TipSheet host={openSheet.to || host} onClose={onClose} onSend={sim.fireTip} onBoost={sim.fireBoost} balance={sim.balance ?? 240} onTopUp={(n) => onOpen?.({ kind: 'topup', short: n })} />;
  if (openSheet.kind === 'subscribe') return <SubscribeSheet host={host} onClose={onClose} />;
  if (openSheet.kind === 'giftsub') return <GiftSubSheet host={host} onClose={onClose} balance={sim.balance ?? 240} onTopUp={(n) => onOpen?.({ kind: 'topup', short: n })} />;
  if (openSheet.kind === 'gifters') return <GiftersSheet gifters={openSheet.gifters} hostName={host?.displayName} onClose={onClose} />;
  if (openSheet.kind === 'more') return <MoreSheet onClose={onClose} />;
  if (openSheet.kind === 'share') return <ShareSheet onClose={onClose} />;
  if (openSheet.kind === 'viewers') return <ViewerListSheet role={role} onClose={onClose} onPick={(uid) => onOpen?.({ kind: 'profile', uid })} />;
  if (openSheet.kind === 'report') return <ReportSheet person={openSheet.person} onClose={onClose} />;
  if (openSheet.kind === 'timeout') return <TimeoutSheet person={openSheet.person} onClose={onClose} />;
  if (openSheet.kind === 'slowmode') return <SlowModeSheet onClose={onClose} />;
  if (openSheet.kind === 'shield') return <ShieldSheet onClose={onClose} />;
  if (openSheet.kind === 'vframe') return <VerticalFramingSheet onClose={onClose} />;
  if (openSheet.kind === 'automod') return <AutoModSheet onClose={onClose} level={openSheet.level} onLevel={openSheet.onLevel} heldCount={openSheet.heldCount} onOpenHeld={() => onOpen?.({ kind: 'held' })} />;
  if (openSheet.kind === 'held') return <HeldQueueSheet onClose={onClose} held={openSheet.held} level={openSheet.level} onApprove={openSheet.onApprove} onDeny={openSheet.onDeny} onTimeout={(uid) => onOpen?.({ kind: 'profile', uid })} />;
  if (openSheet.kind === 'bannedwords') return <BannedWordsSheet onClose={onClose} />;
  if (openSheet.kind === 'pin') return <PinSheet messages={sim.messages} onClose={onClose} />;
  if (openSheet.kind === 'confirm') return <ConfirmSheet {...openSheet} onClose={onClose} />;
  if (openSheet.kind === 'profile') {
    return (
      <QuickSheet
        person={openSheet.uid === 'host' ? host : castByUid(openSheet.uid)}
        isHost={openSheet.uid === 'host'}
        role={role}
        messages={sim.messages || []}
        onClose={onClose}
        // ⚠ EVERY ACTION GOES SOMEWHERE. The previous sheet's two buttons were
        // dead and the ten moderation rows all called onClose — a menu that
        // dismisses itself is not a feature. Each of these opens the screen that
        // actually asks the remaining question (how long? why? are you sure?).
        onAction={(kind, person) => {
          if (kind === 'giftsub') return onOpen?.({ kind: 'giftsub', to: person });
          if (kind === 'tip') return onOpen?.({ kind: 'tip', to: person });
          if (kind === 'report') return onOpen?.({ kind: 'report', person });
          if (kind === 'timeout') return onOpen?.({ kind: 'timeout', person });
          if (kind === 'ban') return onOpen?.({ kind: 'confirm', title: `Ban ${person.displayName}?`,
            body: 'They will not be able to watch or chat on this stream again. You can undo this from the moderation queue.',
            confirmLabel: 'Ban', danger: true });
          if (kind === 'block') return onOpen?.({ kind: 'confirm', title: `Block ${person.displayName}?`,
            body: 'You will not see their messages and they cannot message you. This applies everywhere on Vergr, not just this stream.',
            confirmLabel: 'Block', danger: true });
          if (kind === 'appoint') return onOpen?.({ kind: 'confirm', title: `Make ${person.displayName} a moderator?`,
            body: 'They will be able to time out, ban and pin messages on your streams. They cannot change your chat rules.',
            confirmLabel: 'Make moderator' });
          return onClose();
        }}
      />
    );
  }
  return null;
}

export function PreviewSheets(props) {
  if (!props.openSheet) return null;
  return (
    <SheetHost onClose={props.onClose}>
      <PreviewSheetBody {...props} />
    </SheetHost>
  );
}
