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

import {SubAlertOverlay, StreamGoalBar} from '../../../components/streams/StreamGoalAndAlerts';
import { PlaybackState, StreamPaywall, ChatStateBanner, TtsStrip, EmptyChat, VpEarnedChip, PreviewLevelUp, AudioStage, ModChannelSwitch, RaidBanner, HypeTrain, TrainBonusHost } from './previewStates';
import Icon from '../../../components/Icon';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { usePreviewVideos, usePreviewSim, usePreviewRole } from './previewAssetsContext';
import { PREVIEW_VIEWER } from './previewCast';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import { PreviewSheets } from './previewChrome';
import {
  PreviewVideoStage, FacecamPip, HostCapsule, GiftersClusterCoins, ViewerPill, CloseBtn,
  FullscreenBtn, FloatingHeart, GiftFeed, useGiftFeed, SoloChatRow, JoinRow, WatchingRow, SoloDock, C,
  glassDark, MovableGoal } from './previewSoloParts';
import { VergrMeBannerCard } from '../../../components/streams/VergrMeStreamBanner';
import streamBg from '../../../assets/stream/cohost-bg.jpg';

export default function PreviewSoloPortrait({ doc, host, scene = 'game',
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
  const { goalBox, setGoalBox, goalEdit, reactions = [], chatHidden = false, onToggleChat, subscribed = false, playback = 'live', gate = 'none', chatState = 'open', tts = 'off', watchMinutes = 0, levelUp = false, setLevelUp, audioOnly = false, chatChannel = 'public', setChatChannel, raiding = false, setRaiding } = usePreviewSim();
  const previewRole = usePreviewRole();
  const d = doc || {};
  const { toasts, sendGift } = useGiftFeed(d.lastGift);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column', background: `#0a0a14 url(${streamBg}) center/cover` }}>

      {/* ⚠ BLURRED FILL BEHIND THE LETTERBOX. [[feedback-video-fit]] — never crop
          the broadcaster's frame; letterbox it and fill the bars with a blurred
          copy of the same source. Falls back to the branded backdrop only when
          there is no video yet, so nothing is ever a flat purple field. */}
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

      {/* Header — same host capsule + gifters / viewers / close as the immersive viewer. */}
      <div style={{ position: 'relative', zIndex: 3, padding: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <HostCapsule host={host} hearts={d.hearts} onOpen={() => onOpenSheet?.({ kind: 'profile', uid: 'host' })} />
        <div style={{ flex: 1, minWidth: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GiftersClusterCoins gifters={d.previewGifters} />
          <ViewerPill count={d.viewerCount} onClick={() => onOpenSheet({ kind: 'viewers' })} />
          <CloseBtn onClose={() => onOpenSheet?.({ kind: 'confirm', title: 'Leave this stream?', body: 'You can come back any time while the broadcaster is still live. Your place in chat is not saved.', confirmLabel: 'Leave' })} />
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
      {/* ⚠ STATUS BELONGS UNDER THE HEADER, not floating with the video box.
          The goal used to sit inside the centred group, so it drifted down the
          screen with the video and left the band under the header dead.

          ⚠ AND IT DOES NOT REPEAT THE HEADER. Founder, 2026-09-01: the viewer
          count, the like total and the top supporters are ALREADY in the header
          on this view — I proposed them for this band having read the code
          instead of looking at the screen. What goes here is what the header
          does NOT say: what is being played, and whether you are a member. */}
      <div style={{ position: 'relative', zIndex: 4, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {/* ⚠ THE GOAL LEFT THIS COLUMN. In flow here it sat across the video at 14-18%
            of its height — straight over the broadcaster's face, measured at 9,704px of
            overlap with the subject band. It is now placed by the broadcaster and drawn
            over the stage; only the vergr.me card remains in the column. */}
        {!d.goal?.active && <VergrMeBannerCard username={host?.username} onClick={() => {}} />}

        {/* ⚠ THREE CHIPS DO NOT FIT 373px, SO THEY WERE WRAPPING RAGGEDLY —
            title and game on one line, Subscribe orphaned on the next. Founder:
            "Does that look neat to you?". It does not.

            A title is a sentence and a chip is a label; making the title a chip
            was the mistake. It reads as one line of text, and the chips below it
            are short enough that the row can never wrap. Two rows on purpose
            beats three chips wrapping by accident. */}
        {d.title && (
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.94)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{d.title}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {d.game && (
            <span style={{ ...glassDark, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: C.purpleLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{d.game}</span>
          )}
          {/* The ask comes last: an ask before the context reads as a paywall. */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', color: '#fff', flexShrink: 0,
            ...(subscribed
              ? { background: '#7c3aed', border: 'none' }
              : glassDark),
          }}>
            <Icon name={subscribed ? 'workspace_premium' : 'add'} size={13} filled={subscribed} />
            {subscribed ? 'Member' : 'Subscribe'}
          </span>
        </div>
      </div>
      <div style={{ flex: '1 1 0', minHeight: 0 }} />
      <div style={{ position: 'relative', zIndex: 2, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Promo strip — sits ABOVE the stream box, in space the 16:9 source
            leaves over anyway. Tip goal when the host has set one, otherwise
            their vergr.me page, so the slot is never dead. The whole group
            (strip + box) is centred, so toggling the goal shifts the box a
            little but never squeezes the chat. */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', flexShrink: 0, background: '#000', overflow: 'hidden' }}>
        {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
            TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
            mounted last, and buried the chrome on six of seven surfaces — the
            mobile broadcaster lost End stream and Mic, the desktop viewer lost
            Follow and the composer. It replaces the VIDEO, so it renders here,
            straight after it, under everything the surface draws on top. */}
        <PreviewVideoStage videoUrl={videoFor('stage')} scene={scene} />
        {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={d?.title} z={1} />}
        {/* Facecam PiP — the ONLY difference between the two split scenes. The
            stage is the same desktop 16:9 either way; "camera only" just means
            the broadcaster's facecam isn't being composited over it. */}
        {/* ⚠ NO FACECAM IN AN AUDIO-ONLY STREAM. A picture-in-picture of a camera on
            a broadcast that by definition has none is a contradiction on screen, and
            the audio stage only hid it by accident of z-order. Say it explicitly. */}
        {scene === 'game' && !audioOnly && <FacecamPip w={96} videoUrl={videoFor('facecam')} style={{ position: 'absolute', left: 8, bottom: 8 }} />}
        {/* ⚠ THE GOAL SITS OVER THE STAGE, PLACED BY THE BROADCASTER. It used to be
            in the chrome column above, where it crossed the video at 14-18% of its
            height — over the face, 9,704px of overlap with the subject band. */}
        <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 13, wPct: 62 }} goal={d.goal} box={goalBox} onChange={setGoalBox} editable={false} />
        {/* Fullscreen toggle — bottom-right corner of the video. */}
        {/* ⚠ THIS CONTROL LIVES INSIDE THE VIDEO BOX, so it needs a z ABOVE the
            audio stage or audio-only buries it — measured as the one remaining
            blocked control on the split viewer after the audio-layer fix. */}
        <FullscreenBtn onClick={() => onOpenSheet?.({ kind: 'streamsettings' })} style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 2 }} />
      </div>
      </div>

      <div style={{ flex: '1 1 0', minHeight: 0 }} />

      {/* Chat panel — sized to its content and pinned above the composer, so the
          leftover space is split evenly above and below the band. */}
      <div style={{ position: 'relative', zIndex: 2, flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px', gap: 12 }}>
        <FloatingHeart style={{ position: 'absolute', right: 8, bottom: 12, zIndex: 6 }} />
        {/* Chat block, wrapped so gift drops can be anchored directly ABOVE it.
            The wrapper exists because the chat block has overflow:hidden — an
            absolute child of it at bottom:100% would be clipped. */}
        <div style={{ position: 'relative', minHeight: 0, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Transient gift drops — sit in the empty space ABOVE the chat, never
              over it. Covering the newest messages is exactly what the chat is
              for reading. */}
          <HypeTrain /><TrainBonusHost />
          <GiftFeed toasts={toasts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 24, overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)' }}>
          {/* Presentable copy — this preview is what store screenshots are taken
              from, so no lorem and no width stress-test strings. One long-ish
              line is kept so wrapping is still visible. */}
{messages.length === 0 && <EmptyChat />}
          {messages.slice(-5).map((m) => (
            <SoloChatRow key={m.id} avatar={avatars[m.uid] || m.avatar} user={m.name} uid={m.uid} vpLevel={m.vpLevel} mod={m.isMod} text={m.text} sub={m.sub} />
          ))}
            <JoinRow />
          </div>
        </div>
        <WatchingRow />
      </div>

      {/* Composer dock — Tips & VC fires a gift drop. */}
      <div style={{ position: 'relative', zIndex: 3, padding: 10 }}>
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
