// The group call. The SIMULATOR copy.
//
// Copied layout source: src/screens/messages/GroupCallScreen.jsx:150-256.
//
// ⚠ A GROUP CALL IS NOT A BIGGER 1:1. It routes through the Pion SFU (never
// call it Jitsi) because a mesh would have every phone encoding one stream per
// peer. The consequences the UI has to carry: a camera cap of 8
// (MAX_CALL_VIDEO, mirroring maxCallVideoPublishers in infra/sfu/main.go), a
// grid rather than a stage, and "End for all" existing only for the person who
// started it.
//
// ⚠ THE CALL STAYS 'ringing' FOR ITS WHOLE LIFE, which is the detail that
// surprises everyone reading the code: members who have not answered must keep
// being rung, so joining suppresses YOUR ring, not theirs (GroupCallScreen:96).
// It is why the header reads "N in call" rather than a phase.

import Icon from '../../../components/Icon';
import { usePreviewSim } from '../streamPreview/previewAssetsContext';
import { CallBtn, CallTile, QualityPill, useSeatVideo, S, C, FONT } from './callChrome';
import { PREVIEW_GROUP } from './callCast';

// Mirrors MAX_CALL_VIDEO in src/utils/groupCall.js, which mirrors the SFU.
const MAX_CALL_VIDEO = 8;

export default function PreviewGroupCall({ wide = false, isStarter = true }) {
  const sim = usePreviewSim();
  const {
    phase, group, camOn, setCamOn, micOn, setMicOn, speakingFor, groupCams,
    quality, me, setPhase, elapsed,
  } = sim;
  const seatVideo = useSeatVideo();
  const speaking = speakingFor(group);
  const connecting = phase === 'connecting';

  // The self seat is a seat like any other, so one tile component draws
  // everybody and the two can never look different by accident.
  const meSeat = { ...me, name: 'You', micOn, camOn, avatar: me.avatar };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff',
      fontFamily: FONT, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* header. GroupCallScreen.jsx:157 */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexShrink: 0 }}>
        <button type="button" aria-label="Minimise the call" style={{
          width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: S.chip, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon name="expand_more" size={20} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {PREVIEW_GROUP.groupName}
          </p>
          <p style={{ margin: 0, fontSize: 11.5, color: C.textDim }}>
            {connecting ? 'Connecting' : phase === 'failed' ? 'Connection error' : `${group.length + 1} in call`}
            {/* ⚠ THE CALL DURATION IS NOT SHOWN ON THE SHIPPED GROUP SCREEN AND
                IT SHOULD BE. GroupCallScreen prints the head count and nothing
                else; the 1:1 screen has a running clock and people expect one.
                Added here so the gap is visible rather than argued about. */}
            {phase === 'active' && ` · ${Math.floor(elapsed / 60)}m`}
          </p>
        </div>
        {phase === 'active' && <QualityPill quality={quality} compactMode />}
        {/* ⚠ THE CAP CHIP APPEARS ONLY WHEN IT BITES. A permanent "8 cameras
            max" reads as a limitation being advertised; appearing at the moment
            somebody cannot turn their camera on is when it explains something.
            GroupCallScreen.jsx:172 already gets this right. */}
        {groupCams >= MAX_CALL_VIDEO && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.textDim, padding: '5px 9px', borderRadius: 999, background: S.chip, flexShrink: 0 }}>
            {MAX_CALL_VIDEO} cameras max
          </span>
        )}
      </header>

      {/* ⚠ THE ERROR LINE IS A BANNER, NOT A DEAD CALL. A camera that could not
          publish past the cap must not fail the whole join: losing your camera
          is not losing the call, so the room stays up on voice and says why.
          groupCall.js:206 already does exactly this. */}
      {phase === 'failed' && (
        <p style={{
          margin: '0 16px 8px', fontSize: 11.5, color: C.amber,
          background: '#2A1F08', borderRadius: 10, padding: '9px 12px',
        }}>
          Camera limit reached ({MAX_CALL_VIDEO} cameras). You are still in the call on voice.
        </p>
      )}

      {/* tiles */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px', minHeight: 0 }}>
        <div style={{
          display: 'grid',
          // GroupCallScreen: grid-cols-2 lg:grid-cols-3. Portrait tiles on a
          // phone, 16:9 once there is room, which is the shipped `aspect-[3/4]
          // sm:aspect-video`.
          gridTemplateColumns: `repeat(${wide ? 3 : 2}, minmax(0, 1fr))`,
          gap: 8,
        }}>
          <CallTile seat={meSeat} isMe speaking={!!speaking.me} videoUrl={seatVideo(0)} seed={0} aspect={wide ? '16 / 9' : '3 / 4'} />
          {group.map((s, i) => (
            <CallTile key={s.uid} seat={s} speaking={!!speaking[s.uid]}
              videoUrl={seatVideo(i + 1)} seed={i + 1} aspect={wide ? '16 / 9' : '3 / 4'} />
          ))}
        </div>

        {phase === 'active' && group.length === 0 && (
          <p style={{ textAlign: 'center', fontSize: 12, color: C.textDim, marginTop: 32 }}>
            Waiting for others to join
          </p>
        )}
      </main>

      {/* controls. GroupCallScreen.jsx:224 */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '18px 16px 24px', flexShrink: 0 }}>
        <CallBtn icon={micOn ? 'mic' : 'mic_off'} label={micOn ? 'Mute' : 'Unmute'}
          tone={micOn ? 'neutral' : 'alert'} onClick={() => setMicOn((v) => !v)} />
        <CallBtn icon={camOn ? 'videocam' : 'videocam_off'} label={camOn ? 'Turn camera off' : 'Turn camera on'}
          tone={camOn ? 'on' : 'neutral'} onClick={() => setCamOn((v) => !v)}
          disabled={!camOn && groupCams >= MAX_CALL_VIDEO} />
        <CallBtn icon="call_end" label="Leave the call" tone="danger" iconSize={26} onClick={() => setPhase('ended')} />
        {/* ⚠ ONLY THE PERSON WHO STARTED IT CAN END IT FOR EVERYONE
            (GroupCallScreen.jsx:246 gates on call.callerId). Everyone else just
            leaves, and the LAST person out ends the call so an empty room stops
            ringing the people who never answered. */}
        {isStarter && (
          <button type="button" onClick={() => setPhase('ended')} style={{
            height: 56, padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: S.chip, color: C.textDim, fontSize: 11.5, fontWeight: 700,
          }}>
            End for all
          </button>
        )}
      </footer>
    </div>
  );
}
