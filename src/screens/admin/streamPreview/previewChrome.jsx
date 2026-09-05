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

import { useEffect, useRef, useState } from 'react';
import { EmptyChat } from './previewStates';
import { CoinIcon } from '../../../components/CoinIcon';
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


export function Scene({ wide = false, scene = 'gameplay', videoUrl = null }) {
  const [hasArt, setHasArt] = useState(true);
  const src = wide ? '/brand/live/preview-scene-wide.webp' : '/brand/live/preview-scene.webp';
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0a14' }}>
      {/* ⚠ AN UPLOADED VIDEO WINS. autoPlay+muted+playsInline is what lets it
          start without a gesture; loop is the point — the founder captures a
          screen recording, so the backdrop has to keep moving. */}
      {videoUrl ? (
        <video
          src={videoUrl} autoPlay muted loop playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : hasArt && (
        <img src={src} alt="" onError={() => setHasArt(false)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {!videoUrl && !hasArt && <SceneFallback scene={scene} />}
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
export function PreviewChat({ messages = [], layout = 'overlay', height, fill = false, onOpenProfile, avatars = {} }) {
  const ref = useRef(null);
  const overlay = layout === 'overlay';
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div
      ref={ref}
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
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>Live chat</span>
        <span style={{ marginLeft: 'auto', color: C.textMuted, display: 'grid' }}><Icon name="settings" size={15} /></span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '8px 6px' }}>
        <PreviewChat fill messages={messages} layout="side" onOpenProfile={onOpenProfile} />
      </div>
      <div style={{ padding: 10, ...ruleTop }}>
        <div style={{ padding: '10px 13px', borderRadius: 10, background: S.row, fontSize: 12.5, color: C.textMuted }}>
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
const BOOST_TIERS = [
  { id: 'stream_boost', name: 'Stream Boost', price: 50, detail: '1.5x · 15 min' },
  { id: 'stream_super', name: 'Super Boost', price: 150, detail: '2.5x · 30 min' },
  { id: 'stream_mega', name: 'Mega Boost', price: 500, detail: '4x · 60 min' },
];

function TipSheet({ host, onClose, onSend, onBoost, balance = 240, onTopUp }) {
  const faceOf = useFaces();
  const [tab, setTab] = useState('tip');
  const [amount, setAmount] = useState(100);
  const [boost, setBoost] = useState('stream_super');
  const [message, setMessage] = useState('');
  const PRESETS = [10, 50, 100, 500, 1000];
  // ⚠⚠ A SHORTFALL MUST NEVER DISABLE THE BUTTON. Founder, on exactly this:
  // "we cant create a design that prevents the user from checking out if they
  // are already there and willing to pay." So the CTA changes what it does,
  // it does not stop working — and it tops up IN PLACE, because leaving a
  // live stream to buy coins means missing the moment you were paying for.
  const cost = tab === 'boost' ? (BOOST_TIERS.find((b) => b.id === boost)?.price || 0) : amount;
  const short = Math.max(0, cost - balance);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <UserAvatar src={faceOf(host)} size="md" />
          <div>
            <div style={{ fontSize: 12, color: C.textDim }}>{tab === 'boost' ? 'Boost' : 'Tip'}</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{host?.displayName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['tip', 'Tip'], ['boost', 'Boost']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} style={{
              flex: 1, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', border: 'none',
              fontSize: 13, fontWeight: 800,
              background: tab === id ? C.purple : S.row,
              color: tab === id ? '#fff' : C.textDim,
              boxShadow: 'none',
            }}>{label}</button>
          ))}
        </div>
        {tab === 'boost' ? (
          // ⚠ THE THREE TIERS WERE PLAIN DIVS. You could read them and not pick
          // one, and there was no confirm button on this tab at all — so the
          // boost purchase was a price list, not a flow. Tiers, durations and
          // multipliers are the shipped ones from src/utils/boosts.js.
          <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
            {BOOST_TIERS.map(({ id, name, price, detail }) => (
              <button key={id} type="button" onClick={() => setBoost(id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 12, cursor: 'pointer',
                textAlign: 'left', color: C.text,
                background: boost === id ? C.purpleSoft : S.row, border: 'none',
                boxShadow: boost === id ? C.selBar : 'none',
              }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: C.purpleSoft, color: C.purpleLight, display: 'grid', placeItems: 'center' }}><Icon name="rocket_launch" size={17} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{name}</div>
                  <div style={{ fontSize: 11.5, color: C.textDim }}>{detail}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.purpleLight }}>{price}c</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {PRESETS.map((p) => (
                <button key={p} onClick={() => setAmount(p)} style={{
                  padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  background: amount === p ? C.purple : S.row,
                  border: 'none',
                  color: amount === p ? '#fff' : C.textDim,
                }}>{p}c</button>
              ))}
            </div>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value || '0', 10)))}
              style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 15, outline: 'none', marginBottom: 10 }} />
            <input type="text" value={message} maxLength={80} onChange={(e) => setMessage(e.target.value)} placeholder="Optional message (up to 80 chars)"
              style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, outline: 'none', marginBottom: 6 }} />
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, lineHeight: 1.4 }}>
              Every message is moderated before broadcast. Vergr pays the host their revenue share of this tip.
            </div>
          </>
        )}
        {/* The balance is always visible, not only when it is short — being
            surprised at the last step is what makes people abandon. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12 }}>
          <CoinIcon size={14} />
          <span style={{ color: C.textDim }}>Your balance</span>
          <span className="vg-mono" style={{ fontWeight: 800, color: short ? C.amber : C.text }}>{balance.toLocaleString()}c</span>
          {short > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: C.amber }}>
              {short.toLocaleString()}c short
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: S.row, color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          {/* ⚠⚠ `Send` USED TO BE `onClose`. The sheet dismissed and nothing
              happened — no tip in the feed, no alert, no counter. The single
              most-captured interaction in the product did nothing, and it looked
              fine because the sheet closing reads as success.
              Both buttons now fire the real simulator events, so what you
              capture is the same overlay a viewer would see. */}
          {tab === 'tip' ? (
            <button onClick={() => { if (short) { onTopUp?.(short); return; } onSend?.(amount); onClose(); }} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{short ? `Top up ${short.toLocaleString()}c` : `Send ${amount}c`}</button>
          ) : (
            <button onClick={() => { if (short) { onTopUp?.(short); return; } onBoost?.(boost); onClose(); }} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              {short ? `Top up ${short.toLocaleString()}c` : `Boost · ${BOOST_TIERS.find((b) => b.id === boost)?.price}c`}
            </button>
          )}
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
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '86%', overflowY: 'auto', background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, color: C.text }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Top up</div>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
          You are {need.toLocaleString()}c short. The stream keeps playing behind this.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
          {packs.map((p) => {
            const on = p.id === picked;
            // ⚠ A BADGE ON EVERY ROW SAYS NOTHING. With a 50c shortfall every
            // pack covers it, so “covers it” was noise on all eight. Badge only
            // the SMALLEST pack that clears the shortfall — that is the one
            // useful fact, and it is the row already preselected.
            const enough = p.id === best?.id && p.coins >= need;
            return (
              <button key={p.id} type="button" onClick={() => setPicked(p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 13px',
                borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                background: on ? C.purpleSoft : S.row, border: 'none',
                boxShadow: on ? C.selBar : 'none',
                color: C.text,
              }}>
                <CoinIcon size={16} />
                <span className="vg-mono" style={{ fontWeight: 800, fontSize: 14 }}>{p.coins.toLocaleString()}</span>
                {/* ⚠ THE ONLY LABEL IS WHETHER IT COVERS THE SHORTFALL. Anything
                    else here would be a value claim I am not authorised to make. */}
                {enough && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: C.purple, padding: '2px 7px', borderRadius: 6 }}>enough</span>}
                <span className="vg-mono" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800 }}>${Number(p.priceUSD).toFixed(2)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: S.row, color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Not now</button>
          <button onClick={onClose} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            {sel ? `Buy ${sel.coins.toLocaleString()}c · $${Number(sel.priceUSD).toFixed(2)}` : 'Buy coins'}
          </button>
        </div>
      </div>
    </div>
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
        style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 13.5, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
        {note.length}/500 · You can still watch the stream while this is reviewed.
      </div>
      {/* ⚠ 24x24 IS THE WCAG 2.2 AA TARGET MINIMUM (2.5.8) and this link measured
          197x20 — the only control in the whole preview under the floor, and it was
          one I had just added. A standalone block link gets no inline exception. */}
      <a href="/platform/acceptable-use" style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
        minHeight: 24, padding: '4px 2px',
        fontSize: 11.5, fontWeight: 700, color: C.purpleInk, textDecoration: 'none',
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

      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '2px 0 8px' }}>FORMAT</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[[false, 'videocam', 'Camera'], [true, 'graphic_eq', 'Audio only']].map(([v, icon, label]) => (
          <button key={label} type="button" onClick={() => onAudioOnly?.(v)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '11px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: !!audioOnly === v ? C.purple : S.row, border: 'none',
            color: !!audioOnly === v ? '#fff' : C.textDim,
          }}><Icon name={icon} size={16} /> {label}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16, lineHeight: 1.55 }}>
        Audio only still carries chat, tips and your goal. Use it for a podcast, or
        when you would rather not be on camera.
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '2px 0 8px' }}>WHO CAN WATCH</div>
      {WATCH.map(([id, label, note]) => (
        <button key={id} type="button" onClick={() => onGate?.(id)} style={{
          display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
          padding: '11px 12px', borderRadius: 10, cursor: 'pointer', color: C.text,
          background: gate === id ? C.purpleSoft : S.row, border: 'none',
          boxShadow: gate === id ? C.selBar : 'none',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700 }}>
            <Icon name={gate === id ? 'radio_button_checked' : 'radio_button_unchecked'} size={16} style={{ color: gate === id ? C.purpleLight : C.textMuted }} />
            {label}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 3, paddingLeft: 24, lineHeight: 1.5 }}>{note}</span>
        </button>
      ))}

      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '16px 0 8px' }}>WHO CAN CLIP</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {CLIP.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onClipWho?.(id)} style={{
            flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
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

// ── profile sheet — the on-stream UserQuickSheet ──────────────────────
function QuickSheet({ person, isHost, onClose, role = 'viewer', onAction }) {
  const faceOf = useFaces();
  const [following, setFollowing] = useState(false);
  if (!person) return null;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
          <UserAvatar src={faceOf(person)} size="lg" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>{person.displayName}</span>
              {isHost && <span style={{ width: 15, height: 15, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'grid', placeItems: 'center' }}><Icon name="check" size={9} /></span>}
            </div>
            <div style={{ fontSize: 12.5, color: C.textDim }}>@{person.username}</div>
            <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: C.purpleSoft, color: C.purpleInk, fontSize: 10.5, fontWeight: 800 }}>
              <Icon name="military_tech" size={11} /> LEVEL {person.vpLevel}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button onClick={() => setFollowing((v) => !v)} style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: following ? C.purpleSoft : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: following ? C.purpleLight : '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{following ? 'Following' : 'Follow'}</button>
          <button onClick={() => onAction?.('message', person)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: S.row, color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Message</button>
          <button aria-label="Close" onClick={onClose} style={{ width: 46, padding: 13, borderRadius: 12, border: 'none', background: S.row, color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="close" size={16} /></button>
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
          <div style={{ marginTop: 14, ...ruleTop, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ActionRow icon="redeem" label="Gift a sub" onClick={() => onAction?.('giftsub', person)} />
            <ActionRow icon="volunteer_activism" label="Send coins" onClick={() => onAction?.('tip', person)} />
            <ActionRow icon="flag" label="Report" danger onClick={() => onAction?.('report', person)} />
            <ActionRow icon="block" label="Block" danger onClick={() => onAction?.('block', person)} />

            {canModerate(role) && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '12px 0 4px' }}>MODERATION</div>
                <ActionRow icon="timer_off" label="Time out" onClick={() => onAction?.('timeout', person)} />
                <ActionRow icon="gavel" label="Ban from this stream" danger onClick={() => onAction?.('ban', person)} />
              </>
            )}
            {canConfigureChat(role) && (
              <ActionRow icon="shield_person" label={person.isMod ? 'Remove as moderator' : 'Make moderator'} onClick={() => onAction?.('appoint', person)} />
            )}
          </div>
        )}
      </div>
    </div>
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
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, height: '82%', display: 'flex', flexDirection: 'column', background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Icon name="group" size={18} style={{ color: C.purpleLight }} />
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>In this stream</div>
          <button aria-label="Close" onClick={onClose} style={{ ...iconBtn, width: 30, height: 30 }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 10px', padding: '9px 12px', borderRadius: 10, background: S.row, flexShrink: 0 }}>
          <Icon name="search" size={17} style={{ color: C.textMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search viewers"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 13.5 }} />
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
              display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
              padding: '9px 6px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: C.text,
            }}>
              <UserAvatar src={faceOf(c)} size="sm" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.displayName}
                  {c.sub && <span style={{ fontSize: 8.5, fontWeight: 800, padding: '1px 5px', borderRadius: 99, background: C.purple }}>SUB</span>}
                  {c.isMod && <span style={{ fontSize: 8.5, fontWeight: 800, padding: '1px 5px', borderRadius: 99, background: C.green, color: C.onGreen }}>MOD</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted }}>@{c.username} · Level {c.vpLevel}</div>
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
      </div>
    </div>
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
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', marginBottom: 6,
          padding: '12px 12px', borderRadius: 10, cursor: 'pointer', color: C.text, fontSize: 13.5,
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
        display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
        minHeight: 24, padding: '4px 2px',
        fontSize: 11.5, fontWeight: 700, color: C.purpleInk, textDecoration: 'none',
      }}>
        <Icon name="menu_book" size={13} /> Read the community guidelines
      </a>
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
          style={{ flex: 1, background: S.field, border: `1px solid ${C.fieldEdge}`, borderRadius: 10, padding: '11px 13px', color: C.text, fontSize: 13.5, outline: 'none' }} />
        <button onClick={add} style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: C.purple, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {words.map((w) => (
          <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px 7px 12px', borderRadius: 8, background: S.row, fontSize: 12.5 }}>
            {w}
            <button aria-label={`Remove ${w}`} onClick={() => setWords(words.filter((x) => x !== w))} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, minWidth: 24, minHeight: 24 }}><Icon name="close" size={14} /></button>
          </span>
        ))}
        {words.length === 0 && <span style={{ fontSize: 12.5, color: C.textMuted }}>No banned words. Chat is only filtered by the automatic scan.</span>}
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
          display: 'flex', gap: 10, width: '100%', textAlign: 'left', marginBottom: 6, padding: 11, borderRadius: 10, cursor: 'pointer',
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
      sub="They stay in the stream but cannot chat until it expires."
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
      cta={<div style={{ display: 'flex', gap: 9, marginTop: 4 }}>
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
      display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
      padding: '11px 8px', borderRadius: 10, border: 'none', background: 'transparent',
      color: danger ? C.red : C.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
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
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '72%', overflowY: 'auto', background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="leaderboard" size={18} style={{ color: '#F5C842' }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>Top supporters{hostName ? ` · ${hostName}` : ''}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {gifters.map((g, i) => (
            <div key={g.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: S.row }}>
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
      </div>
    </div>
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
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14 }}>
        <SheetBtn icon="fullscreen" label="Fullscreen" onClick={onClose} />
        <SheetBtn icon="flag" label="Report stream" danger onClick={onClose} />
      </div>
    </div>
  );
}

// ── share — StreamShareSheet.jsx ──────────────────────────────────────
function ShareSheet({ onClose }) {
  const rows = [['link', 'Copy link'], ['chat', 'Send in a message'], ['group', 'Share to a squad'], ['ios_share', 'More…']];
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, color: C.text }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>Share this stream</div>
        {rows.map(([ic, l]) => <SheetBtn key={l} icon={ic} label={l} onClick={onClose} />)}
      </div>
    </div>
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
        {t.popular && <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: C.purple, color: '#fff' }}>POPULAR</span>}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800 }}>
          <CoinIcon size={14} />{t.priceCoins}
          <span style={{ color: selected ? '#fff' : C.textMuted, fontWeight: 600 }}>/mo</span>
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: selected ? '#fff' : C.textDim, lineHeight: 1.6 }}>{t.perks.join(' · ')}</div>
    </button>
  );
}

function Sheet({ title, sub, onClose, children, cta }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      {/* ⚠ THE CTA MUST BE ON SCREEN. A bottom sheet that scrolls is fine to use
          and useless to SCREENSHOT — the first capture of this one had "Gift ·
          100 coins" below the fold. The header and the button are pinned; only
          the middle scrolls. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '92%', display: 'flex', flexDirection: 'column', background: C.card, boxShadow: C.sheetShadow, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, color: C.text }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: C.textDim, margin: '4px 0 14px' }}>{sub}</div>}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
        <div style={{ flexShrink: 0 }}>{cta}</div>
      </div>
    </div>
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
          <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>Someone in chat</div>
        </button>
        {CAST.slice(0, 6).map((p) => (
          <button key={p.uid} type="button" onClick={() => setTo(p.uid)} style={{
            flexShrink: 0, width: 74, padding: '10px 6px', borderRadius: 12, cursor: 'pointer', color: C.text,
            background: to === p.uid ? C.purpleSoft : S.row, border: 'none',
            boxShadow: to === p.uid ? C.selBar : 'none',
          }}>
            <UserAvatar src={faceOf(p)} size={34} />
            <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '6px 0 8px' }}>HOW MANY</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        {QTY.map((q) => (
          <button key={q} type="button" onClick={() => setQty(q)} style={{
            flex: 1, padding: '9px 6px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 800,
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
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    host.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('keydown', onKey);
      marked.forEach((el) => { el.inert = false; });
      // ⚠ PUT FOCUS BACK WHERE IT CAME FROM. Without this it falls to <body> and the
      // next Tab restarts at the top of the page.
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [onClose]);
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
  if (openSheet.kind === 'bannedwords') return <BannedWordsSheet onClose={onClose} />;
  if (openSheet.kind === 'pin') return <PinSheet messages={sim.messages} onClose={onClose} />;
  if (openSheet.kind === 'confirm') return <ConfirmSheet {...openSheet} onClose={onClose} />;
  if (openSheet.kind === 'profile') {
    return (
      <QuickSheet
        person={openSheet.uid === 'host' ? host : castByUid(openSheet.uid)}
        isHost={openSheet.uid === 'host'}
        role={role}
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
