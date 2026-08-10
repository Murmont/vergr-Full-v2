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
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { TipAlertOverlay, SubAlertOverlay, StreamGoalBar } from '../../../components/streams/StreamGoalAndAlerts';
import { PreviewVideoStage, FacecamPip, compactNum } from './previewSoloParts';
import vpCrystal from '../../../assets/stream/vp-crystal.webp';
import cheerGem from '../../../assets/stream/cheer-gem.webp';

const T = {
  bg: '#0e0e16', panel: '#16161f', panel2: '#1d1d28', input: '#0c0c14',
  border: 'rgba(255,255,255,0.08)', text: '#efeff1', dim: '#adadb8', muted: '#7a7a85',
  violet: '#7c3aed', violetL: '#b44fff', red: '#ef4444', gold: '#F5C842', green: '#22c55e',
};

const NAME_COLORS = ['#FF7AA2', '#7CE3FF', '#9D7CFF', '#7CFF9D', '#FFC857', '#FF9D7C', '#7C9DFF', '#FF7CE3'];

// Mock chat feed (timestamps + colour names + badges + reply context).
const FEED = [
  { t: '01:07', u: 'AstroLumen', c: 1, text: 'navi mentioned', badge: 'mod' },
  { t: '01:07', u: 'tonyrose__', c: 4, text: 'Zonic: Nice Ilja!' },
  { t: '01:07', u: 'l0wkeyy_1', c: 6, text: 'NiKo Ok', badge: 'sub' },
  { t: '01:07', u: 'zef_te_velde_', c: 3, text: '@mha9if oohhh thats messy wth' },
  { t: '01:08', u: 'csroster22', c: 2, text: 'this is actually a pretty good start for niko these days', reply: '@ezz4navi' },
  { t: '01:08', u: '21bears', c: 0, text: 'NiKo wake up', badge: 'vp' },
  { t: '01:08', u: 'danthrman98', c: 7, text: 'navi tier 2' },
  { t: '01:08', u: 'Septorius', c: 5, text: 'n0vi' },
  { t: '01:08', u: 'hadyan115', c: 4, text: 'hmmm . Yea. Probably', reply: '@fixenas_cs' },
];

export default function PreviewDesktopViewer({ doc, host }) {
  const d = doc || {};
  const [panel, setPanel] = useState(null);            // identity | emote | cheer | mod | settings
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div style={{ position: 'absolute', inset: 0, background: T.bg, color: T.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex' }}>
      {/* ── LEFT: video + channel info ───────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Video */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', flexShrink: 0 }}>
          <PreviewVideoStage scene="game" />
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
            <span style={{ ...badge, background: T.red }}>● LIVE</span>
            <span style={badge}>1080p60</span>
          </div>
          <FacecamPip w={150} style={{ position: 'absolute', right: 12, bottom: 56 }} />
          {d.goal?.active && <div style={{ position: 'absolute', left: 12, right: 12, bottom: 56 }}><StreamGoalBar goal={d.goal} compact /></div>}
          {/* hover control bar */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 14px 10px', background: 'linear-gradient(0deg, rgba(0,0,0,0.75), transparent)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Icon name="play_arrow" size={20} filled />
            <Icon name="volume_up" size={19} />
            <div style={{ width: 90, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.3)' }} />
            <div style={{ flex: 1 }} />
            <Icon name="settings" size={18} />
            <Icon name="picture_in_picture_alt" size={18} />
            <Icon name="fullscreen" size={20} />
          </div>
          <TipAlertOverlay lastTip={d.lastTip} anchor="top" />
          <SubAlertOverlay lastSub={d.lastSub} anchor="top" />
        </div>

        {/* Channel bar */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ position: 'relative', flexShrink: 0, padding: 2, borderRadius: '50%', background: `linear-gradient(135deg, ${T.violet}, ${T.violetL})` }}>
                <UserAvatar src={host?.avatar} size={48} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 17, fontWeight: 800 }}>{host?.displayName || 'Host'}</span>
                  {host?.isVerified && <Icon name="verified" size={15} filled style={{ color: T.violetL }} />}
                </div>
                <div style={{ fontSize: 12, color: T.dim }}>Click name to open profile</div>
              </div>
            </button>
            <div style={{ flex: 1 }} />
            {/* Twitch-style actions (founder: keep Follow on desktop). */}
            <button type="button" style={pillBtn(T.violet)}><Icon name="favorite" size={15} filled /> Follow</button>
            <button type="button" style={pillBtn(T.panel2)}><img src={cheerGem} alt="" style={{ width: 16, height: 16 }} /> Gift a Sub</button>
            <button type="button" style={pillBtn(T.panel2)}><Icon name="star" size={15} filled style={{ color: T.gold }} /> Subscribe</button>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{d.title || 'LIVE stream'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: T.violetL, fontWeight: 700 }}>{d.game || 'Counter-Strike'}</span>
            <span style={{ ...tag }}>English</span>
            <div style={{ flex: 1 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: T.red, fontWeight: 700 }}><Icon name="person" size={15} filled /> {(d.viewerCount || 0).toLocaleString()}</span>
            <span style={{ fontSize: 13, color: T.dim }}>8:27:44</span>
            <Icon name="ios_share" size={17} style={{ color: T.dim }} />
            <Icon name="more_vert" size={17} style={{ color: T.dim }} />
          </div>
        </div>

        {/* About card */}
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>About {host?.displayName || 'Host'}</span>
            {host?.isVerified && <Icon name="verified" size={14} filled style={{ color: T.violetL }} />}
          </div>
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{compactNum(d.followers || 6500000)} followers</div>
            <div style={{ fontSize: 13, color: T.dim }}>Home of everything Counter-Strike</div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: STREAM CHAT ───────────────────────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, background: T.panel, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* header */}
        <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: `1px solid ${T.border}` }}>
          <Icon name="chevron_right" size={20} style={{ color: T.dim, cursor: 'pointer' }} />
          <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.06em' }}>STREAM CHAT</div>
          <Icon name="group" size={19} style={{ color: T.dim, cursor: 'pointer' }} />
        </div>

        {/* top gifters strip */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${T.border}`, overflow: 'hidden' }}>
          {(d.previewGifters || []).slice(0, 3).map((g, i) => (
            <span key={g.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: T.panel2, fontSize: 11.5, fontWeight: 700 }}>
              {i === 0 ? <Icon name="emoji_events" size={13} style={{ color: T.gold }} /> : <img src={cheerGem} alt="" style={{ width: 13, height: 13 }} />}
              <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.displayName}</span>
              <span style={{ color: T.gold }}>{compactNum(g.coins)}</span>
            </span>
          ))}
        </div>

        {/* messages */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 9, padding: '10px 12px', fontSize: 13, lineHeight: 1.4 }}>
          {FEED.map((m, i) => (
            <div key={i}>
              {m.reply && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.muted, marginBottom: 1 }}><Icon name="reply" size={12} /> Replying to {m.reply}</div>}
              <span style={{ fontSize: 11, color: T.muted, marginRight: 6 }}>{m.t}</span>
              {m.badge === 'mod' && <Icon name="build" size={13} filled style={{ color: T.green, verticalAlign: '-2px', marginRight: 3 }} />}
              {m.badge === 'sub' && <Icon name="star" size={13} filled style={{ color: T.violetL, verticalAlign: '-2px', marginRight: 3 }} />}
              {m.badge === 'vp' && <img src={vpCrystal} alt="" style={{ width: 14, height: 14, verticalAlign: '-3px', marginRight: 3 }} />}
              <span style={{ fontWeight: 800, color: NAME_COLORS[m.c % NAME_COLORS.length] }}>{m.u}</span>
              <span style={{ color: T.muted }}>: </span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>

        {/* ── footer (the 7 icons) ──────────────────────────────────────── */}
        <div style={{ flexShrink: 0, padding: 12, borderTop: `1px solid ${T.border}`, position: 'relative' }}>
          {panel && <FooterPanel which={panel} verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly} onClose={() => setPanel(null)} />}

          {/* Account-verification gate banner (image5) */}
          {verifiedOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: T.panel2, fontSize: 12, color: T.dim, marginBottom: 8 }}>
              <Icon name="verified_user" size={15} style={{ color: T.dim }} /> Verified Accounts Only Chat
            </div>
          )}

          {/* input row: identity (left) · placeholder · emote + cheer (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: T.input, border: `1px solid ${T.border}` }}>
            <button type="button" onClick={() => togglePanel('identity')} title="Identity selector" style={iconBtn}><Icon name="badge" size={18} style={{ color: panel === 'identity' ? T.violetL : T.dim }} /></button>
            <span style={{ flex: 1, fontSize: 13, color: T.muted }}>Send a message</span>
            <button type="button" onClick={() => togglePanel('emote')} title="Emotes & Stickers" style={iconBtn}><Icon name="mood" size={18} style={{ color: panel === 'emote' ? T.violetL : T.dim }} /></button>
            <button type="button" onClick={() => togglePanel('cheer')} title="Cheer / Premium gift" style={iconBtn}><img src={cheerGem} alt="" style={{ width: 19, height: 19 }} /></button>
          </div>

          {/* bottom row: VP balance (left) · mod / settings / Chat (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span title="VP Rewards" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 800, color: T.text }}>
              <img src={vpCrystal} alt="" style={{ width: 20, height: 20 }} /> {compactNum(d.viewerVp || 0)}
            </span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => togglePanel('mod')} title="Moderation actions" style={iconBtn}><Icon name="gavel" size={18} style={{ color: panel === 'mod' ? T.violetL : T.dim }} /></button>
            <button type="button" onClick={() => togglePanel('settings')} title="Chat settings" style={iconBtn}><Icon name="settings" size={18} style={{ color: panel === 'settings' ? T.violetL : T.dim }} /></button>
            <button type="button" style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#fff', background: T.violet }}>Chat</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pop-up panel above the footer for each control (mock content).
function FooterPanel({ which, verifiedOnly, setVerifiedOnly, onClose }) {
  const wrap = { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 8, background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: 12, zIndex: 10 };
  const head = (label) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
      <div style={{ flex: 1 }} />
      <Icon name="close" size={16} style={{ color: T.dim, cursor: 'pointer' }} onClick={onClose} />
    </div>
  );

  if (which === 'identity') {
    const items = [['VP Rank — Diamond', true], ['Subscriber', false], ['Verified', false]];
    return (
      <div style={wrap}>{head('Chat identity')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(([l, on]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: T.input, fontSize: 12.5 }}>
              <Icon name={on ? 'radio_button_checked' : 'radio_button_unchecked'} size={16} style={{ color: on ? T.violetL : T.muted }} />{l}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (which === 'emote') {
    return (
      <div style={wrap}>{head('Emotes & Stickers')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
          {['😀','😂','🔥','💜','👀','🎮','🏆','😎','💀','🥳','👑','⚡','🙌','💎','❤️','😭'].map((e, i) => <span key={i} style={{ fontSize: 18, textAlign: 'center', cursor: 'pointer' }}>{e}</span>)}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>Custom animated emotes — coming soon</div>
      </div>
    );
  }
  if (which === 'cheer') {
    return (
      <div style={wrap}>{head('Cheer with VP')}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[50, 100, 500, 1000].map((n) => (
            <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999, background: T.input, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              <img src={cheerGem} alt="" style={{ width: 16, height: 16 }} /> {n}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>Premium animated gifts — price tiers pending</div>
      </div>
    );
  }
  if (which === 'mod') {
    const acts = [['Slow mode', 'timer'], ['Followers-only', 'group'], ['Subscribers-only', 'star'], ['Timeout / ban a user', 'gavel'], ['Clear chat', 'delete_sweep']];
    return (
      <div style={wrap}>{head('Moderation actions')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {acts.map(([l, ic]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer' }}><Icon name={ic} size={16} style={{ color: T.dim }} />{l}</div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>Broadcaster / moderator only</div>
      </div>
    );
  }
  // settings
  const toggles = [['Verified accounts only', verifiedOnly, () => setVerifiedOnly((v) => !v)], ['Show timestamps', true, null], ['Readable chat colours', true, null]];
  return (
    <div style={wrap}>{head('Chat settings')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {toggles.map(([l, on, fn]) => (
          <div key={l} onClick={fn || undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: fn ? 'pointer' : 'default' }}>
            <span style={{ flex: 1 }}>{l}</span>
            <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? T.violet : T.muted, position: 'relative', flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const badge = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 800 };
const tag = { padding: '3px 9px', borderRadius: 999, background: T.panel2, color: T.dim, fontSize: 12, fontWeight: 600 };
const iconBtn = { background: 'none', border: 'none', padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 };
const pillBtn = (bg) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#fff', background: bg });
