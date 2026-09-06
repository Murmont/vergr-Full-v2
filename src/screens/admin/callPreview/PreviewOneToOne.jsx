// The 1:1 call, voice and video. The SIMULATOR copy.
//
// Copied layout source: src/screens/messages/CallScreen.jsx:188-365.
//
// ⚠ ONE FILE SERVES BOTH, exactly as the real screen does: CallScreen branches
// on `callType` and shares its control bar between the two. Splitting them here
// would let the two layouts drift apart in the preview while they cannot drift
// apart in production.
//
// ⚠ IT SIMULATES, IT DOES NOT FUNCTION. No getUserMedia, no peer connection, no
// signalling, no `calls` doc. The controls move simulator state and nothing
// else.

import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { useFaces, usePreviewSim } from '../streamPreview/previewAssetsContext';
import {
  CallBtn, VideoSurface, CamFallback, QualityPill, EncryptedNote,
  phaseLabel, S, C, EMBER, VIOLET, VIOLET_LIGHT, FONT,
} from './callChrome';
import { clock } from './callCast';

export default function PreviewOneToOne({ video = true, role = 'caller' }) {
  const sim = usePreviewSim();
  const faceOf = useFaces();
  const {
    phase, elapsed, muted, videoOff, speakerOn, controls, quality, peer, videos,
  } = sim;

  const connected = phase === 'active';
  const remoteUrl = videos?.stage || null;
  const selfUrl = videos?.facecam || null;
  const showControls = !video || controls;

  // ── VOICE ────────────────────────────────────────────────────────────
  if (!video) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Ambient wash. CallScreen.jsx:281. Two soft violet fields so the
            screen is not a flat black rectangle behind one avatar. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '22%', left: '18%', width: 256, height: 256, borderRadius: '50%', background: 'rgba(123,31,255,0.13)', filter: 'blur(64px)' }} />
          <div style={{ position: 'absolute', bottom: '20%', right: '16%', width: 208, height: 208, borderRadius: '50%', background: 'rgba(180,79,255,0.10)', filter: 'blur(64px)' }} />
        </div>

        {/* ⚠ THE TRUST BADGE AND THE QUALITY PILL SHARE A ROW. The shipped
            screen puts the encrypted badge alone at the top at 9px, which is
            below the size anything is read at, and shows no network state at
            all. Both belong here: they are the two facts about the CONNECTION
            rather than about the person. */}
        <div style={{ position: 'absolute', top: 26, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 2 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, background: S.chip }}>
            <EncryptedNote p2p />
          </span>
          {connected && <QualityPill quality={quality} />}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', position: 'relative', zIndex: 1 }}>
          {/* Avatar with the ringing halo. CallScreen.jsx:294. */}
          <div style={{ position: 'relative', marginBottom: 30, display: 'grid', placeItems: 'center' }}>
            {phase === 'ringing' && (
              <>
                <span aria-hidden="true" style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', border: '2px solid rgba(123,31,255,0.22)', animation: 'vgcall-ping 2s cubic-bezier(0,0,0.2,1) infinite' }} />
                <span aria-hidden="true" style={{ position: 'absolute', width: 144, height: 144, borderRadius: '50%', border: '1px solid rgba(123,31,255,0.14)', animation: 'vgcall-ping 3s cubic-bezier(0,0,0.2,1) infinite' }} />
              </>
            )}
            {connected && (
              <span aria-hidden="true" style={{ position: 'absolute', width: 128, height: 128, borderRadius: '50%', border: `2px solid ${VIOLET}`, opacity: 0.35 }} />
            )}
            <UserAvatar src={faceOf(peer)} size={112} />
          </div>

          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, margin: 0 }}>{peer.displayName}</h2>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: C.textMuted, margin: '4px 0 8px' }}>@{peer.username}</p>

          {connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: VIOLET_LIGHT, fontVariantNumeric: 'tabular-nums' }}>{clock(elapsed)}</span>
            </div>
          ) : (
            <p style={{ fontSize: 14, margin: 0, color: phase === 'failed' ? EMBER : C.textDim }}>
              {phase === 'failed'
                // ⚠ THE FAILURE COPY NAMES A CAUSE AND A NEXT STEP. The shipped
                // string is "Connection failed, try WiFi or mobile data", which
                // is close, and it is the only one of the states that does.
                ? 'Could not connect. Try WiFi or mobile data.'
                : phase === 'reconnecting'
                  ? 'Reconnecting. Stay on the line.'
                  : phaseLabel(phase, elapsed, role)}
            </p>
          )}
        </div>

        <Controls video={false} sim={sim} visible />
        <PingKeyframes />
      </div>
    );
  }

  // ── VIDEO ────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#fff', fontFamily: FONT, overflow: 'hidden' }}>
      {/* ⚠ NEVER CROP THE REMOTE PICTURE. object-contain over a blurred cover
          copy of the same source: no pixel is thrown away and there are no bare
          black bars. VideoSurface owns both halves so the pair cannot come
          apart. */}
      {remoteUrl ? <VideoSurface url={remoteUrl} fit="contain" /> : <CamFallback seed={3} />}

      {/* Before connection the remote frame is replaced entirely, not overlaid:
          there is nothing to show through. CallScreen.jsx:205. */}
      {!connected && (
        <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', display: 'grid', placeItems: 'center', zIndex: 5 }}>
          <div style={{ textAlign: 'center' }}>
            <UserAvatar src={faceOf(peer)} size={96} />
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 800, margin: '16px 0 0' }}>{peer.displayName}</p>
            <p style={{ fontSize: 13, marginTop: 8, color: phase === 'failed' ? EMBER : VIOLET_LIGHT }}>
              {phase === 'failed'
                ? 'Could not connect. Try WiFi or mobile data.'
                : phase === 'reconnecting'
                  ? 'Reconnecting. Stay on the line.'
                  : `${phaseLabel(phase, elapsed, role)}...`}
            </p>
          </div>
        </div>
      )}

      {/* Self view. CallScreen.jsx:229.
          ⚠ 16:9 AND object-contain, NOT a portrait box with object-cover. The
          box used to be w-28 h-40 with cover, so a 1280x720 webcam lost about
          61% of its width, measured live. A landscape camera now fills it and a
          portrait phone camera letterboxes instead of being sliced in half. */}
      <div style={{
        position: 'absolute', top: 62, right: 14, width: 148, aspectRatio: '16 / 9',
        borderRadius: 16, overflow: 'hidden', background: '#000', zIndex: 30,
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
      }}>
        {videoOff
          ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#131020' }}>
              <Icon name="videocam_off" size={22} style={{ color: C.textMuted }} />
            </div>
          )
          : selfUrl
            ? <VideoSurface url={selfUrl} fit="contain" blurBacking={false} />
            : <CamFallback seed={1} />}
      </div>

      {/* Top bar. Fades with the controls. CallScreen.jsx:236. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 18px 46px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
        zIndex: 20, opacity: showControls ? 1 : 0, transition: 'opacity 300ms',
        pointerEvents: showControls ? 'auto' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: connected ? '#22c55e' : C.amber, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* ⚠ THE PERSON IS THE MOST IMPORTANT THING ON THIS SCREEN. It was
                12px, smaller than a sidebar nav label, until CallScreen was
                fixed. Keep it at 18. */}
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 800, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{peer.displayName}</p>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, margin: 0, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
              {phaseLabel(phase, elapsed, role)}
            </p>
          </div>
          {connected && <QualityPill quality={quality} compactMode />}
          <EncryptedNote p2p align="flex-end" />
        </div>
      </div>

      <Controls video sim={sim} visible={showControls} />

      {/* ⚠ THE FAILED STATE'S ONLY ACTION IS A FULL PAGE RELOAD, and that is
          what ships (CallScreen.jsx:357 calls safeReload()). Reloading the app
          to retry a call throws away the whole session, including any other
          call state, and on the native build it is a cold boot of the WebView.
          Drawn here as-is rather than quietly designed away, because the fix is
          a code change to the real screen, not a nicer button in a simulator. */}
      {phase === 'failed' && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 130, display: 'grid', placeItems: 'center', zIndex: 30 }}>
          <button type="button" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px',
            borderRadius: 999, border: 'none', cursor: 'pointer',
            background: VIOLET, color: '#fff', fontSize: 13, fontWeight: 700,
          }}>
            <Icon name="refresh" size={17} /> Retry
          </button>
        </div>
      )}
      <PingKeyframes />
    </div>
  );
}

/**
 * The control bar, shared by both layouts exactly as CallScreen shares it.
 *
 * Copied layout source: CallScreen.jsx:320-355.
 */
function Controls({ video, sim, visible }) {
  const { muted, setMuted, videoOff, setVideoOff, speakerOn, setSpeakerOn, setPhase } = sim;
  return (
    <div style={{
      position: video ? 'absolute' : 'relative',
      left: 0, right: 0, bottom: 0, zIndex: 20,
      opacity: visible ? 1 : 0, transition: 'opacity 300ms',
      pointerEvents: visible ? 'auto' : 'none',
      background: video ? 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)' : 'transparent',
      paddingTop: video ? 60 : 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 24px 38px' }}>
        <CallBtn icon={muted ? 'mic_off' : 'mic'} label={muted ? 'Unmute' : 'Mute'}
          tone={muted ? 'alert' : 'neutral'} onClick={() => setMuted((v) => !v)} />

        {video && (
          <CallBtn icon={videoOff ? 'videocam_off' : 'videocam'} label={videoOff ? 'Turn camera on' : 'Turn camera off'}
            tone={videoOff ? 'alert' : 'neutral'} onClick={() => setVideoOff((v) => !v)} />
        )}

        <CallBtn icon="call_end" label="End call" tone="danger" size={64} iconSize={28}
          onClick={() => setPhase('ended')} />

        {/* ⚠⚠ BOTH OF THE REMAINING BUTTONS ARE INERT IN THE SHIPPED SCREEN AND
            THAT IS A REAL DEFECT, NOT A SIMULATOR SHORTCUT.
              - Speaker (CallScreen.jsx:346) flips `speakerOn` and nothing reads
                it. There is no setSinkId call anywhere in the file, so the
                button restyles itself and the audio keeps coming out of the
                earpiece. On the native build the correct fix is an
                AudioManager route through the Kotlin bridge, not setSinkId.
              - Flip camera (CallScreen.jsx:353) has NO onClick AT ALL. It is a
                styled div. On a phone, front/back is the single most used
                control on a video call.
            They are drawn here so the layout matches, and they are listed in
            the rail's findings panel so they get fixed rather than screenshotted
            forever. */}
        {!video && (
          <CallBtn icon={speakerOn ? 'volume_up' : 'volume_down'} label={speakerOn ? 'Speaker on' : 'Speaker off'}
            tone={speakerOn ? 'active' : 'neutral'} onClick={() => setSpeakerOn((v) => !v)} />
        )}

        {video && (
          <CallBtn icon="flip_camera_ios" label="Switch camera" tone="neutral" onClick={() => {}} />
        )}
      </div>
    </div>
  );
}

/** The ringing halo. Inline so this file carries its own motion. */
function PingKeyframes() {
  // ⚠ REDUCED MOTION IS TWO SWITCHES AND A MEDIA QUERY ONLY CATCHES ONE.
  // Settings > Appearance sets html[data-reduced-motion="true"], and index.css
  // answers it by fast-forwarding an animation to its LAST keyframe rather than
  // stopping it. This animation's last frame is fully transparent, which is the
  // correct resting pose either way, so it degrades to no halo instead of to a
  // frozen ring.
  return (
    <style>{`
      @keyframes vgcall-ping { 0% { transform: scale(1); opacity: 0.9 } 75%, 100% { transform: scale(1.7); opacity: 0 } }
      @media (prefers-reduced-motion: reduce) { [style*="vgcall-ping"] { animation: none !important; opacity: 0 !important } }
    `}</style>
  );
}
