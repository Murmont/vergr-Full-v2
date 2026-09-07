// PreviewViewerScreen — SEPARATE, preview-only reproduction of the viewer UI
// (mobile immersive = MobileLiveViewer-style, desktop = framed Twitch-style) for
// the admin Stream Preview tab. Mock data only: no Firestore, no HLS, no relay.
// `doc` carries lastGift/lastTip/lastSub so the admin screen can preview alert +
// gift-overlay placement. Production ViewerStreamScreen / MobileLiveViewer are
// never touched.

import Icon from '../../../components/Icon';
// ⚠ THE REAL COMPONENTS. Every cosmetic the VP ladder sells is resolved
// inside them from `vpLevel` alone, so a plain name here means a capture
// that shows none of it. Prop-driven, so importing is read-only.
import UserName from '../../../components/UserName';
import RankBadge from '../../../components/RankBadge';
import { PlaybackState, StreamPaywall, ChatStateBanner, TtsStrip, EmptyChat, VpEarnedChip, PreviewLevelUp, AudioStage, ModChannelSwitch, RaidBanner, ComposerPill, HypeTrain, TrainBonusHost } from './previewStates';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { usePreviewVideos, usePreviewSim, usePreviewRole } from './previewAssetsContext';
import { PREVIEW_VIEWER } from './previewCast';
import UserAvatar from '../../../components/UserAvatar';
import {StreamGoalBar, SubAlertOverlay} from '../../../components/streams/StreamGoalAndAlerts';
import { PreviewCoHostGrid, PreviewTournamentCard, stageAspect } from './PreviewStreamStages';
import { PreviewSheets } from './previewChrome';
import useChatDismiss from './useChatDismiss';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import { useFaces } from './previewAssetsContext';
import { CoinIcon } from '../../../components/CoinIcon';
import { PreviewVideoStage, FloatingHeart, MovableGoal } from './previewSoloParts';
import PreviewSoloPortrait from './PreviewSoloPortrait';
import PreviewSoloLandscape from './PreviewSoloLandscape';
import PreviewDesktopViewer from './PreviewDesktopViewer';
import { GiftFeed, useGiftFeed } from './previewSoloParts';
import modBadgeIcon from '../../../assets/stream/mod-badge.webp';
import watchingIcon from '../../../assets/stream/watching.webp';
import waveIcon from '../../../assets/stream/wave.webp';
import inviteIcon from '../../../assets/stream/invite.webp';
import vcCoinIcon from '../../../assets/stream/vc-coin.webp';
import giftboxIcon from '../../../assets/stream/giftbox.webp';
import sendIcon from '../../../assets/stream/send.webp';
import likeIcon from '../../../assets/stream/like.webp';
import cohostScreenBg from '../../../assets/stream/cohost-screen-bg.webp';

// Frosted-glass surface tokens (the founder's design is glassmorphic; the
// background image behind makes the blur read).
// ⚠⚠ FOURTH TIME FOR THIS EXACT SHAPE: A TOKEN FIXED IN SOME COPIES AND NOT OTHERS.
// glass/glassDark were solidified in previewChrome, MobileLiveViewer and previewSoloParts
// and reported done — but there are FIVE definitions, not three. This one and
// VergrMeStreamBanner were never touched, and the guard read only the three that had
// been, so it stayed green through two whole waves. `glass` here was
// rgba(255,255,255,0.10) under a rgba(255,255,255,0.18) edge: the same white, stroke
// nearly twice the fill, which is the textbook case the founder rejected.
// Previous instances: the rank crest (1 of 4 profile views), the font (simulator vs the
// real screens), and the panel-border token (now known to have four copies).
const glass = { background: '#1E1A2E', border: 'none' };
const glassDark = { background: '#100C1C', border: 'none' };

function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}


// ⚠ A PANEL DOES NOT GET AN OUTLINE FOR BEING A PANEL. It separates by VALUE.
// See PreviewBroadcasterScreen for the measurement that produced this. A DIVIDER
// survives only where a real division needs marking, and it fades at both ends.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };
const ruleTop = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'top' };

const C = {
  // ⚠ THE LADDER, NOT THE STROKE. See PreviewBroadcasterScreen for the measurement.
  bg: '#0a0a14', card: '#1A1A2A', cardSoft: '#14141F',
  border: 'rgba(255,255,255,0.09)', text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', amber: '#f59e0b',
  // ⚠ TWO REDS: white on #ef4444 measured 3.76:1 on the LIVE pill. See previewStates.
  red: '#ff6b6b', redFill: '#c62828',
};



function fmtUptime(ms) {
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
}

// ⚠⚠ THE AUDIO STAGE IS PART OF THE MEDIA, so it lives in the one helper both
// branches already render rather than in each branch's blocking-state ternary.
// Mounted there it was an opaque z-4 layer over the whole surface and it buried
// the chrome — the split viewer had ZERO reachable controls. Owning it here is
// also why co-host and solo cannot drift apart on it.
function VideoStage({ streamType = 'solo', guestCount = 2, audioOnly = false, host, onOpenSheet }) {
  const audio = audioOnly
    ? <AudioStage host={host} hostName={host?.displayName} z={0} />
    : null;
  const { videoFor } = usePreviewVideos();
  // Viewer sees the baked composite as a SINGLE video. For co-host that's the
  // server-composited grid; render it as the stage so the founder sees what a
  // multi-guest stream looks like to a viewer. For solo we paint the supplied
  // background image (stands in for the live video so the glass blur reads).
  if (streamType === 'cohost') {
    return <div style={{ position: 'absolute', inset: 0 }}><PreviewCoHostGrid count={guestCount} fullscreen />{audio}</div>;
  }
  // Solo immersive: in production the video fills the whole screen, so the
  // branded backdrop is never visible here. Render the measuring grey
  // placeholder instead — this is the region real footage has to fill in a
  // store screenshot, and it prints its own pixel size.
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PreviewVideoStage scene="game" videoUrl={videoFor('stage')} />
      {audio}
      {streamType === 'tournament' && <PreviewTournamentCard offset={{ top: 56, left: 12 }} />}
    </div>
  );
}

export default function PreviewViewerScreen({
  device = 'mobile', doc, host, streamType = 'solo', guestCount = 2, soloView = 'immersive', scene = 'game',
  messages = [], joinEvents = [], openSheet = null, onOpenSheet = () => {},
  avatars = {}, cohostLayout = 'grid', camsOff = [],
  chatHidden = false, onToggleChat = () => {},
}) {
  // Native = swipe right; browser = long press. See useChatDismiss for why they
  // differ (a rightward swipe is the browser's own back gesture).
  const dismiss = useChatDismiss(onToggleChat, { native: false });
  // ⚠ REACTIONS COME FROM THE SIM CONTEXT, NOT A PROP. Threading them was how
  // the like button ended up dead on the solo views: the component was mounted
  // and the data never arrived. Third time for this class — see rule 20.
  const { goalBox, setGoalBox, goalEdit,reactions = [], playback = 'live', gate = 'none', chatState = 'open', tts = 'off', watchMinutes = 0, levelUp = false, setLevelUp, audioOnly = false, chatChannel = 'public', setChatChannel, raiding = false, setRaiding } = usePreviewSim();
  const previewRole = usePreviewRole();
  // ⚠ VIDEOS COME FROM THE PROVIDER, NOT A PROP. `facecamVideo` was a prop,
  // went missing from simProps in an unrelated edit, and nothing failed — the
  // PiP simply rendered empty. A context cannot be forgotten at a call site.
  const { videoFor } = usePreviewVideos();
  const faceOf = useFaces();
  const streamDoc = doc;
  const uptime = streamDoc?.startedAt ? fmtUptime(Date.now() - streamDoc.startedAt) : null;
  // Transient gift drops (combo-aware) for the mobile immersive + co-host views.
  const { toasts: gifts, sendGift } = useGiftFeed(streamDoc?.lastGift);

  // ── MOBILE SOLO — ADDITIONAL solo-viewer designs (their OWN files, NOT the
  // co-host grid). These are selectable ALONGSIDE the existing immersive viewer
  // below; `soloView==='immersive'` (default) falls through and keeps the
  // original screen untouched. ──
  if (device === 'mobile' && streamType === 'solo' && soloView === 'split') {
    return <PreviewSoloPortrait doc={streamDoc} host={host} scene={scene} avatars={avatars} messages={messages} joinEvents={joinEvents} openSheet={openSheet} onOpenSheet={onOpenSheet} />;
  }
  if (device === 'mobile' && streamType === 'solo' && soloView === 'landscape') {
    return <PreviewSoloLandscape doc={streamDoc} host={host} scene={scene} avatars={avatars} messages={messages} joinEvents={joinEvents} openSheet={openSheet} onOpenSheet={onOpenSheet} />;
  }

  // ── MOBILE MULTI-USER (co-host) — the founder's multi-user mockup: the video
  // grid is CONTAINED in the top area and the chat lives in a panel BELOW it,
  // both on the violet gradient. (Solo stays the full-bleed immersive layout.) ──
  if (device === 'mobile' && streamType === 'cohost') {
    // ⚠ A FULL GRID LEAVES NO ROOM BELOW IT, SO THE CHAT SITS ON IT. Two rows of
    // 2:3 cells is ~590px of an 852px phone; with a header, a status strip and a
    // composer there is nothing left, and the chat was squeezed to two lines.
    // The reference solves it the same way: in TikTok's own 2x2 mockup the chat
    // is drawn OVER the lower cells, not in a panel beneath them.
    //
    // ⚠ AND THE CELLS DO NOT SHRINK TO MAKE ROOM. That is the mistake this
    // screen has already made once — the tile shape comes from the reference and
    // stays; what moves is the chat.
    const chatOverlays = guestCount > 2;
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column', backgroundImage: `url(${cohostScreenBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>

        {/* ⚠ THE GESTURE LAYER SITS UNDER THE CHROME, NOT OVER IT. At the top of
            the stack it would swallow every tap meant for a button; at zIndex 1
            it catches the empty video area, which is exactly where someone
            reaches to put the chat away. */}
        <div {...dismiss} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

        {/* ⚠ THIS BRANCH HAD NO GOAL BAR AT ALL. PreviewViewerScreen has three
            branches and only two of them rendered one, so a viewer on a mobile
            co-host stream never saw the tip goal — measured as zero MovableGoal
            nodes in the DOM, not a placement bug. Same sibling failure as the
            three broadcaster branches. */}
        <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 13, wPct: 62 }}
          goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable={false} />

        {/* Restore. A dismissed chat with no way back is a dead end, and the
            control has to say what the gesture was, or nobody finds it twice. */}
        {chatHidden && (
          <button type="button" onClick={onToggleChat} style={{
            position: 'absolute', left: 12, bottom: 14, zIndex: 6, display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', borderRadius: 999, cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 700, ...glassDark,
          }}>
            <Icon name="chat_bubble" size={15} /> Show chat
          </button>
        )}

        {/* Header — same host capsule + right controls as solo. */}
        <div style={{ position: 'relative', zIndex: 3, padding: '10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button type="button" onClick={() => onOpenSheet?.({ kind: 'profile', uid: 'host' })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
            <UserAvatar src={faceOf(host)} size={38} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{host?.displayName || 'Live'}</span>
                {host?.isVerified && (
                  <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={10} />
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap', flexShrink: 0 }}>{compactNum(streamDoc.hearts || 0)} Likes</span>
            </div>
          </button>
          <div style={{ flex: 1, minWidth: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <GiftersCluster gifters={streamDoc.previewGifters || []} />
            <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, border: 'none', color: '#fff', cursor: 'pointer', ...glassDark }}>
              <Icon name="visibility" size={14} />{compactNum(streamDoc.viewerCount || 0)}
            </button>
            <button aria-label="Leave stream" onClick={() => onOpenSheet?.({ kind: 'confirm', title: 'Leave this stream?', body: 'You can come back any time while the broadcaster is still live. Your place in chat is not saved.', confirmLabel: 'Leave' })} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>
          </div>
        </div>


        {/* Video grid — CONTAINED in the top area (not full-bleed). The grid
            geometry: 2 side-by-side · 3 big-left + two stacked · 4 = 2×2. */}
        {/* ⚠ THE STRIP ABOVE THE GRID IS ALWAYS OCCUPIED. The tip goal lives
            here, and when the host has not set one the stream still says what
            it is — title and category — so the space never reads as a hole.
            The reference does the same thing: a chip row (category, rank,
            connection) sits between the header and the grid on every stream. */}
        <div style={{ position: 'relative', zIndex: 3, padding: '0 10px 8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span dir="auto" style={{ ...glassDark, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '62%' }}>{streamDoc.title}</span>
              {streamDoc.game && <span style={{ ...glassDark, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: C.purpleLight, whiteSpace: 'nowrap' }}>{streamDoc.game}</span>}
            </div>
        </div>

        {/* ⚠⚠ THE GRID IS SIZED BY ITS CELLS, MEASURED OFF THE REFERENCE.
            TikTok's own multi-guest mockup is 750x1624 with 375x553 cells — a
            PORTRAIT 2:3 tile. Two of those side by side is a short wide band,
            not the full-height slices we had (196x429, 0.46), which is what
            made the frames look stretched.

            This is NOT the earlier mistake of shrinking the video to close a
            gap: the cell shape comes from the reference, and the chat below
            simply takes what is left. The video is the right shape first. */}
        <div style={{ position: 'relative', zIndex: 2, width: '100%', flex: '0 0 auto', aspectRatio: String(stageAspect(cohostLayout, guestCount)), minHeight: 0 }}>
          <PreviewCoHostGrid count={guestCount} fullscreen edge layout={cohostLayout} camsOff={camsOff} />
        </div>

        {/* Chat panel — fills the rest, newest at the bottom, older fade out at
            the top. Floating red like on the right. */}
        {/* Fixed height — the chat takes what it needs to be readable and never
            competes with the video for the rest. `0 0 auto` is the other half
            of the rule above; if this ever becomes `1 1` the gap comes back. */}
        {/* ⚠ CHAT AND COMPOSER SHARE ONE POSITIONED BOX. When the chat
            overlays a full grid it anchors to `bottom: 100%` of this wrapper,
            which IS the composer — so it can never run behind the input or the
            dock icons the way a hand-picked pixel offset did. */}
        {/* ⚠⚠ `marginTop: auto` PINS THIS TO THE BOTTOM, AND IT IS NOT OPTIONAL.
            The grid has a fixed aspect and this wrapper is `0 0 auto`, so with
            nothing in the column set to grow the leftover height collected AFTER
            the composer — the input and the dock icons floated up the screen
            with a band of empty purple beneath them. Pushing this box to the end
            of the column puts the slack ABOVE it instead, which is exactly where
            the chat overlay draws. */}
        <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', flex: chatOverlays ? '0 0 auto' : '1 1 auto', marginTop: 'auto', minHeight: 0 }}>
        {!chatHidden && <div style={chatOverlays
          // ⚠ OVERLAID CHAT NEEDS A SHADOW. On the panel it sits on a violet
          // gradient we control; over live video it can land on anything, and
          // white text on a bright frame is unreadable. The solo views already
          // carry this and the overlay path was missing it.
          // ⚠ ANCHORED TO THE COMPOSER, NOT TO A GUESSED OFFSET. `bottom: 78`
          // was a number picked to clear the composer and it did not — measured
          // live, the feed still ran 63px behind the input. `bottom: 100%` of
          // the shared wrapper IS "directly above the composer", as a fact of
          // the layout. GiftFeed already does this a few lines below.
          //
          // ⚠ AND IT NEEDS A REAL HEIGHT. With maxHeight alone the box sizes to
          // content, so the inner list's `height: 100%` resolved against zero
          // and the whole feed collapsed to a single line.
          ? { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 4, zIndex: 2, height: 'calc(var(--vg-frame-h, 852px) * 0.34)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px', gap: 12, pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }
          : { position: 'relative', zIndex: 2, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px', gap: 12 }}>
          {/* ⚠ NO onClick, AND UNCLICKABLE ANYWAY. This sat inside the chat
              overlay, which sets pointerEvents:'none' so the chat never eats a
              tap meant for the video — so even once it had a handler the button
              could not receive one. It needs pointerEvents back on itself. */}
          <FloatingHeart style={{ position: 'absolute', right: 6, bottom: 10, zIndex: 6, width: 44, height: 44, pointerEvents: 'auto' }} />
          {/* Chat block wrapped so gift drops anchor directly ABOVE it — never
              over the newest messages, which are the ones being read. */}
          <div style={{ position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <HypeTrain /><TrainBonusHost />
            <GiftFeed toasts={gifts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 12, paddingTop: 24, height: '100%', maxHeight: '100%', overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)' }}>
{messages.length === 0 && <EmptyChat />}
            {messages.slice(-12).map((m) => (
              <PreviewChatRow key={m.id} user={m.name} uid={m.uid} vpLevel={m.vpLevel} mod={m.isMod} text={m.text} sub={m.sub} avatar={avatars[m.uid] || m.avatar} />
            ))}
            {joinEvents.slice(-2).map((ev) => (
              <div key={ev.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>
                <img src={ev.kind === 'subscriber' ? waveIcon : watchingIcon} alt="" aria-hidden style={{ width: ev.kind === 'subscriber' ? 24 : 18, height: ev.kind === 'subscriber' ? 24 : 18, objectFit: 'contain', flexShrink: 0 }} />
                <span><b style={{ fontWeight: 800 }}>{ev.user?.displayName}</b> {ev.kind === 'subscriber' ? 'joined via share invitation' : 'started watching'}</span>
              </div>
            ))}
          </div>
          </div>
        </div>}
        {!chatHidden && <div style={{ position: 'relative', zIndex: 6, padding: 10 }}>
          {/* ⚠ A DISABLED COMPOSER WITH NO REASON READS AS BROKEN. The dock is
              a flex ROW, so the banner cannot be spliced into it — it gets its
              own line above, which is where a person looks when the box is dead. */}
          {/* ⚠ THE REWARD HAS TO BE VISIBLE WHERE IT IS EARNED. Vergr already pays
              VP for watching and for tipping; saying nothing means paying the cost
              of the loop and getting none of it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <ModChannelSwitch role={previewRole} channel={chatChannel} onChannel={setChatChannel} />
        </div>
          {raiding && <RaidBanner fromName={host?.displayName} toName="nova_kill" onStay={() => setRaiding?.(false)} />}
          <TtsStrip state={tts} onOpenSheet={onOpenSheet} />
          <ChatStateBanner onOpenSheet={onOpenSheet} onAppeal={(k) => onOpenSheet?.({ kind: 'appeal', appealKind: k })} state={chatState} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ComposerPill />
          <DockGlassBtn src={inviteIcon} alt="Invite" onClick={() => onOpenSheet({ kind: 'share' })} />
          <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={() => sendGift({ ...PREVIEW_VIEWER, name: PREVIEW_VIEWER.displayName, qty: 1 })} />
          <DockGlassBtn src={giftboxIcon} alt="Gift Box" onClick={() => onOpenSheet({ kind: 'giftsub' })} />
          <DockGlassBtn src={sendIcon} alt="Share" onClick={() => onOpenSheet({ kind: 'share' })} />
          </div>
        </div>}
        </div>

        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" />
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

  // ── MOBILE IMMERSIVE (matches the founder's Solo Stream Figma: glass over the
  // background image, founder icon assets, single-row composer, nothing clipped) ──
  if (device === 'mobile') {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif' }}>
        <VideoStage streamType={streamType} guestCount={guestCount} audioOnly={audioOnly} host={host} onOpenSheet={onOpenSheet} />

        {/* Top row — TWO matched glass cards (host on the left, viewer controls on
            the right) exactly like the founder's Solo Stream design. Element sizes
            are FIXED to the design; only the streamer name flexes (truncates). */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {/* Host card — tapping the avatar/name opens the streamer's profile
              bottom-sheet (TikTok pattern), where Follow lives. There is NO inline
              Follow pill, so nothing can bleed past the card edge. */}
          <button type="button" onClick={() => onOpenSheet?.({ kind: 'profile', uid: 'host' })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
            <UserAvatar src={faceOf(host)} size={38} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Row 1 — name + verified check inline (TikTok places the badge by the
                  name, not on the avatar). Name truncates; check never shrinks. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{host?.displayName || 'Live'}</span>
                {host?.isVerified && (
                  <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={10} />
                  </span>
                )}
              </div>
              {/* Row 2 — "342 Likes" (no heart icon; the word already says it). */}
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap', flexShrink: 0 }}>{compactNum(streamDoc.hearts || 0)} Likes</span>
            </div>
          </button>

          <div style={{ flex: 1, minWidth: 0 }} />

          {/* Right controls — TikTok-style: spaced transparent elements (NOT one
              crammed glass card), so the streamer name keeps its room. Each item
              carries its own soft bubble for contrast over the video. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <GiftersCluster gifters={streamDoc.previewGifters || []} />
            <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, border: 'none', color: '#fff', cursor: 'pointer', ...glassDark }}>
              <Icon name="visibility" size={14} />{compactNum(streamDoc.viewerCount || 0)}
            </button>
            <button aria-label="Leave stream" onClick={() => onOpenSheet?.({ kind: 'confirm', title: 'Leave this stream?', body: 'You can come back any time while the broadcaster is still live. Your place in chat is not saved.', confirmLabel: 'Leave' })} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>
          </div>
        </div>

        {/* Tip goal — sits directly under the header. The viewer sees it where the
            broadcaster placed it; positioning/resizing is a BROADCASTER control
            (shelved for the broadcaster view: drag + resize width AND height,
            persisted to the stream doc). */}
        <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 13, wPct: 62 }} goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable={false} />

        {/* Bottom — chat (fades at top, TikTok-style), "started watching", composer, floating like. */}
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Floating like button (founder heart asset) — z-index above the chat so
              it's never hidden behind a message. */}
          {/* ⚠ THE FOURTH DEAD LIKE BUTTON, and the one that hid longest: it
              carried no aria-label, so the guard that caught the other three
              could not see it either. Counting copies is the wrong game —
              there is one component now. */}
          <FloatingHeart style={{ position: 'absolute', right: 0, bottom: 58, zIndex: 20, width: 42, height: 42, boxShadow: '0 6px 18px rgba(0,0,0,0.45)' }} />

          {/* Chat block wrapped so gift drops anchor directly ABOVE it — never
              over the newest messages, which are the ones being read. */}
          <div style={{ position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <HypeTrain /><TrainBonusHost />
            <GiftFeed toasts={gifts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />

          {/* Chat — TikTok-style: no box, newest at the bottom, older messages fade
              out at the top via a gradient mask (≈4 lines visible). */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, paddingTop: 26, height: 188, maxHeight: 188, overflow: 'hidden', textShadow: '0 1px 3px rgba(0,0,0,0.85)', maskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 95%)' }}>
            {joinEvents.slice(-1).map((ev) => (
              <div key={ev.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
                <img src={ev.kind === 'subscriber' ? waveIcon : watchingIcon} alt="" aria-hidden style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
                <span><b style={{ fontWeight: 800 }}>{ev.user?.displayName}</b> {ev.kind === 'subscriber' ? 'joined via share invitation' : 'started watching'}</span>
              </div>
            ))}
{messages.length === 0 && <EmptyChat />}
            {messages.slice(-3).map((m) => (
              <PreviewChatRow key={m.id} inline user={m.name} uid={m.uid} vpLevel={m.vpLevel} mod={m.isMod} text={m.text} sub={m.sub} avatar={avatars[m.uid] || m.avatar} />
            ))}
          </div>
          </div>

          {/* "started watching" sits below the panel, on the video. */}

          {/* Composer — single row: input + invite / VC / gift / SHARE. The last
              button SHARES the stream (glass, like the other dock buttons). Sending
              a comment is done by the keyboard's own send key, so there is no
              in-dock send button. Tips & VC fires a transient gift drop. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ComposerPill />
            <DockGlassBtn src={inviteIcon} alt="Invite" onClick={() => onOpenSheet({ kind: 'share' })} />
            <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={() => sendGift({ ...PREVIEW_VIEWER, name: PREVIEW_VIEWER.displayName, qty: 1 })} />
            <DockGlassBtn src={giftboxIcon} alt="Gift Box" onClick={() => onOpenSheet({ kind: 'giftsub' })} />
            <DockGlassBtn src={sendIcon} alt="Share" onClick={() => onOpenSheet({ kind: 'share' })} />
          </div>
        </div>

        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" />
        <ReactionsFloor events={reactions} position="right" />
        <JoinAnnouncer events={joinEvents} side="left" sound={false} />
        {gate !== 'none'
          ? <StreamPaywall kind={gate} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
          : playback !== 'live'
            ? <PlaybackState state={playback} hostName={host?.displayName} onOpenSheet={onOpenSheet} />
              : null}
        <PreviewSheets openSheet={openSheet} host={host} onClose={() => onOpenSheet(null)} onOpen={onOpenSheet} />
      </div>
    );
  }

  // ── DESKTOP SOLO — Twitch-style viewer (founder redesign), its own file. ──
  if (device !== 'mobile' && streamType === 'solo') {
    // ⚠ THE DESKTOP VIEWER NEVER RECEIVED `scene`, so its facecam PiP was welded on:
    // the Game+cam / Camera only control existed but could not reach this surface.
    return <PreviewDesktopViewer doc={streamDoc} host={host} scene={scene} />;
  }

  // ── DESKTOP FRAMED (co-host / tournament keep this layout) ──
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex', gap: 12, padding: 12 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', borderRadius: 12, overflow: 'hidden' }}>
          <VideoStage streamType={streamType} guestCount={guestCount} audioOnly={audioOnly} host={host} onOpenSheet={onOpenSheet} />
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
            <span style={{ ...chip, background: C.redFill }}>● LIVE</span>
            <span style={chip}>1080p60</span>
          </div>
          <MovableGoal editing={goalEdit} fallback={{ xPct: 3, yPct: 13, wPct: 62 }} goal={streamDoc.goal} box={goalBox} onChange={setGoalBox} editable={false} compact={false} />
          {/* hover control bar */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '24px 14px 10px', background: 'linear-gradient(0deg, rgba(0,0,0,0.75), transparent)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="volume_up" size={18} />
            <div style={{ width: 110, height: 4, borderRadius: 999, background: '#4A4A58' }} />
            <div style={{ flex: 1 }} />
            <Icon name="crop_16_9" size={18} />
            <Icon name="fullscreen" size={18} />
          </div>
          <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" />
        </div>
        {/* under-player channel card */}
        <div style={{ padding: 14, background: C.card, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div dir="auto" style={{ fontSize: 16, fontWeight: 800 }}>{streamDoc.title || 'Live stream'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserAvatar src={faceOf(host)} size="md" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{host?.displayName || 'Host'}</div>
              {streamDoc.game && <div style={{ fontSize: 12, color: C.purpleLight, fontWeight: 600 }}>{streamDoc.game}</div>}
            </div>
            <button style={{ padding: '9px 18px', borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }} onClick={() => onOpenSheet?.({ kind: 'profile', uid: 'host' })}>Follow</button>
            <button style={{ padding: '9px 18px', borderRadius: 12, border: 'none', background: C.cardSoft, color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => onOpenSheet?.({ kind: 'subscribe' })}><CoinIcon size={15} /> Tip</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textDim }}><Icon name="visibility" size={13} /> {(streamDoc.viewerCount || 0).toLocaleString()} watching</span>
          </div>
        </div>
      </div>

      <div style={{ width: 320, flexShrink: 0, background: C.card, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', ...ruleBottom, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.textDim }}>LIVE CHAT</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, padding: 12, fontSize: 13 }}>
          {messages.slice(-6).map((m) => <div key={m.id}><span style={{ color: C.purpleLight, fontWeight: 700 }}>{m.name}</span> <span>{m.text}</span></div>)}
        </div>
        <div style={{ padding: 12, ...ruleTop }}>
          <div style={{ padding: '9px 12px', borderRadius: 999, background: C.cardSoft, color: '#ADADC2', fontSize: 13 }}>Say something…</div>
        </div>
      </div>
    </div>
  );
}

// Top-supporters cluster shown top-right: the 3 biggest coin senders this
// stream, each over their running total.
//
// ⚠ COPIED FROM THE REAL ONE, NOT REDESIGNED. `TopGiftersCluster`
// (MobileLiveViewer.jsx:1443) puts each supporter's coin total in a gold pill
// UNDER their avatar. The preview had dropped those pills with a note saying
// they ate the streamer name's room — but the shipped component has them, so a
// capture from here did not match what a viewer actually sees, which is the one
// thing this screen exists to guarantee. If the pill genuinely crowds the name
// then that is a bug to fix in the REAL viewer, not a difference to introduce
// here.
function GiftersCluster({ gifters }) {
  const faceOf = useFaces();
  const top = (gifters || []).slice(0, 3);
  if (!top.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
      {top.map((g, i) => (
        <div key={g.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: i ? -6 : 0, zIndex: 3 - i }}>
          <span style={{ display: 'inline-flex', borderRadius: '50%', border: '2px solid rgba(0,0,0,0.55)' }}>
            <UserAvatar src={faceOf(g)} size={24} />
          </span>
          <span style={{
            marginTop: 2, fontSize: 9, fontWeight: 800, color: '#F5C842', fontFamily: 'DM Mono, monospace',
            background: '#100C1C', borderRadius: 8, padding: '0 4px', lineHeight: '13px',
          }}>{compactNum(g.coins)}</span>
        </div>
      ))}
    </div>
  );
}

// Mod shield + violet SUB pill, shared by both chat row layouts.
function ModBadge() {
  return <img src={modBadgeIcon} alt="moderator" style={{ height: 15, width: 'auto', objectFit: 'contain', verticalAlign: '-3px' }} />;
}
function SubPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', padding: '1px 5px 1px 3px', borderRadius: 8, fontSize: 9, fontWeight: 900, letterSpacing: '0.04em', color: '#fff', background: 'linear-gradient(135deg, #7c3aed, #b44fff)' }}>
      <Icon name="star" size={9} filled style={{ color: '#F5C842' }} />SUB
    </span>
  );
}

// Chat row. `inline` (solo immersive) puts badges before the name on one wrapping
// line; the default (stacked, multi-user) puts the name + badges on their own
// line with the message below, matching the founder's multi-user mockup.
// ⚠ `avatar` was hardcoded to null: every row drew an empty disc and an
// uploaded face was thrown away with no error.
function PreviewChatRow({ user, text, uid = null, vpLevel = 0, mod = false, sub = false, inline = false, avatarSize = 'sm', avatar = null }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}><UserAvatar src={avatar} size={inline ? 'xs' : avatarSize} /></span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
        {inline ? (
          <>
            {mod && <span style={{ marginRight: 4 }}><ModBadge /></span>}
            {sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
            <span style={{ fontWeight: 800, color: '#fff', marginRight: 6 }}><UserName user={{ displayName: user, vpLevel }} masked context="chat" fallback="guest" /><RankBadge level={vpLevel} uid={uid} size={12} animated style={{ marginLeft: 4, verticalAlign: '-2px' }} /></span>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{text}</span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
              <span style={{ fontWeight: 800, color: '#fff' }}><UserName user={{ displayName: user, vpLevel }} masked context="chat" fallback="guest" /><RankBadge level={vpLevel} uid={uid} size={12} animated style={{ marginLeft: 4, verticalAlign: '-2px' }} /></span>
              {mod && <ModBadge />}
              {sub && <SubPill />}
            </div>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word', fontSize: 13 }}>{text}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Glass dock button rendering a founder icon asset.
function DockGlassBtn({ src, alt, onClick }) {
  return (
    <button title={alt} onClick={onClick} style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, padding: 0, overflow: 'hidden', cursor: 'pointer', ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} alt={alt} style={{ width: 28, height: 28, objectFit: 'contain' }} />
    </button>
  );
}

const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 999, background: '#100C1C', color: '#fff', fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace' };
const glassBtn = { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', ...glass };
