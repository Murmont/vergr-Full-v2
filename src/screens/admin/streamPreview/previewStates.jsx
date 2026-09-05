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

import { motion } from 'framer-motion';
import Icon from '../../../components/Icon';
// ⚠ THE FACE COMES FROM THE PROVIDER, NOT A PROP. Passing host?.avatar bypasses
// the uploaded-face resolver, so a founder-uploaded avatar would not appear here —
// an existing guard caught exactly that in this component’s first version. Reading
// it from context also means six call sites cannot each forget it.
import { useFaces, usePreviewSim } from './previewAssetsContext';
import { canUseModChannel } from './previewRoles';
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
        display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
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




