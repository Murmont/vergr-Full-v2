// PreviewStreamStages — preview-only replicas of the non-solo stream LAYOUTS
// (co-host / multi-guest SFU grid + tournament overlay card) for the admin
// Stream Preview tab. These are STATIC mocks: no SFU, no Firestore, no camera.
// The visuals mirror CoHostStage.jsx and TournamentOverlay.jsx so the founder
// can judge each stream type, but the production streaming files are NEVER
// touched or imported here.

import Icon from '../../../components/Icon';

const C = {
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  gold: '#F0A500',
};

// Mock publisher roster for the co-host grid (host + up to 3 co-hosts).
export const PREVIEW_PUBLISHERS = [
  { role: 'HOST', name: 'Preview Streamer' },
  { role: 'CO-HOST', name: 'Nova' },
  { role: 'CO-HOST', name: 'Kai' },
  { role: 'CO-HOST', name: 'Lyra' },
];

// Mirrors CoHostStage.gridFor — n cells → grid template. n=3 = big tile down
// the left + two stacked on the right (the founder's multi-user mockup).
const gridFor = (n) => {
  if (n <= 1) return { cols: '1fr', rows: '1fr' };
  if (n === 2) return { cols: '1fr 1fr', rows: '1fr' };
  if (n === 3) return { cols: '1fr 1fr', rows: '1fr 1fr', bigLeft: true };
  return { cols: '1fr 1fr', rows: '1fr 1fr' };
};

// Co-host / multi-guest publisher grid. `count` = number of live publishers
// (1-4). `showInvite` renders the host-only empty "Invite co-host" slot when
// there's an open seat (broadcaster view only). `fullscreen` tightens gaps to
// match what a viewer sees in the baked composite. `edge` drops the outer
// padding + radius so tiles run edge-to-edge (the stacked multi-user viewer).
export function PreviewCoHostGrid({ count = 2, showInvite = false, fullscreen = false, edge = false }) {
  const n = Math.max(1, Math.min(4, count));
  const tiles = PREVIEW_PUBLISHERS.slice(0, n);
  const withInvite = showInvite && n < 4;
  // The invite slot is a real cell — size the grid for the total cell count.
  const cellCount = n + (withInvite ? 1 : 0);
  const grid = gridFor(cellCount);
  // `edge` (mobile co-host) = tiles run flush to the screen edges (NO outer
  // margin) with just a thin 4px seam between them so the cohost-screen
  // background shows as a divider and the streamers don't merge into a mesh.
  const pad = edge ? 0 : (fullscreen ? 8 : 12);
  const gap = edge ? 4 : (fullscreen ? 6 : 10);

  return (
    <div style={{ position: 'absolute', inset: 0, padding: pad, background: edge ? 'transparent' : 'radial-gradient(120% 80% at 50% 0%, #1a1530 0%, #0c0c16 70%)' }}>
      <div style={{ display: 'grid', gap, gridTemplateColumns: grid.cols, gridTemplateRows: grid.rows, width: '100%', height: '100%' }}>
        {tiles.map((t, i) => (
          <Tile key={i} tile={t} fullscreen={fullscreen} bigLeft={grid.bigLeft && i === 0} edge={edge} />
        ))}
        {withInvite && <InviteSlot />}
      </div>
    </div>
  );
}

function Tile({ tile, fullscreen, bigLeft, edge }) {
  return (
    <div style={{
      position: 'relative', background: '#000', borderRadius: edge ? 0 : (fullscreen ? 8 : 12),
      border: edge ? 'none' : `1px solid ${C.border}`, overflow: 'hidden', minHeight: 0,
      gridRow: bigLeft ? 'span 2' : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#3a3a55' }}>
        <Icon name="videocam" size={fullscreen ? 24 : 32} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>{tile.role === 'HOST' ? 'YOUR CAMERA' : 'GUEST CAMERA'}</span>
      </div>
      <div style={{
        position: 'absolute', top: 10, left: 10, padding: '3px 8px', borderRadius: 4,
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
        background: tile.role === 'HOST' ? 'rgba(124,58,237,0.85)' : 'rgba(0,0,0,0.6)', color: '#fff',
      }}>{tile.role}</div>
      <div style={{
        position: 'absolute', bottom: 10, left: 10, fontSize: 12, fontWeight: 700, color: '#fff',
        padding: '4px 8px', background: 'rgba(0,0,0,0.55)', borderRadius: 4,
      }}>{tile.name}</div>
    </div>
  );
}

function InviteSlot() {
  return (
    <div style={{
      position: 'relative', background: C.cardSoft, border: `1px dashed ${C.border}`, borderRadius: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim,
      fontSize: 12, fontWeight: 600,
    }}>
      <div style={{ textAlign: 'center' }}>
        <Icon name="group_add" size={28} />
        <div style={{ marginTop: 6 }}>Invite co-host</div>
      </div>
    </div>
  );
}

// Floating tournament card — mirrors TournamentOverlay.jsx visuals with mock
// data, anchored top-left over the video.
export function PreviewTournamentCard({ offset = { top: 12, left: 12 } }) {
  return (
    <div style={{
      position: 'absolute', ...offset, display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px 6px 8px', borderRadius: 12, background: 'rgba(18,18,30,0.92)',
      border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
      color: C.text, fontSize: 11, fontWeight: 700, zIndex: 5, maxWidth: 320,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: `linear-gradient(135deg, ${C.gold}, #F5C842)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="emoji_events" size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Preview Cup · Finals</div>
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>Round 3 vs Nova</div>
      </div>
      <div style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(240,165,0,0.18)', color: C.gold, fontSize: 10, fontWeight: 800 }}>50,000c</div>
    </div>
  );
}
