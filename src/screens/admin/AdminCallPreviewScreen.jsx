// AdminCallPreviewScreen, mounted at /admin/call-preview
//
// A working simulator of every CALL surface, so each one can be seen and
// screenshot without a second real account on a second real device.
//
// ⚠ IT SIMULATES, IT DOES NOT FUNCTION. No getUserMedia, no RTCPeerConnection,
// no SFU socket, no Firestore, no callable, no wallet. Production call code is
// not imported for behaviour and nothing on this screen can modify it.
//
// ⚠ WHY EVERY SURFACE HERE IS A COPY, unlike the stream preview. That tool
// IMPORTS JoinAnnouncer, StreamGoalBar and the alert overlays, because they take
// props and nothing else, so importing is read-only and cannot drift. Nothing on
// a call screen is prop-only: CallScreen owns a peer connection, GroupCallScreen
// subscribes to a module singleton, VoiceChannelScreen reads Firestore and joins
// the SFU on mount. Importing any of them would open a real socket and ask for
// the camera from inside an admin page. Each copy records its source file and
// line at the copy site; change the real screen and change the copy.
//
// ⚠ THE UPLOAD RAIL IS SHARED WITH THE STREAM PREVIEW, deliberately. Same cast,
// same IndexedDB store, same uids, so a face uploaded in one tool is that
// person's face in the other with no second upload.
//
// ⚠ THE COPY ON THIS SCREEN IS SHIPPED. Nothing may read as a placeholder.

import { useState } from 'react';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import Icon from '../../components/Icon';
import { PreviewAssetsProvider } from './streamPreview/previewAssetsContext';
import { VIDEO_SLOTS } from './streamPreview/previewAssets';
import useCallSim from './callPreview/useCallSim';
import { CAST, PREVIEW_VIEWER } from './callPreview/callCast';
import PreviewOneToOne from './callPreview/PreviewOneToOne';
import PreviewGroupCall from './callPreview/PreviewGroupCall';
import PreviewSquadCall from './callPreview/PreviewSquadCall';
import PreviewVoiceChannel from './callPreview/PreviewVoiceChannel';
import {
  PreviewIncomingRing, PreviewCallsHub, PreviewVoicePill,
  PreviewCallRows, PreviewChannelModals,
} from './callPreview/PreviewCallOther';

// ⚠ REAL DEVICE VIEWPORTS, IN CSS PIXELS, NOT ROUNDED GUESSES. A capture taken
// at 393x852 and one at 375x667 lay out differently: a 3-column tile grid, the
// safe-area inset and every clamp() move. The same list the stream preview uses,
// so a call capture and a stream capture composite into the same device frame.
//
// ⚠ NO DRAWN BEZEL (founder): captures get composited into a real device frame
// afterwards, and a bezel here would end up nested inside a second one.
const DEVICES = [
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', w: 393, h: 852 },
  { id: 'iphone-15-pro-max', label: '15 Pro Max', w: 430, h: 932 },
  { id: 'iphone-se', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'pixel-8', label: 'Pixel 8', w: 412, h: 915 },
  { id: 'galaxy-s24', label: 'Galaxy S24', w: 360, h: 780 },
  { id: 'ipad-mini', label: 'iPad mini', w: 744, h: 1133 },
];

// ⚠ THE SURFACE LIST IS THE INVENTORY. Every call surface in the product is in
// here, including the four that are not a call screen (the ring, the hub, the
// pill, the in-thread row). A surface missing from this list is a surface that
// cannot be designed or captured, which is how the avatar orbit shipped visible
// to nobody but its owner.
const SURFACES = [
  { id: 'voice', label: '1:1 voice', group: 'Calls' },
  { id: 'video', label: '1:1 video', group: 'Calls' },
  { id: 'group', label: 'Group call', group: 'Calls' },
  { id: 'squad', label: 'Squad hangout', group: 'Calls' },
  { id: 'channel', label: 'Voice channel', group: 'Calls' },
  { id: 'ring', label: 'Incoming ring', group: 'Around a call' },
  { id: 'hub', label: 'Calls hub', group: 'Around a call' },
  { id: 'pill', label: 'Floating pill', group: 'Around a call' },
  { id: 'rows', label: 'In-thread rows', group: 'Around a call' },
  { id: 'create', label: 'New channel', group: 'Around a call' },
  { id: 'invite', label: 'Invite to channel', group: 'Around a call' },
];

// Which surfaces care about which controls. Kept as data so a control cannot be
// left showing on a surface it does nothing to, which is the defect the stream
// preview's rail hit twice (a replay picker hidden on the only phase it applied
// to, and a scene toggle missing from the one surface that needed it).
const USES = {
  phase: ['voice', 'video', 'group', 'squad', 'channel'],
  quality: ['voice', 'video', 'group', 'squad', 'channel'],
  seats: ['group', 'squad', 'channel', 'pill'],
  self: ['voice', 'video', 'group', 'squad', 'channel'],
  ring: ['ring'],
  channel: ['channel'],
};
const uses = (key, surface) => USES[key].includes(surface);

function Seg({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 3, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => onChange(o.value)} style={{
          padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
          background: value === o.value ? `linear-gradient(135deg, ${C.accent2}, ${C.accent})` : 'transparent',
          color: value === o.value ? '#fff' : C.textDim,
        }}>{o.label}</button>
      ))}
    </div>
  );
}

const chip = (on) => ({
  padding: '5px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  background: on ? `linear-gradient(135deg, ${C.accent2}, ${C.accent})` : C.card,
  color: on ? '#fff' : C.textDim,
  border: `1px solid ${on ? 'transparent' : C.border}`,
});

function Panel({ title, children }) {
  return (
    <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: C.textDim, fontWeight: 600 }}>
      {label}
      {children}
    </label>
  );
}

/**
 * What is broken in the shipped call screens, found while building this.
 *
 * ⚠⚠ THIS PANEL IS THE POINT OF THE TOOL, NOT DECORATION. A simulator that
 * quietly designs around a defect turns it into a screenshot nobody ever fixes.
 * Every line here was checked against the file named, not remembered. A fix
 * lands in the real file and the line comes out of this list.
 */
const FINDINGS = [
  {
    where: 'CallScreen.jsx:346',
    what: 'The speaker button flips a state nothing reads.',
    why: 'No setSinkId anywhere in the file, so the button restyles itself and the audio keeps coming out of the earpiece. NOT fixed with the others on 2026-09-06 on purpose: setSinkId is unsupported in the Android WebView, so a web-only fix would leave the native app exactly as broken while looking done. The real fix is an AudioManager route through the Kotlin bridge, which is an APK change and is batched.',
  },
  {
    where: 'no file',
    what: 'No call surface reads getStats(). There is no connection-quality signal anywhere.',
    why: 'A call degrades in silence and then dies with "Connection failed". The three-bar pill in this preview is a PROPOSAL, not something that ships, building it is a design decision, not a defect fix.',
  },
  {
    where: 'IncomingCallManager.jsx',
    what: 'A second, older incoming-call ringer that is imported nowhere.',
    why: 'AppRouter mounts IncomingCallOverlay only. Dead file, and it holds a divergent copy of the accept and decline rules, so it is the file a session fixes by mistake. Deleting it needs permission; nothing may be removed without asking.',
  },
];

// Fixed at the source on 2026-09-06 and kept here as a record, because a defect
// that quietly disappears from a list teaches nobody anything. Guard rule 15 now
// asserts each FIX, so a revert fails the build.
const FIXED = [
  ['CallScreen.jsx', 'Flip camera had no onClick at all, a dead button for the life of the feature. Now replaceTrack on the existing sender, so it needs no renegotiation.'],
  ['CallScreen.jsx', 'A failed call offered only a full page reload. Retry now re-runs the WebRTC setup in place, and the teardown finally stops the camera and mic.'],
  ['IncomingCallOverlay.jsx', 'Every ring printed "Encrypted P2P Call", including group ones that route through our own SFU. Group rings now say Group Call.'],
  ['GroupCallScreen.jsx', 'A head count with no duration. There is a clock now, started when the call goes live rather than on mount.'],
  ['SquadStreamScreen.jsx', 'The two-camera cap was explained by a toast a disabled button never fires. The reason is a permanent line under the controls.'],
  ['VoiceChannelScreen.jsx', 'The volume slider pushed the roster off a 360px screen: a range input resolves min-width:auto to an intrinsic 129px, so flex-1 could not shrink it.'],
];

export default function AdminCallPreviewScreen() {
  const [surface, setSurface] = useState('video');
  const [device, setDevice] = useState('mobile');
  const [deviceId, setDeviceId] = useState('iphone-15-pro');
  const [role, setRole] = useState('caller');
  const [isStarter, setIsStarter] = useState(true);
  const [channelState, setChannelState] = useState('live');

  const sim = useCallSim();
  const dev = DEVICES.find((d) => d.id === deviceId) || DEVICES[0];
  const mobile = device === 'mobile';
  const frameW = mobile ? dev.w : '100%';
  const frameH = mobile ? dev.h : 640;
  // ⚠ THE FRAME PUBLISHES ITS OWN HEIGHT. A screen inside it has no other way to
  // size against it: `vh` measures the ADMIN's browser window, and a `%` height
  // only resolves if the parent's height is definite. Same variable name the
  // stream preview uses so a component moved between the two still resolves.
  const frameVars = { '--vg-frame-h': typeof frameH === 'number' ? `${frameH}px` : frameH };

  // ⚠ THE WHOLE SIM GOES THROUGH THE PROVIDER, NOT A PROP LIST. The stream
  // preview maintained `simProps` by hand and it silently dropped something four
  // separate times, each one leaving a control mounted with nothing feeding it,
  // and the founder found every one of them. There is no list here to forget to
  // update.
  const stage = (() => {
    switch (surface) {
      case 'voice': return <PreviewOneToOne video={false} role={role} />;
      case 'video': return <PreviewOneToOne video role={role} />;
      case 'group': return <PreviewGroupCall wide={!mobile} isStarter={isStarter} />;
      case 'squad': return <PreviewSquadCall wide={!mobile} />;
      case 'channel': return <PreviewVoiceChannel wide={!mobile} state={channelState} />;
      case 'ring': return <PreviewIncomingRing />;
      case 'hub': return <PreviewCallsHub wide={!mobile} />;
      case 'pill': return <PreviewVoicePill />;
      case 'rows': return <PreviewCallRows />;
      case 'create': return <PreviewChannelModals which="create" />;
      case 'invite': return <PreviewChannelModals which="invite" />;
      default: return null;
    }
  })();

  // Which seat list the Seats panel edits, so one panel serves three rooms
  // rather than three panels drifting apart.
  const seatSet = surface === 'squad'
    ? { seats: sim.squad, set: sim.setSquadSeat, cams: true, capName: '2 cameras' }
    : surface === 'channel'
      ? { seats: sim.channel, set: sim.setChannelSeat, cams: false, capName: 'voice only' }
      : { seats: sim.group, set: sim.setGroupSeat, cams: true, capName: '8 cameras' };

  return (
    <AdminShell
      screen="call-preview"
      title="Call Preview"
      subtitle="A working simulator of every call surface. Nothing here is live: no camera, microphone, peer connection, SFU or Firestore."
    >
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>

        {/* ── top rail ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <select value={surface} onChange={(e) => setSurface(e.target.value)} aria-label="Surface"
            style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {['Calls', 'Around a call'].map((g) => (
              <optgroup key={g} label={g}>
                {SURFACES.filter((s) => s.group === g).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <Seg label="Device" options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} value={device} onChange={setDevice} />
          {mobile && (
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Device size"
              style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.w}x{d.h}</option>)}
            </select>
          )}

          {/* ⚠ CALLER AND CALLEE ARE DIFFERENT SCREENS AND ONLY ONE OF THEM
              SAYS "Ringing". CallScreen sets 'ringing' for the caller and
              'connecting' for the callee, so a capture has to be able to pick. */}
          {(surface === 'voice' || surface === 'video') && (
            <Seg label="Side" options={[{ value: 'caller', label: 'I called' }, { value: 'callee', label: 'They called' }]} value={role} onChange={setRole} />
          )}
          {surface === 'group' && (
            <Seg label="Who started it" options={[{ value: true, label: 'I started it' }, { value: false, label: 'Someone else did' }]} value={isStarter} onChange={setIsStarter} />
          )}
          {surface === 'channel' && (
            <Seg label="Channel state" options={[{ value: 'live', label: 'In channel' }, { value: 'locked', label: 'Private' }, { value: 'missing', label: 'Deleted' }]} value={channelState} onChange={setChannelState} />
          )}
        </div>

        {/* ── stage + rail ── */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', justifyContent: 'center', position: 'sticky', top: 12 }}>
            <div style={{
              position: 'relative', width: frameW, height: frameH, ...frameVars,
              maxWidth: mobile ? undefined : 1000, overflow: 'hidden',
              borderRadius: mobile ? 0 : 14, background: '#000',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            }}>
              <PreviewAssetsProvider avatars={sim.avatars} videos={sim.videos} sim={sim} role="viewer">
                {stage}
              </PreviewAssetsProvider>
            </div>
          </div>

          <div style={{ flex: '0 0 320px', display: 'grid', gap: 12, minWidth: 260 }}>

            {uses('phase', surface) && (
              <Panel title="Call state">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    ['connecting', 'Connecting'],
                    ['ringing', 'Ringing'],
                    ['active', 'Connected'],
                    ['reconnecting', 'Reconnecting'],
                    ['failed', 'Failed'],
                    ['ended', 'Ended'],
                  ].map(([id, label]) => (
                    <button key={id} onClick={() => sim.setPhase(id)} style={chip(sim.phase === id)}>{label}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  A 1:1 call uses all six. The SFU rooms (group, squad, channel)
                  only ever report connecting, live or error, and a group call
                  stays ringing for its whole life so late members keep being rung.
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>DURATION</div>
                <Field label={`${Math.floor(sim.elapsed / 60)}m ${sim.elapsed % 60}s`}>
                  <input type="range" min={0} max={7200} step={5} value={sim.elapsed}
                    onChange={(e) => sim.setElapsed(Number(e.target.value))} />
                </Field>
              </Panel>
            )}

            {uses('quality', surface) && (
              <Panel title="Connection">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['good', 'Good'], ['fair', 'Unstable'], ['poor', 'Weak']].map(([id, label]) => (
                    <button key={id} onClick={() => sim.setQuality(id)} style={chip(sim.quality === id)}>{label}</button>
                  ))}
                </div>
                {/* ⚠ SAY IT ON THE CONTROL, not only in a code comment. A rail
                    that lets an admin capture a feature the product does not
                    have is how an unbuilt thing reaches a store listing. */}
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 10, lineHeight: 1.5 }}>
                  Not built. No call surface reads getStats() today, so a call
                  degrades silently and then fails. This is a proposal.
                </div>
              </Panel>
            )}

            {uses('self', surface) && (
              <Panel title="You">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button onClick={() => sim.setMicOn((v) => !v)} style={chip(!sim.micOn)}>
                    {sim.micOn ? 'Mic on' : 'Muted'}
                  </button>
                  {surface !== 'channel' && (
                    <button onClick={() => sim.setCamOn((v) => !v)} style={chip(sim.camOn)}>
                      {sim.camOn ? 'Camera on' : 'Camera off'}
                    </button>
                  )}
                  {(surface === 'voice' || surface === 'video') && (
                    <>
                      <button onClick={() => sim.setMuted((v) => !v)} style={chip(sim.muted)}>
                        {sim.muted ? 'Track muted' : 'Track live'}
                      </button>
                      <button onClick={() => sim.setVideoOff((v) => !v)} style={chip(sim.videoOff)}>
                        {sim.videoOff ? 'Self view off' : 'Self view on'}
                      </button>
                      <button onClick={() => sim.setSpeakerOn((v) => !v)} style={chip(sim.speakerOn)}>
                        {sim.speakerOn ? 'Speaker' : 'Earpiece'}
                      </button>
                    </>
                  )}
                </div>
                {surface === 'video' && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>CONTROLS</div>
                    {/* ⚠ THE FADE IS A REAL BEHAVIOUR AND A CAPTURE MUST NOT
                        RACE IT. The shipped video call hides its controls 4s
                        after they were last shown, so half the time you cannot
                        screenshot the state you wanted. */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => sim.setControls(true)} style={chip(sim.controls)}>Showing</button>
                      <button onClick={() => sim.setControls(false)} style={chip(!sim.controls)}>Faded out</button>
                    </div>
                  </>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>SPEAKING RING</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => sim.setSpeakingOn(true)} style={chip(sim.speakingOn)}>Rotating</button>
                  <button onClick={() => sim.setSpeakingOn(false)} style={chip(!sim.speakingOn)}>Nobody</button>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
                  Moves every 1.8s through whoever has their mic on. A muted seat
                  never lights up, which is the same guard the real RMS loop carries.
                </div>
              </Panel>
            )}

            {uses('seats', surface) && (
              <Panel title={`In the room · ${seatSet.capName}`}>
                <Field label={`People · ${sim.guestCount}`}>
                  <input type="range" min={0} max={7} step={1} value={sim.guestCount}
                    onChange={(e) => sim.setGuestCount(Number(e.target.value))} />
                </Field>
                <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                  {seatSet.seats.map((s) => (
                    <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 8, background: C.card }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                      <button onClick={() => seatSet.set(s.uid, { micOn: !s.micOn })}
                        aria-label={`${s.name} microphone`} title="Mic"
                        style={{ ...chip(s.micOn), padding: '3px 7px', display: 'grid' }}>
                        <Icon name={s.micOn ? 'mic' : 'mic_off'} size={13} />
                      </button>
                      {seatSet.cams && (
                        <button onClick={() => seatSet.set(s.uid, { camOn: !s.camOn })}
                          aria-label={`${s.name} camera`} title="Camera"
                          style={{ ...chip(s.camOn), padding: '3px 7px', display: 'grid' }}>
                          <Icon name={s.camOn ? 'videocam' : 'videocam_off'} size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  {/* ⚠ THE CAP IS THE SERVER'S, NOT A LAYOUT PREFERENCE. Turning
                      on a third squad camera here would advertise a state the SFU
                      rejects, so the control disables at the cap exactly as the
                      product does. */}
                  A seat whose camera is off keeps its seat and shows their avatar.
                  The grid never reshuffles when somebody goes quiet.
                </div>
              </Panel>
            )}

            {uses('ring', surface) && (
              <Panel title="Incoming call">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['direct', 'One to one'], ['group', 'Group'], ['paid', 'Paid session']].map(([id, label]) => (
                    <button key={id} onClick={() => sim.setRingKind(id)} style={chip(sim.ringKind === id)}>{label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => sim.setRingVideo(false)} style={chip(!sim.ringVideo)}>Voice</button>
                  <button onClick={() => sim.setRingVideo(true)} style={chip(sim.ringVideo)}>Video</button>
                </div>
                {sim.ringKind === 'paid' && (
                  <div style={{ marginTop: 12 }}>
                    <Field label={`Price · ${sim.ringPrice.toLocaleString()}c`}>
                      <input type="range" min={0} max={5000} step={50} value={sim.ringPrice}
                        onChange={(e) => sim.setRingPrice(Number(e.target.value))} />
                    </Field>
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  Declining a GROUP call dismisses it on this device only. It
                  keeps ringing everyone who has not answered, because declining
                  is stepping out, not hanging up on the room.
                </div>
              </Panel>
            )}

            {uses('channel', surface) && (
              <Panel title="Channel">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button onClick={() => sim.setOwner(true)} style={chip(sim.owner)}>I own it</button>
                  <button onClick={() => sim.setOwner(false)} style={chip(!sim.owner)}>I am a member</button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => sim.setChannelPrivate(true)} style={chip(sim.channelPrivate)}>Private</button>
                  <button onClick={() => sim.setChannelPrivate(false)} style={chip(!sim.channelPrivate)}>Public</button>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  Invite, delete and remove-member are owner only. Their absence
                  is the member's view, not a broken header.
                </div>
              </Panel>
            )}

            {/* ⚠ THE UPLOAD RAILS ARE THE SAME STORE THE STREAM PREVIEW USES.
                A face uploaded there is this person's face here, and the other
                way round. Files stay in this browser (IndexedDB); nothing is
                uploaded anywhere. */}
            <Panel title="Camera clips">
              <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
                One clip per tile, all muted and looping. Shared with the stream
                preview, so anything loaded there is already here. Kept between visits.
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {VIDEO_SLOTS.map((v) => {
                  const url = sim.videos[v.id] || null;
                  return (
                    <div key={v.id} style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>{v.label}</span>
                        {url && <span style={{ fontSize: 10, fontWeight: 700, color: C.accent2 }}>loaded</span>}
                      </div>
                      {url && (
                        <video src={url} autoPlay muted loop playsInline
                          style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, background: '#000', border: `1px solid ${C.border}` }} />
                      )}
                      <div style={{ display: 'flex', gap: 7 }}>
                        <label style={{
                          flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                          background: url ? C.card : `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
                          border: url ? `1px solid ${C.border}` : 'none',
                          color: '#fff', fontSize: 12, fontWeight: 700,
                        }}>
                          <Icon name="movie" size={15} />
                          {url ? 'Replace' : 'Upload'}
                          <input type="file" accept="video/*" style={{ display: 'none' }}
                            onChange={(e) => sim.setVideo(v.id, e.target.files?.[0] || null)} />
                        </label>
                        {url && (
                          <button onClick={() => sim.setVideo(v.id, null)} style={{ ...chip(false), padding: '8px 12px' }}>Remove</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Faces">
              <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
                An uploaded face is used everywhere that person appears, on both
                simulators. Every default is a deterministic identicon, never a
                real or generated face: captures from here get published, and a
                likeness would be a claim about a user who does not exist.
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {[{ ...PREVIEW_VIEWER, displayName: `${PREVIEW_VIEWER.displayName} (you)` }, ...CAST].map((c) => (
                  <div key={c.uid} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <img src={sim.avatars[c.uid] || c.avatar} alt=""
                      style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.displayName}
                    </span>
                    {sim.avatars[c.uid] && (
                      <button onClick={() => sim.clearAvatar(c.uid)} aria-label={`Remove ${c.displayName}'s photo`} title="Remove"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, display: 'grid' }}>
                        <Icon name="close" size={13} />
                      </button>
                    )}
                    <label style={{
                      padding: '4px 9px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                      background: C.card, border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, fontWeight: 600,
                    }}>
                      {sim.avatars[c.uid] ? 'Change' : 'Upload'}
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={(e) => sim.setAvatar(c.uid, e.target.files?.[0])} />
                    </label>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={`What is broken · ${FINDINGS.length}`}>
              <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
                Found by reading the shipped call screens while building this.
                Each is checked against the file named. A fix lands in that file
                and the line comes out of this list.
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {FINDINGS.map((f) => (
                  <div key={f.where + f.what} style={{ background: C.card, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.accent2, marginBottom: 4 }}>{f.where}</div>
                    <div style={{ fontSize: 11.5, color: C.text, fontWeight: 600, lineHeight: 1.45 }}>{f.what}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5, marginTop: 4 }}>{f.why}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* ⚠ THE RECORD STAYS ON SCREEN. A defect that simply vanishes from
                the list above teaches nobody anything, and the next session
                rediscovers it as new. Guard rule 15 asserts each of these fixes
                is still in the real file, so a revert fails the build. */}
            <Panel title={`Fixed at the source · ${FIXED.length}`}>
              <div style={{ display: 'grid', gap: 8 }}>
                {FIXED.map(([file, what]) => (
                  <div key={file + what} style={{ background: C.card, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#4ade80', marginBottom: 4 }}>{file}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{what}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Reset">
              <button onClick={sim.reset} style={{ ...chip(false), padding: '8px 12px' }}>
                Back to a fresh call
              </button>
            </Panel>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
