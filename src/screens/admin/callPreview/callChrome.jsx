// Shared chrome for the call simulator: the pieces every call surface draws.
//
// ⚠ COPIES OF THE DESIGN, NOT A SECOND IMPLEMENTATION OF THE FEATURE. Each
// component below reproduces the markup of a shipped call screen so a capture
// matches what ships, and each records its source file and line at the copy
// site. If you change the real screen, change the copy.
//
// ⚠ WHY COPIES AND NOT IMPORTS. The stream preview imports JoinAnnouncer,
// StreamGoalBar and the alert overlays because those take props and nothing
// else, so importing is read-only and cannot drift. NOTHING on a call screen is
// prop-only: CallScreen owns a peer connection, GroupCallScreen subscribes to a
// module singleton, VoiceChannelScreen reads Firestore and joins the SFU on
// mount. Importing any of them here would open a real socket and ask for the
// camera from inside an admin page. Copies are the only honest option.
//
// ⚠ SOLID FILLS, NEVER SEMI-TRANSPARENT PILLS. Founder, repeatedly. A low-alpha
// white over video has no value of its own, changes with whatever frame is
// behind it, and turns to mud. The one thing allowed to stay translucent is a
// full-bleed SCRIM, whose whole job is to let the video read as being behind
// it. A scrim is not a pill.

import { useEffect, useRef } from 'react';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { useFaces, usePreviewVideos } from '../streamPreview/previewAssetsContext';
import { clock } from './callCast';

// ⚠ ONE PALETTE, TAKEN FROM THE STREAM STATE LAYER RATHER THAN INVENTED. These
// are the same tokens the real stream states use, so the two simulators cannot
// drift into two houses of colour. `red` is type on dark and `redFill` carries
// white type: #ef4444 measures 3.76:1 as a fill and 4.29:1 as text, failing
// both floors in opposite directions, so no single value fixes it.
export { S, C } from '../../../components/streams/states/tokens';
import { S, C } from '../../../components/streams/states/tokens';

// Brand tokens the call screens use by Tailwind class name. Spelled as hex here
// because this file styles inline, and `var(--brand-*)` is NOT defined globally
// (only inside TournamentOverlayNeon) so using it would silently void the whole
// declaration. That trap already killed one gradient on the earnings screen.
export const EMBER = '#F04060';
export const VIOLET = '#7B1FFF';
export const VIOLET_LIGHT = '#B44FFF';
export const GREEN = '#22c55e';

export const FONT = 'DM Sans, system-ui, sans-serif';

/**
 * A round call control.
 *
 * ⚠ EVERY ONE OF THESE NEEDS AN aria-label. `Icon` is aria-hidden app-wide
 * (2026-09-02), so an icon-only button no longer inherits an accidental name
 * from its ligature and has none at all unless it is given one. On a call
 * screen that means the End button announces as nothing.
 */
export function CallBtn({ icon, label, onClick, tone = 'neutral', size = 56, iconSize = 24, disabled = false }) {
  // ⚠ 'active' IS A SOLID FILL, NOT A TINT. The shipped screens use
  // `bg-white/20` and `bg-brand-violet/20` for the on state, which is exactly
  // the wash the founder has banned twice. Flattened to real values here.
  const tones = {
    neutral: { bg: S.chipOnVideo, fg: '#fff' },
    active: { bg: '#2E2A40', fg: '#fff' },
    danger: { bg: EMBER, fg: '#fff' },
    accept: { bg: GREEN, fg: '#06240F' },
    on: { bg: VIOLET_LIGHT, fg: '#12081F' },
    alert: { bg: '#2E2A40', fg: EMBER },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        width: size, height: size, borderRadius: '50%', border: 'none', padding: 0,
        background: t.bg, color: t.fg, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/**
 * A remote video surface, or the person's face when there is no picture.
 *
 * ⚠ NEVER CROP. Founder rule, and CallScreen already follows it: the remote
 * video is `object-contain` over a blurred `object-cover` copy of the SAME
 * stream, so the letterbox is filled instead of showing black bars and not one
 * pixel of the frame is thrown away. Measured on a live call before that fix,
 * `object-cover` was discarding 16.6% of the remote frame and about 61% of the
 * self view's width. One stream, two sinks: no extra bandwidth.
 */
export function VideoSurface({ url, fit = 'contain', blurBacking = true, radius = 0, muteGlyph = null }) {
  const ref = useRef(null);
  const bgRef = useRef(null);
  // Autoplay needs muted + playsInline or the browser refuses to start it
  // without a gesture, and a preview nobody has clicked would sit on a frozen
  // first frame.
  useEffect(() => {
    [ref.current, bgRef.current].forEach((el) => { if (el) el.play?.().catch(() => {}); });
  }, [url]);

  if (!url) {
    return (
      <div style={{
        position: 'absolute', inset: 0, background: '#0E0B1A', borderRadius: radius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {muteGlyph}
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: radius, background: '#000' }}>
      {blurBacking && (
        <video ref={bgRef} src={url} autoPlay muted loop playsInline aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', transform: 'scale(1.1)', filter: 'blur(28px)',
            opacity: 0.5, pointerEvents: 'none',
          }} />
      )}
      <video ref={ref} src={url} autoPlay muted loop playsInline
        style={{ position: 'relative', width: '100%', height: '100%', objectFit: fit }} />
    </div>
  );
}

/**
 * The drawn stand-in when no clip has been uploaded for a tile.
 *
 * ⚠ THE RAIL EXISTS SO NOTHING RENDERS EMPTY (founder, 2026-08-31). A grey box
 * where a person should be makes a capture unusable, and "upload a video first"
 * is not a state anybody wants to screenshot. This draws a lit room so the tile
 * reads as a camera feed at a glance, and an uploaded clip replaces it.
 */
export function CamFallback({ seed = 0, dim = false }) {
  const hues = [268, 212, 338, 24, 152, 292];
  const h = hues[seed % hues.length];
  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: `radial-gradient(120% 90% at 26% 14%, hsl(${h} 62% 26%) 0%, hsl(${h} 48% 13%) 46%, #0A0812 100%)`,
      opacity: dim ? 0.5 : 1,
    }}>
      {/* A shoulders-and-head silhouette. Deliberately abstract: a drawn face
          would be a likeness of a user who does not exist, and a photo would be
          a real person we have no release for. */}
      <div style={{
        position: 'absolute', left: '50%', bottom: '-16%', transform: 'translateX(-50%)',
        width: '78%', height: '62%', borderRadius: '50% 50% 0 0',
        background: `hsl(${h} 34% 9%)`,
      }} />
      <div style={{
        position: 'absolute', left: '50%', bottom: '38%', transform: 'translateX(-50%)',
        width: '30%', aspectRatio: '1', borderRadius: '50%',
        background: `hsl(${h} 30% 12%)`,
      }} />
    </div>
  );
}

/**
 * One participant tile.
 *
 * Copied layout source: GroupCallScreen.jsx:47 (Tile).
 *
 * ⚠ THE SPEAKING RING IS A REAL RING, NOT A GLOW. The shipped tile uses
 * `ring-2 ring-brand-violet` plus a violet shadow; a blur alone reads as a
 * hover state rather than as "this person is talking".
 *
 * ⚠ A SEAT WITH ITS CAMERA OFF KEEPS ITS SEAT. It shows the person's avatar,
 * it does not vanish and the grid does not reshuffle. A grid that re-lays out
 * every time somebody goes quiet is unusable, and the avatar is what tells the
 * room who is still there.
 */
export function CallTile({ seat, isMe = false, speaking = false, videoUrl = null, seed = 0, aspect = '3 / 4', showVolume = false, onKick = null }) {
  const faceOf = useFaces();
  return (
    <div style={{
      position: 'relative', borderRadius: 16, overflow: 'hidden', background: S.row,
      aspectRatio: aspect,
      boxShadow: speaking
        ? `0 0 0 2px ${VIOLET_LIGHT}, 0 0 20px rgba(123,31,255,0.35)`
        : 'none',
    }}>
      {seat.camOn
        ? (videoUrl ? <VideoSurface url={videoUrl} fit="cover" blurBacking={false} /> : <CamFallback seed={seed} />)
        : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserAvatar src={faceOf(seat)} size={64} />
          </div>
        )}

      {/* Name plate. A gradient scrim, which is the one translucent thing
          allowed here: its job is to let the picture read behind the name. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 8px 6px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 100%)',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: '#fff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{isMe ? 'You' : seat.name}</span>
        {!seat.micOn && <Icon name="mic_off" size={13} style={{ color: '#fff', opacity: 0.75 }} />}
        {onKick && (
          <button type="button" onClick={onKick} aria-label={`Remove ${seat.name} from the channel`}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.red, display: 'grid' }}>
            <Icon name="person_remove" size={14} />
          </button>
        )}
      </div>

      {/* ⚠ THE VOLUME SLIDER IS LOCAL PLAYBACK ONLY and the voice channel is
          the only surface that has one (VoiceChannelScreen.jsx:296). It is not
          a mute of the other person, which is why it is a slider and not a
          toggle. */}
      {showVolume && (
        <div style={{ position: 'absolute', left: 6, right: 6, bottom: 26, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <Icon name="volume_down" size={12} style={{ color: 'rgba(255,255,255,0.8)' }} />
          {/* ⚠ minWidth: 0 IS LOAD-BEARING. See PreviewVoiceChannel: a range
              input resolves min-width:auto to an intrinsic 129px, so `flex: 1`
              alone cannot shrink it and the row widens its own container. */}
          <input type="range" min="0" max="100" defaultValue="80" aria-label={`${seat.name} volume`}
            style={{ flex: 1, minWidth: 0, height: 2, accentColor: VIOLET_LIGHT }} />
        </div>
      )}
    </div>
  );
}

/**
 * A voice-only row: the shape a call takes when nobody has a camera.
 *
 * Copied layout source: VoiceChannelScreen.jsx:265 and SquadStreamScreen.jsx:404.
 */
export function VoiceRow({ seat, isMe = false, speaking = false, sub = null, onKick = null }) {
  const faceOf = useFaces();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
      background: S.row,
      boxShadow: speaking ? `0 0 0 1.5px ${GREEN}` : 'none',
    }}>
      <div style={{ borderRadius: '50%', boxShadow: speaking ? `0 0 0 2px ${GREEN}` : 'none', display: 'grid' }}>
        <UserAvatar src={faceOf(seat)} size={36} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: C.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {/* ⚠ THE SHIPPED ROW IS `<UserName/> (you)`, which reads correctly for
              a real account ("Sable (you)") and produced "You (you)" here,
              because the simulator's viewer is literally named You. Suffix only
              when the name is not already the word. */}
          {isMe && seat.name !== 'You' ? `${seat.name} (you)` : seat.name}
        </div>
        <div style={{ fontSize: 11, color: speaking ? GREEN : C.textDim }}>
          {sub || (speaking ? 'Speaking' : seat.micOn ? 'Mic on' : 'Muted')}
        </div>
      </div>
      {onKick && (
        <button type="button" onClick={onKick} aria-label={`Remove ${seat.name} from the channel`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, display: 'grid' }}>
          <Icon name="person_remove" size={15} />
        </button>
      )}
      <Icon name={seat.micOn ? 'mic' : 'mic_off'} size={17}
        style={{ color: seat.micOn ? VIOLET_LIGHT : C.textMuted }} />
    </div>
  );
}

/**
 * The connection-quality pill.
 *
 * ⚠⚠ THIS DOES NOT EXIST IN THE PRODUCT AND THE LABEL SAYS SO NOWHERE, so read
 * this comment before shipping it. Measured 2026-09-06: no call surface reads
 * `RTCPeerConnection.getStats()`, and the only network feedback any of them
 * gives is CallScreen switching to 'failed' after ICE has already given up. A
 * call therefore degrades silently and then dies with "Connection failed", at
 * which point the only offered action is a full page reload.
 *
 * Three bars is the cheapest honest fix and needs no new infrastructure:
 * getStats() is already available on the peer connection CallScreen holds.
 */
export function QualityPill({ quality = 'good', compactMode = false }) {
  const map = {
    good: { bars: 3, color: GREEN, label: 'Good connection' },
    fair: { bars: 2, color: C.amber, label: 'Connection unstable' },
    poor: { bars: 1, color: C.red, label: 'Very weak connection' },
  };
  const q = map[quality] || map.good;
  return (
    <span
      title={q.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: compactMode ? '3px 7px' : '4px 9px', borderRadius: 999,
        background: S.chipOnVideo,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 11 }} aria-hidden="true">
        {[4, 7.5, 11].map((h, i) => (
          <span key={h} style={{
            width: 3, height: h, borderRadius: 1,
            background: i < q.bars ? q.color : '#3A3550',
          }} />
        ))}
      </span>
      {!compactMode && (
        <span style={{ fontSize: 11, fontWeight: 700, color: quality === 'good' ? C.textDim : q.color }}>
          {quality === 'good' ? 'Good' : quality === 'fair' ? 'Unstable' : 'Weak'}
        </span>
      )}
    </span>
  );
}

/**
 * What the call is doing, in words.
 *
 * ⚠ EACH STRING NAMES THE CAUSE AND THE NEXT STEP. "Connection failed" is what
 * CallScreen says today and it tells a person nothing: whose fault, is it over,
 * is there anything to do. A failure message that reads as the app blaming the
 * user is worse than no message.
 */
export function phaseLabel(phase, elapsed, role = 'caller') {
  switch (phase) {
    case 'ringing': return role === 'callee' ? 'Incoming' : 'Ringing';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'active': return clock(elapsed);
    case 'ended': return `Call ended · ${clock(elapsed)}`;
    case 'failed': return 'Could not connect';
    default: return '';
  }
}

/** The encryption line. 1:1 is genuinely peer to peer; a group call is not. */
export function EncryptedNote({ p2p = true, align = 'center' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: align,
      fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.7)', fontFamily: 'DM Mono, monospace',
    }}>
      <Icon name="lock" size={12} style={{ color: p2p ? GREEN : C.textDim }} />
      {/* ⚠⚠ A GROUP CALL IS NOT P2P AND MUST NOT SAY IT IS. 1:1 calls are raw
          WebRTC between two browsers, so "P2P encrypted" is true. A group call,
          a squad hangout and a voice channel all route media through the Pion
          SFU on our own box, which decrypts and re-encrypts every hop: transport
          is encrypted, the server is not blind. IncomingCallOverlay prints
          "VERGR · Encrypted P2P Call" under a GROUP ring today, which is the
          wrong claim on the wrong screen. */}
      {p2p ? 'P2P encrypted' : 'Encrypted'}
    </span>
  );
}

/** Slot ids from the shared upload rail, mapped onto call seats in order. */
export const SEAT_SLOTS = ['facecam', 'stage', 'guest1', 'guest2', 'guest3'];

/**
 * The clip for a seat, if one has been uploaded.
 *
 * ⚠ ONE SLOT PER TILE, NEVER ONE CLIP REUSED. The stream preview shipped a
 * four-way co-host grid fed by a single facecam clip, so one person appeared
 * three times, which reads as deliberate and is worse than an empty tile.
 */
export function useSeatVideo() {
  const { videoFor } = usePreviewVideos();
  return (index) => videoFor(SEAT_SLOTS[index % SEAT_SLOTS.length]);
}
