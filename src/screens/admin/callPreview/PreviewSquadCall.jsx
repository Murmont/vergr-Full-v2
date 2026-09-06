// The squad hangout. The SIMULATOR copy.
//
// Copied layout source: src/screens/squads/SquadStreamScreen.jsx:294-455.
//
// ⚠ IT IS VOICE-FIRST AND THE CAP IS THE WHOLE DESIGN. Streaming routing rule
// #2: everyone in the squad publishes Opus and subscribes to everyone else, and
// AT MOST TWO cameras may publish at once (MAX_VIDEO_PUBLISHERS). A squad is up
// to 100 members, so fanning out 100 video tracks is not a thing that can
// happen. That single constraint is why this screen is a voice roster with two
// video tiles above it rather than a grid like the group call.
//
// ⚠ VIDEO IS SUBSCRIBED ON DEMAND, and that is visible in the UI: a camera that
// is live shows "Tap to watch" until you actually subscribe to it, because
// pulling a video track nobody asked for is bandwidth spent on a tile nobody is
// looking at. The third person who wants their camera on gets a polite "ask one
// of them to swap", never a hard rotation that cuts somebody off mid-sentence.
//
// ⚠ THE NATIVE ROUTE IS THIS SAME FILE. NativeSquadStreamScreen re-exports it,
// so there is one implementation and the preview cannot fall out of step with a
// second one.

import { useState } from 'react';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { useFaces, usePreviewSim } from '../streamPreview/previewAssetsContext';
import {
  CallBtn, CamFallback, VideoSurface, VoiceRow, QualityPill, useSeatVideo,
  S, C, VIOLET_LIGHT, FONT,
} from './callChrome';
import { PREVIEW_SQUAD } from './callCast';

// Mirrors MAX_VIDEO_PUBLISHERS in SquadStreamScreen.jsx.
const MAX_VIDEO_PUBLISHERS = 2;

export default function PreviewSquadCall({ wide = false }) {
  const sim = usePreviewSim();
  const faceOf = useFaces();
  const {
    phase, squad, camOn, setCamOn, micOn, setMicOn, speakingFor, squadCams,
    quality, me, setPhase,
  } = sim;
  const seatVideo = useSeatVideo();
  const speaking = speakingFor(squad);

  // ⚠ WATCHING IS PER-VIEWER STATE, NOT PER-PUBLISHER. Somebody's camera being
  // live and YOU having subscribed to it are two different facts, and the tile
  // draws differently for each. Held here so both are capturable.
  const [watching, setWatching] = useState(() => new Set([squad[0]?.uid]));
  const toggleWatch = (uid) => setWatching((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  const cams = squad.filter((s) => s.camOn);
  const voiceOnly = squad.filter((s) => !s.camOn);
  const meSeat = { ...me, name: 'You', micOn, camOn };

  if (phase === 'failed') {
    // SquadStreamScreen.jsx:296. The whole screen becomes the error, because a
    // hangout you could not join has nothing else to show.
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <Icon name="error" size={48} style={{ color: '#F04060' }} />
          <p style={{ fontWeight: 700, margin: '14px 0 6px' }}>Could not join the hangout</p>
          <p style={{ fontSize: 13, color: C.textDim, margin: '0 0 18px' }}>
            The voice server did not answer. Check your connection and try again.
          </p>
          <button type="button" style={{ padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: S.chip, color: '#fff', fontSize: 13 }}>
            Back to squad
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* TopBar equivalent */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', flexShrink: 0 }}>
        <button type="button" aria-label="Leave and go back to the squad" style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: S.chip, color: '#fff', display: 'grid', placeItems: 'center' }}>
          <Icon name="arrow_back" size={19} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 800 }}>{PREVIEW_SQUAD.name}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: C.textDim }}>
            {phase === 'connecting' ? 'Connecting' : `${squad.length + 1} in voice`}
          </p>
        </div>
        {phase === 'active' && <QualityPill quality={quality} compactMode />}
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', minHeight: 0 }}>
        {/* Self row. SquadStreamScreen.jsx:322. */}
        <p style={sectionLabel}>You</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: S.row, marginBottom: 20 }}>
          <UserAvatar src={faceOf(me)} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{me.displayName}</p>
            <p style={{ margin: 0, fontSize: 12, color: C.textDim }}>
              {micOn ? 'Mic on' : 'Mic muted'}{camOn ? ' · Camera on' : ''}
            </p>
          </div>
          <Icon name={micOn ? 'mic' : 'mic_off'} size={19} style={{ color: micOn ? VIOLET_LIGHT : C.textMuted }} />
        </div>

        {/* Live cameras. SquadStreamScreen.jsx:337. */}
        {(cams.length > 0 || camOn) && (
          <>
            <p style={sectionLabel}>Cameras live ({squadCams}/{MAX_VIDEO_PUBLISHERS})</p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: wide ? 'repeat(2, minmax(0,1fr))' : '1fr', marginBottom: 20 }}>
              {cams.map((s, i) => {
                const on = watching.has(s.uid);
                const url = seatVideo(i);
                return (
                  <div key={s.uid} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: S.row, aspectRatio: '16 / 9' }}>
                    {on
                      ? (url ? <VideoSurface url={url} fit="cover" blurBacking={false} /> : <CamFallback seed={i} />)
                      : (
                        // ⚠ THE UNWATCHED STATE IS A BUTTON, NOT A BLANK. It is
                        // the only thing telling a member that a camera is
                        // available at all, and it is what makes on-demand
                        // subscription legible rather than feeling broken.
                        <button type="button" onClick={() => toggleWatch(s.uid)}
                          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#fff' }}>
                          <UserAvatar src={faceOf(s)} size={48} />
                          <span style={{ fontSize: 12, color: C.textDim }}>Tap to watch</span>
                        </button>
                      )}
                    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '4px 8px', borderRadius: 6, background: S.chipOnVideo, fontSize: 11, fontWeight: 600 }}>{s.name}</span>
                      {on && (
                        <button type="button" onClick={() => toggleWatch(s.uid)}
                          style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: S.chipOnVideo, color: '#fff', fontSize: 11 }}>
                          Stop watching
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {camOn && (
                <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: S.row, aspectRatio: '16 / 9' }}>
                  {seatVideo(4) ? <VideoSurface url={seatVideo(4)} fit="cover" blurBacking={false} /> : <CamFallback seed={4} />}
                  <span style={{ position: 'absolute', left: 8, bottom: 8, padding: '4px 8px', borderRadius: 6, background: S.chipOnVideo, fontSize: 11, fontWeight: 600 }}>You</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Voice roster */}
        <p style={sectionLabel}>In voice</p>
        {voiceOnly.length === 0 ? (
          <p style={{ fontSize: 13, color: C.textDim }}>Just you here. Invite a squadmate.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(${wide ? 3 : 2}, minmax(0,1fr))` }}>
            {voiceOnly.map((s) => (
              <VoiceRow key={s.uid} seat={s} speaking={!!speaking[s.uid]} />
            ))}
          </div>
        )}
      </main>

      {/* Bottom bar. SquadStreamScreen.jsx:427. */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px', flexShrink: 0, background: '#100E1A' }}>
        <CallBtn icon={micOn ? 'mic' : 'mic_off'} label={micOn ? 'Mute mic' : 'Unmute mic'}
          tone={micOn ? 'neutral' : 'danger'} onClick={() => setMicOn((v) => !v)} />
        <CallBtn icon={camOn ? 'videocam' : 'videocam_off'} label={camOn ? 'Turn off camera' : 'Turn on camera'}
          tone={camOn ? 'on' : 'neutral'} onClick={() => setCamOn((v) => !v)}
          disabled={!camOn && squadCams >= MAX_VIDEO_PUBLISHERS} />
        <CallBtn icon="call_end" label="Leave hangout" tone="danger" onClick={() => setPhase('ended')} />
      </footer>

      {/* ⚠ THE CAMERA CAP IS EXPLAINED WHERE IT BITES, NOT IN A TOAST THAT HAS
          ALREADY GONE. SquadStreamScreen shows a toast reading "2 cameras
          already live, ask one of them to turn off"; a toast is gone in three
          seconds and the button stays disabled with no reason attached to it.
          A line under the disabled control costs nothing and is still there
          when the person looks back at it. */}
      {!camOn && squadCams >= MAX_VIDEO_PUBLISHERS && (
        <p style={{
          position: 'absolute', left: 16, right: 16, bottom: 82, margin: 0, textAlign: 'center',
          fontSize: 11.5, color: C.textDim,
        }}>
          {MAX_VIDEO_PUBLISHERS} cameras already live. Ask one of them to turn off, or wait.
        </p>
      )}
    </div>
  );
}

const sectionLabel = {
  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em',
  color: '#9298ab', margin: '0 0 8px', fontWeight: 700,
};
