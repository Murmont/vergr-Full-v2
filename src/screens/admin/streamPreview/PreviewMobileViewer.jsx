// Mobile immersive viewer — the SIMULATOR copy.
//
// ⚠ A COPY OF THE DESIGN, NOT A SECOND IMPLEMENTATION OF THE FEATURE. It
// reproduces MobileLiveViewer's immersive layout so screenshots match what
// ships, and it deliberately does nothing: no Firestore, no relay socket, no
// callable, no camera. Production streaming code is untouched.
//
// ⚠ IMPORTED VS COPIED. JoinAnnouncer, StreamGoalBar, TipAlertOverlay and
// SubAlertOverlay are IMPORTED — they take props and nothing else, so importing
// is read-only, changes no production file, and unlike a copy it cannot drift.
// The entry ribbon especially must be the real one, because it draws the
// founder's real banner art and the point of the tool is to trust the capture.
// Chat rows, the tip sheet and the profile sheet are COPIES (they reach for a
// socket or a Firestore doc), and live in previewChrome.jsx with their source
// lines recorded.
//
// Copied layout source: MobileLiveViewer.jsx ~930-1110.

import { useState, useEffect } from 'react';
import Icon from '../../../components/Icon';
import { PlaybackState, StreamPaywall, ChatStateBanner, TtsStrip, VpEarnedChip, PreviewLevelUp, AudioStage, ModChannelSwitch, RaidBanner, ComposerPill, HypeTrain, TrainBonusHost } from './previewStates';
import { usePreviewVideos, usePreviewSim, usePreviewRole } from './previewAssetsContext';
import { PREVIEW_VIEWER } from './previewCast';
import UserAvatar from '../../../components/UserAvatar';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import {StreamGoalBar, SubAlertOverlay} from '../../../components/streams/StreamGoalAndAlerts';
// All four are prop-only, so they are IMPORTED rather than copied — the same
// rule as the alerts. See docs/STREAM_PREVIEW_PLAN.md §2.
import { StreamPollCard } from '../../../components/streams/StreamPoll';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { BoostTimer } from '../../../components/streams/BoostStreamSheet';
import { Scene, PreviewChat, PreviewSheets, glass, glassDark, iconBtn, C, compact } from './previewChrome';
import { GiftFeed, useGiftFeed, useAboveChat, FloatingHeart, MovableGoal } from './previewSoloParts';
// ⚠ THE DOCK USES IMAGE ASSETS, NOT MATERIAL GLYPHS. A first pass substituted
// Icon names here (group_add / monetization_on / redeem / send) and it was simply
// wrong: the shipped dock renders these .webp files through GlassDockBtn, so the
// preview was showing icons that appear nowhere in the product. Copying a design
// means copying its assets, not approximating them.
import likeIconAsset from '../../../assets/stream/like.webp';
import inviteIconAsset from '../../../assets/stream/invite.webp';
import vcCoinIconAsset from '../../../assets/stream/vc-coin.webp';
import giftboxIconAsset from '../../../assets/stream/giftbox.webp';
import sendIconAsset from '../../../assets/stream/send.webp';

// copied verbatim from MobileLiveViewer.jsx:1391
function GlassDockBtn({ src, label, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={{
      width: 42, height: 42, borderRadius: '50%', flexShrink: 0, padding: 0, overflow: 'hidden', cursor: 'pointer',
      ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src={src} alt={label} style={{ width: 28, height: 28, objectFit: 'contain' }} />
    </button>
  );
}

export default function PreviewMobileViewer({ doc, host, messages, joinEvents, onOpenSheet, openSheet, backdrop = 'gameplay', avatars = {} }) {
  // ⚠ VIDEOS COME FROM THE PROVIDER, NOT A PROP. `facecamVideo` was a prop,
  // went missing from simProps in an unrelated edit, and nothing failed — the
  // PiP simply rendered empty. A context cannot be forgotten at a call site.
  const { videoFor } = usePreviewVideos();
  const { goalBox, setGoalBox, goalEdit, vFrame = null } = usePreviewSim();
  // ⚠ REACTIONS COME FROM THE SIM CONTEXT, NOT A PROP. Threading them was how
  // the like button ended up dead on the solo views: the component was mounted
  // and the data never arrived. Third time for this class — see rule 20.
  // The real hook re-evaluates once a second so an expiry flips the UI with no
  // write. Same here, and it stops as soon as there is no poll.
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPollTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Derived exactly as useActiveStreamPoll derives it: expired = closed. pollTick
  // is read here purely to re-run this on the interval.
  const pollExp = doc?.previewPoll?.expiresAt ? new Date(doc.previewPoll.expiresAt).getTime() : 0;
  const pollClosed = !!doc?.previewPoll && pollExp > 0 && Date.now() > pollExp && pollTick >= 0;
  const { reactions = [], playback = 'live', gate = 'none', chatState = 'open', tts = 'off', watchMinutes = 0, levelUp = false, setLevelUp, audioOnly = false, chatChannel = 'public', setChatChannel, raiding = false, setRaiding, dismissPoll } = usePreviewSim();
  const previewRole = usePreviewRole();
  const { toasts: gifts, sendGift } = useGiftFeed(doc?.lastGift);
  // Transients sit directly above the newest chat, measured, never at a fixed
  // offset: the chat box is a fixed 30% and bottom-anchored, so with a sparse
  // feed most of that box is empty and a constant left a hole.
  const { setList: setChatList, setAnchor: setFrame, bottom: aboveChat } = useAboveChat(messages?.length);
  const gifters = doc.previewGifters || [];

  return (
    <div ref={setFrame} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: C.bg, color: '#fff', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 13, wPct: 62 }} goal={doc.goal} box={goalBox} onChange={setGoalBox} editable={false} />
      {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
          TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
          mounted last, and buried the chrome on six of seven surfaces — the
          mobile broadcaster lost End stream and Mic, the desktop viewer lost
          Follow and the composer. It replaces the VIDEO, so it renders here,
          straight after it, under everything the surface draws on top. */}
      {/* ⚠⚠ NULL MEANS UNTOUCHED, NOT LETTERBOX. This briefly passed
          'letterbox' when no framing was set, which turned the immersive stage
          into objectFit:contain and put black bars behind the header — measured
          1080x1920 source in a 393x852 (19.5:9) frame. Full-bleed IS the
          approved TikTok look for this surface; the founder's no-crop rule is
          about MEDIA UPLOADS, not this viewer's presentation. Only a frame the
          host actually drew changes anything here. */}
      <Scene scene={backdrop} videoUrl={videoFor('stage')} frame={vFrame} />
      {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={doc?.title} z={1} />}

      {/* header — MobileLiveViewer ~930-1040 */}
      <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', gap: 8, zIndex: 6 }}>
        <button
          onClick={() => onOpenSheet({ kind: 'profile', uid: 'host' })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 999, cursor: 'pointer', border: 'none', minWidth: 0, ...glassDark }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <UserAvatar src={avatars[host.id] || host.avatar} size="sm" />

          </div>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            {/* ⚠⚠ THE TICK GOES BESIDE THE NAME, NEVER ON THE AVATAR. Pinned to the avatar's
                corner it overlapped the portrait and read as clipped — founder, 2026-09-03:
                "the verified tick is under the broadcasters avatar". PreviewViewerScreen and
                previewSoloParts already put it next to the name and even carry a comment
                saying so; these two never got the memo, which is how one component ends up
                with two placements. The name truncates, the tick never shrinks. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{host.displayName}</span>
              <span style={{ flexShrink: 0, width: 14, height: 14, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={9} />
              </span>
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="favorite" size={9} style={{ color: C.red }} />
              {compact(doc.hearts)} Likes
            </div>
          </div>
        </button>

        <div style={{ flex: 1 }} />

        {gifters.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 4 }}>
            {gifters.slice(0, 3).map((g, i) => (
              <span key={g.uid} style={{ marginLeft: i ? -9 : 0, borderRadius: '50%', border: '2px solid rgba(10,8,22,0.8)', display: 'grid' }}>
                <UserAvatar src={avatars[g.uid] || g.avatar} size="xs" />
              </span>
            ))}
          </div>
        )}

        {/* ⚠ THE VIEWER COUNT IS THE WAY INTO THE VIEWER LIST. It was a dead label,
            and 'who is watching?' had no answer anywhere in the product. This is
            where people already look to ask it. */}
        <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, cursor: 'pointer', color: '#fff', ...glassDark }}>
          <Icon name="person" size={13} />
          {compact(doc.viewerCount)}
        </button>
        <button aria-label="More" onClick={() => onOpenSheet({ kind: 'more' })} style={iconBtn}><Icon name="more_horiz" size={17} /></button>
        <button aria-label="Leave" onClick={() => onOpenSheet({ kind: 'confirm', title: 'Leave this stream?', body: 'You can come back any time while the broadcaster is still live. Your place in chat is not saved.', confirmLabel: 'Leave' })} style={iconBtn}><Icon name="close" size={17} /></button>
      </div>

      {/* ⚠ STATUS STRIP, BELOW THE HEADER — NOT IN IT.
          The boost countdown was first dropped into the header row beside the
          viewer pill, which squeezed the host card, the supporters cluster and
          the two icon buttons on a 375px screen. A running boost is status, not
          a control, and every live platform puts status on its own line under
          the top bar. BoostTimer has no shipped placement to copy (it is
          imported by both real viewers and rendered by neither), so this is a
          decision, and it belongs here. */}
      {/* ⚠ THE TIP GOAL IS STATUS, SO IT SITS AT THE TOP WITH THE OTHER STATUS.
          It used to live in the bottom dock stack, directly above the chat,
          where it pushed the feed down and read as part of the conversation
          rather than as a property of the stream. The reference puts everything
          of this kind — category, rank, connection, promos — in a strip under
          the header, and nothing status-like above the chat. */}
      <div style={{ position: 'absolute', top: 62, left: 12, right: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
        {/* the goal is drawn over the stage where the BROADCASTER placed it */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          {doc.boosts?.length > 0 && <BoostTimer stream={doc} />}
        </div>
      </div>

      {/* bottom dock — MobileLiveViewer ~1050-1105 */}
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 8 }}>
        {doc.previewPoll && (
          <div style={{ maxWidth: 320 }}>
            {/* ⚠ closed IS COMPUTED, NOT false. It was hardcoded, so an expired poll
                kept reading "LIVE POLL" with a frozen "0s" and sat on screen forever:
                caught only because several minutes of sheet captures all had a dead
                poll in the frame. The shipped card flips to "POLL CLOSED" and drops
                the countdown, and useActiveStreamPoll derives that the same way this
                does, so this MIRRORS the product rather than inventing a rule. */}
            <StreamPollCard poll={doc.previewPoll} myVote={null} closed={pollClosed} uid="sim" onClose={dismissPoll} />
          </div>
        )}

        {/* ⚠ WAS A HAND-ROLLED BUTTON WITH NO onClick. It looked identical to
            the working one and did nothing. Shared component now. */}
        <FloatingHeart style={{ position: 'absolute', right: 2, bottom: 56, width: 48, height: 48, boxShadow: '0 6px 18px rgba(0,0,0,0.45)', zIndex: 9 }} />

      {/* ⚠ ONE 30vh BOX HOLDS THE FEED **AND** THE COMPOSER, because that is how
          the real viewer is built: the composer lives INSIDE ChatPanel, inside a
          single `height: CHAT_FEED_HEIGHT` box (MobileLiveViewer.jsx:1096).
          The first version gave the FEED 30vh and then put the composer beneath
          it, so the two together overflowed the dock and the newest message slid
          underneath the input — visible in every viewer capture taken before
          this fix. The feed must flex inside the box, never own the box. */}
      <div style={{ height: 'calc(var(--vg-frame-h, 852px) * 0.30)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* ⚠ `minHeight: 0` STOPS A FLEX CHILD PUSHING ITS SIBLINGS. IT DOES NOT
            STOP IT PAINTING OUTSIDE ITS BOX. Measured on the live site: chat rows
            at y=808 against a composer band starting at y=738 — "Sable: the new
            mic sounds so much better" drawn straight through "Add a comment…".
            The clip and the absolute fill are what actually bound it. */}
        <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <PreviewChat
            fill messages={messages} layout="overlay" avatars={avatars} scrollRef={setChatList}
            onOpenProfile={(uid) => onOpenSheet({ kind: 'profile', uid })}
          />
        </div>

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
        {/* composer + the four dock buttons, in shipped order */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, flexShrink: 0 }}>
          <ComposerPill />
          {/* Shipped order and labels — MobileLiveViewer.jsx:872-875. The coin
              sends one coin; the gift box opens the tip sheet. */}
          <GlassDockBtn src={inviteIconAsset} label="Invite friends" onClick={() => onOpenSheet({ kind: 'share' })} />
          {/* ⚠ THIS BUTTON HAD NO onClick AT ALL. Founder: "it also had a
              counter which isnt even firing when i click the coin icon". It is
              the control that drives the combo, so an inert one makes the whole
              feature look broken. */}
          <GlassDockBtn src={vcCoinIconAsset} label="Send 1 coin" onClick={() => sendGift({ ...PREVIEW_VIEWER, name: PREVIEW_VIEWER.displayName, qty: 1 })} />
          <GlassDockBtn src={giftboxIconAsset} label="Tips & gifts" onClick={() => onOpenSheet({ kind: 'tip' })} />
          <GlassDockBtn src={sendIconAsset} label="Share" onClick={() => onOpenSheet({ kind: 'share' })} />
        </div>
        </div>
      </div>

      {/* real components, driven by the control panel */}
      {/* ⚠ THE TIP DISPLAY IS THE DESIGNED COMBO FEED, NOT AN ALERT PILL.
          Left-aligned, avatar + "Sent X" + coin + a big xN counter that climbs
          when the same person sends again (previewSoloParts.jsx). The solo views
          always had it; these surfaces never did, so a tip here rendered as the
          generic centred pill instead — the thing that was replaced. */}
      <HypeTrain /><TrainBonusHost />
      <GiftFeed toasts={gifts} style={{ bottom: aboveChat ?? 'calc(30% + 84px)', left: 10 }} />
      <SubAlertOverlay lastSub={doc.lastSub} anchor="bottom" bottom={aboveChat ?? 'calc(30% + 84px)'} />
      <ReactionsFloor events={reactions} position="right" />
      <JoinAnnouncer events={joinEvents} side="left" sound={false} bottom={aboveChat ?? 'calc(30% + 84px)'} />

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
