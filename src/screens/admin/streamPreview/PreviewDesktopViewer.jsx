// PreviewDesktopViewer — desktop live-viewer, Twitch-style (founder request).
// Video + channel info on the left, full-height STREAM CHAT docked on the right
// with the founder's 7 chat icons wired as interactive mocks:
//   VP Rewards balance · Cheer/gift · Identity selector · Emotes · Account
//   verification gate · Moderation actions · Chat settings.
// HYBRID icon treatment: the colourful hero PNGs (VP crystal, Cheer gem) render
// where they shine; the small footer controls use flat Material icons that read
// at 20px. Preview-only — no Firestore / relay / camera. Real backend lands when
// this ports to the live screens.

import { useState } from 'react';
import { PlaybackState, StreamPaywall, ChatStateBanner, TtsStrip, VpEarnedChip, PreviewLevelUp, AudioStage, ModChannelSwitch, RaidBanner, composerCopy } from './previewStates';
import ReactionsFloor from '../../../components/streams/ReactionsFloor';
import { usePreviewVideos, usePreviewSim, usePreviewRole } from './previewAssetsContext';
import { useFaces } from './previewAssetsContext';
import Icon from '../../../components/Icon';
import { canModerate, canConfigureChat } from './previewRoles';
import { CoinIcon } from '../../../components/CoinIcon';
import UserAvatar from '../../../components/UserAvatar';
import {SubAlertOverlay, StreamGoalBar} from '../../../components/streams/StreamGoalAndAlerts';
import { PreviewVideoStage, FacecamPip, compactNum, FloatingHeart, MovableGoal } from './previewSoloParts';
import { PreviewCoHostGrid } from './PreviewStreamStages';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import { PreviewChat, PreviewSheets } from './previewChrome';
import { GiftFeed, useGiftFeed } from './previewSoloParts';
import vpCrystal from '../../../assets/stream/vp-crystal.webp';
import cheerGem from '../../../assets/stream/cheer-gem.webp';

// A bare icon button: no fill, no border, just a real hit target and a real name. Used
// wherever a glyph used to sit loose in a row pretending to be a control.
const iconBtnBare = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 24, minHeight: 24, flexShrink: 0,
};


// ⚠ A PANEL DOES NOT GET AN OUTLINE FOR BEING A PANEL. Measured on the deployed page,
// every card on this screen was ringed at dL 0.014 against its own fill while the fill
// itself was only 0.0038 off the page behind it — so the stroke was doing the work the
// value ladder should be doing. Ladder raised, strokes gone. A DIVIDER survives only
// where a real division needs marking, and it fades at both ends so it cannot read as
// a cage edge.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };
const ruleTop = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'top' };

const T = {
  bg: '#0e0e16', panel: '#1B1B26', panel2: '#26262F', input: '#0B0B12',
  border: 'rgba(255,255,255,0.08)', text: '#efeff1', dim: '#adadb8', muted: '#7a7a85',
  violet: '#7c3aed', violetL: '#b44fff', gold: '#F5C842', green: '#22c55e',
  // ⚠ TWO REDS: white on #ef4444 measured 3.76:1 on the LIVE pill. See previewStates.
  red: '#ff6b6b', redFill: '#c62828',
};


// ⚠ THE STATIC `FEED` THAT WAS HERE IS DELETED, FOR TWO REASONS.
//
// 1. IT WAS A TWITCH PASTICHE, NOT OUR CHAT. Timestamps, a fixed name-colour
//    palette and "Replying to" lines — ChatPanel draws none of those. A preview
//    that shows a competitor's chat design is worse than no preview, because it
//    gets screenshotted and believed.
// 2. ITS HANDLES REFERENCED REAL PLAYERS AND TEAMS. The copy on this screen is
//    SHIPPED — Play store screenshots are captured here — and a real handle is
//    impersonation. previewStream.js already warns about exactly this.
//
// Chat now comes from the simulator and renders through PreviewChat, which
// reproduces ChatPanel's own `side` layout.

export default function PreviewDesktopViewer({
  doc, host, messages = [], joinEvents = [], openSheet = null, onOpenSheet = () => {},
  // ⚠ `scene` DRIVES THE FACECAM PiP. It reached the mobile solo views and not this one,
  // so the Game+cam / Camera only control could not turn the PiP off on desktop — the
  // reason it sat in every capture.
  scene = 'game',
  // ⚠ THE CO-HOST GRID WAS MISSING HERE ENTIRELY. This component is the desktop
  // viewer for BOTH stream types (`desktopViewer = role === 'viewer' && !mobile`,
  // no streamType check), and it only ever drew a single stage — so a desktop
  // viewer watching a co-host stream saw one video and no second publisher, while
  // the broadcaster on the same stream saw two tiles.
  streamType = 'solo', guestCount = 2, cohostLayout = 'grid', camsOff = [],
  avatars = {}, role = 'viewer',
}) {
  // ⚠ VIDEOS COME FROM THE PROVIDER, NOT A PROP. `facecamVideo` was a prop,
  // went missing from simProps in an unrelated edit, and nothing failed — the
  // PiP simply rendered empty. A context cannot be forgotten at a call site.
  const { videoFor } = usePreviewVideos();
  // ⚠ REACTIONS COME FROM THE SIM CONTEXT, NOT A PROP. Threading them was how
  // the like button ended up dead on the solo views: the component was mounted
  // and the data never arrived. Third time for this class — see rule 20.
  const sim = usePreviewSim();
  const { goalBox, setGoalBox, goalEdit } = sim;
  const { playback = 'live', gate = 'none', chatState = 'open', tts = 'off', watchMinutes = 0, levelUp = false, setLevelUp , audioOnly = false , chatChannel = 'public', setChatChannel , raiding = false, setRaiding } = sim;
  // what chat is doing to this viewer, resolved once for the banner AND the input
  const chatLock = composerCopy(chatState);
  const previewRole = usePreviewRole();
  const { reactions = [] } = sim;
  const { toasts: gifts } = useGiftFeed(doc?.lastGift);
  const faceOf = useFaces();
  const d = doc || {};
  const [panel, setPanel] = useState(null);            // identity | emote | cheer | mod | settings
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  // ⚠ THE COLLAPSE CHEVRON HAD NO STATE BEHIND IT. It carried `cursor: pointer` and did
  // nothing; a viewer who wants the video full-width had no way to get it, on the one
  // surface with room to care.
  const [chatOpen, setChatOpen] = useState(true);
  const [following, setFollowing] = useState(false);
  // ⚠ A COMPOSER WITH NO DRAFT CANNOT SHOW AN EMOTE BEING INSERTED, and the
  // emote button beside the input implies exactly that. The draft is what makes
  // the picker, the placeholder and the Send button one flow instead of three
  // decorations.
  const [draft, setDraft] = useState('');
  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));
  // ⚠⚠ A PANEL MUST NOT OUTLIVE THE PERMISSION THAT OPENED IT. Opening the
  // moderation panel as a moderator and then switching to a plain viewer left it
  // on screen with the gavel gone — the exact defect just fixed, one layer up.
  // Derived at render rather than cleared in an effect, so there is no window in
  // which the wrong thing is painted.
  const cohost = streamType === 'cohost';
  const openPanel = panel === 'mod' && !canModerate(role) ? null : panel;

  return (
    <div style={{ position: 'absolute', inset: 0, background: T.bg, color: T.text, fontFamily: '"DM Sans",system-ui,sans-serif', display: 'flex' }}>
      {/* ── LEFT: video + channel info ───────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Video */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', flexShrink: 0 }}>
          {/* ⚠⚠ AUDIO-ONLY BELONGS AT THE MEDIA LAYER, NOT IN THE BLOCKING-STATE
              TERNARY BELOW. It sat there as an opaque `inset: 0` layer at z-4,
              mounted last, and buried the chrome on six of seven surfaces — the
              mobile broadcaster lost End stream and Mic, the desktop viewer lost
              Follow and the composer. It replaces the VIDEO, so it renders here,
              straight after it, under everything the surface draws on top. */}
          {streamType === 'cohost'
            ? <PreviewCoHostGrid count={guestCount} fullscreen layout={cohostLayout} camsOff={camsOff} />
            : <PreviewVideoStage scene={scene} videoUrl={videoFor('stage')} />}
          {audioOnly && <AudioStage host={host} hostName={host?.displayName} title={d?.title} z={1} />}
          {/* ⚠ THE TILE OWNS THE TOP-LEFT IN CO-HOST MODE. Measured on the deployed page:
              the ● LIVE badge overlapped the first tile's HOST label by 45x19px, stacking
              two labels on one corner in every capture. The grid draws HOST/CO-HOST at each
              tile's top-left, so the stream-level badges move to the free top-right. */}
          <div style={{ position: 'absolute', top: 12, left: cohost ? 'auto' : 12, right: cohost ? 12 : 'auto', display: 'flex', gap: 6, zIndex: 3 }}>
            <span style={{ ...badge, background: T.redFill }}>● LIVE</span>
            <span style={badge}>1080p60</span>
          </div>
          {/* ⚠ DESKTOP FLOATED HEARTS WITH NOTHING TO TAP. Hearts rose on the
              right of the player and the only way to make one was the admin
              rail, so a capture of this screen could never show the interaction
              it was advertising. Sits above the PiP, on the side the hearts
              rise from. */}
          <FloatingHeart style={{ position: 'absolute', right: 12, bottom: 152, zIndex: 4 }} />
          {/* ⚠ NO FACECAM IN AN AUDIO-ONLY STREAM. A picture-in-picture of a camera on
              a broadcast that by definition has none is a contradiction on screen, and
              the audio stage only hid it by accident of z-order. Say it explicitly. */}
          {!audioOnly && scene === 'game' && streamType !== 'cohost' && <FacecamPip w={150} videoUrl={videoFor('facecam')} style={{ position: 'absolute', right: 12, bottom: 56 }} />}
          {/* ⚠ A GOAL IS A CARD, NOT A BAND ACROSS THE PICTURE. Measured 629px on a 653px
              stage — 96% of the width — so it cut the video in half in every capture.
              Anchored left at a readable width instead, the way the mobile surfaces draw it. */}
          <MovableGoal editing={goalEdit} fallback={{ xPct: 2, yPct: 70, wPct: 46 }} goal={d.goal} box={goalBox} onChange={setGoalBox} editable={false} />
          {/* hover control bar */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 14px 10px', background: 'linear-gradient(0deg, rgba(0,0,0,0.75), transparent)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Icon name="play_arrow" size={20} filled />
            <Icon name="volume_up" size={19} />
            <div style={{ width: 90, height: 4, borderRadius: 99, background: '#4A4A58' }} />
            <div style={{ flex: 1 }} />
            <Icon name="settings" size={18} />
            <Icon name="picture_in_picture_alt" size={18} />
            <Icon name="fullscreen" size={20} />
          </div>
          {/* ⚠ THE TIP DISPLAY IS THE DESIGNED COMBO FEED, NOT AN ALERT PILL.
              Left-aligned, avatar + "Sent X" + coin + a big xN counter that climbs
              when the same person sends again (previewSoloParts.jsx). The solo views
              always had it; these surfaces never did, so a tip here rendered as the
              generic centred pill instead — the thing that was replaced. */}
          <GiftFeed toasts={gifts} style={{ bottom: 64 }} />
          <SubAlertOverlay lastSub={d.lastSub} anchor="bottom" />
        </div>

        {/* Channel bar */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, ...ruleBottom }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {/* ⚠⚠ THIS BUTTON'S OWN SUBTITLE READS "Click name to open profile" AND IT
                HAD NO onClick. Measured 2026-09-03: a <button> with cursor:pointer, zero
                React handlers, and a label instructing you to press it. Every earlier sweep
                missed it because they asked whether a control could be HIT, never whether
                pressing it DID anything. */}
            <button type="button" onClick={() => onOpenSheet({ kind: 'profile', uid: 'host' })} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ position: 'relative', flexShrink: 0, padding: 2, borderRadius: '50%', background: `linear-gradient(135deg, ${T.violet}, ${T.violetL})` }}>
                <UserAvatar src={faceOf(host)} size={48} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 17, fontWeight: 800 }}>{host?.displayName || 'Host'}</span>
                  {host?.isVerified && <Icon name="verified" size={15} filled style={{ color: T.violetL }} />}
                </div>
                {/* ⚠ THIS WAS THE LITERAL STRING "Click name to open profile" — an
                    instruction to the user sitting where the channel's own line belongs, in
                    the middle of every capture. The preview exists to make store
                    screenshots; filler text that tells someone how to use the UI cannot be
                    in one. The follower count is what the real channel bar carries here. */}
                <div style={{ fontSize: 12, color: T.dim }}>{compactNum(d.followers || 48200)} followers</div>
              </div>
            </button>
            <div style={{ flex: 1 }} />
            {/* Twitch-style actions (founder: keep Follow on desktop). */}
            <button type="button" onClick={() => setFollowing((v) => !v)} style={pillBtn(following ? T.panel2 : T.violet)}>
              <Icon name={following ? 'check' : 'favorite'} size={15} filled /> {following ? 'Following' : 'Follow'}
            </button>
            {/* ⚠⚠ "GIFT A SUB" AND "SUBSCRIBE" WERE THE SAME NOTHING — both
                unwired, and grepping the repo for `giftSub` / `giftMembership`
                returns NOTHING. The button named a feature that does not exist,
                on a screen whose captures go to the Play store. They are two
                different things now: Subscribe buys a membership for YOURSELF;
                Gift a Sub buys the same membership FOR SOMEONE ELSE at the same
                price, creator's 90% unchanged (functions/memberships.js
                `subscribeMembership`). No rate is invented here. */}
            <button type="button" onClick={() => onOpenSheet({ kind: 'giftsub' })} style={pillBtn(T.panel2)}>
              <Icon name="redeem" size={15} filled style={{ color: T.violetL }} /> Gift a Sub
            </button>
            <button type="button" onClick={() => onOpenSheet({ kind: 'subscribe' })} style={pillBtn(T.panel2)}>
              <Icon name="star" size={15} filled style={{ color: T.gold }} /> Subscribe
            </button>
          </div>
          <div dir="auto" style={{ fontSize: 15, fontWeight: 700 }}>{d.title || 'LIVE stream'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: T.violetL, fontWeight: 700 }}>{d.game || 'Nightfall Protocol'}</span>
            <span style={{ ...tag }}>English</span>
            <div style={{ flex: 1 }} />
            <button aria-label="Viewers" onClick={() => onOpenSheet({ kind: 'viewers' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: T.red, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0, minHeight: 24 }}><Icon name="person" size={15} filled /> {(d.viewerCount || 0).toLocaleString()}</button>
            <span style={{ fontSize: 13, color: T.dim }}>8:27:44</span>
            {/* ⚠ THESE WERE BARE <Icon> GLYPHS — not buttons, no handlers, no names. A
                probe that looks for button/[role=button] cannot see them, which is exactly
                where the dead controls were hiding. */}
            <button type="button" aria-label="Share this stream" onClick={() => onOpenSheet({ kind: 'share' })} style={iconBtnBare}><Icon name="ios_share" size={17} style={{ color: T.dim }} /></button>
            <button type="button" aria-label="More" onClick={() => onOpenSheet({ kind: 'more' })} style={iconBtnBare}><Icon name="more_vert" size={17} style={{ color: T.dim }} /></button>
          </div>
        </div>

        {/* About card */}
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>About {host?.displayName || 'Host'}</span>
            {host?.isVerified && <Icon name="verified" size={14} filled style={{ color: T.violetL }} />}
          </div>
          <div style={{ background: T.panel, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{compactNum(d.followers || 48200)} followers</div>
            <div style={{ fontSize: 13, color: T.dim }}>Ranked grinds, scrims and the occasional disaster</div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: STREAM CHAT ───────────────────────────────────────────── */}
      <div style={{ width: chatOpen ? 340 : 44, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0, transition: 'width .18s' }}>
        {/* header */}
        <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', ...ruleBottom }}>
          {/* ⚠⚠ BOTH OF THESE CARRIED `cursor: pointer` AND DID NOTHING. A pointer cursor
              is a promise; these actively invited a click and had no handler behind them. */}
          <button type="button" aria-label={chatOpen ? 'Collapse chat' : 'Expand chat'} onClick={() => setChatOpen((v) => !v)} style={iconBtnBare}>
            <Icon name={chatOpen ? 'chevron_right' : 'chevron_left'} size={20} style={{ color: T.dim }} />
          </button>
          {chatOpen && <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.06em' }}>STREAM CHAT</div>}
          {chatOpen && (
            <button type="button" aria-label="Who is watching" onClick={() => onOpenSheet({ kind: 'viewers' })} style={iconBtnBare}>
              <Icon name="group" size={19} style={{ color: T.dim }} />
            </button>
          )}
        </div>

        {/* ⚠ GATE THE BODY, NOT JUST THE WIDTH. A 340px column squeezed into 44px does not
            read as collapsed, it reads as broken — the gifter chips, the message rows and the
            composer all wrap into a smear. Collapsed shows the chevron and nothing else. */}
        {chatOpen && <>
        {/* top gifters strip */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', ...ruleBottom, overflow: 'hidden' }}>
          {/* ⚠ `minWidth: 0` IS WHAT MAKES flex-shrink WORK. A flex item defaults to
              `min-width: auto`, so these nowrap chips refused to compress and the strip
              overflowed its 340px rail by 49px — `overflow: hidden` then sliced the
              third gifter through the middle of their name. The name already carries an
              ellipsis; it was simply never allowed to reach it. */}
          {(d.previewGifters || []).slice(0, 3).map((g, i) => (
            <span key={g.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, padding: '3px 8px', borderRadius: 999, background: T.panel2, fontSize: 11.5, fontWeight: 700 }}>
              {i === 0 ? <Icon name="emoji_events" size={13} style={{ color: T.gold, flexShrink: 0 }} /> : <img src={cheerGem} alt="" style={{ width: 13, height: 13, flexShrink: 0 }} />}
              <span style={{ maxWidth: 64, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.displayName}</span>
              <span style={{ color: T.gold, flexShrink: 0 }}>{compactNum(g.coins)}</span>
            </span>
          ))}
        </div>

        {/* messages — the simulator's live feed, in ChatPanel's side layout */}
        <div style={{ flex: 1, minHeight: 0, padding: '10px 8px' }}>
          <PreviewChat
            messages={messages} layout="side" avatars={avatars}
            onOpenProfile={(uid) => onOpenSheet({ kind: 'profile', uid })}
          />
        </div>

        {/* ── footer (the 7 icons) ──────────────────────────────────────── */}
        <div style={{ flexShrink: 0, padding: 12, ...ruleTop, position: 'relative' }}>
          {openPanel && <FooterPanel which={openPanel} role={role} verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly} onClose={() => setPanel(null)} onInsert={(e) => setDraft((d) => d + e)} />}

          {/* Account-verification gate banner (image5) */}
          {verifiedOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: T.panel2, fontSize: 12, color: T.dim, marginBottom: 8 }}>
              <Icon name="verified_user" size={15} style={{ color: T.dim }} /> Verified Accounts Only Chat
            </div>
          )}

          {/* ⚠ A DISABLED COMPOSER WITH NO REASON READS AS BROKEN. Whatever chat
              is doing to this person has to be said directly above the box they
              cannot type in, with the one action that would change it. */}
          {/* ⚠ THE REWARD HAS TO BE VISIBLE WHERE IT IS EARNED. Vergr already pays
              VP for watching and for tipping; saying nothing means paying the cost
              of the loop and getting none of it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
          <ModChannelSwitch role={previewRole} channel={chatChannel} onChannel={setChatChannel} />
        </div>
          {raiding && <RaidBanner reserveRight={12} fromName={host?.displayName} toName="nova_kill" onStay={() => setRaiding?.(false)} />}
          <TtsStrip state={tts} onOpenSheet={onOpenSheet} />
          <ChatStateBanner onOpenSheet={onOpenSheet} onAppeal={(k) => onOpenSheet?.({ kind: 'appeal', appealKind: k })} state={chatState} reserveRight={12} />
          {/* chat state must reach the composer, not just the banner above it */}
          {/* input row: identity (left) · placeholder · emote + cheer (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: T.input, border: 'none', boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.55)' }}>
            <button type="button" aria-label="Identity selector" onClick={() => togglePanel('identity')} title="Identity selector" style={iconBtn}><Icon name="badge" size={18} style={{ color: panel === 'identity' ? T.violetL : T.dim }} /></button>
            {/* the only REAL input in the preview, so it is the only one that can
                actually be disabled rather than just look it. */}
            <input value={chatLock.locked ? '' : draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (!chatLock.locked && e.key === 'Enter' && draft.trim()) { sim.pushMessage?.('you', draft.trim()); setDraft(''); } }}
              disabled={chatLock.locked}
              placeholder={chatLock.locked ? chatLock.text : 'Send a message'}
              style={{ flex: 1, fontSize: 13, color: chatLock.locked ? '#7E7E92' : T.text, background: 'transparent', border: 'none', outline: 'none', minWidth: 0 }} />
            <button type="button" aria-label="Emotes and stickers" onClick={() => togglePanel('emote')} title="Emotes & Stickers" style={iconBtn}><Icon name="mood" size={18} style={{ color: panel === 'emote' ? T.violetL : T.dim }} /></button>
            {/* ⚠ "CHEER WITH VP" IS GONE (founder). It was wrong three times over:
                VP is PROGRESSION, not currency — coins (VC) are the only thing a
                viewer can spend; gifting is DEFERRED in CLAUDE.md and has no
                catalogue; and its own copy read "price tiers pending", which
                advertises an unbuilt feature on a screen whose captures go on the
                Play listing. The coin button below sends coins, which is real. */}
            <button type="button" onClick={() => onOpenSheet({ kind: 'tip' })} title="Send coins" style={iconBtn}><CoinIcon size={19} /></button>
          </div>

          {/* bottom row: VP balance (left) · mod / settings / Chat (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span title="VP Rewards" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 800, color: T.text }}>
              <img src={vpCrystal} alt="" style={{ width: 20, height: 20 }} /> {compactNum(d.viewerVp || 0)}
            </span>
            <div style={{ flex: 1 }} />
            {/* ⚠⚠ THE GAVEL IS GATED NOW. It used to render for EVERY viewer,
                offering timeout/ban and clear-chat to anyone watching, while the
                panel's own footer claimed "Broadcaster / moderator only". Only a
                host, an appointed stream moderator or a Vanguard sees it —
                the same test `loadStreamForMod` applies on the server. */}
            {canModerate(role) && (
              <button type="button" onClick={() => togglePanel('mod')} title="Moderation actions" style={iconBtn}><Icon name="gavel" size={18} style={{ color: panel === 'mod' ? T.violetL : T.dim }} /></button>
            )}
            <button type="button" aria-label="Chat settings" onClick={() => togglePanel('settings')} title="Chat settings" style={iconBtn}><Icon name="settings" size={18} style={{ color: panel === 'settings' ? T.violetL : T.dim }} /></button>
            {/* ⚠ THIS HAD AN EMPTY HANDLER. The one button labelled for sending a
                message did not send one, on the surface with a real keyboard. */}
            <button type="button" onClick={() => { if (draft.trim()) { sim.pushMessage?.('you', draft.trim()); setDraft(''); } }} title="Send message" style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: draft.trim() ? 'pointer' : 'default', fontSize: 13, fontWeight: 800, color: draft.trim() ? '#fff' : T.dim, background: draft.trim() ? T.violet : '#22222F' }}>Chat</button>
          </div>
        </div>
        </>}
      </div>

      {/* ⚠ side="right" matches the real desktop viewer (ViewerStreamScreen.jsx
          ~1082). The mobile immersive viewer uses side="left". They are not
          interchangeable — the ribbon flies in from the side it is anchored to. */}
      <ReactionsFloor events={reactions} position="right" />
      <JoinAnnouncer events={joinEvents} side="right" sound={false} />
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

// Pop-up panel above the footer for each control (mock content).
function FooterPanel({ which, verifiedOnly, setVerifiedOnly, onClose, role = 'viewer', onInsert }) {
  const [identity, setIdentity] = useState('VP Rank: Diamond');
  const [prefs, setPrefs] = useState({ timestamps: true, readable: true, hideOverlay: false });
  const wrap = { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 8, background: T.panel2, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.72)', padding: 12, zIndex: 10 };
  const head = (label) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
      <div style={{ flex: 1 }} />
      <Icon name="close" size={16} style={{ color: T.dim, cursor: 'pointer' }} onClick={onClose} />
    </div>
  );

  if (which === 'identity') {
    // ⚠ THREE RADIO ROWS, NONE OF THEM CLICKABLE. You could see which badge was
    // selected and never change it — a picker that cannot pick.
    const items = ['VP Rank: Diamond', 'Subscriber', 'Verified'];
    return (
      <div style={wrap}>{head('Chat identity')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((l) => (
            <button key={l} type="button" onClick={() => setIdentity(l)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
              background: T.input, fontSize: 12.5, cursor: 'pointer', color: T.text,
              border: `1px solid ${identity === l ? T.violet : 'transparent'}`, textAlign: 'left', width: '100%',
            }}>
              <Icon name={identity === l ? 'radio_button_checked' : 'radio_button_unchecked'} size={16} style={{ color: identity === l ? T.violetL : T.muted }} />{l}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>This is the badge shown beside your name in chat.</div>
      </div>
    );
  }
  if (which === 'emote') {
    return (
      <div style={wrap}>{head('Emotes & Stickers')}
        {/* ⚠ SIXTEEN GLYPHS, NONE CLICKABLE. A picker that cannot insert is a
            poster of a picker. They now append to the composer draft, which is
            what the button beside the input implies they do. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
          {['😀','😂','🔥','💜','👀','🎮','🏆','😎','💀','🥳','👑','⚡','🙌','💎','❤️','😭'].map((e, i) => (
            <button key={i} type="button" onClick={() => onInsert?.(e)} style={{ fontSize: 18, textAlign: 'center', cursor: 'pointer', background: 'none', border: 'none', padding: 4, borderRadius: 6, lineHeight: 1 }}>{e}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>Unlock more emotes by subscribing.</div>
      </div>
    );
  }
  if (which === 'mod') {
    // ⚠⚠ TWO TIERS, NOT ONE, AND THE SERVER ALREADY DRAWS THE LINE.
    // functions/streamChatMod.js gates mute/ban/pin behind `loadStreamForMod`
    // (host OR moderator) and slow-mode / followers-only / banned-words behind
    // `loadStream` (HOST ONLY). The old panel offered all of it to everybody, so
    // even for a real moderator half the rows were controls the server answers
    // with `permission-denied`. Offering a button that cannot work is the same
    // defect as offering it to the wrong person.
    const modActs = [['Timeout a viewer', 'timer_off'], ['Ban a viewer', 'gavel'], ['Pin a message', 'push_pin'], ['Clear chat', 'delete_sweep']];
    const hostActs = [['Slow mode', 'timer'], ['Followers-only', 'group'], ['Subscribers-only', 'star'], ['Verified accounts only', 'verified_user'], ['Banned words', 'block'], ['Appoint a moderator', 'shield_person']];
    const Row = ([l, ic], on) => (
      <div key={l} onClick={l === 'Verified accounts only' ? () => setVerifiedOnly((v) => !v) : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer' }}>
        <Icon name={ic} size={16} style={{ color: T.dim }} /><span style={{ flex: 1 }}>{l}</span>
        {l === 'Verified accounts only' && (
          <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? T.violet : T.muted, position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </span>
        )}
      </div>
    );
    return (
      <div style={wrap}>{head(canConfigureChat(role) ? 'Moderation' : 'Moderator actions')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {modActs.map((a) => Row(a, false))}
        </div>
        {canConfigureChat(role) ? (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: T.muted, margin: '12px 0 6px' }}>CHAT RULES · HOST ONLY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {hostActs.map((a) => Row(a, a[0] === 'Verified accounts only' ? verifiedOnly : false))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>Chat rules are set by {'the broadcaster'}.</div>
        )}
      </div>
    );
  }
  // settings — VIEWER PREFERENCES ONLY.
  // ⚠ "Verified accounts only" USED TO LIVE HERE, beside "show timestamps". One
  // decides who is ALLOWED TO POST and is a host control; the other two are how
  // this person likes to read. Mixing the two put a moderation switch in a
  // preferences menu for every viewer.
  // ⚠ ALL THREE ROWS PASSED `null` AS THEIR HANDLER, so the panel rendered
  // toggles that could never move. These are personal reading preferences, so
  // they belong to the viewer and are the one thing in this panel that should
  // NOT be role-gated.
  const KEYS = [['Show timestamps', 'timestamps'], ['Readable chat colours', 'readable'], ['Hide chat overlay', 'hideOverlay']];
  return (
    <div style={wrap}>{head('Chat settings')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {KEYS.map(([l, k]) => (
          <button key={l} type="button" onClick={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', background: 'none', border: 'none', color: T.text, width: '100%', textAlign: 'left' }}>
            <span style={{ flex: 1 }}>{l}</span>
            <span style={{ width: 34, height: 20, borderRadius: 999, background: prefs[k] ? T.violet : T.muted, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: prefs[k] ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const badge = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, background: '#100C1C', color: '#fff', fontSize: 11, fontWeight: 800 };
const tag = { padding: '3px 9px', borderRadius: 999, background: T.panel2, color: T.dim, fontSize: 12, fontWeight: 600 };
const iconBtn = { background: 'none', border: 'none', padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 };
const pillBtn = (bg) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#fff', background: bg });
