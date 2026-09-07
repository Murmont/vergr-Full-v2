// The live-stream STATE LAYER: what the screen shows when it is not simply
// playing. Zero viewers, an empty chat, a blocked gate, a chat rule, spoken
// chat, a level-up, the VP a broadcaster earned.
//
// WHY THESE LIVE HERE AND NOT IN THE ADMIN PREVIEW.
// They were built in `/admin/stream-preview` because that is the only place
// they could be designed and captured without going live. That left the
// simulator AHEAD of production on every one of them: measured 2026-09-04,
// none of ZeroViewers, EmptyChat, the chat-state banners, the paywall gates or
// the VP chip existed in BroadcasterScreen, ViewerStreamScreen, MobileLiveViewer
// or ChatPanel. Moving them here inverts the dependency: the preview imports
// these, so a fix lands in both by construction.
//
// EVERY COMPONENT IN THIS FILE IS PURE. Props only, no context, no data
// fetching. That is what makes it safe for the preview and the real screens to
// share them, and it is deliberate: the five state components that DO read the
// simulator (PlaybackState, HealthWarning, ComposerPill, AudioStage,
// ModChannelSwitch) stay behind until their reads are lifted to props.
import { useState, useRef, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import Icon from '../../Icon';
import LevelUpCelebration from '../../engagement/LevelUpCelebration';
import { VP_ACTIONS, GIFT_COINS_PER_VP } from '../../../utils/vpSystem';
import { RANK_UNLOCKS } from '../../../utils/rankUnlocks';
import { TTS_UNLOCK_ID } from '../../../utils/streamTts';
import { StreamGoalBar } from '../StreamGoalAndAlerts';
import { S, C } from './tokens';

// The spoken-chat gate, imported rather than restated. canUseStreamTts() passes
// on level OR Pro (founder, 2026-08-26: "both, can be unlocked or by subscribing
// to pro"), so Pro-only copy hides the earned path, and hardcoding 92 would
// drift the day the ladder moves.
const TTS_LEVEL = RANK_UNLOCKS.find((u) => u.id === TTS_UNLOCK_ID)?.level;

// ⚠⚠ A FULL-BLEED STATE MUST CARRY ITS OWN WAY OUT, AND MUST NOT SIT UNDER THE DOCK.
// Measured on the deployed page 2026-09-03, on EVERY state built from this component:
// the host row, Viewers, More and Leave were all covered by this scrim, so the only
// control a viewer could reach was the one CTA — and on "Region blocked", which has no
// CTA by design, **nothing on the screen was reachable at all**. That is the audio-only
// defect again: a layer mounted so it buries the exit.
//
// ⚠ IT ALSO SAT AT z-7 WHILE THE DOCK IS z-8, so a live poll painted OVER the ended
// screen and covered "Watch the replay". A blocking layer has to be above the dock.
//
// ⚠ BLOCKING IS NOT THE DEFAULT FOR EVERY STATE, AND THE COPY DECIDES WHICH. "Host
// dropped" says *the stream is still open and this will pick up on its own*, and
// "offline" says *you will not lose your place in chat* — both promise the room is
// still there, so blocking chat and the exit contradicts the sentence on screen.
// Those two pass blocking={false} and behave like connecting/reconnecting, which
// already carry pointerEvents:'none'. Terminal and gated states stay blocking.
//
// ⚠ THE LEAVE CONTROL IS PARITY, NOT AN INVENTION. The shipped viewer passes
// onBack to the real StreamPaywall (MobileLiveViewer.jsx); this copy dropped it.
// ⚠ `onLeave` AND `onAction` ARE NOT OPTIONAL POLISH. This component draws the
// blocking states — subscriber gate, age gate, region block, ended, offline — and
// BOTH its buttons were dead: the X that is the only way out, and the CTA that is
// the only thing to do. A viewer who hits one of these had nowhere to go, which is
// the same defect wave 5 fixed for the region block and missed everywhere else.
export function Centred({ icon, title, body, action, onAction, onLeave, tone = C.purpleLight, spin = false, blocking = true }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: blocking ? 12 : 7, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 28, textAlign: 'center',
      background: 'rgba(6,6,14,0.78)', backdropFilter: 'blur(3px)',
      pointerEvents: blocking ? 'auto' : 'none',
    }}>
      {blocking && (
        <button type="button" aria-label="Leave stream" onClick={onLeave} style={{
          position: 'absolute', left: 12, top: 12, width: 40, height: 40, borderRadius: '50%',
          display: 'grid', placeItems: 'center', cursor: 'pointer', border: 'none',
          background: S.chipOnVideo, color: '#fff',
        }}><Icon name="arrow_back" size={20} /></button>
      )}
      <div style={{ maxWidth: 300, pointerEvents: 'auto' }}>
        {spin ? (
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-flex', color: tone }}>
            <Icon name={icon} size={34} />
          </motion.span>
        ) : <Icon name={icon} size={34} style={{ color: tone }} />}
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: '10px 0 6px' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.6 }}>{body}</div>
        {action && (
          <button type="button" onClick={onAction} style={{
            marginTop: 16, padding: '11px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff',
            fontSize: 13.5, fontWeight: 800,
          }}>{action}</button>
        )}
      </div>
    </div>
  );
}

// ⚠ `remaining` IS A PROP, NOT A LITERAL. The muted row used to read a
// hardcoded "4:32 left", which is correct in a simulator and a lie on a real
// screen. With no value it simply says you are timed out and omits the clock.
/**
 * What chat is doing to this viewer, shown above the composer.
 *
 * ⚠ A DISABLED INPUT WITH NO EXPLANATION IS THE WORST VERSION OF THIS. If
 * someone cannot type, the screen has to say why and what would change it —
 * otherwise it reads as broken and they leave.
 */
//
// ⚠ IT MUST CLEAR THE FLOATING LIKE BUTTON, AND MEASURING IS THE ONLY WAY THIS
// SHOWED UP. Every live viewer surface parks a 44-48px heart in the bottom-right
// of this exact band. The first version ran full-width underneath it, and
// elementFromPoint on the Follow CTA returned the heart: the one action that
// would lift followers-only chat was UNCLICKABLE. “Subscribe” only escaped
// because it is wider, so its centre point cleared the heart while its right
// edge did not.
//
// ⚠ THE DEFAULT RESERVES THE SPACE, so a call site that forgets the prop is
// still correct. Failing safe matters more here than a symmetric box.
/**
 * The composer, told what chat is doing to this viewer.
 *
 * THE BUG: chatState drove ChatStateBanner and NOTHING else, so the banner said
 * "You are banned from this chat" while the composer directly beneath it still
 * read "Add a comment...", with the full dock beside it. Two opposite claims in
 * one frame, and it would have gone into a store screenshot.
 *
 * IT READS THE SIM ITSELF instead of taking a prop. SoloDock has no chatState
 * and no prop for one, so threading it would have meant four call sites each
 * able to forget it. That exact class of miss already has a guard rule.
 *
 * SLOW MODE STAYS UNLOCKED on purpose: slow mode rate-limits you, it does not
 * stop you, so a disabled composer there would be a lie in the other direction.
 *
 * Locked text is #7E7E92, measured 4.85:1 on the #100C1C pill. Dimmer reads as
 * more disabled and fails the floor: #6B6B7E came out at 3.70:1.
 */
export const composerCopy = (state) => ({
  open:      { text: 'Add a comment…' },
  slow:      { text: 'Add a comment…' },
  followers: { text: 'Follow to chat', icon: 'group', locked: true },
  subs:      { text: 'Subscribe to chat', icon: 'star', locked: true },
  muted:     { text: 'You cannot chat while timed out', icon: 'volume_off', locked: true },
  banned:    { text: 'You cannot chat here', icon: 'block', locked: true },
}[state] || { text: 'Add a comment…' });

export function ChatStateBanner({ state = 'open', seconds = 5, reserveRight = 56, remaining = null, onAppeal, onOpenSheet }) {
  if (state === 'open') return null;
  const MAP = {
    slow: { icon: 'timer', tone: C.amber, text: `Slow mode is on. One message every ${seconds}s.` },
    followers: { icon: 'group', tone: C.purpleLight, text: 'Followers-only chat.', cta: 'Follow', go: () => onOpenSheet?.({ kind: 'profile', uid: 'host' }) },
    subs: { icon: 'star', tone: C.amber, text: 'Subscribers-only chat.', cta: 'Subscribe', go: () => onOpenSheet?.({ kind: 'subscribe' }) },
    muted: { icon: 'volume_off', tone: C.red, text: `You are timed out${remaining ? `, ${remaining} left` : ''}. You can still watch.`, cta: 'Appeal', appeal: 'timeout' },
    banned: { icon: 'block', tone: C.red, text: 'You are banned from this chat. You can still watch.', cta: 'Appeal', appeal: 'ban' },
  };
  const m = MAP[state] || MAP.slow;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10,
      background: S.panel, marginBottom: 6,
      paddingRight: 12 + reserveRight,
    }}>
      <Icon name={m.icon} size={15} style={{ color: m.tone, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 11.5, color: C.text, lineHeight: 1.4 }}>{m.text}</span>
      {/* ⚠ AN APPEAL CTA THAT GOES NOWHERE IS WORSE THAN NO APPEAL — it looks
          like a route out and is not one. A JSX comment is a CHILD, never an
          expression, so it cannot be the first thing inside {cond && (...)}. */}
      {/* ⚠⚠ THE COMMENT ABOVE WAS TRUE AND THE CODE DID NOT ENFORCE IT. `m.cta &&`
          renders the button whether or not a handler exists, so mounting this on a
          surface that passes neither onAppeal nor onOpenSheet drew exactly the dead
          route the note warns about. Now the CTA requires the handler it needs. */}
      {m.cta && (m.appeal ? !!onAppeal : !!onOpenSheet) && (
        <button type="button" onClick={m.appeal ? () => onAppeal(m.appeal) : m.go} style={{
          flexShrink: 0, padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: C.purple, color: '#fff', fontSize: 11, fontWeight: 800,
        }}>{m.cta}</button>
      )}
    </div>
  );
}

/**
 * Spoken chat (text-to-speech), as the VIEWER sees it.
 *
 * ⚠ TTS HAD TWO REFERENCES IN THE REAL VIEWERS AND ZERO IN THE PREVIEW, so a
 * feature that reads strangers’ words aloud in someone’s ears could not be
 * designed, reviewed or captured at all.
 *
 * ⚠ MUTE IS MANDATORY, NOT POLISH — ChatPanel.jsx:518 says so and it is right.
 * The one thing this strip must always offer is a way to make it stop, in one
 * tap, without hunting through a menu.
 *
 * ⚠ "NEEDS A TAP" IS A REAL STATE, NOT AN EDGE CASE. Web Speech is autoplay-
 * gated and fails SILENTLY (streamTts.js:42, measured on the live site): with
 * no prior gesture, speak() errors and nothing happens. Without this strip the
 * viewer just thinks the feature is broken.
 *
 * ⚠ NOTHING IS EVER SPOKEN HERE. This is a capture tool; a screenshot session
 * that starts talking is a defect. Visual only, deliberately.
 */
export function TtsStrip({ state = 'off', onOpenSheet }) {
  if (state === 'off') return null;
  const MAP = {
    on:      { icon: 'volume_up',  tone: C.textDim, text: 'Mute spoken messages' },
    muted:   { icon: 'volume_off', tone: C.red,     text: 'Spoken messages muted' },
    gesture: { icon: 'touch_app',  tone: C.amber,   text: 'Tap to hear spoken messages' },
    // THE OLD COPY SAID "Spoken chat is a Pro feature" AND THAT IS ONLY HALF TRUE.
    // canUseStreamTts() passes on level OR Pro, so telling a free viewer it is a
    // Pro feature hides the earned path entirely and turns a ladder reward into a
    // pure paywall. Same class as the tier claims the 2026-08-19 audit deleted,
    // in the opposite direction: this one UNDERSELLS what the product gives away.
    locked:  { icon: 'lock', tone: C.amber, text: `Spoken chat unlocks at level ${TTS_LEVEL}, or with Pro`, cta: 'Upgrade' },
  };
  const m = MAP[state] || MAP.on;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 9,
      background: state === 'muted' ? S.dangerDim : S.chipOnVideo,
      marginBottom: 6, width: 'fit-content', maxWidth: '100%',
    }}>
      <Icon name={m.icon} size={14} style={{ color: m.tone, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: m.tone }}>{m.text}</span>
      {m.cta && (
        <button type="button" onClick={() => onOpenSheet?.({ kind: 'confirm', title: 'Upgrade to Pro?',
          body: `Spoken chat reads messages aloud while you play. You earn it at level ${TTS_LEVEL}, or get it straight away with Pro.`, confirmLabel: 'See plans' })} style={{
          // ⚠ 24px MINIMUM HEIGHT. It measured 62x22, two pixels under the WCAG 2.2
          // AA target floor, and it is the ONLY way out of this banner — the button
          // that sells the upgrade should not be the hardest thing on screen to hit.
          // Padding alone left it short, so the floor is stated.
          minHeight: 24, padding: '3px 9px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: C.purple, color: '#fff', fontSize: 10.5, fontWeight: 800,
        }}>{m.cta}</button>
      )}
    </div>
  );
}

/**
 * Zero viewers — the first twenty minutes of every new creator’s life.
 *
 * ⚠ THIS IS THE MOST IMPORTANT SCREEN IN THE PRODUCT AND NEITHER THE PREVIEW
 * NOR THE REAL BROADCASTER HAD IT. Measured: with the viewer count at 0 the
 * shipped screen renders the digit "0" beside an eye icon and nothing else.
 * Every new creator sees this, and what it says decides whether they ever
 * stream a second time.
 *
 * ⚠ IT MUST OFFER WORK TO DO, NOT REASSURANCE. "Hang in there" is worthless.
 * Share, invite and boost are the three things that actually change the number,
 * and they are the three things on it.
 *
 * ⚠ IT NEVER SAYS THE STREAM IS FAILING. A host reading "nobody is watching"
 * ends the stream. The framing is early, not empty.
 */
export function ZeroViewers({ onShare, onInvite, onBoost, compact = false }) {
  // ⚠ AN ACTION WITHOUT A HANDLER IS NOT RENDERED. All three used to draw
  // whether or not the surface could do them, so mounting this anywhere that has
  // no boost entry point produced a button that did nothing. Same dead-control
  // shape as the appeal CTA and the offline Leave. The card still works with one
  // action; it is the three things that change the number, not a fixed set.
  const acts = [
    ['Share the link', 'ios_share', onShare],
    ['Invite a friend', 'group_add', onInvite],
    ['Boost this stream', 'rocket_launch', onBoost],
  ].filter(([, , fn]) => typeof fn === 'function');
  return (
    <div style={{
      background: S.panel, borderRadius: 14,
      padding: compact ? 12 : 16, backdropFilter: 'blur(4px)',
      // ⚠ THE BAND THAT HOLDS THIS PASSES TAPS THROUGH, so anything with buttons
      // inside it has to opt back in or its actions become decorative.
      pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="sensors" size={17} style={{ color: C.purpleLight }} />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>You are live and early</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.55, marginBottom: 12 }}>
        Nobody has found the stream yet. These are the three things that change that.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {acts.map(([label, icon, fn]) => (
          <button key={label} type="button" onClick={fn} style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '10px 12px',
            borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left',
            background: S.row, color: C.text, fontSize: 12.5, fontWeight: 700,
          }}>
            <Icon name={icon} size={16} style={{ color: C.purpleLight }} />
            <span style={{ flex: 1 }}>{label}</span>
            <Icon name="chevron_right" size={16} style={{ color: C.textMuted }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Empty chat.
 *
 * ⚠ AN EMPTY CHAT WITH NOTHING IN IT READS AS BROKEN, not as quiet, and it is
 * the default state of every stream for its first minutes. It has to name the
 * one action that fixes it rather than apologising for being empty.
 */
export function EmptyChat({ isHost = false }) {
  return (
    <div style={{ padding: '14px 12px', textAlign: 'center' }}>
      <Icon name="forum" size={22} style={{ color: C.textMuted }} />
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginTop: 7 }}>
        {isHost ? 'Chat is quiet so far' : 'No messages yet'}
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3, lineHeight: 1.5 }}>
        {isHost ? 'Ask a question on camera. It is the fastest way to start one.' : 'Say hi and get the conversation going.'}
      </div>
    </div>
  );
}

/**
 * What this viewer has earned by being here.
 *
 * ⚠ VERGR ALREADY PAYS VP FOR WATCHING AND FOR TIPPING, AND THE STREAM NEVER
 * SAID SO. `watch_stream_hour` and `GIFT_COINS_PER_VP` are live server-side, so
 * the reward is being spent whether or not anyone is told — which is the worst
 * of both: the cost with none of the loop.
 *
 * ⚠ EVERY NUMBER IS READ FROM `vpSystem`, NEVER TYPED. The rate is a locked
 * economy value; a preview showing a rate Vergr does not pay would put a promise
 * on a screenshot that the server will not keep.
 */
// ⚠ THE HOST EARNS VP TOO, AND THE BROADCASTER HAD NO CHIP AT ALL. `go_live`
// (30, once) and `stream_hour` (20 per whole hour) are paid server-side exactly
// like the viewer rates, so leaving the host out meant the one person whose
// reward is largest could not see it. Found by the final sweep, not by design.
export function VpEarnedChip({ minutes = 0, coinsTipped = 0, onOpen, host = false }) {
  const watched = host
    ? VP_ACTIONS.go_live + Math.floor(minutes / 60) * VP_ACTIONS.stream_hour
    : Math.floor((minutes / 60) * VP_ACTIONS.watch_stream_hour);
  const gifted = host ? 0 : Math.floor(coinsTipped / GIFT_COINS_PER_VP);
  const total = watched + gifted;
  if (total <= 0) return null;
  // ⚠ NO HANDLER, NO BUTTON. The chip is informational, and a surface that has
  // nowhere useful to send someone should render a plain element rather than a
  // button that does nothing. Same rule the appeal CTA, the offline Leave and the
  // zero-viewer actions now follow.
  const Tag = onOpen ? 'button' : 'span';
  return (
    <Tag type={onOpen ? 'button' : undefined} onClick={onOpen} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
      // ⚠ NO HAIRLINE RING ON A SOLID FILL. The fill already separates it from the
      // video; a 1px stroke on top is the border-soup the founder calls cheap, and
      // at 0.4 alpha it is the wash pattern in another costume.
      borderRadius: 8, border: 'none', cursor: onOpen ? 'pointer' : 'default',
      // ⚠ THE ROW ABOVE IS `pointerEvents: 'none'` BECAUSE IT IS A FULL-WIDTH
      // INVISIBLE BAR. Measured 2026-09-02: its empty half sat over the chat and
      // swallowed taps on avatars and rank crests — nothing looked wrong, the
      // targets simply did not respond. The chips opt back in individually.
      pointerEvents: 'auto',
      background: S.chipOnVideo, color: C.text, fontSize: 11, fontWeight: 800,
    }}>
      <Icon name="bolt" size={13} style={{ color: C.purpleLight }} />
      <span className="vg-mono">+{total}</span>
      <span style={{ color: C.textDim, fontWeight: 700 }}>VP this stream</span>
    </Tag>
  );
}

/**
 * Levelling up while you watch.
 *
 * ⚠ THE SHIPPED COMPONENT, IMPORTED. `LevelUpCelebration` is prop-only and is
 * already what the app fires; re-drawing it here would guarantee the capture
 * and the product drift apart.
 */
/**
 * ⚠⚠ THE CELEBRATION IS `position: fixed`, WHICH ESCAPES A SIMULATED DEVICE.
 * `LevelUpCelebration` is the real shipped component and it is correct as written:
 * `fixed inset-0` means "the phone screen" on a real phone. Inside the simulator it
 * resolves against the BROWSER VIEWPORT instead, so it rendered 2043x915 — centred on
 * the whole admin page, spilling 777px past the left of the frame and 873px past the
 * right, dimming the admin sidebar with it. The one screen that exists to be captured
 * could not be captured.
 *
 * A transform on an ancestor makes it the containing block for `fixed` descendants, so
 * this wrapper is what puts the celebration back inside the phone. It is the ONLY
 * fixed-position descendant in the whole preview (measured), so the wrapper is scoped
 * here rather than put on the frame, where a transform would also change how the
 * landscape stage and every scrollWidth measurement behave.
 *
 * ⚠ DO NOT "FIX" THIS BY EDITING LevelUpCelebration. It is right for production; it
 * is this mount point that differs — the same reasoning as the PlaybackState wrapper.
 */
export function PreviewLevelUp({ show, level = 63, tierName = 'Mythic', onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0)', pointerEvents: show ? 'auto' : 'none' }}>
      <LevelUpCelebration show={show} level={level} tierName={tierName} onClose={onClose} />
    </div>
  );
}

/**
 * The paywall — a stream you are not entitled to watch.
 *
 * ⚠ `functions/entitlements.js` SUPPORTS PAID AND SUBSCRIBER-ONLY STREAMS and
 * the preview had one reference to any of it against 13 in the real viewer. A
 * creator cannot see what their own paid stream looks like to someone who has
 * not paid, which is the one view that decides whether they price it at all.
 */
export function StreamPaywall({ kind = 'subs', hostName, priceCoins = 100, onOpenSheet }) {
  const leave = () => onOpenSheet?.({ kind: 'confirm', title: 'Leave this stream?',
    body: 'You can come back any time while the broadcaster is still live.', confirmLabel: 'Leave' });
  // ⚠ A BLOCK IS NOT A PAYWALL AND MUST NEVER LOOK LIKE ONE. There is nothing
  // to buy here, so offering a purchase would be a lie. Region and age blocks
  // say what happened, why, and the only real next step — which for a region
  // block is nothing, and for an age block is verifying your age.
  if (kind === 'region') {
    return <Centred icon="public_off" tone={C.textDim} onLeave={leave}
      title="Not available in your region"
      body="This stream cannot be shown where you are. That is a restriction on this stream, not on your account. Everything else on Vergr still works." />;
  }
  if (kind === 'age') {
    return <Centred icon="shield_person" tone={C.amber} onLeave={leave}
      onAction={() => onOpenSheet?.({ kind: 'confirm', title: 'Verify your age?',
        body: 'Verification happens once and applies everywhere on Vergr.', confirmLabel: 'Verify my age' })}
      title="For verified adults"
      body="The creator marked this stream 18+. Verify your age once and it applies everywhere on Vergr."
      action="Verify my age" />;
  }
  const subs = kind === 'subs';
  return (
    <Centred
      icon={subs ? 'star' : 'lock'}
      tone={C.amber}
      onLeave={leave}
      onAction={() => (subs
        ? onOpenSheet?.({ kind: 'subscribe' })
        : onOpenSheet?.({ kind: 'confirm', title: `Unlock this stream for ${priceCoins}c?`,
          body: 'You keep access afterwards, including the replay.', confirmLabel: `Unlock for ${priceCoins}c` }))}
      title={subs ? `Subscribers only` : 'Ticketed stream'}
      body={subs
        ? `${hostName || 'This creator'} is streaming for subscribers. Join to watch this and every subscriber stream.`
        : `${hostName || 'This creator'} set a one-off price for this stream. Pay once and you keep access, including the replay.`}
      action={subs ? 'Subscribe' : `Unlock for ${priceCoins}c`}
    />
  );
}

export function ReconnectingOverlay() {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 999, background: '#12121E', border: 'none', color: C.text, fontSize: 13, fontWeight: 700 }}>
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-flex' }}><Icon name="progress_activity" size={16} /></motion.span>
        Reconnecting…
      </div>
    </div>
  );
}
// Blurred-frame loading cover (TikTok-style): the stream's own thumbnail,
// blurred + dark, with a spinner — shown until the first real frame paints.
// No z-index: DOM order keeps it above the <video> and below the top-bar chrome
// (so Close stays tappable). Purely visual (pointerEvents none).
export function StreamLoadingCover({ thumb, visible }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0a14',
      opacity: visible ? 1 : 0, pointerEvents: 'none',
      transition: 'opacity 0.45s ease',
    }}>
      {thumb && (
        <img src={thumb} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', filter: 'blur(30px) brightness(0.5)', transform: 'scale(1.25)',
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 42%, rgba(124,58,237,0.28), rgba(10,10,20,0.82) 68%)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <motion.div
          animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          style={{ width: 42, height: 42, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.16)', borderTopColor: '#fff' }}
        />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.92)' }}>
          <motion.span
            animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.1, repeat: Infinity }}
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2d4f', boxShadow: '0 0 9px #ff2d4f' }}
          />
          GOING LIVE
        </div>
      </div>
    </div>
  );
}
// ComboMeter now lives in ./ComboMeter so the stream simulator can render the
// same bar. One definition, imported by both.


// ⚠ onLeave IS EXPLICIT. `leave` used to be defined unconditionally and only ever
// opened a sheet, so a surface passing no onOpenSheet still drew a Leave button that
// did nothing. A real screen has a real leave (the viewer's own close) and passes it;
// a surface with neither now renders no button at all.
export function PlaybackStateView({ state = 'live', hostName, onOpenSheet, onRetry, onLeave }) {
  // ⚠ EACH ACTION OPENS THE SHEET THAT ACTION REALLY LEADS TO. "Try again" is the
  // exception: recovery is not a sheet, it is the state clearing, so it clears it.
  const leave = onLeave
    || (onOpenSheet ? () => onOpenSheet({ kind: 'confirm', title: 'Leave this stream?',
      body: 'You can come back any time while the broadcaster is still live.', confirmLabel: 'Leave' })
      : undefined);
  if (state === 'live') return null;
  // ⚠ THE TWO IMPORTED OVERLAYS NEED A STACKING LAYER HERE, AND MEASURING IS
  // THE ONLY WAY THIS SHOWED UP. In the real viewer both are mounted INSIDE the
  // video box, so covering the video is all they have to do and chat correctly
  // sits above them. The preview mounts them at FRAME level, where
  // StreamLoadingCover’s `z-index: auto` loses to the chat (2-3) and the dock
  // (6): measured 393x852, exactly the frame, and elementFromPoint at its
  // centre returned something else entirely. It filled the screen and was
  // invisible.
  //
  // ⚠ DO NOT “FIX” THIS BY EDITING THE SHIPPED COMPONENTS. They are correct
  // where they live; it is this mount point that differs. Wrapping keeps them
  // imported read-only, which is the whole reason they are imported.
  if (state === 'connecting' || state === 'reconnecting') {
    return (
      // ⚠ z5, NOT z7. MEASURED LAYER MAP OF THIS FRAME:
      //   video (auto) < cover < header 6 < chat 8 < dock 9/10
      // z7 cleared the video AND the header, so the Connecting state painted an
      // opaque #0a0a14 over the whole 244x528 frame and the viewer had NO VISIBLE
      // WAY OUT: a zoom of the header strip was solid black, while the Leave button
      // still sat under it at (1087,123).
      //
      // ⚠⚠ AND THE HIT TEST SAID IT WAS FINE. StreamLoadingCover carries
      // pointerEvents:'none', so elementFromPoint SKIPS it and returns the button
      // underneath. Every reachability probe reported Leave reachable:true in all
      // five playback states. HIT-TESTING PROVES CLICKABILITY, NEVER VISIBILITY.
      // Only rendering the strip found this.
      //
      // Production is correct and is what z5 restores: in MobileLiveViewer the cover
      // is mounted INSIDE the video box and the top bar is a LATER SIBLING, so the
      // chrome always paints above it.
      <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
        {state === 'connecting' ? <StreamLoadingCover visible /> : <ReconnectingOverlay />}
      </div>
    );
  }
  if (state === 'hostdropped') {
    return <Centred icon="cloud_off" tone={C.amber} spin blocking={false}
      title={`${hostName || 'The streamer'} dropped out`}
      body="Their connection went. The stream is still open and this will pick up on its own the moment they are back." />;
  }
  if (state === 'ended') {
    return <Centred icon="check_circle" tone={C.purpleLight} onLeave={leave}
      onAction={() => onOpenSheet?.({ kind: 'confirm', title: 'Watch the replay?',
        body: 'The replay opens from the start. Chat from the live show is replayed with it.', confirmLabel: 'Watch replay' })}
      title="The stream has ended"
      body="Thanks for watching. The replay will be here shortly, and you can follow to know when they go live again."
      action="Watch the replay" />;
  }
  // offline
  return <Centred icon="wifi_off" tone={C.red} spin={false} blocking={false} onLeave={leave}
    onAction={onRetry}
    title="You are offline"
    body="Check your connection. Playback will resume by itself when you are back. You will not lose your place in chat."
    action="Try again" />;
}

// ⚠⚠ THE COPY IS OVERRIDABLE, AND THAT IS WHAT MADE THIS PORTABLE. The real
// broadcaster's only health signal is the uplink probe capping the bitrate, and it
// already says the true thing: "Quality lowered to keep you live". The card's
// built-in unstable copy says the OPPOSITE kind of thing ("switch to a lower
// quality") because in the simulator nothing has happened yet. Shipping the card
// with its own wording would have replaced an accurate message with an inaccurate
// one, which is a worse product and exactly what "never delete what is there"
// exists to prevent.
//
// So a surface may pass its own title, body and action. The defaults stay for the
// simulator and for any surface that has the generic signal.
export function HealthWarningView({ state = 'ok', onRecover, title, body, action }) {
  // recovery clears the warning, which is what both buttons really do
  if (state === 'ok') return null;
  const lost = state === 'lost';
  return (
    <div style={{
      // ⚠ See ZeroViewers: the floating status band is pointerEvents:'none'.
      pointerEvents: 'auto',
      display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10,
      // ⚠ AN 18% TINT OVER LIVE GAMEPLAY IS UNREADABLE, and this shipped that
      // way for one render. Measured on the co-host layout: the warning text ran
      // straight through the video and the “KILL CONFIRMED” graphic behind it.
      // Semi-transparent colour over a busy, saturated background averages to
      // mud — the same lesson `.vg-bloom` and the store art already record.
      // The base is OPAQUE and near-black; the tone is the border and the icon,
      // never the fill. `ZeroViewers` directly below it was legible for exactly
      // this reason and is what the comparison made obvious.
      background: S.panel,
      backdropFilter: 'blur(4px)',
      border: `1px solid ${lost ? 'rgba(239,68,68,0.55)' : 'rgba(245,158,11,0.5)'}`,
      boxShadow: `inset 3px 0 0 ${lost ? C.red : C.amber}`,
      marginBottom: 8,
    }}>
      <Icon name={lost ? 'cloud_off' : 'network_check'} size={16} style={{ color: lost ? C.red : C.amber, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.text }}>
          {title || (lost ? 'You are offline' : 'Your connection is struggling')}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.45 }}>
          {body || (lost
            ? 'Viewers can no longer see you. The stream stays open for 2 minutes. Reconnect and you keep your audience.'
            : 'Dropping frames. Close other uploads, or switch to a lower quality and stay on.')}
        </div>
      </div>
      {/* ⚠ NO HANDLER, NO BUTTON. A surface whose warning is purely informational
          (the system already acted) must not draw an action that does nothing. */}
      {onRecover && (
      <button type="button" onClick={onRecover} style={{
        flexShrink: 0, padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
        background: lost ? C.redFill : S.row, color: '#fff', fontSize: 11, fontWeight: 800,
      }}>{action || (lost ? 'Reconnect' : 'Lower quality')}</button>
      )}
    </div>
  );
}

/**
 * The tip goal, placed by the BROADCASTER. Founder instruction, given twice:
 * "the broadcaster should be able to move the tip bar and resize it".
 *
 * ⚠ THE DEFAULT POSITION IS NOT THE POINT — THE CONTROL IS. A fixed spot cannot suit
 * every framing: a face-cam fills the middle, a gameplay capture has its HUD in the
 * corners. Measured before this existed, the bar covered the subject band by 9,704px
 * on the split viewer and 6,872px on landscape.
 *
 * ⚠ VIEWERS SEE WHERE THE BROADCASTER PUT IT. Same `box` from the sim on every surface,
 * so this is one decision, not six independent placements that drift.
 */
// ⚠ `fallback` IS THE SURFACE'S OWN SHAPE-APPROPRIATE DEFAULT, used only until the
// broadcaster places the bar. Measured: header chrome ends at 4.7% of a full-bleed
// portrait stage and the subject band starts at 15%, so 7% is the clear strip there;
// a 16:9 desktop stage has its badges top-left and its player controls at the bottom,
// so its clear strip is different. A single constant is wrong for both.
export function MovableGoal({ goal, box, onChange, editable = false, compact = true, editing = false,
  fallback = { xPct: 3, yPct: 7, wPct: 64 } }) {
  const ref = useRef(null);
  const drag = useRef(null);

  // ⚠⚠ THE DEFAULT MEASURES ITS OWN FLOOR. A FIXED yPct CANNOT BE CORRECT HERE.
  //
  // The chrome above the goal is a FLOW COLUMN whose height depends on state. The
  // VP chip row sits at 8% normally and at 18.5-21.8% once the broadcast-health
  // card appears above it, because the card pushes it down. So a constant that
  // clears the column in one state collides in another, and this number was moved
  // twice before that became obvious:
  //   yPct 14 -> health card covered 80% of the goal
  //   yPct 20 -> cleared health, then overlapped the pushed-down VP row by 37%
  //
  // Now the fallback is a MINIMUM and the real floor is measured: find the top
  // chrome actually on screen and sit below the lowest of it. Self-correcting, so
  // new chrome cannot reintroduce this, and it is the whole reason a third
  // hardcoded number was not simply picked.
  //
  // ⚠ IT ONLY EVER MOVES THE DEFAULT. Once the broadcaster drags the goal, `box`
  // is set and their placement wins outright, including on top of the chrome.
  const [floorPct, setFloorPct] = useState(0);
  useLayoutEffect(() => {
    if (box) { if (floorPct !== 0) setFloorPct(0); return; }
    const el = ref.current; const stageEl = el && el.offsetParent;
    if (!stageEl) return;
    const sr = stageEl.getBoundingClientRect();
    if (!sr.height) return;
    let low = 0;
    stageEl.querySelectorAll('*').forEach((n) => {
      if (n === el || el.contains(n) || n.contains(el)) return;
      const cs = getComputedStyle(n);
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') return;
      const r = n.getBoundingClientRect();
      if (!r.height || r.width < sr.width * 0.2) return;
      const topPct = ((r.y - sr.y) / sr.height) * 100;
      const botPct = ((r.bottom - sr.y) / sr.height) * 100;
      // TOP CHROME ONLY, and never a BACKGROUND. A full-stage video or scrim has
      // topPct 0 and would otherwise report a floor of 100 and shove the goal
      // off the bottom of the stage.
      if (topPct < 0 || topPct > 45) return;
      if (botPct - topPct > 25) return;
      if (botPct > low) low = botPct;
    });
    const next = Math.min(45, low);
    if (Math.abs(next - floorPct) > 0.2) setFloorPct(next);
  });

  if (!goal?.active) return null;
  const base = box || fallback;
  // the measured floor only ever pushes the DEFAULT down, never up, and never a
  // placement the broadcaster chose themselves.
  const b = box ? base : { ...base, yPct: Math.max(base.yPct, floorPct + 1.5) };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const stage = () => (ref.current?.offsetParent || ref.current?.parentElement)?.getBoundingClientRect();

  const onDown = (e, mode) => {
    if (!editable || !editing) return;
    e.preventDefault(); e.stopPropagation();
    const s = stage(); if (!s) return;
    drag.current = { mode, sx: e.clientX, sy: e.clientY, box: { ...b }, w: s.width, h: s.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dxPct = ((e.clientX - d.sx) / d.w) * 100;
    const dyPct = ((e.clientY - d.sy) / d.h) * 100;
    if (d.mode === "move") {
      onChange({ ...b, xPct: clamp(d.box.xPct + dxPct, 0, 100 - b.wPct),
        yPct: clamp(d.box.yPct + dyPct, 0, 96) });
    } else {
      // ⚠ FLOOR AND CEILING BOTH MATTER: below ~28% the label and the figures collide,
      // and past the stage edge it clips. Resizing must not be able to break the bar.
      const w = clamp(d.box.wPct + dxPct, 28, 100 - b.xPct);
      onChange({ ...b, wPct: w });
    }
  };
  const onUp = () => { drag.current = null; };

  return (
    <div ref={ref} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: "absolute", left: b.xPct + "%", top: b.yPct + "%",
        width: b.wPct + "%", zIndex: 6, touchAction: "none" }}>
      <div onPointerDown={(e) => onDown(e, "move")}
        style={{ cursor: editable && editing ? "grab" : "default" }}>
        <StreamGoalBar goal={goal} compact={compact} />
      </div>
      {editable && editing && (
        <>
          {/* ⚠ A 24x24 HANDLE, NOT A HAIRLINE CORNER. It is a real control and takes the
              same tap-target floor as every other one on these surfaces. */}
          <button type="button" aria-label="Resize the tip goal"
            onPointerDown={(e) => onDown(e, "size")}
            style={{ position: "absolute", right: -10, bottom: -10, width: 24, height: 24,
              borderRadius: "50%", border: "none", background: "#7c3aed", color: "#fff",
              display: "grid", placeItems: "center", cursor: "ew-resize", touchAction: "none" }}>
            <Icon name="drag_indicator" size={13} />
          </button>
          {/* ⚠ THERE WAS NO WAY BACK, AND THAT BIT DURING THIS VERY AUDIT. The box is
              SHARED across every surface by design, so one bad drag follows the broadcaster
              everywhere with no undo. An accidental drag during automated clicking left it
              at left 70.2% / width 28% — 28% is the resize clamp FLOOR — on every screen,
              and nothing in the UI could restore the default. A placement control needs a
              reset; passing null puts every surface back on its own measured fallback. */}
          <button type="button" aria-label="Reset the tip goal to its default place"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            style={{ position: "absolute", right: -10, top: -10, width: 24, height: 24,
              borderRadius: "50%", border: "none", background: "#1A1A2A", color: "#fff",
              display: "grid", placeItems: "center", cursor: "pointer" }}>
            <Icon name="restart_alt" size={13} />
          </button>
          <span style={{ position: "absolute", left: 0, top: -16, fontSize: 9.5, fontWeight: 800,
            letterSpacing: "0.06em", color: "#8E8EA0" }}>DRAG TO PLACE</span>
        </>
      )}
    </div>
  );
}

export function AudioStageView({ avatar, hostName, title, live = true, z = 4 }) {
  // A fixed, irregular bar pattern — a regular one reads as a loading spinner
  // rather than sound. 13 bars is enough to look like level, few enough to stay
  // legible at phone width.
  const BARS = [0.35, 0.62, 0.28, 0.85, 0.48, 0.95, 0.4, 0.72, 0.3, 0.88, 0.52, 0.66, 0.38];
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: z, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
      background: 'radial-gradient(circle at 50% 38%, #241548 0%, #0b0b14 68%)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px',
        borderRadius: 8, background: C.purple,
        fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', color: '#fff',
      }}>
        <Icon name="graphic_eq" size={12} /> AUDIO ONLY
      </span>

      <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        {/* the ring is the only thing that says "still live" when nobody is talking */}
        <motion.span
          animate={{ scale: [1, 1.13, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
          style={{ position: 'absolute', width: 104, height: 104, borderRadius: '50%', border: `2px solid ${C.purpleLight}` }}
        />
        {avatar
          ? <img src={avatar} alt="" style={{ width: 92, height: 92, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${C.purpleLight}` }} />
          : <span style={{ width: 92, height: 92, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#1a1030', border: `2px solid ${C.purpleLight}` }}>
              <Icon name="podcasts" size={38} style={{ color: C.purpleLight }} />
            </span>}
      </div>

      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{hostName || 'Live'}</div>
        {title && <div dir="auto" style={{ fontSize: 12.5, color: C.textDim, marginTop: 3, maxWidth: 260 }}>{title}</div>}
      </div>

      {/* ⚠ THE METER IS THE PROOF OF LIFE. Without it the screen is indistinguishable
          from a stalled video, which is the exact confusion this whole component
          exists to prevent. It stops when the stream is not live. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 26 }}>
        {BARS.map((h, i) => (
          <motion.span key={i}
            animate={live ? { scaleY: [h, Math.min(1, h + 0.45), h * 0.7, h] } : { scaleY: h }}
            transition={live ? { duration: 1.1 + (i % 4) * 0.23, repeat: Infinity, ease: 'easeInOut' } : undefined}
            style={{
              width: 3, height: 26, borderRadius: 2, transformOrigin: 'bottom',
              background: `linear-gradient(180deg, ${C.purpleLight}, ${C.purple})`,
            }} />
        ))}
      </div>

      {/* ⚠ REDUCED MOTION HAS TWO SWITCHES IN THIS APP and a media query only
          catches one; index.css answers the settings toggle by fast-forwarding an
          animation to its LAST keyframe, which for these bars is their resting
          height — so the meter degrades to a static level rather than vanishing. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .vg-audio-stage * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── HYPE TRAIN ──────────────────────────────────────────────────────────────
//
// The PURE renderer, shared by the real stream surfaces and the admin
// simulator, so the design cannot drift between what the founder reviews and
// what a viewer sees. The preview's own `HypeTrain` is a thin wrapper that
// reads the sim and calls this.
//
// ⚠⚠ IT READS ONLY WHAT THE STREAM DOC CARRIES. `topName` and `topAvatar` are
// denormalised by the server in `sendTip`, which had already loaded them for
// the tip alert. Resolving the leader here instead would be a Firestore read
// per rider, per viewer, per train.
//
// ⚠ THE CONDUCTOR IS THE FEATURE, NOT THE BAR. The first version showed grey
// silhouettes and "5 on board", which is a count, not a story. Twitch names the
// person carrying it, so the leader is ringed in gold and named.
//
// ⚠ THE BAR CARRIES ITS OWN FIGURES. A progress bar with no numbers is a mood.
// "9,800 / 22,646" is what tells somebody whether one more tip finishes a level,
// which is the entire decision the train is asking them to make.
//
// ⚠ THE CLOCK ESCALATES BY COLOUR, NOT BY MOTION. There are two reduced-motion
// switches in this app and the CSS one FAST-FORWARDS an animation to its final
// keyframe rather than stopping it, so a pulsing timer is invisible for anyone
// who set it. Colour and weight cannot fail that way.
//
// ⚠ IT RIDES `hypeTrain`, NOT `streams/{id}.hype`. That field is a
// reactions-per-5-seconds meter (functions/streamHype.js). Two systems on one
// word is how the theme system died.
const TRAIN_GOLD = 'linear-gradient(180deg, #FCEFB4 0%, #F5C842 38%, #E9A517 72%, #C97F12 100%)';
const TRAIN_HEAT = ['#8b3ff0', '#a34cf5', '#b44fff', '#c87fff', '#f0a500'];
const trainClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function HypeTrainView({ train, style }) {
  if (!train || !train.received) return null;
  const { level = 1, into = 0, goal = 1, maxLevel = 5, endsAtMs = 0 } = train;
  const capped = level >= maxLevel;
  const pct = capped ? 100 : Math.max(3, Math.min(100, Math.round((into / goal) * 100)));
  const left = Math.max(0, Math.round((endsAtMs - Date.now()) / 1000));
  const hot = TRAIN_HEAT[Math.min(level, TRAIN_HEAT.length) - 1];
  const urgent = !capped && left <= 30;
  const warm = !capped && left <= 60;
  const others = Math.max(0, (train.riderCount || 0) - 1);

  return (
    <div className="vg-material vg-grain" style={{
      position: 'absolute', left: 10, right: 10, top: 56, zIndex: 26,
      padding: 10, borderRadius: 16, pointerEvents: 'none', overflow: 'hidden',
      boxShadow: capped
        ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 8px 26px rgba(240,165,0,0.34)'
        : `inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 22px ${hot}33`,
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 9px', borderRadius: 999,
          background: capped ? TRAIN_GOLD : `linear-gradient(180deg, ${hot}, ${hot}cc)`,
          fontSize: 11, fontWeight: 900, letterSpacing: '0.02em',
          color: capped ? '#241a05' : '#fff',
          boxShadow: capped ? '0 2px 10px rgba(240,165,0,0.5)' : 'none',
        }}>
          <Icon name="local_fire_department" size={12} />
          {capped ? 'MAX' : `LV ${level}`}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: '#e8e8f0' }}>
          {capped ? 'Hype train at full' : 'Hype train'}
        </span>
        <span className="vg-mono" style={{
          flexShrink: 0, fontSize: 12, fontWeight: urgent ? 900 : 800,
          color: capped ? '#f5c842' : urgent ? '#ff6b6b' : warm ? '#f59e0b' : '#a0a0b8',
        }}>
          {capped ? 'held' : trainClock(left)}
        </span>
      </div>

      <div style={{ height: 7, borderRadius: 999, background: '#20232a', overflow: 'hidden', margin: '7px 0 6px' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 999,
          background: capped ? TRAIN_GOLD : `linear-gradient(90deg, ${hot}, #f5c842)`,
          boxShadow: `0 0 10px ${capped ? '#f0a500' : hot}88`,
          transition: 'width 340ms cubic-bezier(0.2,0.6,0.25,1)',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {train.topAvatar && (
          <span style={{ flexShrink: 0, borderRadius: 999, padding: 1, background: TRAIN_GOLD, display: 'flex' }}>
            <img src={train.topAvatar} alt="" width={20} height={20}
              style={{ width: 20, height: 20, borderRadius: 999, objectFit: 'cover', display: 'block' }} />
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: '#a0a0b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {train.topName ? `${train.topName} leading` : ''}
          {others > 0 ? ` · +${others}` : ''}
        </span>
        <span className="vg-mono" style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: capped ? '#f5c842' : '#a0a0b8' }}>
          {capped ? 'top level' : `${into.toLocaleString()} / ${goal.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}
