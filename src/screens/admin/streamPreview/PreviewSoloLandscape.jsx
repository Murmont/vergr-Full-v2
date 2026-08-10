// PreviewSoloLandscape — solo live-viewer, PHONE LANDSCAPE (rotated).
// Founder design (images 1 & 3): IMMERSIVE full-bleed video with overlaid chrome
// — host capsule top-left, gifters / viewers / close top-right, solo facecam PiP
// bottom-left (gameplay only), chat overlay on the RIGHT, composer dock across
// the bottom, fullscreen toggle bottom-right.
// scene='game' = gameplay + PiP, scene='cam' = camera only. Preview-only.
//
// Focus mode: TAP the video (an action, not a button) to dismiss ALL UI + chat
// so the viewer can watch clean; tap again to bring it back.
//
// Gifts: the gift component is TRANSIENT — it floats above the dock when a gift is
// sent (admin "Fire tip" or tapping Tips & VC) and fades; same sender+gift combos
// the counter, different senders stack (TikTok-style).

import { useState } from 'react';
import { SubAlertOverlay, StreamGoalBar } from '../../../components/streams/StreamGoalAndAlerts';
import {
  PreviewVideoStage, FacecamPip, HostCapsule, GiftersClusterCoins, ViewerPill, CloseBtn,
  FullscreenBtn, GiftFeed, useGiftFeed, SoloChatRow, JoinRow, SoloDock, C,
} from './previewSoloParts';

export default function PreviewSoloLandscape({ doc, host, scene = 'game' }) {
  const d = doc || {};
  const [uiHidden, setUiHidden] = useState(false);
  const { toasts, sendGift } = useGiftFeed(d.lastGift);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
      <PreviewVideoStage scene={scene} />

      {/* Tap layer — sits over the video, BELOW the chrome (z3). Tapping bare
          video toggles focus mode; the chrome (z4+) keeps its own taps. When the
          UI is hidden this layer covers everything, so a tap brings it back. */}
      <div onClick={() => setUiHidden((v) => !v)} style={{ position: 'absolute', inset: 0, zIndex: 3, cursor: 'pointer' }} />

      {!uiHidden && (
        <>
          {/* Top row — host capsule (left) + gifters / viewers / close (right). */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 12, display: 'flex', alignItems: 'flex-start', gap: 8, zIndex: 4 }}>
            <HostCapsule host={host} hearts={d.hearts} />
            <div style={{ flex: 1, minWidth: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <GiftersClusterCoins gifters={d.previewGifters} />
              <ViewerPill count={d.viewerCount} />
              <CloseBtn />
            </div>
          </div>

          {/* Tip goal — under the header on the left. */}
          {d.goal?.active && (
            <div style={{ position: 'absolute', top: 70, left: 12, width: 280, zIndex: 4 }}><StreamGoalBar goal={d.goal} compact /></div>
          )}

          {/* Solo facecam PiP — bottom-left, gameplay only. */}
          {scene === 'game' && <FacecamPip w={184} style={{ position: 'absolute', left: 12, bottom: 70, zIndex: 4 }} />}

          {/* Chat overlay — right side, newest at the bottom, older fade at the top. */}
          <div style={{ position: 'absolute', right: 12, top: 70, bottom: 74, width: '42%', maxWidth: 360, zIndex: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 11, textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 96%)' }}>
              <SoloChatRow inline user="kai_mercer" text="wait how did you pull that off" />
              <SoloChatRow inline user="ZERO_taeyeon" text="ok that was actually clean, I've been trying to land that all week and it never works for me" mod sub />
              <SoloChatRow inline user="Priya_S" text="first time here, this is sick" />
              <SoloChatRow inline user="tomruns" text="streaming again tomorrow?" />
              <JoinRow />
            </div>
          </div>

          {/* Transient gift drops — float above the dock on the left. */}
          <GiftFeed toasts={toasts} style={{ position: 'absolute', left: 12, bottom: 64, zIndex: 5 }} />

          {/* Composer dock — across the bottom. Tips & VC fires a gift drop. */}
          <div style={{ position: 'absolute', left: 12, right: 62, bottom: 12, zIndex: 5 }}>
            <SoloDock onTip={() => sendGift({ name: 'You', gift: 'Galaxy', qty: 1 })} />
          </div>

          {/* Fullscreen toggle — bottom-right corner. */}
          <FullscreenBtn style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 5 }} />
        </>
      )}

      <SubAlertOverlay lastSub={d.lastSub} anchor="top" />
    </div>
  );
}
