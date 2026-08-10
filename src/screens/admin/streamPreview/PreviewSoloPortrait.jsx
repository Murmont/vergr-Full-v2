// PreviewSoloPortrait — solo live-viewer, PHONE PORTRAIT.
// Founder design (images 2 & 4): SPLIT layout — video contained at the top, chat
// in a panel below on the violet gradient, floating heart, composer dock.
// This layout only ever appears for a LANDSCAPE (desktop) source, so the stream
// box is 16:9 in both scenes: scene='game' is a screen capture with the facecam
// composited in as a PiP, scene='cam' is the same box with the facecam off.
// Preview-only; no Firestore / relay / camera.
//
// Gifts: the gift component is TRANSIENT — it floats above the composer when a
// gift is sent (admin "Fire tip" or tapping the Tips & VC button) and fades; same
// sender+gift combos the counter, different senders stack (TikTok-style).

import { SubAlertOverlay, StreamGoalBar } from '../../../components/streams/StreamGoalAndAlerts';
import {
  PreviewVideoStage, FacecamPip, HostCapsule, GiftersClusterCoins, ViewerPill, CloseBtn,
  FullscreenBtn, FloatingHeart, GiftFeed, useGiftFeed, SoloChatRow, JoinRow, WatchingRow, SoloDock, C,
} from './previewSoloParts';
import { VergrMeBannerCard } from '../../../components/streams/VergrMeStreamBanner';
import streamBg from '../../../assets/stream/cohost-bg.jpg';

export default function PreviewSoloPortrait({ doc, host, scene = 'game' }) {
  const d = doc || {};
  const { toasts, sendGift } = useGiftFeed(d.lastGift);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column', background: `#0a0a14 url(${streamBg}) center/cover` }}>

      {/* Header — same host capsule + gifters / viewers / close as the immersive viewer. */}
      <div style={{ position: 'relative', zIndex: 3, padding: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <HostCapsule host={host} hearts={d.hearts} />
        <div style={{ flex: 1, minWidth: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GiftersClusterCoins gifters={d.previewGifters} />
          <ViewerPill count={d.viewerCount} />
          <CloseBtn />
        </div>
      </div>

      {/* Video band — grows to fill everything between the top bar and the chat,
          with the stream box CENTRED in it. Split portrait means the broadcast
          is coming from a DESKTOP, so the source is always landscape 16:9 and
          much shorter than the phone; pinning it under the top bar left a dead
          strip of backdrop below it. The slack is now split evenly above and
          below. Matches MobileLiveViewer's split band. */}
      {/* Flexible spacers centre the band without ever shrinking it — the box
          must stay a true 16:9 or the preview stops representing the real
          stream area, which is the one thing this screen exists to show. */}
      <div style={{ flex: '1 1 0', minHeight: 0 }} />
      <div style={{ position: 'relative', zIndex: 2, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px' }}>
        {/* Promo strip — sits ABOVE the stream box, in space the 16:9 source
            leaves over anyway. Tip goal when the host has set one, otherwise
            their vergr.me page, so the slot is never dead. The whole group
            (strip + box) is centred, so toggling the goal shifts the box a
            little but never squeezes the chat. */}
        {d.goal?.active
          ? <StreamGoalBar goal={d.goal} compact />
          : <VergrMeBannerCard username={host?.username} onClick={() => {}} />}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', flexShrink: 0, background: '#000', overflow: 'hidden' }}>
        <PreviewVideoStage scene={scene} />
        {/* Facecam PiP — the ONLY difference between the two split scenes. The
            stage is the same desktop 16:9 either way; "camera only" just means
            the broadcaster's facecam isn't being composited over it. */}
        {scene === 'game' && <FacecamPip w={132} style={{ position: 'absolute', left: 8, bottom: 8 }} />}
        {/* Fullscreen toggle — bottom-right corner of the video. */}
        <FullscreenBtn style={{ position: 'absolute', right: 8, bottom: 8 }} />
      </div>
      </div>

      <div style={{ flex: '1 1 0', minHeight: 0 }} />

      {/* Chat panel — sized to its content and pinned above the composer, so the
          leftover space is split evenly above and below the band. */}
      <div style={{ position: 'relative', zIndex: 2, flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px', gap: 10 }}>
        <FloatingHeart style={{ position: 'absolute', right: 8, bottom: 12, zIndex: 6 }} />
        {/* Chat block, wrapped so gift drops can be anchored directly ABOVE it.
            The wrapper exists because the chat block has overflow:hidden — an
            absolute child of it at bottom:100% would be clipped. */}
        <div style={{ position: 'relative', minHeight: 0, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Transient gift drops — sit in the empty space ABOVE the chat, never
              over it. Covering the newest messages is exactly what the chat is
              for reading. */}
          <GiftFeed toasts={toasts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, paddingTop: 24, overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)' }}>
          {/* Presentable copy — this preview is what store screenshots are taken
              from, so no lorem and no width stress-test strings. One long-ish
              line is kept so wrapping is still visible. */}
          <SoloChatRow user="kai_mercer" text="wait how did you pull that off" />
          <SoloChatRow user="Nadia" text="second time tonight 😭" />
          <SoloChatRow user="ZERO_taeyeon" text="ok that was actually clean, I've been trying to land that all week and it never works for me" mod sub />
          <SoloChatRow user="Priya_S" text="first time here, this is sick" />
          <SoloChatRow user="tomruns" text="streaming again tomorrow?" />
            <JoinRow />
          </div>
        </div>
        <WatchingRow />
      </div>

      {/* Composer dock — Tips & VC fires a gift drop. */}
      <div style={{ position: 'relative', zIndex: 3, padding: 10 }}>
        <SoloDock onTip={() => sendGift({ name: 'You', gift: 'Galaxy', qty: 1 })} />
      </div>

      <SubAlertOverlay lastSub={d.lastSub} anchor="top" />
    </div>
  );
}
