// AdminStreamPreviewScreen — /admin/stream-preview
//
// A working simulator of the live-stream UI, so every stream surface can be
// SCREENSHOT without going live and without a second real account.
//
// ⚠ IT SIMULATES, IT DOES NOT FUNCTION. No camera, no ingest, no Firestore, no
// relay socket, no callable, no wallet. Production streaming code is not
// imported for behaviour and is never modified by anything on this screen.
//
// ⚠ WHY THE SCREENSHOTS CAN BE TRUSTED. The entry ribbon, tip goal, tip alert
// and sub alert are the REAL components (they take props and nothing else, so
// importing them is read-only and cannot drift). Everything with a data
// dependency — chat rows, the tip sheet, the profile sheet — is a copy of the
// shipped markup, with its source file and line noted at the copy site in
// PreviewMobileViewer.jsx. If you change the real viewer, update the copies.
//
// ⚠ THE COPY ON THIS SCREEN IS SHIPPED. Play store screenshots come from here,
// so nothing may read as a placeholder. See previewCast.js.

import { useState } from 'react';
import { PREVIEW_PUBLISHERS } from './streamPreview/PreviewStreamStages';
import { VIDEO_SLOTS } from './streamPreview/previewAssets';
import { PreviewAssetsProvider } from './streamPreview/previewAssetsContext';
import { PreviewSheets } from './streamPreview/previewChrome';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import Icon from '../../components/Icon';
import { makePreviewStreamDoc, PREVIEW_HOST } from './streamPreview/previewStream';
import PreviewBroadcasterScreen from './streamPreview/PreviewBroadcasterScreen';
import PreviewViewerScreen from './streamPreview/PreviewViewerScreen';
import PreviewDesktopViewer from './streamPreview/PreviewDesktopViewer';
import PreviewMobileViewer from './streamPreview/PreviewMobileViewer';
import { PreviewGoLive, PreviewNativeGoLive, PreviewStreamEnded } from './streamPreview/PreviewEndAndSetup';
import {
  PreviewAnalytics, PreviewModeration, PreviewCoHostSetup,
  PreviewSquadStream, PreviewBoostSheet, PreviewVergrMeBanner,
} from './streamPreview/PreviewRemaining';
import useStreamSim from './streamPreview/useStreamSim';
import { CAST, PREVIEW_VIEWER } from './streamPreview/previewCast';
import { PREVIEW_ROLES } from './streamPreview/previewRoles';
import { PLAYBACK_STATES, CHAT_STATES, TTS_STATES, HEALTH_STATES } from './streamPreview/previewStates';


// ⚠ REAL DEVICE VIEWPORTS, IN CSS PIXELS, NOT ROUNDED GUESSES. A capture taken
// at 402x874 and one taken at 390x844 lay out differently — 30vh chat, the
// safe-area inset and every clamp() move — so the frame size has to be a real
// device or the screenshot is of a phone nobody owns.
//
// ⚠ THE PHONE CHROME IS GONE ON PURPOSE (founder): captures get composited into
// a real device frame afterwards, the way /platform does its hero art, so a
// drawn bezel here would end up nested inside a second bezel.
const DEVICES = [
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', w: 393, h: 852 },
  { id: 'iphone-15-pro-max', label: '15 Pro Max', w: 430, h: 932 },
  { id: 'iphone-se', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'pixel-8', label: 'Pixel 8', w: 412, h: 915 },
  { id: 'galaxy-s24', label: 'Galaxy S24', w: 360, h: 780 },
  { id: 'ipad-mini', label: 'iPad mini', w: 744, h: 1133 },
];
function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 3 }}>
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

function Btn({ children, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      background: accent ? `linear-gradient(135deg, ${C.accent2}, ${C.accent})` : C.card2,
      color: accent ? '#fff' : C.text,
      border: accent ? 'none' : `1px solid ${C.border}`,
      display: 'inline-flex', alignItems: 'center', gap: 7,
    }}>{children}</button>
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

// One chip style for every state selector in the rail.
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

export default function AdminStreamPreviewScreen() {
  // ⚠ A BROADCAST HAS THREE PHASES AND THE FIRST BUILD ONLY COVERED THE MIDDLE
  // ONE. Setup and Ended are the two screens you cannot reach without actually
  // starting or finishing a stream, which is precisely what this tool exists to
  // avoid. See docs/STREAM_PREVIEW_PLAN.md §3.
  const [phase, setPhase] = useState('live');   // setup | live | ended
  const [gated, setGated] = useState(false);
  const [other, setOther] = useState('cohost-setup');
  const [role, setRole] = useState('viewer');
  // Which KIND of viewer: plain / appointed stream moderator / Vanguard.
  const [viewerRole, setViewerRole] = useState('viewer');
  const [device, setDevice] = useState('mobile');
  const [live, setLive] = useState(true);
  const [streamType, setStreamType] = useState('solo');
  // ⚠ TWO CO-HOST LAYOUTS, HOST-SELECTABLE, as the reference has: PANEL (host on
  // the main screen, guests secondary — the mode for one-on-one and for guest
  // AUDIO chatting) and GRID (equal exposure). `camsOff` holds the seat indexes
  // whose camera is off; those seats stay put and show the person's avatar
  // rather than the grid reshuffling mid-stream.
  const [cohostLayout, setCohostLayout] = useState('grid');
  const [camsOff, setCamsOff] = useState([]);
  const [guestCount, setGuestCount] = useState(2);
  const [soloView, setSoloView] = useState('immersive');
  const [scene, setScene] = useState('game');
  const [deviceId, setDeviceId] = useState('iphone-15-pro');
  const [backdrop, setBackdrop] = useState('gameplay');
  const dev = DEVICES.find((d) => d.id === deviceId) || DEVICES[0];

  const sim = useStreamSim(makePreviewStreamDoc);
  const { doc } = sim;

  const mobile = device === 'mobile';
  const showSoloView = mobile && role === 'viewer' && streamType === 'solo';
  const landscape = showSoloView && soloView === 'landscape';
  // Landscape swaps the chosen device's own axes rather than using a fixed size.
  const frameW = mobile ? (landscape ? dev.h : dev.w) : '100%';
  const frameH = mobile ? (landscape ? dev.w : dev.h) : 620;
  // ⚠⚠ THE FRAME PUBLISHES ITS OWN HEIGHT, because a screen inside it has no
  // other way to size against it. `vh` measures the ADMIN'S BROWSER WINDOW, and
  // a `%` height only resolves if the immediate parent's height is definite —
  // which it is not inside an absolutely-positioned `bottom: 10` box. Swapping
  // one for the other silently collapsed the chat on three viewer screens.
  // `calc(var(--vg-frame-h) * 0.34)` is definite everywhere, and follows the
  // device preset when it changes.
  const frameVars = { '--vg-frame-h': typeof frameH === 'number' ? `${frameH}px` : frameH };

  // ⚠ EVERY COMBINATION IS NOW FED BY THE SIMULATOR. These flags only choose
  // WHICH copy renders. If a new surface is ever added, give it {...simProps}
  // at the same moment, or it silently shows a frozen chat with no ribbons.
  const mobileImmersiveViewer = role === 'viewer' && mobile && streamType === 'solo' && soloView === 'immersive';
  const desktopViewer = role === 'viewer' && !mobile;
  const broadcaster = role === 'broadcaster';

  // Everything the simulator feeds a surface, in one object so a newly wired
  // screen cannot be given half of it by accident.
  const simProps = {
    // ⚠ ONE PLACE DECIDES WHICH ROOM IS ON SCREEN. Every surface reads `messages`
    // from here, so swapping the array is what makes the switch change the REAL
    // chat on all nine of them — rather than each screen growing its own second
    // panel, which is what the founder rejected.
    messages: sim.chatChannel === 'mods' ? sim.modMessages : sim.messages,
    joinEvents: sim.joinEvents,
    reactions: sim.reactions,   // read via usePreviewSim(), never passed down
    // ⚠ THE EMITTER TRAVELS WITH THE DATA. Passing `reactions` without
    // `fireReaction` gives a surface a display with nothing able to feed it,
    // which is exactly how the like button ended up inert on the split view.
    fireReaction: sim.fireReaction,
    // ⚠ UPLOADS GO IN simProps, NOT ON ONE SCREEN. A face uploaded for Riven has
    // to appear on every surface Riven appears on, and the looping video behind
    // every stream stage. Wiring them to a single component is how half the tool
    // ends up showing identicons while the other half shows the real thing.
    // ⚠ VIDEOS ARE NOT IN HERE ANY MORE, DELIBERATELY. `facecamVideo` was in
    // this object, went missing in an unrelated edit, and nothing failed — the
    // PiP just rendered empty. Videos come from the provider via
    // usePreviewVideos(), so there is no prop left to drop.
    avatars: sim.avatars,
    openSheet: sim.openSheet,
    onOpenSheet: sim.setOpenSheet,
    subscribed: sim.subscribed,
    chatHidden: sim.chatHidden,
    onToggleChat: () => sim.setChatHidden((v) => !v),
  };

  // ⚠ NATIVE GO LIVE IS A DIFFERENT SCREEN, not the web one in a phone frame:
  // sticky app bar, sectioned form, fixed CTA bar with the gate meter.
  const OTHER = {
    'cohost-setup': <PreviewCoHostSetup avatars={sim.avatars} />,
    'squad-stream': <PreviewSquadStream avatars={sim.avatars} />,
    'boost-sheet': <PreviewBoostSheet />,
    'vergrme': <PreviewVergrMeBanner />,
    analytics: <PreviewAnalytics doc={doc} />,
    moderation: <PreviewModeration avatars={sim.avatars} />,
  };

  // ⚠ THE PROVIDER WRAPS THE WHOLE STAGE, so a surface deep inside it can ask
  // for an uploaded face without every parent in between passing it down. This
  // is what stopped the profile sheet and the supporters cluster showing
  // identicons after the founder had uploaded real avatars.
  const stageInner = phase === 'other'
    ? OTHER[other]
    : phase === 'setup'
    ? (mobile ? <PreviewNativeGoLive doc={doc} gated={gated} onGoLive={() => setPhase('live')} /> : <PreviewGoLive doc={doc} gated={gated} onGoLive={() => setPhase('live')} />)
    : phase === 'ended'
    ? (
      <>
        {/* ⚠ SCHEDULING LIVES ON THE GO LIVE SCREEN, not on “Other”. Pointing it
            at the Other phase landed on Co-Stream Setup — a real destination, just
            the wrong one, which is the kind of miss that only shows up by following
            the button. (A JSX comment is also a CHILD, never an attribute — putting
            it between props is a parse error, fourth time this session.) */}
        <PreviewStreamEnded role={role} host={PREVIEW_HOST} vod={sim.vod} onDone={() => setPhase('live')}
          onShare={() => sim.setOpenSheet({ kind: 'share' })}
          onSchedule={() => setPhase('setup')} />
        {/* ⚠ THE SHEET HOST HAS TO EXIST ON THIS PHASE TOO. Every live surface
            mounts one; the ended screen did not, so its Share button was dead. */}
        <PreviewSheets openSheet={sim.openSheet} host={PREVIEW_HOST}
          onClose={() => sim.setOpenSheet(null)} onOpen={sim.setOpenSheet} />
      </>
    )
    : mobileImmersiveViewer
    ? <PreviewMobileViewer doc={doc} host={PREVIEW_HOST} backdrop={backdrop} {...simProps} />
    : desktopViewer
      ? <PreviewDesktopViewer doc={doc} host={PREVIEW_HOST} role={viewerRole} streamType={streamType} guestCount={guestCount} cohostLayout={cohostLayout} camsOff={camsOff} scene={scene} {...simProps} />
      : role === 'broadcaster'
        ? <PreviewBroadcasterScreen device={device} live={live} doc={doc} streamType={streamType} guestCount={guestCount} host={PREVIEW_HOST} cohostLayout={cohostLayout} camsOff={camsOff} onGoLive={() => setLive(true)} onEndStream={() => setPhase('ended')} {...simProps} />
        : <PreviewViewerScreen device={device} doc={doc} host={PREVIEW_HOST} streamType={streamType} guestCount={guestCount} soloView={soloView} scene={scene} cohostLayout={cohostLayout} camsOff={camsOff} {...simProps} />;

  // ⚠⚠ THE WHOLE SIM, NOT A HAND-PICKED LIST. `simProps` is an allowlist I
  // maintain by hand, and it has now silently dropped something FOUR times:
  // uploaded avatars, the PiP video, reactions, and then `combo` — so the combo
  // meter rendered on all six surfaces reading a value that never arrived, and
  // the founder found it again rather than me.
  //
  // Passing the hook's whole return means a surface can read anything the
  // simulator has. There is no list left to forget to update.
  const stage = (
    <PreviewAssetsProvider avatars={sim.avatars} videos={sim.videos} sim={sim} role={role === 'broadcaster' ? 'host' : viewerRole}>
      {stageInner}
    </PreviewAssetsProvider>
  );

  const goal = doc.goal || {};

  return (
    <AdminShell screen="stream-preview" title="Stream Preview" subtitle="A working simulator of the live-stream UI. Nothing here is live: no camera, ingest, Firestore or chat relay.">
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <Seg
            options={[{ value: 'setup', label: 'Go Live' }, { value: 'live', label: 'Live' }, { value: 'ended', label: 'Ended' }, { value: 'other', label: 'Other' }]}
            value={phase} onChange={setPhase}
          />
          {phase === 'setup' && (
            <Seg
              options={[{ value: false, label: 'Can stream' }, { value: true, label: 'Follower-gated' }]}
              value={gated} onChange={setGated}
            />
          )}
          {phase === 'other' && (
            <select value={other} onChange={(e) => setOther(e.target.value)} style={{
              background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '7px 10px', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}>
              <option value="cohost-setup">Co-stream setup</option>
              <option value="squad-stream">Squad hangout</option>
              <option value="boost-sheet">Boost sheet</option>
              <option value="vergrme">Vergr.me banner</option>
              <option value="analytics">Stream analytics</option>
              <option value="moderation">Stream moderation</option>
            </select>
          )}
          {phase === 'live' && (
            <Seg options={[{ value: 'broadcaster', label: 'Broadcaster' }, { value: 'viewer', label: 'Viewer' }]} value={role} onChange={setRole} />
          )}
          {/* ⚠⚠ A VIEWER IS NOT ONE THING. Every desktop viewer was being given
              the full moderation panel — timeout, ban, clear chat — because the
              simulator had no concept of WHICH viewer. Chat authority now comes
              from previewRoles.js, mirroring the server's own two-tier rule, and
              all three states are capturable. */}
          {/* ⚠ NOT JUST "Viewer / Moderator / Vanguard" — the role toggle beside
              it already has a button reading "Viewer", and two identical labels
              in one rail is a control nobody can aim at. Prefixed so each chip
              says what it is on its own. */}
          {phase === 'live' && role === 'viewer' && (
            <Seg options={PREVIEW_ROLES.map((r) => ({ value: r.id, label: r.id === 'viewer' ? 'Plain viewer' : r.label }))} value={viewerRole} onChange={setViewerRole} />
          )}
          <Seg options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} value={device} onChange={setDevice} />
          {mobile && (
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{
              background: C.card2, border: '1px solid ' + C.border, borderRadius: 8,
              padding: '7px 10px', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}>
              {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.w}x{d.h}</option>)}
            </select>
          )}
          {phase === 'live' && (
          <Seg options={[{ value: 'solo', label: 'Solo' }, { value: 'cohost', label: 'Co-host' }]} value={streamType} onChange={setStreamType} />
          )}
          {phase === 'live' && streamType === 'cohost' && (
            <Seg options={[{ value: 'grid', label: 'Grid' }, { value: 'panel', label: 'Panel' }]} value={cohostLayout} onChange={setCohostLayout} />
          )}
          {phase === 'live' && streamType === 'cohost' && (
            <Seg options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} value={guestCount} onChange={setGuestCount} />
          )}
          {phase === 'live' && showSoloView && (
            <Seg options={[{ value: 'immersive', label: 'Immersive' }, { value: 'split', label: 'Split' }, { value: 'landscape', label: 'Landscape' }]} value={soloView} onChange={setSoloView} />
          )}
          {/* ⚠⚠ THIS CONTROL ALREADY EXISTED AND WAS MOBILE-ONLY. `showSoloView` is
              `mobile && viewer && solo`, so the DESKTOP viewer never got it — which is why
              its facecam PiP could not be turned off and sat in every capture. The fix is to
              show the control that EXISTS on one more surface, not to invent a second one
              beside it. I added a duplicate `facecamOn` toggle first and took it back out;
              two controls doing the same job is worse than the one that was missing. */}
          {phase === 'live' && ((showSoloView && soloView !== 'immersive') || (!mobile && role === 'viewer' && streamType === 'solo')) && (
            <Seg options={[{ value: 'game', label: 'Game + cam' }, { value: 'cam', label: 'Camera only' }]} value={scene} onChange={setScene} />
          )}
          {phase === 'live' && role === 'broadcaster' && (
            <Seg options={[{ value: true, label: 'Live' }, { value: false, label: 'Pre-live' }]} value={live} onChange={setLive} />
          )}
          {/* ⚠ PLACEMENT IS A MODE, AND IT IS OFF BY DEFAULT. Founder instruction: the
              broadcaster moves and resizes the tip goal. The handles cannot be permanent —
              measured in a capture, the DRAG TO PLACE hint overlapped the VP chip row by
              81x3px and the 24x24 handle sat on the bar, on the very surface being
              screenshotted. Nobody streams with grab handles on their overlay either. */}
          {phase === 'live' && role === 'broadcaster' && (
            <Seg options={[{ value: false, label: 'Goal locked' }, { value: true, label: 'Place goal' }]} value={sim.goalEdit} onChange={sim.setGoalEdit} />
          )}
        </div>


        {/* ⚠ STAGE LEFT, CONTROLS RIGHT. The panels used to sit ABOVE the
            stage in a wide grid, which pushed the phone below the fold: you had
            to scroll away from the thing you were adjusting in order to adjust
            it. Side by side keeps both in view, which is the whole point of a
            control panel. */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', justifyContent: 'center', position: 'sticky', top: 12 }}>
          {mobile ? (
            // No bezel, no radius: a clean rectangle at true device pixels, ready to
            // be composited into a real device frame.
            <div style={{ position: 'relative', width: frameW, height: frameH, ...frameVars, overflow: 'hidden', background: '#000', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>{stage}</div>
          ) : (
            <div style={{ position: 'relative', width: frameW, height: frameH, ...frameVars, maxWidth: 1000, overflow: 'hidden', borderRadius: 14, background: '#000', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>{stage}</div>
          )}
          </div>

          {/* control rail */}
          <div style={{ flex: '0 0 320px', display: 'grid', gap: 12, minWidth: 260 }}>
          {phase === 'live' && (
          <Panel title="Fire an event">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Btn accent onClick={() => sim.fireJoin()}><Icon name="sensor_door" size={15} /> Entrance</Btn>
              <Btn onClick={sim.fireTip}><Icon name="volunteer_activism" size={15} /> Tip</Btn>
              <Btn onClick={sim.fireSub}><Icon name="workspace_premium" size={15} /> Subscribe</Btn>
              <Btn onClick={sim.firePoll}><Icon name="poll" size={15} /> Poll</Btn>
              <Btn onClick={() => sim.fireReaction()}><Icon name="favorite" size={15} /> Reactions</Btn>
              <Btn onClick={() => sim.fireBoost('super')}><Icon name="rocket_launch" size={15} /> Boost</Btn>
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
              Entrance draws the real rank banner from public/brand/entry/. Each press steps to the
              next cast member, so you can capture several ranks.
            </div>
          </Panel>
          )}

          {/* ⚠ THE STATES A REAL VIEWER HITS. Without these the tool can only
              capture a stream that is working perfectly, which is the one
              situation nobody needs a screenshot of. */}
          {phase === 'live' && (
          <Panel title="Playback state">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PLAYBACK_STATES.map((p) => (
                <button key={p.id} onClick={() => sim.setPlayback(p.id)} style={chip(sim.playback === p.id)}>{p.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>CHAT STATE</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CHAT_STATES.map((p) => (
                <button key={p.id} onClick={() => sim.setChatState(p.id)} style={chip(sim.chatState === p.id)}>{p.label}</button>
              ))}
            </div>
            {/* ⚠ FOUNDER DECISION 2026-09-02: audio-only broadcasts are allowed —
                a co-host already joins audio-only, and a creator with no camera
                could not broadcast at all. */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>FORMAT</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[[false, 'Camera'], [true, 'Audio only']].map(([v, label]) => (
                <button key={label} onClick={() => sim.setAudioOnly(v)} style={chip(!!sim.audioOnly === v)}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>SPOKEN CHAT (TTS)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TTS_STATES.map((t) => (
                <button key={t.id} onClick={() => sim.setTts(t.id)} style={chip(sim.tts === t.id)}>{t.label}</button>
              ))}
            </div>
            {/* ⚠ THE HOST'S OWN UPLINK. The shipped broadcaster shows a kbps
                number and nothing else, which nobody mid-stream is reading. */}
            {/* ⚠ VP EARNED IS REAL AND ALREADY PAID. The chip reads the rate out
                of vpSystem, so this slider moves a number Vergr actually credits. */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>REWARDS</div>
            <label style={{ display: 'block', fontSize: 11.5, color: C.textDim, marginBottom: 6 }}>
              {`Watched · ${sim.watchMinutes ?? 0} min`}
              <input type="range" min={0} max={240} step={5} value={sim.watchMinutes ?? 0}
                onChange={(e) => sim.setWatchMinutes(Number(e.target.value))}
                style={{ width: '100%' }} />
            </label>
            <button onClick={() => sim.setLevelUp(true)} style={chip(!!sim.levelUp)}>Fire a level-up</button>
            {/* ⚠ A raid is a REAL callable now (functions/raids.js). This fires the
                viewer-facing half so the arrival can be designed and captured. */}
            <button onClick={() => sim.setRaiding(!sim.raiding)} style={chip(!!sim.raiding)}>Raid landing</button>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>BROADCAST HEALTH</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {HEALTH_STATES.map((h) => (
                <button key={h.id} onClick={() => sim.setHealth(h.id)} style={chip(sim.health === h.id)}>{h.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 8px' }}>ACCESS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[['none', 'Open to all'], ['subs', 'Subscribers only'], ['paid', 'Ticketed'], ['region', 'Region blocked'], ['age', 'Age restricted']].map(([id, label]) => (
                <button key={id} onClick={() => sim.setGate(id)} style={chip(sim.gate === id)}>{label}</button>
              ))}
            </div>
          </Panel>
          )}

          {/* ⚠ THE REPLAY SELECTOR CANNOT LIVE IN THE LIVE-ONLY PANEL. It was
              put there first, which hid it on the ENDED phase — the only phase
              it controls. A control that disappears exactly when it applies is
              worse than no control, and this is the second one this session
              (the phase chips already collided with the playback labels). */}
          {phase === 'ended' && (
          <Panel title="Replay">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[['available', 'Replay ready'], ['pending', 'Still processing'], ['expired', 'Replay expired'], ['none', 'No replay']].map(([id, label]) => (
                <button key={id} onClick={() => sim.setVod(id)} style={chip(sim.vod === id)}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
              The real ended screen says something different for each of these
              (MobileLiveViewer.jsx:657). Pro sells 90-day replays, so this is the
              screen that has to make the replay findable.
            </div>
          </Panel>
          )}

          {phase === 'live' && (
          <Panel title="Entrance by rank">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CAST.map((c) => (
                <button key={c.uid} onClick={() => sim.fireJoin(c.uid)} style={{
                  padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: C.card, color: C.textDim, border: `1px solid ${C.border}`,
                }}>{c.rank}</button>
              ))}
            </div>
          </Panel>
          )}

          <Panel title="Tip goal">
            <div style={{ display: 'grid', gap: 10 }}>
              <Field label={`Raised · ${(goal.currentCoins || 0).toLocaleString()}c`}>
                <input type="range" min={0} max={goal.targetCoins || 5000} step={10}
                  value={goal.currentCoins || 0}
                  onChange={(e) => sim.setGoal({ currentCoins: Number(e.target.value) })} />
              </Field>
              <Field label={`Target · ${(goal.targetCoins || 0).toLocaleString()}c`}>
                <input type="range" min={500} max={50000} step={500}
                  value={goal.targetCoins || 5000}
                  onChange={(e) => sim.setGoal({ targetCoins: Number(e.target.value) })} />
              </Field>
              <Field label="Reason">
                <input type="text" value={goal.reason || ''}
                  onChange={(e) => sim.setGoal({ reason: e.target.value })}
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', color: C.text, fontSize: 12.5 }} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.textDim, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!goal.active} onChange={(e) => sim.setGoal({ active: e.target.checked })} />
                Goal showing
              </label>
            </div>
          </Panel>

          {phase === 'live' && (
          <Panel title="Chat">
            {/* ⚠ A VIEWER CAN PUT THE CHAT AWAY. Founder, 2026-09-01: they need
                to be able to just watch, without the feed sitting over the
                frame. Swipe right in the app, long press in the browser — a
                left-to-right swipe at the edge is the browser's own back
                gesture, so binding to it would walk the viewer off the stream.
                Toggled here too so both states can be captured. */}
            <div style={{ marginBottom: 10 }}>
              <Btn onClick={() => sim.setSubscribed((v) => !v)}>
                <Icon name={sim.subscribed ? 'workspace_premium' : 'add'} size={14} />
                {sim.subscribed ? 'Member' : 'Not subscribed'}
              </Btn>
              <Btn onClick={() => sim.setChatHidden((v) => !v)}>
                <Icon name={sim.chatHidden ? 'visibility' : 'visibility_off'} size={14} />
                {sim.chatHidden ? 'Show chat' : 'Hide chat'}
              </Btn>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <Field label={sim.chatRate ? `New message every ${sim.chatRate}s` : 'Paused'}>
                <input type="range" min={0} max={8} step={1}
                  value={sim.chatRate}
                  onChange={(e) => sim.setChatRate(Number(e.target.value))} />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={() => sim.pushMessage('c4', 'chat he is so locked in right now')}><Icon name="add_comment" size={15} /> One now</Btn>
                <Btn onClick={sim.resetChat}><Icon name="restart_alt" size={15} /> Clear</Btn>
              </div>
            </div>
          </Panel>
          )}

          {phase === 'live' && (
          <Panel title="Open a sheet">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'tip' })}><Icon name="redeem" size={15} /> Tip sheet</Btn>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'profile', uid: 'host' })}><Icon name="account_circle" size={15} /> Creator profile</Btn>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'profile', uid: 'c1' })}><Icon name="person" size={15} /> Viewer profile</Btn>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'gifters', gifters: doc.previewGifters })}><Icon name="leaderboard" size={15} /> Top supporters</Btn>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'share' })}><Icon name="ios_share" size={15} /> Share</Btn>
              <Btn onClick={() => sim.setOpenSheet({ kind: 'more' })}><Icon name="more_horiz" size={15} /> More menu</Btn>
              {sim.openSheet && <Btn onClick={() => sim.setOpenSheet(null)}><Icon name="close" size={15} /> Close</Btn>}
            </div>
          </Panel>
          )}

          {/* ⚠ THE RAIL EXISTS SO NOTHING RENDERS EMPTY (founder, 2026-08-31).
              Faces, the backdrop and the goal all have content by default; this
              panel is where anything still hollow gets filled. Every avatar is a
              deterministic identicon — never a real or generated face, because
              captures from this screen are published and a likeness would be a
              claim about a user who does not exist. */}
          {/* ⚠ THIS IS WHAT THE RAIL IS FOR: supplying real media, per person
              and per tile. Identicons and the drawn scene are only the fallback
              so nothing is hollow before you upload. Files are kept in this
              browser (IndexedDB) so a refresh does not wipe them; nothing is
              uploaded anywhere. */}
          {/* ⚠ CAMERA OFF IS A SEAT STATE, NOT A MISSING TILE. TikTok's Panel
              layout exists FOR audio guests; the host picks the mode and the
              grid does not reshuffle itself when somebody goes quiet. Toggling a
              seat here shows that person's avatar in their box instead of a
              camera glyph, which is what tells a viewer who is still there. */}
          <Panel title="Cameras">
            <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55, marginBottom: 9 }}>
              Turn a seat's camera off. The seat stays; their avatar fills it.
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {PREVIEW_PUBLISHERS.slice(0, guestCount).map((pub, i) => {
                const off = camsOff.includes(i);
                return (
                  <button key={pub.uid} onClick={() => setCamsOff((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                      background: off ? C.card : C.cardSoft, border: `1px solid ${off ? C.border : "transparent"}`, color: C.text, fontSize: 12 }}>
                    <Icon name={off ? "videocam_off" : "videocam"} size={15} style={{ color: off ? C.textMuted : C.accent2 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{pub.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: off ? C.textMuted : C.accent2 }}>{off ? "off" : "on"}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel title="Video">
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55 }}>
                All loop, muted. One slot per tile: a PiP needs two sources and a
                four-way co-host needs four. Kept between visits.
              </div>
              {VIDEO_SLOTS.map((v) => {
                const url = sim.videos[v.id] || null;
                return (
                  <div key={v.id} style={{ display: 'grid', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>{v.label}</span>
                      {url && <span style={{ fontSize: 10, fontWeight: 700, color: C.accent2 }}>loaded</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{v.hint}</div>
                    {url && (
                      <video src={url} autoPlay muted loop playsInline
                        style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, background: '#000', border: `1px solid ${C.border}` }} />
                    )}
                    <div style={{ display: 'flex', gap: 7 }}>
                      <label style={{
                        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
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
                        <Btn onClick={() => sim.setVideo(v.id, null)}><Icon name="close" size={14} /> Remove</Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Avatars">
            <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
              An uploaded face is used everywhere that person appears — chat,
              supporters, profile sheet, squad grid. Kept between visits.
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {[{ uid: PREVIEW_HOST.uid, displayName: `${PREVIEW_HOST.displayName} (host)`, avatar: PREVIEW_HOST.avatar }, { ...PREVIEW_VIEWER, displayName: `${PREVIEW_VIEWER.displayName} (viewer)` }, ...CAST].map((c) => (
                <div key={c.uid} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <img
                    src={sim.avatars[c.uid] || c.avatar}
                    alt=""
                    style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.displayName}
                  </span>
                  {sim.avatars[c.uid] && (
                    <button onClick={() => sim.clearAvatar(c.uid)} title="Remove" style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, display: 'grid',
                    }}><Icon name="close" size={13} /></button>
                  )}
                  <label style={{
                    padding: '4px 9px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                    background: C.card, border: `1px solid ${C.border}`,
                    color: C.textDim, fontSize: 11, fontWeight: 600,
                  }}>
                    {sim.avatars[c.uid] ? 'Change' : 'Upload'}
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => sim.setAvatar(c.uid, e.target.files?.[0])} />
                  </label>
                </div>
              ))}
            </div>
          </Panel>


          <Panel title="Content">
            <div style={{ display: 'grid', gap: 10 }}>
              <Field label="Behind the UI">
                <select value={backdrop} onChange={(e) => setBackdrop(e.target.value)} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '6px 9px', color: C.text, fontSize: 12.5,
                }}>
                  <option value="gameplay">Gameplay scene</option>
                  <option value="camera">Streamer room</option>
                </select>
              </Field>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.55 }}>
                Drop a real frame at <code>public/brand/live/preview-scene.webp</code> (9:16) or
                <code> preview-scene-wide.webp</code> (16:9) and it replaces the drawn scene
                automatically, no code change. A video still is fine.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.textDim, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!doc.previewGifters?.length}
                  onChange={(e) => sim.setField({ previewGifters: e.target.checked ? makePreviewStreamDoc().previewGifters : [] })} />
                Show top supporters
              </label>
            </div>
          </Panel>

          <Panel title="Stream">
            <div style={{ display: 'grid', gap: 10 }}>
              <Field label={`Viewers · ${(doc.viewerCount || 0).toLocaleString()}`}>
                <input type="range" min={0} max={50000} step={50}
                  value={doc.viewerCount || 0}
                  onChange={(e) => sim.setField({ viewerCount: Number(e.target.value) })} />
              </Field>
              {/* ⚠ THE VIEWER'S OWN WALLET. Drive it below a tip price to reach
                  the shortfall state, which no surface could draw before. */}
              <Field label={`Your coins · ${(sim.balance ?? 0).toLocaleString()}c`}>
                <input type="range" min={0} max={5000} step={10}
                  value={sim.balance ?? 0}
                  onChange={(e) => sim.setBalance(Number(e.target.value))} />
              </Field>
              <Field label={`Likes · ${(doc.hearts || 0).toLocaleString()}`}>
                <input type="range" min={0} max={20000} step={10}
                  value={doc.hearts || 0}
                  onChange={(e) => sim.setField({ hearts: Number(e.target.value) })} />
              </Field>
            </div>
          </Panel>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, color: C.textMuted, marginTop: 10, lineHeight: 1.6 }}>
          Drop a real 9:16 frame at <code>public/brand/live/preview-scene.webp</code> and it replaces
          the gradient behind the UI, so a screenshot reads as a real broadcast.
        </div>
      </div>
    </AdminShell>
  );
}
