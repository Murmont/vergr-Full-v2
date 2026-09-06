// PreviewBroadcasterScreen — a SEPARATE, preview-only copy of the production
// BroadcasterScreen render, for the admin Stream Preview tab. It shows the real
// broadcaster chrome (desktop framed studio + mobile immersive) driven by a mock
// stream doc, with NO camera, NO ingest, and NO Firestore. Handlers are inert /
// local-only. `doc` carries lastGift/lastTip/lastSub so the admin screen can
// fire alerts + (later) gift overlays to preview placement.
//
// Production BroadcasterScreen.jsx is never touched.

import { useState } from 'react';
import { PlaybackState, StreamPaywall, HealthWarning, ZeroViewers, VpEarnedChip, AudioStage, ModChannelSwitch, S, HypeTrain } from './previewStates';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { usePreviewVideos, usePreviewSim } from './previewAssetsContext';
import { GiftFeed, useGiftFeed, useAboveChat, MovableGoal } from './previewSoloParts';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../../../components/Icon';
import HypeMeter from '../../../components/tournament/HypeMeter';
import {StreamGoalBar, SubAlertOverlay} from '../../../components/streams/StreamGoalAndAlerts';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
// Aliased: this file already has its own PreviewChat wrapper (composer + dock).
import { PreviewChat as SimChat, PreviewSheets } from './previewChrome';
import { PreviewCoHostGrid, PreviewTournamentCard, stageAspect } from './PreviewStreamStages';


// ⚠ A PANEL DOES NOT GET AN OUTLINE FOR BEING A PANEL. It separates by VALUE.
// The ghost hairlines that used to ring every card here measured dL 0.008-0.015
// against their own fill: visible enough to read as a cage, too faint to be design.
// The fix is the one CLAUDE.md already prescribes for border soup — raise the value
// ladder, drop the stroke. What survives is a DIVIDER, and only where a real division
// needs marking. It fades at both ends, because a rule that stops at full strength
// reads as a cage edge.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };
const ruleTop = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'top' };

const C = {
  // ⚠ THE LADDER, NOT THE STROKE. bg->card was a 0.0032 luminance step, which is why
  // every panel needed a hairline to be seen at all. card is now a real step off bg and
  // the hairlines are gone. Do not lower these back and re-add a border.
  bg: '#0a0a14', card: '#1A1A2A', cardSoft: '#14141F',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: '#251A46',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b',
  // ⚠ TWO REDS. White on #ef4444 measures 3.76:1 — End Stream, the single most
  // important control on this screen, was below the floor. redFill carries white
  // type; red is for type on a dark panel.
  red: '#ff6b6b', redFill: '#c62828',
};

const LAYOUT_PRESETS = [
  { id: 'camera', label: 'Camera only', icon: 'videocam' },
  { id: 'screen', label: 'Screen only', icon: 'screen_share' },
  { id: 'screen_cam_pip', label: 'Screen + facecam', icon: 'picture_in_picture' },
  { id: 'cam_screen_pip', label: 'Camera + screen PiP', icon: 'picture_in_picture_alt' },
  { id: 'side_by_side', label: 'Side by side', icon: 'splitscreen' },
];
const PIP_CORNERS = [{ id: 'tl' }, { id: 'tr' }, { id: 'bl' }, { id: 'br' }];
const SCENE_CARDS = [
  { id: 'starting', title: 'Starting soon' },
  { id: 'brb', title: 'Be right back' },
  { id: 'ending', title: 'Thanks for watching' },
];

function fmtTime(s) {
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh ? String(hh).padStart(2, '0') + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function PreviewBroadcasterScreen({
  device = 'desktop', live = true, doc, streamType = 'solo', guestCount = 2,
  host = null, messages = [], joinEvents = [], openSheet = null, onOpenSheet = () => {},
  avatars = {}, cohostLayout = 'grid', camsOff = [], onGoLive, onEndStream,
}) {
  // ⚠ VIDEOS COME FROM THE PROVIDER, NOT A PROP. `facecamVideo` was a prop, went
  // missing from simProps in an unrelated edit, and nothing failed — the PiP
  // simply rendered empty. A context cannot be forgotten at a call site.
  const { videoFor } = usePreviewVideos();
  // ⚠ REACTIONS COME FROM THE SIM CONTEXT, NOT A PROP. Threading them was how
  // the like button ended up dead on the solo views: the component was mounted
  // and the data never arrived. Third time for this class — see rule 20.
  const { goalBox, setGoalBox, goalEdit,reactions = [], firePoll, playback = 'live', gate = 'none', health = 'ok', watchMinutes = 0, audioOnly = false, chatChannel = 'public', setChatChannel } = usePreviewSim();
  const { toasts: gifts } = useGiftFeed(doc?.lastGift);
  // Measured, not a constant. `bottom: 76` put the drops on top of the newest
  // messages on both mobile branches, because a bottom-anchored chat has its
  // content wherever the content happens to end, not at a fixed offset.
  const { setList: setChatList, setAnchor: setFrame, bottom: aboveChat } = useAboveChat(messages?.length);
  const streamDoc = doc;
  const isDesktop = device === 'desktop';
  const mobileImmersive = device === 'mobile';
  const isLive = live;
  const isCoHost = streamType === 'cohost';
  const isTournament = streamType === 'tournament';

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // ⚠ THE CAMERA CONTROL MUST NOT CONTRADICT THE STAGE. `camOn` is the host's own
  // toggle and `audioOnly` is the broadcast FORMAT, and with the two independent the
  // desktop studio drew a lit violet Camera button directly beneath a stage reading
  // AUDIO ONLY. An audio-only broadcast has no camera on, by definition, so the
  // displayed state is derived rather than left to agree by luck.
  const camLive = camOn && !audioOnly;
  const [cameraFacing, setCameraFacing] = useState('user');
  const [screenSharing, setScreenSharing] = useState(false);
  const [layoutMode, setLayoutMode] = useState('camera');
  const [pipCorner, setPipCorner] = useState('br');
  const [scene, setScene] = useState(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [mobileStudio, setMobileStudio] = useState(false);
  const [mobileLayoutOpen, setMobileLayoutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [modOpen, setModOpen] = useState(false);

  const duration = streamDoc?.startedAt ? Math.floor((Date.now() - streamDoc.startedAt) / 1000) : 0;
  const tipCoins = 0;
  const followerDelta = 0;
  const micLevel = micOn ? 62 : 0;

  // ⚠ THE LAYOUT MENU PICKED A PiP MODE AND NOTHING DREW ONE. "Screen + facecam"
  // and "Camera + screen PiP" set state, the corner picker set state, and the
  // stage rendered one flat video either way — so the two layouts a broadcaster
  // is most likely to screenshot could not be captured at all. Same class as a
  // kill switch nothing reads.
  //
  // The two PiP presets differ only in WHICH source is large, so one pair of
  // variables covers both and the corner picker finally moves something.
  const pipMode = layoutMode === 'screen_cam_pip' || layoutMode === 'cam_screen_pip';
  const bigSrc = layoutMode === 'cam_screen_pip' ? videoFor('facecam') : videoFor('stage');
  const insetSrc = layoutMode === 'cam_screen_pip' ? videoFor('stage') : videoFor('facecam');
  const insetLabel = layoutMode === 'cam_screen_pip' ? 'SCREEN' : 'CAMERA';
  const pipPos = {
    tl: { top: 12, left: 12 }, tr: { top: 12, right: 12 },
    bl: { bottom: 12, left: 12 }, br: { bottom: 12, right: 12 },
  }[pipCorner] || { bottom: 12, right: 12 };

  const VideoArea = ({ fullscreen = false } = {}) => {
    // ⚠⚠ THE GRID GETS THE CELL SHAPE FROM `gridAspect()`, NOT THE WHOLE FRAME.
    // Stretched to `inset: 0` the tiles measured 177x826 — an aspect of 0.215
    // against the reference's 2:3 (0.667), i.e. three times too tall. This is
    // the SAME defect the founder already rejected on the viewer ("i am certain
    // they do not have stretched frames sitting next to each other"); the fix
    // landed there and was never carried across, so the broadcaster kept
    // rendering a shape the viewer no longer does.
    //
    // Both sides now derive from one helper, so they cannot disagree again.
    // `panel` is deliberately still full-bleed: its host tile IS the background,
    // with the guest column floating over it, which is the reference layout.
    if (isCoHost) {
      if (cohostLayout === 'panel') {
        return <PreviewCoHostGrid count={guestCount} showInvite fullscreen={fullscreen} layout="panel" camsOff={camsOff} />;
      }
      // ⚠ ON THE PHONE THE GRID SITS UNDER THE HEADER, NOT IN THE MIDDLE OF THE
      // SCREEN. Centring it in the full frame left ~490px of black split above
      // and below the tiles — correct tile shape, and still a broken-looking
      // screen. The chat occupies the lower 42%, so the grid takes the band
      // between the header and it, which is the same column order the viewer's
      // co-host uses.
      return (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center',
          alignItems: mobileImmersive ? 'flex-start' : 'center',
          paddingTop: mobileImmersive ? 56 : 0,
          background: '#07070d', overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: String(stageAspect('grid', guestCount)), maxHeight: mobileImmersive ? 'calc(58% - 56px)' : '100%' }}>
            <PreviewCoHostGrid count={guestCount} showInvite fullscreen={fullscreen} layout="grid" camsOff={camsOff} />
          </div>
        </div>
      );
    }

    const big = pipMode ? bigSrc : videoFor('stage');
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
        {big ? (
          <video src={big} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#3a3a55', background: 'radial-gradient(120% 80% at 50% 0%, #241a3a 0%, #0c0c16 70%)' }}>
            <Icon name="videocam" size={42} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em' }}>YOUR CAMERA (preview)</span>
          </div>
        )}
        {/* The inset. Drawn whether or not a second video exists, because the
            LAYOUT is what is being captured — an empty tile still shows where
            the facecam sits, and it fills the moment the second video is up. */}
        {pipMode && (
          <div style={{ position: 'absolute', ...pipPos, width: fullscreen ? 200 : 132, aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', background: '#12101c' }}>
            {insetSrc ? (
              <video src={insetSrc} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'rgba(255,255,255,0.32)' }}>
                <Icon name="person" size={22} filled />
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>{insetLabel}</span>
              </div>
            )}
          </div>
        )}
        {isTournament && <PreviewTournamentCard />}
      </div>
    );
  };

  // ── MOBILE CO-HOST — A COLUMN, NOT OVERLAYS ──
  //
  // ⚠⚠ THE OVERLAY LAYOUT CANNOT WORK FOR A CONTAINED GRID, and trying to make
  // it work produced two bad screens in a row. Solo is full-bleed video with the
  // chrome floating on it, so absolute positioning is right there. A co-host grid
  // is a FIXED SHAPE — its height falls out of the cell aspect and the frame
  // width — so anything positioned at a percentage either overlaps it or leaves a
  // dead band under it. Measured: tiles ended at y=338 while the chat began at
  // 58% (494), leaving ~130px of black with the action rail floating in it and
  // the top button clipping the co-host's tile.
  //
  // A column has no such gap by construction: header, grid at its own aspect,
  // chat taking everything left, composer pinned. This is the same order
  // PreviewViewerScreen uses for its co-host, so the two sides now match.
  if (mobileImmersive && isCoHost && isLive) {
    return (
      <div ref={setFrame} style={{ position: 'absolute', inset: 0, background: '#07070d', overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flexShrink: 0, padding: '12px 12px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <LivePill />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, monospace' }}>{fmtTime(duration)}</span>
          <AudioMeter level={micLevel} compact />
          <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{streamDoc.title}</span>
          <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ ...statChip('#fff'), border: 'none', cursor: 'pointer' }}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</button>
          <button aria-label="End stream" onClick={onEndStream} style={roundBtn}><Icon name="close" size={18} /></button>
        </div>

        {/* The grid keeps its own shape and never stretches to fill. */}
        <div style={{ position: 'relative', flexShrink: 0, width: '100%', aspectRatio: String(stageAspect(cohostLayout, guestCount)) }}>
          {/* ⚠ yPct CLEARS THE BROADCAST-HEALTH CARD, NOT JUST THE VP CHIP ROW.
    These fallbacks were first derived from the VP chip row alone (11.4% mobile,
    19.5% desktop). The health warning is a TRANSIENT, so it was not on screen
    when they were measured, and CLAUDE.md already names transients as the blind
    spot. Measured with health = "Ingest lost": the card runs to 17.7% on mobile
    and 19.2% on desktop, and at yPct 14 it covered 80% of the goal card and
    painted over its centre. 20 clears both on every branch.
    This is only the STARTING position; the broadcaster drags it wherever they
    want. A default that is right in every state beats one that is tighter in
    the common state and broken in two others. */}
          {isLive && <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 20, wPct: 62 }} goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable />}
          {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
              TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
              mounted last, and buried the chrome on six of seven surfaces — the
              mobile broadcaster lost End stream and Mic, the desktop viewer lost
              Follow and the composer. It replaces the VIDEO, so it renders here,
              straight after it, under everything the surface draws on top. */}
          <PreviewCoHostGrid count={guestCount} showInvite fullscreen edge layout={cohostLayout} camsOff={camsOff} />
          {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={streamDoc?.title} z={0} />}
        </div>

        {/* ⚠ THE ACTION RAIL GETS ITS OWN ROW AND IS NOT DRAWN ON THE VIDEO.
            At `top: 36%` it crossed a tile; moved to the grid's bottom-right it
            landed squarely on the co-host's name label. Every position on a
            fixed-shape grid collides with something, because the tiles are full
            of content by design. A row of its own collides with nothing, and the
            band between the grid and the tip goal was empty anyway. */}
        <div style={{ flexShrink: 0, padding: '8px 10px 0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <ActionPill icon="cameraswitch" label="Switch camera" onClick={() => setCameraFacing((f) => (f === 'user' ? 'environment' : 'user'))} active={cameraFacing === 'environment'} />
          <ActionPill icon="content_cut" label="Clip that moment" onClick={() => {}} />
          <ActionPill icon="poll" label="Start a poll" onClick={() => {}} />
          <ActionPill icon="share" label="Share this stream" onClick={() => {}} />
        </div>

        {/* ⚠⚠ THE GOAL IS NOT IN THIS COLUMN ANY MORE — it is drawn over the stage
            above, where the BROADCASTER places it. Deleting it from here left a JSX
            comment as the entire body of a logical-AND gate wrapped in parentheses,
            and a parenthesised JSX comment evaluates to an EMPTY OBJECT LITERAL. React
            refuses to render one: error 31, object with keys, which crashed this whole
            surface to the ErrorBoundary. A JSX comment can never be the body of a gate.
            It parsed, it linted, it built, and it died on render. */}

        {/* Chat takes every pixel the grid and the composer do not. */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: '8px 10px 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <SimChat fill messages={messages} avatars={avatars} layout="overlay" scrollRef={setChatList} onOpenProfile={(uid) => onOpenSheet({ kind: 'profile', uid })} />
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, padding: '11px 14px', borderRadius: 999, background: S.field, color: '#ADADC2', fontSize: 13 }}>Say something…</div>
          <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={() => setMicOn((v) => !v)} label="Mic" />
          <DockBtn icon={camLive ? 'videocam' : 'videocam_off'} danger={!camLive} onClick={() => setCamOn((v) => !v)} label="Camera" />
          <DockBtn icon="more_horiz" onClick={() => setMoreOpen(true)} label="More" />
        </div>

        <HypeTrain />
        <GiftFeed toasts={gifts} style={{ bottom: aboveChat ?? 76, left: 10 }} />
        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" bottom={aboveChat ?? 90} />
        <ReactionsFloor events={reactions} position="right" />
        <JoinAnnouncer events={joinEvents} side="left" sound={false} bottom={aboveChat ?? 96} />
        {/* ⚠ EVERY RENDER BRANCH, NOT JUST THE FIRST. This file has three, and a
            single replace() mounted the states on one of them: broadcaster desktop
            could not draw a reconnect or a gated stream at all, and the guard
            passed because it only asked whether the FILE mentioned them. */}
        {gate !== 'none'
          ? <StreamPaywall kind={gate} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
          : playback !== 'live'
            ? <PlaybackState state={playback} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
              : null}
        {/* ⚠ THE HOST'S OWN FAILURES, ON EVERY BRANCH. A broadcaster who cannot
            see that their uplink died keeps talking to nobody. */}
        {/* ⚠ THIS BAND FLOATS OVER THE STREAM AT z-8 AND SPANS THE FULL WIDTH, so
            hit-testable it blocks a ~34px stripe of whatever is behind it even when
            it is showing nothing but a chip. Same defect as the VP row one level in:
            the target looks fine and simply stops responding. The band passes taps
            through; the things inside it that ARE controls opt back in. */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: 64, zIndex: 8, pointerEvents: 'none' }}>
          <HealthWarning state={health} />
          {/* The host's own VP, at the host's own rates. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <VpEarnedChip host minutes={watchMinutes} onOpen={() => onOpenSheet?.({ kind: 'more' })} />
          <ModChannelSwitch role="host" channel={chatChannel} onChannel={setChatChannel} />
        </div>
          {(streamDoc?.viewerCount ?? 0) === 0 && (
            <ZeroViewers compact
              onShare={() => onOpenSheet?.({ kind: 'share' })}
              onInvite={() => onOpenSheet?.({ kind: 'share' })}
              onBoost={() => onOpenSheet?.({ kind: 'boost' })} />
          )}
        </div>
        <PreviewSheets openSheet={openSheet} host={host} onClose={() => onOpenSheet(null)} onOpen={onOpenSheet} />
        <AnimatePresence>{modOpen && <ModerationSheet onClose={() => setModOpen(false)} onOpenSheet={onOpenSheet} />}</AnimatePresence>

        <AnimatePresence>
          {moreOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.textDim, marginBottom: 10 }}>More</div>
                <SheetRow icon="group_add" label="Invite a co-host" onClick={() => setMoreOpen(false)} />
                <SheetRow icon="dashboard_customize" label="Studio layout" onClick={() => setMoreOpen(false)} />
                {/* ⚠⚠ THE BROADCASTER HAD NO MODERATION CONTROL AT ALL, on
                    either device, while every desktop VIEWER was handed the full
                    panel. Exactly inverted. The host owns the stream, so the host
                    gets both tiers — mod actions AND the chat rules only
                    `loadStream` allows (slow mode, followers-only, banned words,
                    appointing a moderator). */}
                <SheetRow icon="gavel" label="Chat moderation" onClick={() => { setMoreOpen(false); setModOpen(true); }} />
                <SheetRow icon="settings" label="Stream settings" onClick={() => { setMoreOpen(false); onOpenSheet({ kind: 'streamsettings' }); }} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── MOBILE IMMERSIVE ──
  if (mobileImmersive) {
    return (
      <div ref={setFrame} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif' }}>
        {isLive && <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 20, wPct: 62 }} goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable />}
        {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
            TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
            mounted last, and buried the chrome on six of seven surfaces — the
            mobile broadcaster lost End stream and Mic, the desktop viewer lost
            Follow and the composer. It replaces the VIDEO, so it renders here,
            straight after it, under everything the surface draws on top. */}
        <VideoArea />
        {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={streamDoc?.title} z={0} />}

        {/* ⚠ THE LIVE HEADER HAD ~180px OF NOTHING IN THE MIDDLE. Pre-live showed
            the stream title and live showed the pill, the clock and then a gap —
            so the one screen a broadcaster looks at for an hour never named what
            they were streaming. The title now takes the space (truncating), and
            a live mic meter sits beside the clock, because "is my mic being
            heard" is the readout a live broadcaster actually needs and it
            existed only in pre-live. */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '12px 12px 24px', background: 'linear-gradient(180deg, rgba(0,0,0,0.7), transparent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive && <LivePill />}
          {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, monospace' }}>{fmtTime(duration)}</span>}
          {isLive && <AudioMeter level={micLevel} compact />}
          <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>{streamDoc.title}</span>
          <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ ...statChip('#fff'), border: 'none', cursor: 'pointer' }}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</button>
          <button aria-label="End stream" onClick={onEndStream} style={roundBtn}><Icon name="close" size={18} /></button>
        </div>

        {/* ⚠⚠ THE RAIL IS ANCHORED TO THE BOTTOM STACK, NOT TO A SECOND GUESS AT
            THE SAME NUMBER. At `top: 36%` its four 46px pills ran to y=527 while
            the stack below starts at `top: 58%` (y=494) and, being later in the
            DOM, painted over it: 33 of the Share button's 46px were buried and
            elementFromPoint at its centre returned the tip-goal bar. The button
            was simply dead, and it is the one the host presses to grow the stream.
            Deriving the rail's bottom from the SAME 58% the stack uses means they
            cannot drift apart when either number changes. */}
        <div style={{ position: 'absolute', ...(isCoHost && cohostLayout === 'panel' ? { left: 10 } : { right: 10 }), bottom: 'calc(42% + 8px)', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <ActionPill icon="cameraswitch" label="Switch camera" onClick={() => setCameraFacing((f) => (f === 'user' ? 'environment' : 'user'))} active={cameraFacing === 'environment'} />
          {mobileStudio && <ActionPill icon="dashboard_customize" onClick={() => setMobileLayoutOpen(true)} active={mobileLayoutOpen} />}
          <ActionPill icon="content_cut" label="Clip that moment" onClick={() => {}} />
          <ActionPill icon="poll" label="Start a poll" onClick={() => {}} />
          <ActionPill icon="share" label="Share this stream" onClick={() => {}} />
        </div>

        {/* ⚠⚠ THE BOTTOM STACK NEEDS A DEFINITE HEIGHT, AND NEITHER `30vh` NOR
            `30%` GAVE IT ONE. `vh` measured the ADMIN'S BROWSER WINDOW rather
            than the phone frame; swapping it for `30%` was worse, because this
            parent is `bottom: 10` with an AUTO height, so a percentage of it
            resolves to nothing and the chat collapsed to 50px with every row
            pushed above the frame — measured at y=-478. A percentage is only
            definite if its parent's height is.
            Anchoring TOP as well as BOTTOM makes the height a fact of the box. */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: isLive ? '58%' : 'auto', bottom: 10, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8 }}>
          {/* the goal moved out of this band and onto the stage — see MovableGoal below */}
          {isLive ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <PreviewChat overlay messages={messages} avatars={avatars} scrollRef={setChatList} onOpenProfile={(uid) => onOpenSheet({ kind: 'profile', uid })} composerExtras={
                <>
                  <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={() => setMicOn((v) => !v)} label="Mic" />
                  <DockBtn icon={camLive ? 'videocam' : 'videocam_off'} danger={!camLive} onClick={() => setCamOn((v) => !v)} label="Camera" />
                  <DockBtn icon="more_horiz" onClick={() => setMoreOpen(true)} label="More" />
                </>
              } />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={() => setMicOn((v) => !v)} label="Mic" />
                <DockBtn icon={camLive ? 'videocam' : 'videocam_off'} danger={!camLive} onClick={() => setCamOn((v) => !v)} label="Camera" />
                <DockBtn icon="flip_camera_android" onClick={() => {}} label="Flip" />
                <div style={{ flex: 1 }} />
                <AudioMeter level={micLevel} compact />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* ⚠ SOLID IN BOTH STATES. It used to be a rgba(255,255,255,0.06) wash under
                    a BRIGHTER rgba(255,255,255,0.09) hairline when off, and a tint under a
                    ring when on — the two patterns the founder has rejected, one in each
                    state of a single control. Off is a real value step; on is a solid fill. */}
                <button onClick={() => setMobileStudio((v) => !v)} style={{ padding: '14px 12px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: mobileStudio ? C.purple : S.chip, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}><Icon name="dashboard_customize" size={16} /> Studio</button>
                {/* ⚠ THE BUTTON THAT STARTS A STREAM DID NOT START ONE. Every phase
                    transition was dead, so the two moments that bracket a
                    broadcast — going live and ending — could not be captured at
                    all, which is most of what this tool exists for. */}
                <button onClick={onGoLive} style={{ flex: 1, padding: 15, borderRadius: 16, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Start Stream</button>
              </div>
            </div>
          )}
        </div>

      {/* ⚠ THE TIP DISPLAY IS THE DESIGNED COMBO FEED, NOT AN ALERT PILL.
          Left-aligned, avatar + "Sent X" + coin + a big xN counter that climbs
          when the same person sends again (previewSoloParts.jsx). The solo views
          always had it; these surfaces never did, so a tip here rendered as the
          generic centred pill instead — the thing that was replaced. */}
        <HypeTrain />
        <GiftFeed toasts={gifts} style={{ bottom: aboveChat ?? 76, left: 10 }} />
        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" bottom={aboveChat ?? 90} />
        {/* side="left" and the chat-height offset match the mobile viewer, which
            is what the native broadcaster mirrors. */}
        <ReactionsFloor events={reactions} position="right" />
        <JoinAnnouncer events={joinEvents} side="left" sound={false} bottom={aboveChat ?? 96} />
        {/* ⚠ EVERY RENDER BRANCH, NOT JUST THE FIRST. This file has three, and a
            single replace() mounted the states on one of them: broadcaster desktop
            could not draw a reconnect or a gated stream at all, and the guard
            passed because it only asked whether the FILE mentioned them. */}
        {gate !== 'none'
          ? <StreamPaywall kind={gate} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
          : playback !== 'live'
            ? <PlaybackState state={playback} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
              : null}
        {/* ⚠ THE HOST'S OWN FAILURES, ON EVERY BRANCH. A broadcaster who cannot
            see that their uplink died keeps talking to nobody. */}
        <div style={{ position: 'absolute', left: 10, right: 10, top: 64, zIndex: 8, pointerEvents: 'none' }}>
          <HealthWarning state={health} />
          {/* The host's own VP, at the host's own rates. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <VpEarnedChip host minutes={watchMinutes} onOpen={() => onOpenSheet?.({ kind: 'more' })} />
          <ModChannelSwitch role="host" channel={chatChannel} onChannel={setChatChannel} />
        </div>
          {(streamDoc?.viewerCount ?? 0) === 0 && (
            <ZeroViewers compact
              onShare={() => onOpenSheet?.({ kind: 'share' })}
              onInvite={() => onOpenSheet?.({ kind: 'share' })}
              onBoost={() => onOpenSheet?.({ kind: 'boost' })} />
          )}
        </div>
        <PreviewSheets openSheet={openSheet} host={host} onClose={() => onOpenSheet(null)} onOpen={onOpenSheet} />
        <AnimatePresence>{modOpen && <ModerationSheet onClose={() => setModOpen(false)} onOpenSheet={onOpenSheet} />}</AnimatePresence>

        <AnimatePresence>
          {(mobileLayoutOpen || moreOpen) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setMobileLayoutOpen(false); setMoreOpen(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14 }}>
                {mobileLayoutOpen && <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.textDim, marginBottom: 10 }}>Studio layout</div>
                  <SheetRow icon="videocam" label="Camera only" onClick={() => { setLayoutMode('camera'); setMobileLayoutOpen(false); }} />
                  <SheetRow icon="picture_in_picture" label="Dual camera (selfie over rear)" onClick={() => setMobileLayoutOpen(false)} />
                  {SCENE_CARDS.map((s) => <SheetRow key={s.id} icon="image" label={`Scene · ${s.title}`} onClick={() => { setScene(s.id); setMobileLayoutOpen(false); }} />)}
                </>}
                {moreOpen && <>
                  {/* ⚠ THERE ARE TWO "More" SHEETS IN THIS FILE and my first pass
                      only reached the co-host one, so the SOLO broadcaster still
                      had no moderation entry. Found by opening it, not by
                      grepping — the label I searched for existed, in the other
                      branch. Same shape as every one-of-two-surfaces miss above. */}
                  <SheetRow icon="gavel" label="Chat moderation" onClick={() => { setMoreOpen(false); setModOpen(true); }} />
                  {/* ⚠ THESE THREE CLOSED THE SHEET AND DID NOTHING. A poll is the
                      broadcaster's main engagement tool and its button ran a
                      no-op; Clip is what a host reaches for the moment something
                      happens, and losing it loses the moment. */}
                  <SheetRow icon="poll" label="Start a poll" onClick={() => { setMoreOpen(false); firePoll?.(); }} />
                  <SheetRow icon="content_cut" label="Clip the last moment" onClick={() => { setMoreOpen(false); onOpenSheet({ kind: 'confirm', title: 'Clip saved', body: 'The last 30 seconds are in your clips. You choose whether to publish it. Nothing is posted automatically.', confirmLabel: 'Done' }); }} />
                  <SheetRow icon="share" label="Share stream" onClick={() => { setMoreOpen(false); onOpenSheet({ kind: 'share' }); }} />
                </>}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── DESKTOP FRAMED STUDIO ──
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', borderRadius: 16, overflow: 'hidden' }}>
            {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
                TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
                mounted last, and buried the chrome on six of seven surfaces — the
                mobile broadcaster lost End stream and Mic, the desktop viewer lost
                Follow and the composer. It replaces the VIDEO, so it renders here,
                straight after it, under everything the surface draws on top. */}
            <VideoArea />
            {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={streamDoc?.title} z={0} />}
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLive ? <LivePill /> : <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.85)' }}>PREVIEW</span>}
              {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, monospace' }}>{fmtTime(duration)}</span>}
              <div style={{ flex: 1 }} />
              <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ ...statChip('#fff'), border: 'none', cursor: 'pointer' }}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</button>
            </div>
            {/* ⚠ See the desktop viewer: a full-width goal band cuts the picture in half.
                On the co-host grid it also ran straight across the seam between two tiles. */}
            {isLive && <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 22, wPct: 52 }} goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable />}
          {/* ⚠ THE TIP DISPLAY IS THE DESIGNED COMBO FEED, NOT AN ALERT PILL.
          Left-aligned, avatar + "Sent X" + coin + a big xN counter that climbs
          when the same person sends again (previewSoloParts.jsx). The solo views
          always had it; these surfaces never did, so a tip here rendered as the
          generic centred pill instead — the thing that was replaced. */}
        <HypeTrain />
        <GiftFeed toasts={gifts} style={{ bottom: 76 }} />
        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: C.card, borderRadius: 12, padding: 12 }}>
            <CtrlBtn icon={micOn ? 'mic' : 'mic_off'} label="Mic" active={micOn} danger={!micOn} onClick={() => setMicOn((v) => !v)} />
            <CtrlBtn icon={camLive ? 'videocam' : 'videocam_off'} label="Camera" active={camLive} danger={!camLive} onClick={() => setCamOn((v) => !v)} />
            <CtrlBtn icon="screen_share" label={screenSharing ? 'Stop share' : 'Share screen'} active={screenSharing} onClick={() => setScreenSharing((v) => !v)} />
            <div style={{ position: 'relative' }}>
              <CtrlBtn icon="dashboard_customize" label="Layout" active={layoutMenuOpen} onClick={() => setLayoutMenuOpen((v) => !v)} />
              {layoutMenuOpen && (
                <LayoutMenu layoutMode={layoutMode} pipCorner={pipCorner} scene={scene}
                  onLayout={(m) => { setLayoutMode(m); setScene(null); }} onCorner={setPipCorner}
                  onScene={setScene} onClose={() => setLayoutMenuOpen(false)} />
              )}
            </div>
            <CtrlBtn icon="content_cut" label="Clip" onClick={() => onOpenSheet({ kind: 'confirm', title: 'Clip saved', body: 'The last 30 seconds are in your clips. You choose whether to publish it. Nothing is posted automatically.', confirmLabel: 'Done' })} />
            <CtrlBtn icon="poll" label="Poll" onClick={() => firePoll?.()} />
            <CtrlBtn icon="share" label="Share" onClick={() => onOpenSheet({ kind: 'share' })} />
            {/* The desktop half of the same gap: the host had no moderation
                entry point here either. */}
            <CtrlBtn icon="gavel" label="Moderate" active={modOpen} onClick={() => setModOpen(true)} />
            {/* ⚠ THE DESKTOP BAR HAD NO SETTINGS ENTRY AT ALL, so a desktop host
                could not reach format, who-can-watch or who-can-clip. */}
            <CtrlBtn icon="settings" label="Settings" onClick={() => onOpenSheet({ kind: 'streamsettings' })} />
            <div style={{ flex: 1, minWidth: 12 }} />
            <AudioMeter level={micLevel} />
            <button onClick={isLive ? onEndStream : onGoLive} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', background: isLive ? C.redFill : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{isLive ? 'End Stream' : 'Go Live'}</button>
          </div>
        </div>

        <div style={{ width: 320, flexShrink: 0, background: C.card, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', ...ruleBottom, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.textDim }}>LIVE CHAT</div>
          {/* ⚠ `display: flex` IS REQUIRED HERE, NOT DECORATION. This wrapper was
              a plain block, so the `flex: 1` on PreviewChat's own root did
              nothing and the column collapsed to its content — measured 20px,
              with every chat row pushed 1,285px above the frame. `flex: 1` only
              means something inside a flex container; in a block it is ignored
              silently, which is why the panel looked empty rather than broken.
              The bound itself lives inside PreviewChat. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PreviewChat messages={messages} avatars={avatars} onOpenProfile={(uid) => onOpenSheet({ kind: 'profile', uid })} />
          </div>
        </div>
      </div>

      <ReactionsFloor events={reactions} position="right" />
      <JoinAnnouncer events={joinEvents} side="right" sound={false} />
      {/* ⚠ EVERY RENDER BRANCH, NOT JUST THE FIRST. This file has three, and a
          single replace() mounted the states on one of them: broadcaster desktop
          could not draw a reconnect or a gated stream at all, and the guard
          passed because it only asked whether the FILE mentioned them. */}
      {gate !== 'none'
          ? <StreamPaywall kind={gate} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
          : playback !== 'live'
            ? <PlaybackState state={playback} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
              : null}
      {/* ⚠ THE HOST'S OWN FAILURES, ON EVERY BRANCH. A broadcaster who cannot
          see that their uplink died keeps talking to nobody. */}
      <div style={{ position: 'absolute', left: 10, right: 10, top: 64, zIndex: 8, pointerEvents: 'none' }}>
        <HealthWarning state={health} />
        {/* The host's own VP, at the host's own rates. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <VpEarnedChip host minutes={watchMinutes} onOpen={() => onOpenSheet?.({ kind: 'more' })} />
          <ModChannelSwitch role="host" channel={chatChannel} onChannel={setChatChannel} />
        </div>
        {(streamDoc?.viewerCount ?? 0) === 0 && (
          <ZeroViewers compact
            onShare={() => onOpenSheet?.({ kind: 'share' })}
            onInvite={() => onOpenSheet?.({ kind: 'share' })}
            onBoost={() => onOpenSheet?.({ kind: 'boost' })} />
        )}
      </div>
      <PreviewSheets openSheet={openSheet} host={host} onClose={() => onOpenSheet(null)} onOpen={onOpenSheet} />
        <AnimatePresence>{modOpen && <ModerationSheet onClose={() => setModOpen(false)} onOpenSheet={onOpenSheet} />}</AnimatePresence>
    </div>
  );
}

// ── inlined subcomponents (mirror the production broadcaster) ──
const roundBtn = { width: 34, height: 34, borderRadius: '50%', border: 'none', background: S.chipOnVideo, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
function statChip(color) { return { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 9px', borderRadius: 999, background: S.chipOnVideo, color, fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace' }; }
function LivePill() { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: C.redFill, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />LIVE</span>; }
// ⚠ AN ICON-ONLY PILL NEEDS ITS OWN NAME. With <Icon> aria-hidden (a ligature
// is not a word) these read as unnamed to a screen reader, which is a Play
// review item for an app with live UGC.
function ActionPill({ icon, onClick, active, label }) { return <button aria-label={label} onClick={onClick} style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', background: active ? C.purpleSoft : 'rgba(0,0,0,0.45)', color: active ? C.purpleLight : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name={icon} size={21} /></button>; }

function ModerationSheet({ onClose, onOpenSheet }) {
  // ⚠ TWO TIERS, TAKEN FROM THE SERVER, NOT INVENTED. functions/streamChatMod.js
  // gates mute/ban/pin behind loadStreamForMod (host OR moderator) and the chat
  // RULES behind loadStream (host only). The host sees both; a moderator would
  // see only the first group.
  //
  // ⚠⚠ EVERY ROW USED TO BE `onClick={onClose}`. Ten labels that dismissed the
  // menu that opened them — the founder's exact point about "Appoint a
  // moderator". Each one is missing the SECOND question:
  //   Timeout / Ban / Appoint → WHICH PERSON?  → the viewer list
  //   Slow mode               → HOW MANY SECONDS?
  //   Banned words            → WHICH WORDS?
  //   Clear chat              → ARE YOU SURE?  (it is destructive and silent)
  //   Followers-only etc.     → a toggle you can SEE the state of
  // Per-person actions route to the viewer list, which then opens the person
  // sheet, which is where timeout/ban/appoint actually live. One path, not two.
  // ⚠ THE RULES COME FROM THE SIM NOW. As local state they were thrown away
  // every time this sheet closed, and no other surface could see that chat was
  // restricted.
  // ⚠⚠ THIS DESTRUCTURE MUST STAY ABOVE `const rules`. It went below it once and
  // took the whole preview to the ErrorBoundary with "Cannot access 'p' before
  // initialization" — a `const` read above its own declaration is a TDZ error at
  // RENDER time, not a name error, so eslint's no-undef sees a defined binding,
  // the build is green, and the screen is dead.
  const { autoMod = 'standard', setAutoMod = () => {}, held = [], approveHeld, denyHeld, chatRules = {}, setChatRule = () => {} } = usePreviewSim();
  const rules = chatRules;
  const toggle = (k) => setChatRule(k, !rules[k]);
  const pickPerson = () => { onClose(); onOpenSheet?.({ kind: 'viewers' }); };
  const modActs = [
    ['Timeout a viewer', 'timer_off', pickPerson],
    ['Ban a viewer', 'gavel', pickPerson],
    ['Pin a message', 'push_pin', () => { onClose(); onOpenSheet?.({ kind: 'pin' }); }],
    ['Clear chat', 'delete_sweep', () => { onClose(); onOpenSheet?.({ kind: 'confirm', title: 'Clear chat?', body: 'Every message currently on screen is removed for everyone watching. Messages sent after this are unaffected.', confirmLabel: 'Clear chat', danger: true }); }],
  ];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', overflowY: 'auto', background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.textDim, marginBottom: 10 }}>Chat moderation</div>
        {/* ⚠ FIRST, AND IT LOOKS DIFFERENT. Shield Mode is the control a host
            reaches for while something is actively going wrong, so burying it in
            a list of equals is the same as not having it. Every other row here
            changes one setting; this one changes four. */}
        <button type="button" onClick={() => { onClose(); onOpenSheet?.({ kind: 'shield' }); }} style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
          padding: 12, borderRadius: 12, marginBottom: 8, cursor: 'pointer', border: 'none',
          background: 'linear-gradient(180deg, #2a1015 0%, #1a0a0f 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 12, background: 'linear-gradient(135deg, #ff6b6b, #a3122b)', display: 'grid', placeItems: 'center', color: '#fff' }}>
            <Icon name="shield" size={16} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#ff9d9d' }}>Shield mode</span>
            <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 2 }}>Lock chat down in one press</span>
          </span>
          <Icon name="chevron_right" size={16} style={{ color: C.textMuted, flexShrink: 0 }} />
        </button>
        {modActs.map(([l, ic, fn]) => <SheetRow key={l} icon={ic} label={l} onClick={fn} />)}
        {/* ⚠ THE QUEUE SITS DIRECTLY UNDER THE DIAL THAT FILLS IT, and only
            appears when it has something in it. A permanent "Held (0)" row is
            furniture; a row that appears when there is work is a prompt. */}
        {held.length > 0 && (
          <button type="button" onClick={() => { onClose(); onOpenSheet?.({ kind: 'held', held, level: autoMod, onApprove: approveHeld, onDeny: denyHeld }); }} style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
            padding: 12, borderRadius: 12, marginBottom: 6, cursor: 'pointer', border: 'none',
            background: 'linear-gradient(180deg, #2a1015 0%, #1a0a0f 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}>
            <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 12, background: 'linear-gradient(135deg, #ff6b6b, #a3122b)', display: 'grid', placeItems: 'center', color: '#fff' }}>
              <Icon name="inventory_2" size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#ff9d9d' }}>Held for review · {held.length}</span>
              <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 2 }}>Nobody watching has seen them</span>
            </span>
            <Icon name="chevron_right" size={16} style={{ color: C.textMuted, flexShrink: 0 }} />
          </button>
        )}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, margin: '14px 0 6px' }}>CHAT RULES · HOST ONLY</div>
        {/* ⚠ THE ROW CARRIES ITS CURRENT VALUE. A settings row that just says
            "Auto moderation" makes the host open the sheet to find out whether
            it is even on, which is how a safety setting goes unchecked. */}
        <SheetRow icon="auto_awesome" label="Auto moderation" value={AUTOMOD_LABEL[autoMod] || 'Standard'}
          onClick={() => { onClose(); onOpenSheet?.({ kind: 'automod', level: autoMod, onLevel: setAutoMod, heldCount: held.length }); }} />
        <SheetRow icon="timer" label="Slow mode" onClick={() => { onClose(); onOpenSheet?.({ kind: 'slowmode' }); }} />
        <ToggleRow icon="group" label="Followers-only" on={rules.followers} onClick={() => toggle('followers')} />
        <ToggleRow icon="star" label="Subscribers-only" on={rules.subs} onClick={() => toggle('subs')} />
        <ToggleRow icon="verified_user" label="Verified accounts only" on={rules.verified} onClick={() => toggle('verified')} />
        {/* ⚠ THE HOST SWITCH FOR SPOKEN CHAT WAS MISSING ENTIRELY. `ttsEnabled`
            is a per-stream setting the host owns (ChatPanel.jsx:96), and the
            preview had no way to turn it on — so neither the host control nor
            anything downstream of it could be captured. */}
        <ToggleRow icon="record_voice_over" label="Read chat aloud" on={rules.tts} onClick={() => toggle('tts')} />
        <SheetRow icon="block" label="Banned words" onClick={() => { onClose(); onOpenSheet?.({ kind: 'bannedwords' }); }} />
        <SheetRow icon="shield_person" label="Appoint a moderator" onClick={pickPerson} />
      </motion.div>
    </motion.div>
  );
}

const AUTOMOD_LABEL = { off: 'Off', light: 'Light', standard: 'Standard', strict: 'Strict' };

/** A rule you can see the state of. A toggle that never looks on is a label. */
function ToggleRow({ icon, label, on, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6, background: S.row, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
      <Icon name={icon} size={18} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? C.purple : S.track, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

function CtrlBtn({ icon, label, onClick, active, danger }) { return <button onClick={onClick} title={label} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 12, border: 'none', background: danger ? S.dangerDim : active ? C.purple : C.cardSoft, color: danger ? '#fff' : active ? '#fff' : C.text, cursor: 'pointer', minWidth: 58 }}><Icon name={icon} size={18} /><span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span></button>; }
function DockBtn({ icon, onClick, label, danger }) { return <button onClick={onClick} aria-label={label} style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: danger ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name={icon} size={20} /></button>; }
function SheetRow({ icon, label, value, onClick }) { return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6, background: S.row, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}><Icon name={icon} size={18} /><span style={{ flex: 1, minWidth: 0 }}>{label}</span>{value ? <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: C.textMuted }}>{value}</span> : null}</button>; }
function AudioMeter({ level, compact }) {
  const bars = compact ? 12 : 20;
  return <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: compact ? 12 : 14 }}>{Array.from({ length: bars }).map((_, i) => { const lit = level >= ((i + 1) / bars) * 100; const color = i < bars * 0.6 ? C.green : i < bars * 0.85 ? C.amber : C.red; return <div key={i} style={{ width: 3, height: compact ? 4 + (i / bars) * 8 : 4 + (i / bars) * 10, background: lit ? color : S.track, borderRadius: 1 }} />; })}</div>;
}
function LayoutMenu({ layoutMode, pipCorner, scene, onLayout, onCorner, onScene, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', bottom: '110%', left: 0, width: 250, background: C.card, borderRadius: 12, padding: 10, zIndex: 41, boxShadow: '0 16px 44px rgba(0,0,0,0.72)' }}>
        <div style={menuHdr}>Layout</div>
        {LAYOUT_PRESETS.map((p) => <button key={p.id} onClick={() => onLayout(p.id)} style={menuRow(layoutMode === p.id && !scene)}><Icon name={p.icon} size={16} /><span style={{ flex: 1 }}>{p.label}</span>{layoutMode === p.id && !scene && <Icon name="check" size={15} />}</button>)}
        <div style={menuHdr}>PiP corner</div>
        <div style={{ display: 'flex', gap: 6, padding: '0 2px' }}>{PIP_CORNERS.map((c) => <button key={c.id} onClick={() => onCorner(c.id)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: pipCorner === c.id ? C.purpleSoft : C.cardSoft, color: pipCorner === c.id ? C.purpleLight : C.textDim, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{c.id.toUpperCase()}</button>)}</div>
        <div style={menuHdr}>Scene cards</div>
        {SCENE_CARDS.map((s) => <button key={s.id} onClick={() => onScene(s.id)} style={menuRow(scene === s.id)}><Icon name="image" size={16} /><span style={{ flex: 1 }}>{s.title}</span>{scene === s.id && <Icon name="check" size={15} />}</button>)}
      </div>
    </>
  );
}
const menuHdr = { fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '8px 4px 6px' };
function menuRow(active) { return { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 8px', borderRadius: 8, border: 'none', background: active ? C.purpleSoft : 'transparent', color: active ? C.purpleLight : C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }; }

// Inert mock chat — no relay socket, no Firestore. Mirrors ChatPanel's look.
// ⚠ THE STATIC `PREVIEW_MSGS` THAT WAS HERE IS GONE. It was five hardcoded
// lines with no avatars and no member badges, so the broadcaster's chat did not
// look like the chat that ships. Messages now come from the simulator and render
// through the shared SimChat, which reproduces ChatPanel's own row treatment.
/**
 * What the host has switched on, said out loud.
 *
 * ⚠⚠ THE HOST HAD NO WAY TO SEE THAT THEY HAD RESTRICTED THEIR OWN CHAT. Every
 * rule lived inside the moderation sheet, so once it closed the only evidence
 * was that chat had gone quiet — which reads as "nobody is watching", not as
 * "I turned off everyone who is". After Shield Mode that is worse, because four
 * rules go on at once and none of them show anywhere.
 *
 * ⚠ IT IS A STATUS LINE, NOT A CONTROL. The action is one tap away in the
 * moderation menu. Wiring a handler through this component's two call sites is
 * the "remembered at every hop" pattern that has gone wrong four times in this
 * repo; the strip earns its place by answering "why is chat quiet", which no
 * surface answered at all.
 *
 * ⚠ `tts` IS NOT A RESTRICTION and is deliberately absent. Reading chat aloud
 * stops nobody from talking, and padding this line with settings that do not
 * gate anyone is how a status strip becomes wallpaper.
 */
function ChatRulesStrip({ overlay, rules = {} }) {
  const on = [
    rules.followers && 'Followers only',
    rules.subs && 'Subscribers only',
    rules.verified && 'Verified only',
    rules.slow > 0 && `Slow ${rules.slow}s`,
  ].filter(Boolean);
  if (!on.length) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      margin: overlay ? '0 0 8px' : '0 12px 8px', padding: '6px 10px', borderRadius: 12,
      background: 'linear-gradient(180deg, #221a3d 0%, #171029 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <Icon name="lock" size={13} style={{ color: C.purpleLight, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: C.purpleLight }}>Chat is limited</span>
      {on.map((label) => (
        <span key={label} style={{ fontSize: 11, fontWeight: 700, color: C.textDim, background: C.cardSoft, padding: '2px 8px', borderRadius: 999 }}>{label}</span>
      ))}
    </div>
  );
}

function PreviewChat({ overlay = false, composerExtras = null, messages = [], onOpenProfile, avatars = {}, scrollRef }) {
  const { held = [], autoMod = 'standard', approveHeld, denyHeld, setOpenSheet, chatRules = {} } = usePreviewSim();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ⚠ `overflow:hidden` AND AN EXPLICIT 100% ARE BOTH LOAD-BEARING. A flex
          child with minHeight:0 still PAINTS outside its box — it only stops
          pushing its siblings — and SimChat defaulted to a fixed 30vh, so it
          claimed the whole parent and the composer below was shoved out of the
          container onto the chat's own last rows. That is the founder's
          screenshot: "tomruns streaming again tomorrow" under the mic button. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', padding: overlay ? 0 : '10px 8px' }}>
        <SimChat
          fill
          messages={messages}
          avatars={avatars}
          layout={overlay ? 'overlay' : 'side'}
          scrollRef={scrollRef}
          onOpenProfile={onOpenProfile}
        />
      </div>
      <ChatRulesStrip overlay={overlay} rules={chatRules} />
      {/* ⚠⚠ A QUEUE NOBODY SEES IS A QUEUE NOBODY EMPTIES. The dial withholds
          messages from viewers, so the host has to be told, on the surface they
          are already staring at, that people are waiting on them. Burying the
          count two taps deep in a settings menu is how a held message becomes an
          accidental permanent mute.
          ⚠ IT RENDERS ONLY WHEN THERE IS SOMETHING HELD, so it costs the chat no
          height the rest of the time — this row sits above the composer and
          would otherwise push the chat up for nothing. */}
      {held.length > 0 && (
        <button type="button" onClick={() => setOpenSheet?.({ kind: 'held', held, level: autoMod, onApprove: approveHeld, onDeny: denyHeld })} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          margin: overlay ? '0 0 8px' : '0 12px', padding: '8px 12px', borderRadius: 12,
          border: 'none', cursor: 'pointer',
          background: 'linear-gradient(180deg, #2a1015 0%, #14080c 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
        }}>
          <Icon name="inventory_2" size={16} style={{ color: '#ff9d9d', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: '#ff9d9d' }}>
            {held.length} held for review
          </span>
          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: '#fff' }}>Review</span>
          <Icon name="chevron_right" size={14} style={{ color: '#ff9d9d', flexShrink: 0 }} />
        </button>
      )}
      {/* ⚠⚠ THE DESKTOP BROADCASTER COULD NOT SEND A MESSAGE. This row rendered a
          bare placeholder with no send button and no emoji — the host, the one
          person who is definitely going to talk in their own chat, had no way to.
          Mobile passes its mic/camera/more through `composerExtras`; desktop
          passed nothing, so it got nothing. Emoji + send are now part of the row
          itself, so no caller can omit them. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: overlay ? '8px 0 0' : '10px 12px', ...(overlay ? null : ruleTop) }}>
        <div style={{ flex: 1, padding: '9px 12px', borderRadius: 999, background: overlay ? S.chipOnVideo : C.cardSoft, color: '#ADADC2', fontSize: 13 }}>Say something…</div>
        {!overlay && (
          <>
            <button type="button" aria-label="Emotes" title="Emotes" onClick={() => {}} style={{ width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer', background: C.cardSoft, color: C.textDim, display: 'grid', placeItems: 'center' }}>
              <Icon name="mood" size={18} />
            </button>
            <button type="button" title="Send" onClick={() => {}} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: C.purple, color: '#fff', fontSize: 13, fontWeight: 800 }}>Send</button>
          </>
        )}
        {composerExtras}
      </div>
    </div>
  );
}
