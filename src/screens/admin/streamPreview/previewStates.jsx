// Playback and chat STATES — the screens a real viewer will see and that the
// simulator could not draw at all.
//
// ⚠⚠ THE PREVIEW HAD NO FAILURE STATES. Measured against the real viewers:
// reconnect 7 references vs 0, buffering 1 vs 0, and nothing at all for "the
// host dropped", "the stream ended while you were watching", "you are muted",
// "followers-only" or "slow mode". Every one of those is a screen a real person
// WILL hit, and none of them could be designed or captured.
//
// ⚠ THE TWO THAT ALREADY EXIST ARE IMPORTED, NOT COPIED. `ReconnectingOverlay`
// and `StreamLoadingCover` are exported from MobileLiveViewer and take props
// only, so importing is read-only and cannot drift — the same rule the alerts
// and the entry ribbon follow. Only the states the product does NOT yet have
// are authored here.
//
// ⚠ FAILURE COPY MUST SAY WHOSE FAULT IT IS AND WHAT HAPPENS NEXT. "Something
// went wrong" tells a viewer nothing and reads as the app blaming them. Each
// message below names the cause and the next step.

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import Icon from '../../../components/Icon';
// ⚠ THE FACE COMES FROM THE PROVIDER, NOT A PROP. Passing host?.avatar bypasses
// the uploaded-face resolver, so a founder-uploaded avatar would not appear here —
// an existing guard caught exactly that in this component’s first version. Reading
// it from context also means six call sites cannot each forget it.
import { useFaces, usePreviewSim } from './previewAssetsContext';
import { canUseModChannel } from './previewRoles';
import { castByUid } from './previewCast';
import { PREVIEW_HOST } from './previewStream';
import UserAvatar from '../../../components/UserAvatar';
import { ReconnectingOverlay, StreamLoadingCover } from '../../../components/streams/MobileLiveViewer';
import { RaidBanner } from '../../../components/streams/RaidControls';

// ⚠⚠ THE STATE LAYER MOVED TO src/components/streams/states/ AND IS IMPORTED
// BACK. It was built here because the preview is the only place these could be
// designed and captured without going live, which left the SIMULATOR AHEAD OF
// PRODUCTION: measured 2026-09-04, not one of ZeroViewers, EmptyChat, the
// chat-state banners, the paywall gates or the VP chip existed in
// BroadcasterScreen, ViewerStreamScreen, MobileLiveViewer or ChatPanel.
//
// Importing them back inverts the dependency, so the real screens and the
// preview now share ONE definition and a fix lands in both. This is the same
// reason ReconnectingOverlay and StreamLoadingCover are imported rather than
// copied.
//
// ⚠ RE-EXPORTED so nothing else in the preview changed. Five surfaces import
// these from this file; rewriting those call sites would have been churn with
// its own risk, and the point of this step is that it is invisible.
import {
  Centred, ChatStateBanner, TtsStrip, ZeroViewers, EmptyChat,
  VpEarnedChip, PreviewLevelUp, StreamPaywall, composerCopy, PlaybackStateView, HealthWarningView, AudioStageView,
} from '../../../components/streams/states';
import { S, C } from '../../../components/streams/states/tokens';
export {
  ChatStateBanner, TtsStrip, ZeroViewers, EmptyChat,
  VpEarnedChip, PreviewLevelUp, StreamPaywall, composerCopy, PlaybackStateView, HealthWarningView, AudioStageView, S,
};
export { RaidBanner };
// ⚠⚠ THE REAL NUMBERS, IMPORTED. These are founder-locked economy values and
// a preview that shows a rate Vergr does not pay is worse than showing none
// ([[feedback-no-unilateral-financial-choices]]). Nothing here is a literal.
// The TTS gate, imported for the same reason the VP numbers are. Founder,
// 2026-08-26: spoken chat is "both, can be unlocked or by subscribing to pro",
// so the level is half the answer and hardcoding 92 would drift the day the
// ladder moves.

// ⚠⚠ SOLID VALUES, NOT WASHES. Founder, 2026-09-02, having said it before:
// *"I FUCKING HATE THE SEMI TRANSPARENT PILL BACKGROUNDS IT IS GROSS STOP USING
// IT"*. A low-alpha white on a dark page is not a surface — it has no value of
// its own, it changes with whatever is behind it, and over video it turns to mud.
// Every chip, row and control below takes a REAL hex a few steps off its parent,
// and a selected state is a SOLID accent fill, never a tint plus a hairline.
//
// The ONLY thing that may stay translucent is a full-bleed SCRIM, whose whole
// job is to let the video read as being behind it. A scrim is not a pill.




/** The states the rail can put the player into. */
// ⚠ LABELS MUST NOT COLLIDE WITH THE PHASE CHIPS. The rail already has “Live”
// and “Ended” for the broadcast PHASE; a second pair with the same words is a
// control nobody can aim at, which is the same defect the Viewer/Plain-viewer
// pair had.
export const PLAYBACK_STATES = [
  { id: 'live', label: 'Playing' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'reconnecting', label: 'Reconnecting' },
  { id: 'hostdropped', label: 'Host dropped' },
  { id: 'ended', label: 'Stream ended' },
  { id: 'offline', label: 'No connection' },
];

/** What chat is doing to THIS viewer. */
export const CHAT_STATES = [
  { id: 'open', label: 'Open' },
  { id: 'slow', label: 'Slow mode' },
  { id: 'followers', label: 'Followers-only' },
  { id: 'subs', label: 'Subscribers-only' },
  { id: 'muted', label: 'You are muted' },
  // ⚠ BANNED IS NOT MUTED. A timeout ends by itself and says when; a ban does
  // not, and the only honest thing to offer is the appeal. Collapsing them
  // leaves a banned viewer waiting for a countdown that never comes.
  { id: 'banned', label: 'You are banned' },
];


/**
 * The player's state, over the video.
 *
 * ⚠ `hostdropped` IS NOT THE SAME AS `reconnecting`, and conflating them is why
 * viewers leave. Reconnecting is OUR side — their network or ours. Host dropped
 * is the BROADCASTER's side, the stream is still open, and the right thing to
 * tell someone is "wait, they are coming back", not "something is wrong".
 */
// ⚠ onRetry IS A PROP NOW, AND THAT IS THE WHOLE REASON THIS COMPONENT CAN BE
// SHARED. It read the preview simulator for exactly ONE thing, the "Try again"
// action, and that single line was what tied every playback failure state to the
// admin harness and kept it out of the real viewers.
// ⚠⚠ THE BINDING LIVES IN ONE PLACE, NOT AT EIGHT CALL SITES. PlaybackState is
// mounted by 8 preview surfaces with identical props. Threading `onRetry` through
// all eight would mean eight chances to forget it, and a forgotten one is a dead
// "Try again" button on a failure screen. This wrapper reads the simulator once;
// PlaybackStateView below is pure and is what production imports.
export function PlaybackState(props) {
  const sim = usePreviewSim();
  return <PlaybackStateView {...props} onRetry={() => sim?.setPlayback?.('live')} />;
}




export function ComposerPill({ style }) {
  const { chatState = 'open' } = usePreviewSim();
  const c = composerCopy(chatState);
  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
      padding: '11px 14px', borderRadius: 999, fontSize: 13,
      background: S.chipOnVideo, color: c.locked ? '#7E7E92' : '#8E8EA0',
      whiteSpace: 'nowrap', overflow: 'hidden', ...style,
    }}>
      {c.icon && <Icon name={c.icon} size={14} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.text}</span>
    </div>
  );
}


/** The states the spoken-chat strip can be in. */
export const TTS_STATES = [
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
  { id: 'muted', label: 'Muted by me' },
  { id: 'gesture', label: 'Needs a tap' },
  { id: 'locked', label: 'Locked (free)' },
];


/** What the broadcaster’s own uplink is doing. */
export const HEALTH_STATES = [
  { id: 'ok', label: 'Healthy' },
  { id: 'unstable', label: 'Unstable' },
  { id: 'lost', label: 'Ingest lost' },
];

/**
 * The broadcaster’s uplink warning.
 *
 * ⚠ THE REAL BROADCASTER SHOWS A BITRATE NUMBER AND NOTHING ELSE
 * (BroadcasterScreen.jsx:1088). A number is not a warning: nobody mid-stream
 * is watching a kbps readout, and by the time they notice, viewers have left.
 * The screen has to interrupt, say which end is at fault, and say what to do.
 *
 * ⚠ IT NEVER SAYS "ERROR". A host is live in front of an audience; the copy
 * has to be something they can act on in one second without losing composure.
 */
// ⚠⚠ THE BINDING LIVES IN ONE PLACE. HealthWarning touched the simulator for
// exactly ONE thing, the recovery action, and that single line is what kept every
// broadcast-health state out of the real broadcaster. HealthWarningView below is
// pure and is what production imports.
export function HealthWarning(props) {
  const sim = usePreviewSim();
  return <HealthWarningView {...props} onRecover={() => sim?.setHealth?.('ok')} />;
}




// ⚠⚠ THE RAID BANNER IS IMPORTED, NOT REDRAWN. It lived here for one afternoon
// and that is precisely how this repo grows two definitions that drift — the
// theme system and previewGifters both failed that way. The canonical copy is
// `src/components/streams/RaidControls.jsx`, which is what a REAL viewer renders,
// so the simulator cannot show something the product does not.
/**
 * The mod-only channel switch.
 *
 * ⚠⚠ REJECTED TWICE, AND BOTH NOTES ARE THE LESSON.
 *
 * First it was a full-width segmented bar plus a second feed block stacked over
 * the real chat. Founder: *"should not take up the whole screen that is bad
 * design. add it as an actual switch that changes the live chat, not an overlay."*
 *
 * Then I replaced it with a coloured chip and called that a switch. Founder:
 * *"a pill and a switch are not the same thing."* He is right — a SWITCH is a
 * track with a knob that slides, which reads as a state you are holding open. A
 * chip that changes colour reads as a filter you tapped. The product already has
 * the correct shape in `ToggleRow`, so this uses it rather than inventing a third.
 *
 * ⚠ AND NOTHING HERE IS SEMI-TRANSPARENT. The armed track is a solid accent, the
 * off track is a solid grey, the knob is white. See `S` above.
 *
 * ⚠⚠ THE PRIVACY IS NOT REAL UNTIL THE RELAY ENFORCES IT. `infra/chat` already has
 * rooms (`hub.GetOrCreateRoom(streamID)`, main.go:283); this needs a second room,
 * `streamID + ":mods"`, whose join is refused server-side for anyone who is not
 * the host or a listed stream moderator — NOT Vanguard, who are Vergr’s own
 * moderators and have no business in a creator’s private room. A client-side filter is not privacy.
 */
export function ModChannelSwitch({ role = 'viewer', channel = 'public', onChannel }) {
  if (!canUseModChannel(role)) return null;
  const on = channel === 'mods';
  return (
    <button type="button"
      onClick={() => onChannel?.(on ? 'public' : 'mods')}
      role="switch"
      aria-checked={on}
      aria-label="Show the moderators-only room"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0,
        padding: '4px 8px 4px 10px', borderRadius: 8, cursor: 'pointer', border: 'none',
        // ⚠ See VpEarnedChip: the row that holds this is `pointerEvents: 'none'`
        // so its empty half stops eating taps meant for the chat behind it.
        pointerEvents: 'auto',
        background: on ? S.dangerDim : S.chipOnVideo,
        color: on ? '#ff8fa3' : C.textDim,
        fontSize: 11, fontWeight: 800,
      }}>
      <Icon name={on ? 'lock' : 'shield_person'} size={12} />
      {on ? 'Mods only' : 'Mods'}
      {/* the switch itself — a track and a knob, the same shape as ToggleRow */}
      <span style={{
        width: 26, height: 15, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: on ? S.danger : S.track,
        transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 13 : 2, width: 11, height: 11,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
        }} />
      </span>
    </button>
  );
}
/**
 * An audio-only broadcast.
 *
 * ⚠ FOUNDER DECISION, 2026-09-02: audio-only streams are allowed. His reasoning,
 * and it is the strongest argument for it: a CO-HOST already joins with audio
 * only and is not forced to open a camera, so refusing the same to a solo host
 * is an inconsistency rather than a policy. It is also an ACCESS question — a
 * creator with no camera currently cannot broadcast at all — and podcasts are a
 * format Vergr otherwise cannot carry.
 *
 * ⚠⚠ THE WHOLE DESIGN PROBLEM IS THAT SILENCE PLUS A BLACK RECTANGLE READS AS
 * BROKEN. A viewer who cannot tell the difference between "audio-only" and "the
 * video failed" leaves and reports a bug. So this says AUDIO ONLY in words, shows
 * a live level meter so the stream is visibly alive, and gives the eye the host's
 * identity to rest on — the same three things every podcast player does.
 *
 * ⚠ IT IS AN OVERLAY, NOT A REPLACEMENT STAGE. Two components draw a stage here
 * (`Scene` and `PreviewVideoStage`) plus raw <video> in three more files; covering
 * them from the ONE mount point every surface already has is what stops this
 * landing on one screen out of seven, which is the recurring defect in this repo.
 */
// ⚠⚠ AUDIO-ONLY IS NOT A BLOCKING STATE, AND RENDERING IT LIKE ONE BROKE SIX OF
// SEVEN SURFACES. It shipped inside the same ternary as StreamPaywall and
// PlaybackState — an opaque `inset: 0` layer at `zIndex: 4`, mounted LAST — so on
// every surface whose chrome sits below z-4 it covered the whole UI. Measured
// 2026-09-02: the mobile broadcaster had 2 reachable controls and 10 buried,
// **End stream and Mic among them**, and the desktop viewer had 0 reachable and
// 20 buried, Follow and the composer included. A host could not stop their own
// broadcast, which is the worst thing a live surface can do.
//
// It SUBSTITUTES FOR THE VIDEO, so it belongs at the media layer: rendered right
// after the video element with `z={0}`. z-index 0 and `auto` paint in the same
// step, ordered by tree order, so every chrome element declared after it still
// paints above — exactly the ordering this needs.
// ⚠⚠ THE BINDING LIVES IN ONE PLACE. AudioStage read the preview face resolver for
// exactly ONE value, the avatar, and that single line is what kept audio-only
// broadcasts out of the real viewers. AudioStageView is pure and takes the avatar
// as a prop.
export function AudioStage(props) {
  const avatar = useFaces()(props.host);
  return <AudioStageView {...props} avatar={avatar} />;
}

/**
 * What the train paid the creator.
 *
 * ⚠⚠ THE ROOM SEES IT, AND THAT IS THE POINT. A bonus paid silently is a
 * private payout that wastes the moment the room just made; telling them what
 * they earned the creator is what makes the next train more likely.
 *
 * ⚠ IT IS NEVER A FIXED AMOUNT. The figure is a percentage of what actually
 * landed in that train, so it can never exceed the margin those coins already
 * banked. See docs/HYPE_TRAIN_PLAN.md.
 */
// ⚠ THE GOLD RAMP, NOT A FLAT FILL. Founder rule: flat #F0A500 reads as orange
// paint; real gold is this ramp. Used on the MAX chip and the bonus plate.
const GOLD_RAMP = 'linear-gradient(180deg, #FCEFB4 0%, #F5C842 38%, #E9A517 72%, #C97F12 100%)';

// The heat of a level. Violet through pink to gold, which is the brand's own
// ladder, and deliberately no cyan anywhere in it.
const TRAIN_HEAT = ['#8b3ff0', '#a34cf5', '#b44fff', '#c87fff', '#f0a500'];

const trainClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The hype train — one thing the whole room pushes on together.
 *
 * ⚠⚠ THE CONDUCTOR IS THE FEATURE, NOT THE BAR. The first version showed five
 * identical grey silhouettes and the words "5 on board", which is a count, not a
 * story: nobody pushes a meter to be an anonymous blob. Twitch names the person
 * carrying it. So the top contributor is first, ringed in gold, and named.
 *
 * ⚠ THE BAR CARRIES ITS OWN FIGURES. A progress bar with no numbers on it is a
 * mood. "9,800 / 22,646" is what tells somebody whether one more tip finishes a
 * level, which is the entire decision the train is asking them to make.
 *
 * ⚠ THE CLOCK ESCALATES BY COLOUR, NOT BY MOTION. There are two reduced-motion
 * switches in this app and the CSS one FAST-FORWARDS an animation to its final
 * keyframe rather than stopping it, so a pulsing timer is invisible for anyone
 * who set it. Colour and weight carry the urgency instead and cannot fail.
 *
 * ⚠ MAX IS A DIFFERENT STATE, not a recolour. Full gold ramp, its own label, and
 * the countdown stops mattering because there is nothing left to fill.
 *
 * ⚠ IT RIDES `train`, NOT `streams/{id}.hype`. That field is a
 * reactions-per-5-seconds meter (functions/streamHype.js). Two systems on one
 * word is how the theme system died.
 */
export function HypeTrain({ style }) {
  const faceOf = useFaces();
  const { train } = usePreviewSim();
  if (!train) return null;
  const { level = 1, into = 0, goal = 1, maxLevel = 5, endsAtMs = 0, riders = {} } = train;
  const capped = level >= maxLevel;
  const pct = capped ? 100 : Math.max(3, Math.min(100, Math.round((into / goal) * 100)));
  const left = Math.max(0, Math.round((endsAtMs - Date.now()) / 1000));
  const hot = TRAIN_HEAT[Math.min(level, TRAIN_HEAT.length) - 1];

  const sorted = [...Object.entries(riders)].sort((a, b) => b[1] - a[1]);
  const conductor = sorted[0] ? castByUid(sorted[0][0]) : null;
  const rest = sorted.slice(1, 5);
  const more = Math.max(0, sorted.length - 5);

  // Urgent under 30s, warming under a minute. No animation: see the note above.
  const urgent = !capped && left <= 30;
  const warm = !capped && left <= 60;

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
          background: capped ? GOLD_RAMP : `linear-gradient(180deg, ${hot}, ${hot}cc)`,
          fontSize: 11, fontWeight: 900, letterSpacing: '.02em',
          color: capped ? '#241a05' : '#fff',
          boxShadow: capped ? '0 2px 10px rgba(240,165,0,0.5)' : 'none',
        }}>
          <Icon name="local_fire_department" size={12} />
          {capped ? 'MAX' : `LV ${level}`}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: C.text }}>
          {capped ? 'Hype train at full' : 'Hype train'}
        </span>
        <span className="vg-mono" style={{
          flexShrink: 0, fontSize: 12,
          fontWeight: urgent ? 900 : 800,
          color: capped ? '#f5c842' : urgent ? '#ff6b6b' : warm ? '#f59e0b' : C.textDim,
        }}>
          {capped ? 'held' : trainClock(left)}
        </span>
      </div>

      <div style={{ height: 7, borderRadius: 999, background: '#20232a', overflow: 'hidden', margin: '7px 0 6px' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 999,
          background: capped ? GOLD_RAMP : `linear-gradient(90deg, ${hot}, #f5c842)`,
          boxShadow: `0 0 10px ${capped ? '#f0a500' : hot}88`,
          transition: 'width 340ms cubic-bezier(0.2,0.6,0.25,1)',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {conductor && (
          <span style={{ flexShrink: 0, borderRadius: 999, padding: 1, background: GOLD_RAMP, display: 'flex' }}>
            <UserAvatar user={conductor} avatar={faceOf(conductor)} size={20} showLiftRing={false} />
          </span>
        )}
        {rest.map(([uid]) => {
          const u = castByUid(uid);
          return <UserAvatar key={uid} user={u} avatar={faceOf(u)} size={18} showLiftRing={false} />;
        })}
        {more > 0 && (
          <span className="vg-mono" style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: C.textMuted }}>+{more}</span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 2 }}>
          {conductor ? `${conductor.displayName} leading` : ''}
        </span>
        <span className="vg-mono" style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: capped ? '#f5c842' : C.textDim }}>
          {capped ? 'top level' : `${into.toLocaleString()} / ${goal.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}

/**
 * What the train paid the creator.
 *
 * ⚠⚠ THE ROOM SEES IT, AND THAT IS THE POINT. A bonus paid silently is a
 * private payout that wastes the moment the room just made; telling them what
 * they earned the creator is what makes the next train more likely.
 *
 * ⚠ IT IS NEVER A FIXED AMOUNT. The figure is a percentage of what actually
 * landed in that train, so it can never exceed the margin those coins already
 * banked. Working: docs/HYPE_TRAIN_PLAN.md.
 *
 * ⚠ THE GROUND IS DARK MATERIAL, NOT BROWN. The first version put gold on an
 * olive-brown gradient and it read as muddy rather than valuable. Gold belongs
 * on near-black, as a RAMP and never a flat fill, which is the same rule the
 * earnings gauge already records.
 */
export function TrainBonus({ bonus, hostName, onDone, offset = 0 }) {
  useEffect(() => {
    if (!bonus) return undefined;
    const id = setTimeout(() => onDone?.(), 6000);
    return () => clearTimeout(id);
  }, [bonus, onDone]);
  if (!bonus) return null;
  const isVp = bonus.kind === 'vp';
  const amount = isVp ? bonus.vp : bonus.coins;
  return (
    <div className="vg-material vg-grain" style={{
      position: 'absolute', left: 10, right: 10, top: 56 + offset, zIndex: 27,
      padding: 10, borderRadius: 16, pointerEvents: 'none', overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 8px 26px rgba(240,165,0,0.30)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{
        flexShrink: 0, width: 30, height: 30, borderRadius: 12,
        background: GOLD_RAMP, display: 'grid', placeItems: 'center', color: '#241a05',
        boxShadow: '0 3px 12px rgba(240,165,0,0.45)',
      }}>
        <Icon name={isVp ? 'bolt' : 'toll'} size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: C.textMuted }}>
          {`LEVEL ${bonus.level} TRAIN`}
        </span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: C.text, marginTop: 1 }}>
          {`${amount.toLocaleString()} ${isVp ? 'VP' : 'coins'} to ${hostName || 'the host'}`}
        </span>
      </span>
      <span className="vg-mono" style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#f5c842' }}>
        {`${bonus.received.toLocaleString()}c raised`}
      </span>
    </div>
  );
}

// Reads the sim so no call site has to remember to feed it, the same reason
// HypeTrain does. Nine mount points; a prop would have to be right at all nine.
//
// ⚠ IT STEPS BELOW A LIVE TRAIN. Both sat at top:56, so a train starting while
// the previous one's bonus was still on screen put one exactly on top of the
// other. If a train is running the bonus drops under it.
export function TrainBonusHost() {
  // ⚠ THE HOST HAS A NAME AND THE BONUS MUST USE IT. This read doc.hostName,
  // which the stream doc does not carry, so every bonus said "to the host" —
  // an anonymous payout on the one line whose whole job is to tell the room who
  // they just earned it for.
  const { trainBonus, clearTrainBonus, train, doc } = usePreviewSim();
  const host = doc?.hostName || doc?.displayName || PREVIEW_HOST?.displayName;
  return (
    <TrainBonus
      bonus={trainBonus}
      hostName={host}
      onDone={clearTrainBonus}
      offset={train ? 86 : 0}
    />
  );
}