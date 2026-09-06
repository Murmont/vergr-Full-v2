// PreviewObsOverlay — what OBS composites over the game.
//
// ⚠⚠ ZERO NEW MECHANICS, AND THAT IS THE WHOLE POINT. This is a SECOND RENDER
// TARGET for components that already ship on the viewer: the tip combo feed, the
// sub alert, the join announcer, the goal bar and the hype train. Nothing here
// invents an alert, a sound, a threshold or a payout. If an event does not
// already fire on the phone, it does not fire here either.
//
// ⚠ TRANSPARENT IS THE PRODUCT, so the checkerboard is not decoration. An
// overlay that looks right on a dark preview background and turns out to carry
// its own panel fill is useless the moment it lands on bright gameplay — the
// host sees a grey box over their game. The checkerboard is the honest view;
// the gameplay backdrop is how it will actually read. Both, always.
//
// ⚠ 1920x1080 IS THE CANVAS, NOT THE ELEMENT SIZE. OBS scales the browser
// source, so anything sized in viewport units renders at a different size in the
// scene than it does here. Everything is laid out against the 1920x1080 box.
//
// ⚠ NOT A ROUTE YET, DELIBERATELY. `/overlay/battle/:streamId/neon` is the
// precedent and it takes a stream id, which is not a secret — unlike the stream
// KEY, which is a credential and must never reach a URL a host pastes into OBS
// and screen-shares. Shipping the real page is a one-step port once the founder
// has looked at this.
import { useState } from 'react';
import Icon from '../../../components/Icon';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { StreamGoalBar, SubAlertOverlay } from '../../../components/streams/StreamGoalAndAlerts';
import { GiftFeed, useGiftFeed } from './previewSoloParts';
import { HypeTrain } from './previewStates';
import { usePreviewSim } from './previewAssetsContext';
import { C } from '../../../components/streams/states/tokens';

// The browser-source settings a host actually types into OBS. Read off the
// canvas below rather than written twice, so they cannot drift apart.
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export default function PreviewObsOverlay({ doc, backdrop }) {
  const { joinEvents = [], goalBox, reactions = [] } = usePreviewSim();
  const { toasts: gifts } = useGiftFeed(doc?.lastGift);
  const [ground, setGround] = useState('checker');

  // ⚠ SCALED, NOT RESIZED. The canvas is always 1920x1080 and the wrapper scales
  // it, so what is measured here is what OBS gets. Laying this out at the
  // container's own width would make every offset a lie.
  const scale = 0.42;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <div style={{
        position: 'relative',
        width: CANVAS_W * scale, height: CANVAS_H * scale,
        borderRadius: 12, overflow: 'hidden',
        // The two grounds. Checker = the truth about transparency; gameplay =
        // how it will read in a scene.
        ...(ground === 'checker'
          ? {
            backgroundColor: '#20232a',
            backgroundImage: 'linear-gradient(45deg, #2c3038 25%, transparent 25%), linear-gradient(-45deg, #2c3038 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2c3038 75%), linear-gradient(-45deg, transparent 75%, #2c3038 75%)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
          }
          : {
            backgroundColor: '#0b0b14',
            backgroundImage: backdrop ? `url(${backdrop})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }),
      }}>
        {/* The 1920x1080 canvas, scaled as one unit. */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: CANVAS_W, height: CANVAS_H,
          transform: `scale(${scale})`, transformOrigin: 'top left',
          pointerEvents: 'none',
        }}>
          {/* ⚠ THE SAME COMPONENTS, NOT LOOKALIKES. Anything redrawn for the
              overlay is a second definition that drifts the first time the
              viewer's version changes. */}
          {/* ⚠ THREE BANDS, NOT ONE. Measured with all three firing together: at
              a shared `bottom` the sub card lands on the tip row and the entrance
              ribbon under both, so a busy moment — which is exactly when a host
              is watching — turns into one unreadable pile. Alerts are transient,
              so this only shows up if you FIRE them and look, never by reading
              the layout. */}
          <HypeTrain style={{ left: 48, right: 'auto', width: 620, top: 48 }} />
          <SubAlertOverlay lastSub={doc?.lastSub} anchor="bottom" bottom={340} />
          <GiftFeed toasts={gifts} style={{ bottom: 180, left: 48 }} />
          <JoinAnnouncer events={joinEvents} side="left" sound={false} bottom={120} />
          {/* ⚠ REACTIONS BELONG HERE and the guard was right to demand them. They
              are the one alert a viewer fires constantly, so an overlay without
              them is the quietest surface in the product carrying the loudest
              signal on the phone. */}
          <ReactionsFloor events={reactions} position="right" />
          {goalBox !== null && (
            <div style={{ position: 'absolute', left: 48, bottom: 48, width: 620 }}>
              <StreamGoalBar goal={doc?.goal} />
            </div>
          )}
        </div>
      </div>

      {/* ⚠ AN EMPTY CANVAS IS THE CORRECT RESTING STATE, and without saying so it
          reads as broken. An alerts overlay is blank until something happens;
          that is the point of putting it over gameplay. This line is preview
          chrome and is outside the scaled canvas, so it never reaches OBS. */}
      <div style={{ width: CANVAS_W * scale, fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 1.6 }}>
        Empty until something happens, which is the point. Fire a tip, a subscribe, an
        entrance or a reaction from the rail and it lands here exactly as OBS would draw it.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {[['checker', 'Transparency'], ['scene', 'Over gameplay']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setGround(id)} style={{
            padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: ground === id ? C.purple : '#1A1A2A',
            color: ground === id ? '#fff' : C.textDim, fontSize: 12, fontWeight: 800,
          }}>{label}</button>
        ))}
      </div>

      {/* ⚠ THE SETTINGS ARE THE FEATURE. A host who cannot see the width, the
          height and the "shutdown source when not visible" answer will get a
          stretched overlay and blame Vergr. Twitch's own alert products lead
          with exactly these three fields. */}
      <div style={{ width: CANVAS_W * scale, padding: 12, borderRadius: 12, background: '#12101E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon name="dashboard_customize" size={16} style={{ color: C.purpleLight }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Add as a Browser source in OBS</span>
        </div>
        {[
          ['Width', String(CANVAS_W)],
          ['Height', String(CANVAS_H)],
          ['Shutdown source when not visible', 'Off'],
          ['Refresh browser when scene becomes active', 'Off'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.textDim }}>{k}</span>
            <span className="vg-mono" style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{v}</span>
          </div>
        ))}
        {/* ⚠ THE TWO "Off"s ARE NOT PADDING. Both default to ON in OBS, and both
            break alerts: shutdown-when-not-visible drops the connection every
            time the host switches scene, and refresh-on-active replays or
            swallows whatever was on screen at the cut. */}
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
          Both of those default to ON in OBS and both break alerts: the first drops the
          connection every time you switch scene, the second reloads the page mid-alert.
        </div>
      </div>
    </div>
  );
}
