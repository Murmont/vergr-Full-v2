// PreviewBroadcasterScreen — a SEPARATE, preview-only copy of the production
// BroadcasterScreen render, for the admin Stream Preview tab. It shows the real
// broadcaster chrome (desktop framed studio + mobile immersive) driven by a mock
// stream doc, with NO camera, NO ingest, and NO Firestore. Handlers are inert /
// local-only. `doc` carries lastGift/lastTip/lastSub so the admin screen can
// fire alerts + (later) gift overlays to preview placement.
//
// Production BroadcasterScreen.jsx is never touched.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../../../components/Icon';
import HypeMeter from '../../../components/tournament/HypeMeter';
import { StreamGoalBar, TipAlertOverlay, SubAlertOverlay } from '../../../components/streams/StreamGoalAndAlerts';
import { PreviewCoHostGrid, PreviewTournamentCard } from './PreviewStreamStages';

const C = {
  bg: '#0a0a14', card: '#12121e', cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: 'rgba(124,58,237,0.15)',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
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

export default function PreviewBroadcasterScreen({ device = 'desktop', live = true, doc, streamType = 'solo', guestCount = 2 }) {
  const streamDoc = doc;
  const isDesktop = device === 'desktop';
  const mobileImmersive = device === 'mobile';
  const isLive = live;
  const isCoHost = streamType === 'cohost';
  const isTournament = streamType === 'tournament';

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [cameraFacing, setCameraFacing] = useState('user');
  const [screenSharing, setScreenSharing] = useState(false);
  const [layoutMode, setLayoutMode] = useState('camera');
  const [pipCorner, setPipCorner] = useState('br');
  const [scene, setScene] = useState(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [mobileStudio, setMobileStudio] = useState(false);
  const [mobileLayoutOpen, setMobileLayoutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const duration = streamDoc?.startedAt ? Math.floor((Date.now() - streamDoc.startedAt) / 1000) : 0;
  const tipCoins = 0;
  const followerDelta = 0;
  const micLevel = micOn ? 62 : 0;

  const VideoArea = ({ fullscreen = false } = {}) => {
    if (isCoHost) return <PreviewCoHostGrid count={guestCount} showInvite fullscreen={fullscreen} />;
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#3a3a55', background: 'radial-gradient(120% 80% at 50% 0%, #241a3a 0%, #0c0c16 70%)' }}>
        <Icon name="videocam" size={42} />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em' }}>YOUR CAMERA (preview)</span>
        {isTournament && <PreviewTournamentCard />}
      </div>
    );
  };

  // ── MOBILE IMMERSIVE ──
  if (mobileImmersive) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
        <VideoArea />

        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '12px 12px 24px', background: 'linear-gradient(180deg, rgba(0,0,0,0.7), transparent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive ? <LivePill /> : <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{streamDoc.title}</span>}
          {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, monospace' }}>{fmtTime(duration)}</span>}
          <div style={{ flex: 1 }} />
          <span style={statChip('#fff')}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</span>
          <button style={roundBtn}><Icon name="close" size={18} /></button>
        </div>

        <div style={{ position: 'absolute', right: 10, top: '36%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <ActionPill icon="cameraswitch" onClick={() => setCameraFacing((f) => (f === 'user' ? 'environment' : 'user'))} active={cameraFacing === 'environment'} />
          {mobileStudio && <ActionPill icon="dashboard_customize" onClick={() => setMobileLayoutOpen(true)} active={mobileLayoutOpen} />}
          <ActionPill icon="content_cut" onClick={() => {}} />
          <ActionPill icon="poll" onClick={() => {}} />
          <ActionPill icon="share" onClick={() => {}} />
        </div>

        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLive && streamDoc.goal?.active && <div style={{ maxWidth: 360 }}><StreamGoalBar goal={streamDoc.goal} compact /></div>}
          {isLive ? (
            <div style={{ height: '30vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <PreviewChat overlay composerExtras={
                <>
                  <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={() => setMicOn((v) => !v)} label="Mic" />
                  <DockBtn icon={camOn ? 'videocam' : 'videocam_off'} danger={!camOn} onClick={() => setCamOn((v) => !v)} label="Camera" />
                  <DockBtn icon="more_horiz" onClick={() => setMoreOpen(true)} label="More" />
                </>
              } />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={() => setMicOn((v) => !v)} label="Mic" />
                <DockBtn icon={camOn ? 'videocam' : 'videocam_off'} danger={!camOn} onClick={() => setCamOn((v) => !v)} label="Camera" />
                <DockBtn icon="flip_camera_android" onClick={() => {}} label="Flip" />
                <div style={{ flex: 1 }} />
                <AudioMeter level={micLevel} compact />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setMobileStudio((v) => !v)} style={{ padding: '14px 12px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${mobileStudio ? C.purple : C.border}`, background: mobileStudio ? C.purpleSoft : 'rgba(255,255,255,0.06)', color: mobileStudio ? C.purpleLight : '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}><Icon name="dashboard_customize" size={16} /> Studio</button>
                <button style={{ flex: 1, padding: 15, borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>Start Stream</button>
              </div>
            </div>
          )}
        </div>

        <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />
        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />

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
                  <SheetRow icon="poll" label="Start a poll" onClick={() => setMoreOpen(false)} />
                  <SheetRow icon="content_cut" label="Clip the last moment" onClick={() => setMoreOpen(false)} />
                  <SheetRow icon="share" label="Share stream" onClick={() => setMoreOpen(false)} />
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
    <div style={{ position: 'absolute', inset: 0, background: C.bg, color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <VideoArea />
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLive ? <LivePill /> : <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.85)' }}>PREVIEW</span>}
              {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, monospace' }}>{fmtTime(duration)}</span>}
              <div style={{ flex: 1 }} />
              <span style={statChip('#fff')}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</span>
            </div>
            {isLive && streamDoc.goal?.active && <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}><StreamGoalBar goal={streamDoc.goal} /></div>}
            <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />
            <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
            <CtrlBtn icon={micOn ? 'mic' : 'mic_off'} label="Mic" active={micOn} danger={!micOn} onClick={() => setMicOn((v) => !v)} />
            <CtrlBtn icon={camOn ? 'videocam' : 'videocam_off'} label="Camera" active={camOn} danger={!camOn} onClick={() => setCamOn((v) => !v)} />
            <CtrlBtn icon="screen_share" label={screenSharing ? 'Stop share' : 'Share screen'} active={screenSharing} onClick={() => setScreenSharing((v) => !v)} />
            <div style={{ position: 'relative' }}>
              <CtrlBtn icon="dashboard_customize" label="Layout" active={layoutMenuOpen} onClick={() => setLayoutMenuOpen((v) => !v)} />
              {layoutMenuOpen && (
                <LayoutMenu layoutMode={layoutMode} pipCorner={pipCorner} scene={scene}
                  onLayout={(m) => { setLayoutMode(m); setScene(null); }} onCorner={setPipCorner}
                  onScene={setScene} onClose={() => setLayoutMenuOpen(false)} />
              )}
            </div>
            <CtrlBtn icon="content_cut" label="Clip" onClick={() => {}} />
            <CtrlBtn icon="poll" label="Poll" onClick={() => {}} />
            <CtrlBtn icon="share" label="Share" onClick={() => {}} />
            <div style={{ flex: 1, minWidth: 12 }} />
            <AudioMeter level={micLevel} />
            <button style={{ padding: '12px 22px', borderRadius: 12, border: 'none', background: isLive ? C.red : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{isLive ? 'End Stream' : 'Go Live'}</button>
          </div>
        </div>

        <div style={{ width: 320, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.textDim }}>LIVE CHAT</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PreviewChat />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── inlined subcomponents (mirror the production broadcaster) ──
const roundBtn = { width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
function statChip(color) { return { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.45)', color, fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace' }; }
function LivePill() { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: C.red, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />LIVE</span>; }
function ActionPill({ icon, onClick, active }) { return <button onClick={onClick} style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', background: active ? C.purpleSoft : 'rgba(0,0,0,0.45)', color: active ? C.purpleLight : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name={icon} size={21} /></button>; }
function CtrlBtn({ icon, label, onClick, active, danger }) { return <button onClick={onClick} title={label} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 10px', borderRadius: 10, border: `1px solid ${active ? C.purple : C.border}`, background: danger ? 'rgba(239,68,68,0.18)' : active ? C.purpleSoft : C.cardSoft, color: danger ? C.red : active ? C.purpleLight : C.text, cursor: 'pointer', minWidth: 58 }}><Icon name={icon} size={18} /><span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span></button>; }
function DockBtn({ icon, onClick, label, danger }) { return <button onClick={onClick} aria-label={label} style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: danger ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name={icon} size={20} /></button>; }
function SheetRow({ icon, label, onClick }) { return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6, background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}><Icon name={icon} size={18} />{label}</button>; }
function AudioMeter({ level, compact }) {
  const bars = compact ? 12 : 20;
  return <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: compact ? 12 : 14 }}>{Array.from({ length: bars }).map((_, i) => { const lit = level >= ((i + 1) / bars) * 100; const color = i < bars * 0.6 ? C.green : i < bars * 0.85 ? C.amber : C.red; return <div key={i} style={{ width: 3, height: compact ? 4 + (i / bars) * 8 : 4 + (i / bars) * 10, background: lit ? color : 'rgba(255,255,255,0.08)', borderRadius: 1 }} />; })}</div>;
}
function LayoutMenu({ layoutMode, pipCorner, scene, onLayout, onCorner, onScene, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', bottom: '110%', left: 0, width: 250, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, zIndex: 41, boxShadow: '0 12px 36px rgba(0,0,0,0.5)' }}>
        <div style={menuHdr}>Layout</div>
        {LAYOUT_PRESETS.map((p) => <button key={p.id} onClick={() => onLayout(p.id)} style={menuRow(layoutMode === p.id && !scene)}><Icon name={p.icon} size={16} /><span style={{ flex: 1 }}>{p.label}</span>{layoutMode === p.id && !scene && <Icon name="check" size={15} />}</button>)}
        <div style={menuHdr}>PiP corner</div>
        <div style={{ display: 'flex', gap: 6, padding: '0 2px' }}>{PIP_CORNERS.map((c) => <button key={c.id} onClick={() => onCorner(c.id)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${pipCorner === c.id ? C.purple : C.border}`, background: pipCorner === c.id ? C.purpleSoft : C.cardSoft, color: pipCorner === c.id ? C.purpleLight : C.textDim, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{c.id.toUpperCase()}</button>)}</div>
        <div style={menuHdr}>Scene cards</div>
        {SCENE_CARDS.map((s) => <button key={s.id} onClick={() => onScene(s.id)} style={menuRow(scene === s.id)}><Icon name="image" size={16} /><span style={{ flex: 1 }}>{s.title}</span>{scene === s.id && <Icon name="check" size={15} />}</button>)}
      </div>
    </>
  );
}
const menuHdr = { fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '8px 4px 6px' };
function menuRow(active) { return { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 8px', borderRadius: 8, border: 'none', background: active ? C.purpleSoft : 'transparent', color: active ? C.purpleLight : C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }; }

// Inert mock chat — no relay socket, no Firestore. Mirrors ChatPanel's look.
const PREVIEW_MSGS = [['Nova', 'gg that was clean'], ['Kai', 'pog'], ['m32', 'send the boss gift 👀'], ['Lyra', 'W stream'], ['vex', 'lets goooo']];
function PreviewChat({ overlay = false, composerExtras = null }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'flex-end', overflow: 'hidden', padding: overlay ? 0 : '10px 12px', fontSize: 13 }}>
        {PREVIEW_MSGS.map(([u, m], i) => (
          <div key={i} style={overlay ? { background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '5px 9px', alignSelf: 'flex-start', maxWidth: '90%' } : {}}>
            <span style={{ color: C.purpleLight, fontWeight: 700 }}>{u}</span> <span style={{ color: C.text }}>{m}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: overlay ? '8px 0 0' : '10px 12px', borderTop: overlay ? 'none' : `1px solid ${C.border}` }}>
        <div style={{ flex: 1, padding: '9px 12px', borderRadius: 999, background: overlay ? 'rgba(0,0,0,0.4)' : C.cardSoft, color: C.textMuted, fontSize: 13 }}>Say something…</div>
        {composerExtras}
      </div>
    </div>
  );
}
