// PreviewViewerScreen — SEPARATE, preview-only reproduction of the viewer UI
// (mobile immersive = MobileLiveViewer-style, desktop = framed Twitch-style) for
// the admin Stream Preview tab. Mock data only: no Firestore, no HLS, no relay.
// `doc` carries lastGift/lastTip/lastSub so the admin screen can preview alert +
// gift-overlay placement. Production ViewerStreamScreen / MobileLiveViewer are
// never touched.

import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { StreamGoalBar, TipAlertOverlay, SubAlertOverlay } from '../../../components/streams/StreamGoalAndAlerts';
import { PreviewCoHostGrid, PreviewTournamentCard } from './PreviewStreamStages';
import { PreviewVideoStage } from './previewSoloParts';
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
const glass = { background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(16px) saturate(140%)', WebkitBackdropFilter: 'blur(16px) saturate(140%)', border: '1px solid rgba(255,255,255,0.18)' };
const glassDark = { background: 'rgba(10,8,22,0.42)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', border: '1px solid rgba(255,255,255,0.12)' };

function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

const C = {
  bg: '#0a0a14', card: '#12121e', cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)', text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', red: '#ef4444', amber: '#f59e0b',
};

const MSGS = [['Nova', 'gg that was clean'], ['Kai', 'pog'], ['m32', 'send the boss gift 👀'], ['Lyra', 'W stream'], ['vex', 'lets goooo']];

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
}

function VideoStage({ streamType = 'solo', guestCount = 2 }) {
  // Viewer sees the baked composite as a SINGLE video. For co-host that's the
  // server-composited grid; render it as the stage so the founder sees what a
  // multi-guest stream looks like to a viewer. For solo we paint the supplied
  // background image (stands in for the live video so the glass blur reads).
  if (streamType === 'cohost') return <PreviewCoHostGrid count={guestCount} fullscreen />;
  // Solo immersive: in production the video fills the whole screen, so the
  // branded backdrop is never visible here. Render the measuring grey
  // placeholder instead — this is the region real footage has to fill in a
  // store screenshot, and it prints its own pixel size.
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PreviewVideoStage scene="game" />
      {streamType === 'tournament' && <PreviewTournamentCard offset={{ top: 56, left: 12 }} />}
    </div>
  );
}

export default function PreviewViewerScreen({ device = 'mobile', doc, host, streamType = 'solo', guestCount = 2, soloView = 'immersive', scene = 'game' }) {
  const streamDoc = doc;
  const uptime = streamDoc?.startedAt ? fmtUptime(Date.now() - streamDoc.startedAt) : null;
  // Transient gift drops (combo-aware) for the mobile immersive + co-host views.
  const { toasts: gifts, sendGift } = useGiftFeed(streamDoc?.lastGift);

  // ── MOBILE SOLO — ADDITIONAL solo-viewer designs (their OWN files, NOT the
  // co-host grid). These are selectable ALONGSIDE the existing immersive viewer
  // below; `soloView==='immersive'` (default) falls through and keeps the
  // original screen untouched. ──
  if (device === 'mobile' && streamType === 'solo' && soloView === 'split') {
    return <PreviewSoloPortrait doc={streamDoc} host={host} scene={scene} />;
  }
  if (device === 'mobile' && streamType === 'solo' && soloView === 'landscape') {
    return <PreviewSoloLandscape doc={streamDoc} host={host} scene={scene} />;
  }

  // ── MOBILE MULTI-USER (co-host) — the founder's multi-user mockup: the video
  // grid is CONTAINED in the top area and the chat lives in a panel BELOW it,
  // both on the violet gradient. (Solo stays the full-bleed immersive layout.) ──
  if (device === 'mobile' && streamType === 'cohost') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column', backgroundImage: `url(${cohostScreenBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>

        {/* Header — same host capsule + right controls as solo. */}
        <div style={{ position: 'relative', zIndex: 3, padding: '10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
            <UserAvatar src={host?.avatar} size={38} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{host?.displayName || 'Live'}</span>
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, ...glassDark }}>
              <Icon name="visibility" size={14} />{compactNum(streamDoc.viewerCount || 0)}
            </span>
            <button style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>
          </div>
        </div>


        {/* Video grid — CONTAINED in the top area (not full-bleed). The grid
            geometry: 2 side-by-side · 3 big-left + two stacked · 4 = 2×2. */}
        <div style={{ position: 'relative', zIndex: 2, width: '100%', flex: '0 0 44%', minHeight: 0 }}>
          {/* Tip goal — ABSOLUTE overlay over the grid. Chrome that floats on
              the stream must never occupy layout space: in flow, toggling it
              shifts the video grid and the chat below it. */}
          {streamDoc.goal?.active && (
            <div style={{ position: 'absolute', top: 8, left: 10, right: 10, zIndex: 4 }}>
              <StreamGoalBar goal={streamDoc.goal} compact />
            </div>
          )}
          <PreviewCoHostGrid count={guestCount} fullscreen edge />
        </div>

        {/* Chat panel — fills the rest, newest at the bottom, older fade out at
            the top. Floating red like on the right. */}
        <div style={{ position: 'relative', zIndex: 2, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px', gap: 12 }}>
          <button style={{ position: 'absolute', right: 6, bottom: 10, zIndex: 6, width: 44, height: 44, borderRadius: 14, cursor: 'pointer', padding: 0, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.18)' }}>
            <Icon name="favorite" size={28} filled style={{ color: '#ef4444' }} />
          </button>
          {/* Chat block wrapped so gift drops anchor directly ABOVE it — never
              over the newest messages, which are the ones being read. */}
          <div style={{ position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <GiftFeed toasts={gifts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, paddingTop: 24, maxHeight: '100%', overflow: 'hidden', maskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 62%, transparent 96%)' }}>
            <PreviewChatRow user="kai_mercer" text="wait how did you pull that off" />
            <PreviewChatRow user="ZERO_taeyeon" text="ok that was actually clean, I've been trying to land that all week and it never works for me" mod sub />
            <PreviewChatRow user="Priya_S" text="first time here, this is sick" />
            <PreviewChatRow user="tomruns" text="streaming again tomorrow?" />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>
              <img src={waveIcon} alt="" aria-hidden style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />
              <span><b style={{ fontWeight: 800 }}>ZERO_taeyeon</b> joined via share invitation</span>
            </div>
          </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.82)', width: 'fit-content' }}>
            <img src={watchingIcon} alt="" aria-hidden style={{ width: 18, height: 18, objectFit: 'contain' }} />
            <span><b style={{ fontWeight: 800 }}>Priya_S</b> started watching</span>
          </div>
        </div>

        {/* Composer dock — input + invite / VC / gift / share. Tips & VC fires a drop. */}
        <div style={{ position: 'relative', zIndex: 3, padding: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...glassDark }}>Add a comment…</div>
          <DockGlassBtn src={inviteIcon} alt="Invite" />
          <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={() => sendGift({ name: 'You', gift: 'Galaxy', qty: 1 })} />
          <DockGlassBtn src={giftboxIcon} alt="Gift Box" />
          <DockGlassBtn src={sendIcon} alt="Share" />
        </div>

        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />
      </div>
    );
  }

  // ── MOBILE IMMERSIVE (matches the founder's Solo Stream Figma: glass over the
  // background image, founder icon assets, single-row composer, nothing clipped) ──
  if (device === 'mobile') {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
        <VideoStage streamType={streamType} guestCount={guestCount} />

        {/* Top row — TWO matched glass cards (host on the left, viewer controls on
            the right) exactly like the founder's Solo Stream design. Element sizes
            are FIXED to the design; only the streamer name flexes (truncates). */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {/* Host card — tapping the avatar/name opens the streamer's profile
              bottom-sheet (TikTok pattern), where Follow lives. There is NO inline
              Follow pill, so nothing can bleed past the card edge. */}
          <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
            <UserAvatar src={host?.avatar} size={38} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Row 1 — name + verified check inline (TikTok places the badge by the
                  name, not on the avatar). Name truncates; check never shrinks. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{host?.displayName || 'Live'}</span>
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, flexShrink: 0, ...glassDark }}>
              <Icon name="visibility" size={14} />{compactNum(streamDoc.viewerCount || 0)}
            </span>
            <button style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={17} /></button>
          </div>
        </div>

        {/* Tip goal — sits directly under the header. The viewer sees it where the
            broadcaster placed it; positioning/resizing is a BROADCASTER control
            (shelved for the broadcaster view: drag + resize width AND height,
            persisted to the stream doc). */}
        {streamDoc.goal?.active && (
          <div style={{ position: 'absolute', top: 64, left: 10, right: 10, zIndex: 4 }}>
            <StreamGoalBar goal={streamDoc.goal} compact />
          </div>
        )}

        {/* Bottom — chat (fades at top, TikTok-style), "started watching", composer, floating like. */}
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Floating like button (founder heart asset) — z-index above the chat so
              it's never hidden behind a message. */}
          <button style={{ position: 'absolute', right: 0, bottom: 58, zIndex: 20, width: 42, height: 42, borderRadius: '50%', cursor: 'pointer', padding: 0, overflow: 'hidden', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={likeIcon} alt="like" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          </button>

          {/* Chat block wrapped so gift drops anchor directly ABOVE it — never
              over the newest messages, which are the ones being read. */}
          <div style={{ position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <GiftFeed toasts={gifts} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 5 }} />

          {/* Chat — TikTok-style: no box, newest at the bottom, older messages fade
              out at the top via a gradient mask (≈4 lines visible). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 26, maxHeight: 188, overflow: 'hidden', textShadow: '0 1px 3px rgba(0,0,0,0.85)', maskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 55%, transparent 95%)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
              <img src={waveIcon} alt="" aria-hidden style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
              <span><b style={{ fontWeight: 800 }}>ZERO_taeyeon</b> joined via share invitation</span>
            </div>
            <PreviewChatRow inline user="ZERO_taeyeon" text="ok that was actually clean, I've been trying to land that all week and it never works for me" mod sub />
            <PreviewChatRow inline user="Priya_S" text="first time here, this is sick" />
            <PreviewChatRow inline user="tomruns" text="streaming again tomorrow?" />
          </div>
          </div>

          {/* "started watching" sits below the panel, on the video. */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.85)', width: 'fit-content', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
            <img src={watchingIcon} alt="" aria-hidden style={{ width: 18, height: 18, objectFit: 'contain' }} />
            <span><b style={{ fontWeight: 800 }}>Priya_S</b> started watching</span>
          </div>

          {/* Composer — single row: input + invite / VC / gift / SHARE. The last
              button SHARES the stream (glass, like the other dock buttons). Sending
              a comment is done by the keyboard's own send key, so there is no
              in-dock send button. Tips & VC fires a transient gift drop. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...glassDark }}>Add a comment…</div>
            <DockGlassBtn src={inviteIcon} alt="Invite" />
            <DockGlassBtn src={vcCoinIcon} alt="Tips & VC" onClick={() => sendGift({ name: 'You', gift: 'Galaxy', qty: 1 })} />
            <DockGlassBtn src={giftboxIcon} alt="Gift Box" />
            <DockGlassBtn src={sendIcon} alt="Share" />
          </div>
        </div>

        <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />
      </div>
    );
  }

  // ── DESKTOP SOLO — Twitch-style viewer (founder redesign), its own file. ──
  if (device !== 'mobile' && streamType === 'solo') {
    return <PreviewDesktopViewer doc={streamDoc} host={host} />;
  }

  // ── DESKTOP FRAMED (co-host / tournament keep this layout) ──
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex', gap: 12, padding: 12 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          <VideoStage streamType={streamType} guestCount={guestCount} />
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
            <span style={{ ...chip, background: C.red }}>● LIVE</span>
            <span style={chip}>1080p60</span>
          </div>
          {streamDoc.goal?.active && <div style={{ position: 'absolute', left: 12, right: 12, bottom: 48 }}><StreamGoalBar goal={streamDoc.goal} /></div>}
          {/* hover control bar */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '24px 14px 10px', background: 'linear-gradient(0deg, rgba(0,0,0,0.75), transparent)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="volume_up" size={18} />
            <div style={{ width: 110, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.3)' }} />
            <div style={{ flex: 1 }} />
            <Icon name="crop_16_9" size={18} />
            <Icon name="fullscreen" size={18} />
          </div>
          <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />
          <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />
        </div>
        {/* under-player channel card */}
        <div style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{streamDoc.title || 'Live stream'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserAvatar src={host?.avatar} size="md" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{host?.displayName || 'Host'}</div>
              {streamDoc.game && <div style={{ fontSize: 12, color: C.purpleLight, fontWeight: 600 }}>{streamDoc.game}</div>}
            </div>
            <button style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Follow</button>
            <button style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="paid" size={15} /> Tip</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textDim }}><Icon name="visibility" size={13} /> {(streamDoc.viewerCount || 0).toLocaleString()} watching</span>
          </div>
        </div>
      </div>

      <div style={{ width: 320, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.textDim }}>LIVE CHAT</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 7, padding: 12, fontSize: 13 }}>
          {MSGS.map(([u, m], i) => <div key={i}><span style={{ color: C.purpleLight, fontWeight: 700 }}>{u}</span> <span>{m}</span></div>)}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ padding: '9px 12px', borderRadius: 999, background: C.cardSoft, color: C.textMuted, fontSize: 13 }}>Say something…</div>
        </div>
      </div>
    </div>
  );
}

// Top-supporters cluster (TikTok-style): a clean stacked avatar group, #1 gifter
// ringed in gold. No inline coin pill — that ate the streamer name's room; the
// per-gifter totals live in the tap-through leaderboard (GiftersSheet).
function GiftersCluster({ gifters }) {
  const top = (gifters || []).slice(0, 3);
  if (!top.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {top.map((g, i) => (
        <span key={g.uid} style={{ marginLeft: i ? -7 : 0, display: 'inline-flex', borderRadius: '50%', border: `2px solid ${i === 0 ? '#F5C842' : 'rgba(10,8,22,0.6)'}`, zIndex: 3 - i }}>
          <UserAvatar src={g.avatar} size={24} />
        </span>
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', padding: '1px 5px 1px 3px', borderRadius: 6, fontSize: 8.5, fontWeight: 900, letterSpacing: '0.04em', color: '#fff', background: 'linear-gradient(135deg, #7c3aed, #b44fff)' }}>
      <Icon name="star" size={9} filled style={{ color: '#F5C842' }} />SUB
    </span>
  );
}

// Chat row. `inline` (solo immersive) puts badges before the name on one wrapping
// line; the default (stacked, multi-user) puts the name + badges on their own
// line with the message below, matching the founder's multi-user mockup.
function PreviewChatRow({ user, text, mod = false, sub = false, inline = false, avatarSize = 'sm' }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}><UserAvatar src={null} size={inline ? 'xs' : avatarSize} /></span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
        {inline ? (
          <>
            {mod && <span style={{ marginRight: 4 }}><ModBadge /></span>}
            {sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
            <span style={{ fontWeight: 800, color: '#fff', marginRight: 6 }}>{user}</span>
            <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{text}</span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
              <span style={{ fontWeight: 800, color: '#fff' }}>{user}</span>
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

const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace' };
const glassBtn = { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', ...glass };
