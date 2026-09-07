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
import { PlaybackState, StreamPaywall, ChatStateBanner, TtsStrip, EmptyChat, VpEarnedChip, PreviewLevelUp, AudioStage, ModChannelSwitch, RaidBanner, HypeTrain, TrainBonusHost } from './previewStates';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { usePreviewVideos, usePreviewSim, usePreviewRole } from './previewAssetsContext';
import { PREVIEW_VIEWER } from './previewCast';
import {SubAlertOverlay, StreamGoalBar} from '../../../components/streams/StreamGoalAndAlerts';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import { PreviewSheets } from './previewChrome';
import {
  PreviewVideoStage, FacecamPip, HostCapsule, GiftersClusterCoins, ViewerPill, CloseBtn,
  FullscreenBtn, GiftFeed, useGiftFeed, SoloChatRow, JoinRow, SoloDock, C, FloatingHeart, MovableGoal } from './previewSoloParts';

export default function PreviewSoloLandscape({ doc, host, scene = 'game',
  messages = [], joinEvents = [], openSheet = null, onOpenSheet = () => {},
  avatars = {},
}) {
  // ⚠ VIDEOS COME FROM THE PROVIDER, NOT A PROP. `facecamVideo` was a prop,
  // went missing from simProps in an unrelated edit, and nothing failed — the
  // PiP simply rendered empty. A context cannot be forgotten at a call site.
  const { videoFor } = usePreviewVideos();
  // ⚠ REACTIONS WERE NEVER PASSED HERE. The delegation in PreviewViewerScreen
  // handed over doc/host/scene/avatars/messages/joinEvents/openSheet and
  // stopped, so ReactionsFloor received [] and no heart ever floated — the
  // component was mounted and permanently dead. Taken from the context now.
  const { goalBox, setGoalBox, goalEdit,reactions = [], chatHidden = false, onToggleChat, playback = 'live', gate = 'none', chatState = 'open', tts = 'off', watchMinutes = 0, levelUp = false, setLevelUp, audioOnly = false, chatChannel = 'public', setChatChannel, raiding = false, setRaiding } = usePreviewSim();
  const previewRole = usePreviewRole();
  const d = doc || {};
  const [uiHidden, setUiHidden] = useState(false);
  const { toasts, sendGift } = useGiftFeed(d.lastGift);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif' }}>

      {/* ⚠ BLURRED FILL BEHIND THE LETTERBOX. [[feedback-video-fit]] — never crop
          the broadcaster's frame; letterbox it and fill the bars with a blurred
          copy of the same source. Landscape sits on flat black without this, so
          a source that is not exactly the screen ratio shows dead bars. */}
      {videoFor('stage') && (
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
          {/* ⚠ SATURATE MADE IT MUD. Boosting a warm-lit room 135% and blurring it left
              a brown-orange field behind the chat — the letterbox fill is meant to be
              ambience, not a colour cast the messages have to compete with. Desaturated
              and darkened instead; the fill still carries the frame's colour. */}
          <video src={videoFor('stage')} autoPlay muted loop playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) saturate(70%) brightness(0.55)', transform: 'scale(1.18)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,6,14,0.62)' }} />
        </div>
      )}
      {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
          TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
          mounted last, and buried the chrome on six of seven surfaces — the
          mobile broadcaster lost End stream and Mic, the desktop viewer lost
          Follow and the composer. It replaces the VIDEO, so it renders here,
          straight after it, under everything the surface draws on top. */}
      <PreviewVideoStage videoUrl={videoFor('stage')} scene={scene} />
      {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={d?.title} z={1} />}

      {/* Tap layer — sits over the video, BELOW the chrome (z3). Tapping bare
          video toggles focus mode; the chrome (z4+) keeps its own taps. When the
          UI is hidden this layer covers everything, so a tap brings it back. */}
      <div onClick={() => setUiHidden((v) => !v)} style={{ position: 'absolute', inset: 0, zIndex: 3, cursor: 'pointer' }} />

      {!uiHidden && (
        <>
          {/* Top row — host capsule (left) + gifters / viewers / close (right). */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 12, display: 'flex', alignItems: 'flex-start', gap: 8, zIndex: 4 }}>
            <HostCapsule host={host} hearts={d.hearts} onOpen={() => onOpenSheet?.({ kind: 'profile', uid: 'host' })} />
            <div style={{ flex: 1, minWidth: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <GiftersClusterCoins gifters={d.previewGifters} />
              <ViewerPill count={d.viewerCount} onClick={() => onOpenSheet({ kind: 'viewers' })} />
              <CloseBtn onClose={() => onOpenSheet?.({ kind: 'confirm', title: 'Leave this stream?', body: 'You can come back any time while the broadcaster is still live. Your place in chat is not saved.', confirmLabel: 'Leave' })} />
            </div>
          </div>

          {/* Tip goal — under the header on the left. */}
          {d.goal?.active && (
            <MovableGoal editing={goalEdit} fallback={{ xPct: 46, yPct: 10, wPct: 40 }} goal={d.goal} box={goalBox} onChange={setGoalBox} editable={false} />
          )}

          {/* Solo facecam PiP — bottom-left, gameplay only. */}
          {/* ⚠ NO FACECAM IN AN AUDIO-ONLY STREAM. A picture-in-picture of a camera on
              a broadcast that by definition has none is a contradiction on screen, and
              the audio stage only hid it by accident of z-order. Say it explicitly. */}
          {scene === 'game' && !audioOnly && <FacecamPip w={132} videoUrl={videoFor('facecam')} style={{ position: 'absolute', left: 12, bottom: 70, zIndex: 4 }} />}

          {/* Chat overlay — right side, newest at the bottom, older fade at the top. */}
          <div style={{ position: 'absolute', right: 12, top: 70, bottom: 74, width: '42%', maxWidth: 360, zIndex: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 12, textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 96%)' }}>
{messages.length === 0 && <EmptyChat />}
              {messages.slice(-4).map((m) => (
                <SoloChatRow key={m.id} avatar={avatars[m.uid] || m.avatar} inline user={m.name} uid={m.uid} vpLevel={m.vpLevel} mod={m.isMod} text={m.text} sub={m.sub} />
              ))}
              <JoinRow />
            </div>
          </div>

          {/* Transient gift drops — float above the dock on the left. */}
          <HypeTrain /><TrainBonusHost />
          <GiftFeed toasts={toasts} style={{ position: 'absolute', left: 12, bottom: 64, zIndex: 5 }} />

          {/* Composer dock — across the bottom. Tips & VC fires a gift drop. */}
          <div style={{ position: 'absolute', left: 12, right: 62, bottom: 12, zIndex: 5 }}>
            {/* ⚠ A DISABLED COMPOSER WITH NO REASON READS AS BROKEN. Whatever chat
                is doing to this person has to be said directly above the box they
                cannot type in, with the one action that would change it. */}
            {/* ⚠ THE REWARD HAS TO BE VISIBLE WHERE IT IS EARNED. Vergr already pays
                VP for watching and for tipping; saying nothing means paying the cost
                of the loop and getting none of it. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <ModChannelSwitch role={previewRole} channel={chatChannel} onChannel={setChatChannel} />
        </div>
            {raiding && <RaidBanner fromName={host?.displayName} toName="nova_kill" onStay={() => setRaiding?.(false)} />}
            <TtsStrip state={tts} onOpenSheet={onOpenSheet} />
            <ChatStateBanner onOpenSheet={onOpenSheet} onAppeal={(k) => onOpenSheet?.({ kind: 'appeal', appealKind: k })} state={chatState} />
            <SoloDock onInvite={() => onOpenSheet?.({ kind: 'share' })} onGift={() => onOpenSheet?.({ kind: 'tip' })} onShare={() => onOpenSheet?.({ kind: 'share' })} onTip={() => sendGift({ ...PREVIEW_VIEWER, name: PREVIEW_VIEWER.displayName, qty: 1 })} />
          </div>

          {/* ⚠ THIS VIEW HAD NO LIKE BUTTON AT ALL — the one surface where the
              feature was not half-wired but entirely absent. */}
          <FloatingHeart style={{ position: 'absolute', right: 12, bottom: 72, zIndex: 5 }} />

          {/* Fullscreen toggle — bottom-right corner. */}
          <FullscreenBtn onClick={() => onOpenSheet?.({ kind: 'streamsettings' })} style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 5 }} />
        </>
      )}

      {/* ⚠ THE TIP ALERT WAS MISSING FROM BOTH SOLO VIEWS. Only the sub alert
          was mounted, so firing a tip on split or landscape showed nothing at
          all. Same component, same anchor and same order as the real viewer
          (MobileLiveViewer.jsx:1106) so the two captures line up. */}
      <SubAlertOverlay lastSub={d.lastSub} anchor="bottom" />
      <ReactionsFloor events={reactions} position="right" />
      <JoinAnnouncer events={joinEvents} side="left" sound={false} />
      {/* ⚠ STATE OVERLAYS GO ON EVERY LIVE SURFACE. Mounting them on one is
          how reactions, the poll, the boost timer and the combo meter each ended
          up invisible on five of six screens. */}
        {gate !== 'none'
          ? <StreamPaywall kind={gate} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
          : playback !== 'live'
            ? <PlaybackState state={playback} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
              : null}
        <PreviewLevelUp show={levelUp} onClose={() => setLevelUp?.(false)} />
        <PreviewSheets openSheet={openSheet} host={host} onClose={() => onOpenSheet(null)} onOpen={onOpenSheet} />
    </div>
  );
}
