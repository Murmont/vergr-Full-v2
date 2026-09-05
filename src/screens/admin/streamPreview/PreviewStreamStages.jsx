// PreviewStreamStages — preview-only replicas of the non-solo stream LAYOUTS
// (co-host / multi-guest SFU grid + tournament overlay card) for the admin
// Stream Preview tab. These are STATIC mocks: no SFU, no Firestore, no camera.
// The visuals mirror CoHostStage.jsx and TournamentOverlay.jsx so the founder
// can judge each stream type, but the production streaming files are NEVER
// touched or imported here.

import Icon from '../../../components/Icon';
import vcCoin from '../../../assets/stream/vc-coin.webp';
import { CAST } from './previewCast';
import { PREVIEW_HOST } from './previewStream';
import UserAvatar from '../../../components/UserAvatar';
import { usePreviewVideos, useFaces } from './previewAssetsContext';

const compactNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/.0$/, '') + 'k' : String(n));

const C = {
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  gold: '#F0A500',
};

// Mock publisher roster for the co-host grid (host + up to 3 co-hosts).
//
// ⚠ DERIVED FROM THE ONE CAST, NOT INVENTED. This used to read
// { name: 'Preview Streamer' } / 'Nova' / 'Lyra' — a placeholder the file
// header of previewStream.js explicitly bans (these captures go on the Play
// listing), plus two people who exist nowhere else in the simulator. A tile
// labelled with a name that has no cast member behind it can never show an
// uploaded face, and "Preview Streamer" reads as an unfinished mock.
export const PREVIEW_PUBLISHERS = [
  { role: 'HOST', name: PREVIEW_HOST.displayName, uid: PREVIEW_HOST.uid, slot: 'stage' },
  { role: 'CO-HOST', name: CAST[3].displayName, uid: CAST[3].uid, slot: 'guest1' },
  { role: 'CO-HOST', name: CAST[5].displayName, uid: CAST[5].uid, slot: 'guest2' },
  { role: 'CO-HOST', name: CAST[4].displayName, uid: CAST[4].uid, slot: 'guest3' },
];

// ── CELL SHAPE ───────────────────────────────────────────────────────────────
//
// ⚠⚠ MEASURED OFF TIKTOK'S OWN MULTI-GUEST ONE-PAGER, not guessed. Their
// mockup is 750x1624; each guest cell is 375 x 553, so the cell is PORTRAIT at
// roughly 2:3 — not square, and emphatically not the full-height slice we had.
// Two cells side by side at region height gave 196x429 (0.46), which is why the
// frames read as stretched.
//
// ⚠ AND THE SEAT COUNT IS FIXED. In the reference, one live guest renders as
// ONE cell plus three "+ Invite" seats — the cells do NOT grow to fill the
// space. That is what their "fixed layout" setting means, and it is why their
// tiles are always the same shape whoever is on.
const CELL_ASPECT = 2 / 3;

// Rows a fixed 2-column seat grid needs for n seats.
const rowsFor = (n) => (n <= 2 ? 1 : 2);

// The region's own aspect: 2 columns of 2:3 cells over however many rows.
// ⚠ This sizes the GRID, never the screen. The old aspectFor() sized the whole
// region off the viewport and shrank the video; this derives height from the
// cell shape the reference actually uses.
export function gridAspect(seats) {
  const rows = rowsFor(Math.max(1, Math.min(4, seats)));
  const cols = Math.max(1, Math.min(2, seats));
  return (cols * CELL_ASPECT) / rows;
}

// ⚠⚠ PANEL MUST NOT USE gridAspect(). Both viewer and broadcaster were passing
// the GRID aspect to the PANEL layout, so the host tile changed shape with the
// guest count: measured 393x295 (1.333) with one guest and 393x590 (0.667) with
// three. Panel has exactly ONE host tile whatever the guest count — the guests
// float over it in a column — so its shape cannot depend on how many there are.
// Held at the same 2:3 the grid cells use, so switching Grid/Panel does not make
// the stage jump size either.
export const PANEL_ASPECT = CELL_ASPECT;
export function stageAspect(layout, seats) {
  return layout === 'panel' ? PANEL_ASPECT : gridAspect(seats);
}
// ⚠ ALWAYS TWO COLUMNS. The big-left-plus-two-stacked shape is gone: it is not
// in the reference, and it made a 3-guest stream a different tile shape from a
// 2- or 4-guest one — the opposite of what a fixed seat grid is for.
const gridFor = (seats) => ({ cols: '1fr 1fr', rows: seats <= 2 ? '1fr' : '1fr 1fr' });

// Co-host / multi-guest publisher grid. `count` = number of live publishers
// (1-4). `showInvite` renders the host-only empty "Invite co-host" slot when
// there's an open seat (broadcaster view only). `fullscreen` tightens gaps to
// match what a viewer sees in the baked composite. `edge` drops the outer
// padding + radius so tiles run edge-to-edge (the stacked multi-user viewer).
// ⚠ TWO LAYOUTS, BECAUSE THAT IS WHAT THE REFERENCE HAS. TikTok multi-guest
// offers PANEL (host on the main screen, guests secondary — recommended for
// one-on-one and for guest AUDIO chatting) and GRID (equal exposure, for
// performances and gameplay), host-selectable and changeable mid-stream.
//
// ⚠ THIS IS WHY WE DO NOT AUTO-COLLAPSE AROUND A CAMERA-OFF GUEST. Audio guests
// are what Panel mode is FOR; the host picks the mode and the product does not
// guess. A grid that reshuffles every time a camera drops is unusable for the
// host and disorienting for viewers, so a quiet guest KEEPS THEIR SEAT and
// shows their avatar in it.
export function PreviewCoHostGrid({
  count = 2, showInvite = false, fullscreen = false, edge = false,
  layout = 'grid', camsOff = [],
}) {
  const { videoFor } = usePreviewVideos();
  const n = Math.max(1, Math.min(4, count));
  const tiles = PREVIEW_PUBLISHERS.slice(0, n);
  const pad0 = edge ? 0 : (fullscreen ? 8 : 12);
  const camOn = (i) => !camsOff.includes(i);

  if (layout === 'panel') {
    // ⚠⚠ MEASURED OFF TIKTOK'S PANEL MOCKUP (750x1624), NOT INVENTED. Guests
    // are a COLUMN DOWN THE RIGHT, not a strip along the bottom — that was my
    // guess and the founder corrected it. Their column is 242px of 750 (32% of
    // the width), flush right, with tiles 242x308, so each tile is 4:5 portrait.
    // The host runs full-bleed behind it and the chat overlays the bottom LEFT,
    // beside the column rather than under it.
    const [hostTile, ...guests] = tiles;
    return (
      <div style={{ position: 'absolute', inset: 0, padding: pad0, background: edge ? 'transparent' : 'radial-gradient(120% 80% at 50% 0%, #1a1530 0%, #0c0c16 70%)' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Tile tile={hostTile} fullscreen={fullscreen} edge={edge} fill isHost
              videoUrl={camOn(0) ? videoFor(hostTile.slot) : null} camOff={!camOn(0)} />
          </div>
          {/* ⚠⚠ THE COLUMN WIDTH IS COUNT-BASED, AND BOTH WRONG ANSWERS ARE RECORDED.
              MEASURED: at a flat 32% of a 393px stage each 4:5 tile is 126x157, so THREE
              of them fill 481px of a 590px stage — 81% of the height, which is what the
              founder called oversized. My first fix drove the column from HEIGHT instead;
              with only ONE guest that tile then took the whole column and measured 292x365,
              74% of the frame width. WORSE than the bug.
              The mockup proportion (242/750 = 32%) is right for a SHORT column and wrong for
              a tall one, so the count is what varies: 32% at one or two guests, 24% at three
              or more, which lands the stack at ~62% of the height instead of 81%. */}
          {guests.length > 0 && (
            <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: guests.length >= 3 ? '24%' : '32%', display: 'flex', flexDirection: 'column', gap: 5, zIndex: 3 }}>
              {guests.map((t, i) => (
                <div key={t.uid} style={{ width: '100%', aspectRatio: '4 / 5', borderRadius: 4, overflow: 'hidden', position: 'relative', background: '#000' }}>
                  <Tile tile={t} fullscreen edge fill panelGuest
                    videoUrl={camOn(i + 1) ? videoFor(t.slot) : null} camOff={!camOn(i + 1)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  const seats = n <= 2 ? 2 : 4;
  const grid = gridFor(seats);
  // `edge` (mobile co-host) = tiles run flush to the screen edges (NO outer
  // margin) with just a thin 4px seam between them so the cohost-screen
  // background shows as a divider and the streamers don't merge into a mesh.
  const pad = edge ? 0 : (fullscreen ? 8 : 12);
  const gap = edge ? 4 : (fullscreen ? 6 : 10);

  return (
    <div style={{ position: 'absolute', inset: 0, padding: pad, background: edge ? 'transparent' : 'radial-gradient(120% 80% at 50% 0%, #1a1530 0%, #0c0c16 70%)' }}>
      <div style={{ display: 'grid', gap, gridTemplateColumns: grid.cols, gridTemplateRows: grid.rows, width: '100%', height: '100%' }}>
        {/* ⚠ ONE SLOT PER TILE. Every guest used to be handed the SAME facecam
            clip, so a four-way co-host capture was one person duplicated three
            times — worse than an empty tile, because it looks deliberate. */}
        {Array.from({ length: seats }, (_, i) => {
          const t = tiles[i];
          if (!t) return <InviteSlot key={`seat${i}`} edge={edge} showInvite={showInvite} />;
          return (
            <Tile key={t.uid} tile={t} fullscreen={fullscreen} edge={edge}
              videoUrl={camOn(i) ? videoFor(t.slot) : null} camOff={!camOn(i)} />
          );
        })}
      </div>
    </div>
  );
}

// ⚠ EACH TILE IS A DIFFERENT PERSON, SO EACH TILE IS A DIFFERENT CLIP. The grid
// first drew "YOUR CAMERA" / "GUEST CAMERA" on black no matter what was
// uploaded; the fix after that handed the HOST tile the stage clip and EVERY
// guest tile the same facecam clip, which made a four-way capture one person
// duplicated three times. The caller now passes a per-tile slot.
function Tile({ tile, fullscreen, bigLeft, edge, videoUrl = null, camOff = false, compact = false, fill = false, isHost = false, panelGuest = false }) {
  const faceOf = useFaces();
  return (
    <div style={{
      position: 'relative', background: '#000', borderRadius: edge ? 0 : (fullscreen ? 8 : 12),
      // ⚠ NO OUTLINE ON A VIDEO TILE. Gameplay defines its own edge; the hairline that
      // used to ring these measured a visible grey rectangle against pure black.
      border: 'none', overflow: 'hidden', minHeight: 0,
      gridRow: bigLeft ? 'span 2' : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: (compact || fill) ? '100%' : undefined, height: (compact || fill) ? '100%' : undefined,
    }}>
      {videoUrl ? (
        <video src={videoUrl} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        /* ⚠⚠ AVATAR AND A MIC, NEVER A CAMERA GLYPH. Founder, 2026-09-01, on
           the reference: "they have the users avatar with a voice icon/mic not
           a camera". It is the right call and not just a style preference —
           Panel is the AUDIO mode, so someone with no video is not a broken
           camera, they are a person talking. A crossed-out camera reads as a
           fault; a face with a mic reads as a participant. The host gets a
           large circular avatar centred on the blurred stage, exactly as their
           mockup shows a camera-off host. */
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'radial-gradient(90% 80% at 50% 35%, #241d3d 0%, #0c0c16 78%)' }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <UserAvatar src={faceOf(tile)} size={compact ? 26 : (isHost ? 92 : (panelGuest ? 54 : (fullscreen ? 46 : 58)))} />
            {!compact && (
              <span style={{
                position: 'absolute', right: -2, bottom: -2, width: isHost ? 30 : 20, height: isHost ? 30 : 20,
                borderRadius: '50%', background: C.purple, border: '2px solid #0c0c16',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="mic" size={isHost ? 16 : 11} filled />
              </span>
            )}
          </span>
        </div>
      )}
      {/* ⚠⚠ THE ROLE LABEL LEFT THE TOP-LEFT CORNER, AND THAT IS THE WHOLE POINT.
          top:10 left:10 is exactly where every surface puts its own top-left chrome, so
          the label was in a permanent fight with it. Measured on the desktop BROADCASTER
          co-host: HOST covered by the LIVE pill, 29x9, and a hit-test at the label's own
          centre returned the pill. The desktop VIEWER had the same collision and was
          patched by moving ITS badges — which fixed one surface and left this one, the
          sibling failure this project keeps repeating.
          Sitting the role with the NAME it labels fixes every surface at once and cannot
          collide with header chrome by construction.
          ⚠ The old fill was rgba(124,58,237,0.85) — a wash that only escaped the
          fake-glass rule by sitting above its 0.8 threshold. Solid now. */}
      <div style={{
        position: 'absolute',
        ...(isHost && fill
          ? { top: 36, left: 10 }
          : { bottom: compact ? 3 : (panelGuest ? 6 : 10), left: compact ? 4 : (panelGuest ? 7 : 10), right: compact ? 4 : undefined }),
        display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start',
        textShadow: '0 1px 3px rgba(0,0,0,0.9)',
      }}>
        {!compact && !panelGuest && (
          <span style={{
            padding: '2px 7px', borderRadius: 4, marginBottom: 1,
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
            background: tile.role === 'HOST' ? '#7c3aed' : '#100C1C', color: '#fff',
          }}>{tile.role}</span>
        )}
      {/* Name, and for a panel guest their coin total beneath it — the
          reference puts both at the bottom-left of every guest tile.
          ⚠ EXCEPT THE PANEL HOST, WHOSE TILE IS THE WHOLE SCREEN. Pinned to the
          bottom of a full-bleed tile the name lands at y=803 — inside the
          composer row — so "Riven" was sitting under the mic button. A tile that
          IS the background puts its name under the role pill at the top, where
          the rest of the header chrome lives. */}

        <span style={{ fontSize: compact ? 9 : (panelGuest ? 12 : 12), fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120, padding: (compact || panelGuest) ? 0 : '4px 8px', background: (compact || panelGuest) ? 'none' : 'rgba(0,0,0,0.55)', borderRadius: 4 }}>{tile.name}</span>
        {panelGuest && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff' }}>
            <img src={vcCoin} alt="" style={{ width: 13, height: 13, objectFit: 'contain' }} />
            {compactNum(tile.coins || 1200)}
          </span>
        )}
      </div>
    </div>
  );
}
function InviteSlot({ edge = false, showInvite = false }) {
  if (!showInvite) return <div style={{ background: '#14141F', borderRadius: edge ? 0 : 12 }} />;
  return (
    <div style={{
      position: 'relative', background: C.cardSoft, border: '1px dashed rgba(255,255,255,0.20)', borderRadius: 12,
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
      padding: '6px 12px 6px 8px', borderRadius: 12, background: '#12121E', border: 'none',
      boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
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
      <div style={{ padding: '2px 8px', borderRadius: 99, background: '#3A2A05', color: C.gold, fontSize: 10, fontWeight: 800 }}>50,000c</div>
    </div>
  );
}
