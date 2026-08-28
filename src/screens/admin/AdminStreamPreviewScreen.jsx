// AdminStreamPreviewScreen — /admin/stream-preview
//
// See the live-stream UI (broadcaster + viewer, desktop + mobile) WITHOUT going
// live, and preview where on-stream alerts (and, later, gift overlays) land. It
// mounts the SEPARATE preview copies (PreviewBroadcasterScreen /
// PreviewViewerScreen) fed a mock stream doc — no camera, no ingest, no
// Firestore, no chat relay. The production streaming screens are never touched.

import { useState, useRef } from 'react';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import Icon from '../../components/Icon';
import { makePreviewStreamDoc, PREVIEW_HOST } from './streamPreview/previewStream';
import PreviewBroadcasterScreen from './streamPreview/PreviewBroadcasterScreen';
import PreviewViewerScreen from './streamPreview/PreviewViewerScreen';

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 3 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
          background: value === o.value ? `linear-gradient(135deg, ${C.accent2}, ${C.accent})` : 'transparent',
          color: value === o.value ? '#fff' : C.textDim,
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Btn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', gap: 7 }}>{children}</button>
  );
}

export default function AdminStreamPreviewScreen() {
  const [role, setRole] = useState('broadcaster');
  const [device, setDevice] = useState('desktop');
  const [live, setLive] = useState(true);
  const [streamType, setStreamType] = useState('solo');
  const [guestCount, setGuestCount] = useState(2);
  const [soloView, setSoloView] = useState('immersive');
  const [scene, setScene] = useState('game');
  const [doc, setDoc] = useState(makePreviewStreamDoc);

  // Fire tip rotates through demo senders so the gift feed shows BOTH behaviours:
  // repeated TestFan/Rose hits combo one row's counter up, while Kai (also Rose)
  // and Nova (Galaxy) stack as their own rows — the TikTok pattern. The mobile
  // viewers read lastGift (the on-screen gift component); the desktop framed
  // co-host/tournament views still read lastTip for their alert overlay.
  const TIP_DEMO = [
    { name: 'TestFan', gift: 'Rose', qty: 12 },
    { name: 'Nova', gift: 'Galaxy', qty: 50 },
    { name: 'Kai', gift: 'Rose', qty: 8 },
  ];
  const tipIdx = useRef(0);
  const fireTip = () => {
    const g = TIP_DEMO[tipIdx.current % TIP_DEMO.length];
    tipIdx.current += 1;
    setDoc((d) => ({ ...d, lastTip: { coins: 500, fromName: g.name, ts: Date.now() }, lastGift: { ...g, ts: Date.now() } }));
  };
  const fireSub = () => setDoc((d) => ({ ...d, lastSub: { tierName: 'Gold', fromName: 'TestFan', badge: { color: '#F0A500', icon: 'star' }, ts: Date.now() } }));

  const mobile = device === 'mobile';
  // Solo viewer (mobile) can preview the EXISTING immersive screen (default) or
  // the two ADDITIONAL designs (split portrait / landscape). Nothing replaced.
  const showSoloView = mobile && role === 'viewer' && streamType === 'solo';
  const landscape = showSoloView && soloView === 'landscape';
  const frameW = mobile ? (landscape ? 780 : 402) : '100%';
  const frameH = mobile ? (landscape ? 380 : 770) : 560;

  const stage = role === 'broadcaster'
    ? <PreviewBroadcasterScreen device={device} live={live} doc={doc} streamType={streamType} guestCount={guestCount} />
    : <PreviewViewerScreen device={device} doc={doc} host={PREVIEW_HOST} streamType={streamType} guestCount={guestCount} soloView={soloView} scene={scene} />;

  return (
    <AdminShell screen="stream-preview" title="Stream Preview" subtitle="See the live-stream UI without going live. No camera, ingest, or Firestore.">
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <Seg options={[{ value: 'broadcaster', label: 'Broadcaster' }, { value: 'viewer', label: 'Viewer' }]} value={role} onChange={setRole} />
          <Seg options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} value={device} onChange={setDevice} />
          {/* The 'tournament' preview mode is gone with the tournament overlays. */}
          <Seg options={[{ value: 'solo', label: 'Solo' }, { value: 'cohost', label: 'Co-host' }]} value={streamType} onChange={setStreamType} />
          {streamType === 'cohost' && (
            <Seg options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} value={guestCount} onChange={setGuestCount} />
          )}
          {showSoloView && (
            <Seg options={[{ value: 'immersive', label: 'Immersive (current)' }, { value: 'split', label: 'Split (portrait)' }, { value: 'landscape', label: 'Landscape' }]} value={soloView} onChange={setSoloView} />
          )}
          {showSoloView && soloView !== 'immersive' && (
            <Seg options={[{ value: 'game', label: 'Game + cam' }, { value: 'cam', label: 'Camera only' }]} value={scene} onChange={setScene} />
          )}
          {role === 'broadcaster' && (
            <Seg options={[{ value: true, label: 'Live' }, { value: false, label: 'Pre-live' }]} value={live} onChange={setLive} />
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn onClick={fireTip}><Icon name="volunteer_activism" size={15} /> Fire tip</Btn>
            <Btn onClick={fireSub}><Icon name="workspace_premium" size={15} /> Fire sub</Btn>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          {mobile ? (
            <div style={{ padding: 8, borderRadius: 34, background: '#000', border: '6px solid #1c1c2c', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
              <div style={{ position: 'relative', width: frameW, height: frameH, overflow: 'hidden', borderRadius: 26, background: '#000' }}>{stage}</div>
            </div>
          ) : (
            <div style={{ position: 'relative', width: frameW, height: frameH, maxWidth: 1000, overflow: 'hidden', borderRadius: 14, border: `1px solid ${C.border}`, background: '#000' }}>{stage}</div>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, color: C.textMuted, marginTop: 10 }}>
          This is the real {role} chrome rendered from a mock stream. Tip / sub alerts fire over the video so you can judge on-stream overlay placement.
        </div>
      </div>
    </AdminShell>
  );
}
