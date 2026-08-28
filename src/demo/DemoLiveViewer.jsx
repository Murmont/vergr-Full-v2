/**
 * DEMO-ONLY live-stream viewer, POPULATED + ANIMATED so it can be screenshotted
 * (or screen-recorded) for the app stores. Uses the founder's canonical designs:
 *   - mobile  → the Solo Stream immersive layout (PreviewViewerScreen mobile)
 *   - desktop → the Twitch-style layout (PreviewDesktopViewer)
 * with a real PLAYING video in the stream container, live-appending chat, and
 * floating hearts (nothing looks static).
 *
 * In demo builds the vite resolver aliases ViewerStreamScreen +
 * NativeViewerStreamScreen to this so /watch/:id renders it.
 *
 * Drop real gameplay in by swapping STREAM_VIDEO below.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useResponsive from '../hooks/useResponsive';
import Icon from '../components/Icon';
import UserAvatar from '../components/UserAvatar';
import { StreamGoalBar } from '../components/streams/StreamGoalAndAlerts';
import watchingIcon from '../assets/stream/watching.webp';
import waveIcon from '../assets/stream/wave.webp';
import inviteIcon from '../assets/stream/invite.webp';
import vcCoinIcon from '../assets/stream/vc-coin.webp';
import giftboxIcon from '../assets/stream/giftbox.webp';
import sendIcon from '../assets/stream/send.webp';
import likeIcon from '../assets/stream/like.webp';
import modBadgeIcon from '../assets/stream/mod-badge.webp';
import cohostBg from '../assets/stream/cohost-bg.jpg';
import UserName from '../components/UserName';

// Reliable, CORS-enabled, autoplay-muted-friendly sample (cinematic CG). Swap
// this one URL for a real gameplay clip and everything else stays the same.
const STREAM_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4';

const glass = { background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(16px) saturate(140%)', WebkitBackdropFilter: 'blur(16px) saturate(140%)', border: '1px solid rgba(255,255,255,0.18)' };
const glassDark = { background: 'rgba(10,8,22,0.42)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', border: '1px solid rgba(255,255,255,0.12)' };
const C = { purple: '#7c3aed', purpleLight: '#b44fff', text: '#e8e8f0', textMuted: '#6b7280' };
const T = { bg: '#0e0e16', panel: '#16161f', panel2: '#1d1d28', input: '#0c0c14', border: 'rgba(255,255,255,0.08)', text: '#efeff1', dim: '#adadb8', muted: '#7a7a85', gold: '#F5C842', green: '#22c55e', red: '#ef4444' };
const NAME_COLORS = ['#FF7AA2', '#7CE3FF', '#9D7CFF', '#7CFF9D', '#FFC857', '#FF9D7C', '#7C9DFF', '#FF7CE3'];
const av = (u) => `https://i.pravatar.cc/300?u=${u}`;
const compactNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));

const STREAMS = {
  live_nova: {
    host: { displayName: 'Nova Strike', username: 'novastrike', avatar: av('novastrike'), isVerified: true },
    hearts: 20400, viewerCount: 1284, game: 'Valorant', title: 'RADIANT grind → road to #1 leaderboard', followers: 48200,
    goal: { active: true, targetCoins: 5000, currentCoins: 3120, reason: 'New headset' },
    gifters: [{ uid: 'g1', name: 'kaizen', coins: 4200 }, { uid: 'g2', name: 'sova_main', coins: 2600 }, { uid: 'g3', name: 'rook', coins: 1500 }],
    watcher: 'tenzfan',
    pool: [
      { u: 'kaizen', t: 'LETS GOOO that was clean 🔥', sub: true }, { u: 'lunaplays', t: 'the aim is actually unreal today 💜' },
      { u: 'ghostlyy', t: 'that flick 💀💀' }, { u: 'miragg', t: 'keep chat civil pls 🙏 gg', mod: true },
      { u: 'sova_main', t: 'RADIANT gameplay 🐐 insta follow', sub: true }, { u: 'rook', t: 'how is he hitting these' },
      { u: 'zeke', t: 'W stream, dropping a follow' }, { u: 'pixel', t: 'what sens do you run?' },
      { u: 'brie', t: 'this is so entertaining lol' }, { u: 'vex', t: 'clutch or kick 😤' },
      { u: 'tenzfan', t: 'first time here, subbed 💜', sub: true }, { u: 'dexterous', t: 'the movement diff is crazy' },
    ],
  },
  live_dex: {
    host: { displayName: 'Dex', username: 'dexterous', avatar: av('dexterous'), isVerified: true },
    hearts: 8800, viewerCount: 642, game: 'Minecraft', title: 'speedrun marathon (any%) — WR attempts', followers: 41200,
    goal: { active: true, targetCoins: 10000, currentCoins: 6400, reason: 'WR celebration' },
    gifters: [{ uid: 'g1', name: 'pixel', coins: 3800 }, { uid: 'g2', name: 'brie', coins: 2100 }, { uid: 'g3', name: 'ten', coins: 900 }],
    watcher: 'brie',
    pool: [
      { u: 'pixel', t: 'sub 20 pace?? 👀', sub: true }, { u: 'brie', t: 'this run is going crazy' },
      { u: 'novastrike', t: 'W speedrun' }, { u: 'ghostlyy', t: 'clip that split', mod: true },
      { u: 'tenzfan', t: 'first time catching you live, ez sub', sub: true }, { u: 'vex', t: 'no way that worked' },
      { u: 'kaizen', t: 'the routing is insane' }, { u: 'mira', t: 'gogogo' },
    ],
  },
  live_vex: {
    host: { displayName: 'Vex', username: 'vex', avatar: av('vex'), isVerified: true },
    hearts: 31200, viewerCount: 2210, game: 'Apex Legends', title: 'ranked to Pred — grinding with the squad', followers: 33400,
    goal: { active: true, targetCoins: 8000, currentCoins: 5200, reason: 'New GPU' },
    gifters: [{ uid: 'g1', name: 'zeke', coins: 5200 }, { uid: 'g2', name: 'mira', coins: 3100 }, { uid: 'g3', name: 'kaizen', coins: 2400 }],
    watcher: 'sova_main',
    pool: [
      { u: 'zeke', t: 'pred lobbies are unfair rn 😭', sub: true }, { u: 'miragg', t: 'that 1v3 was filthy' },
      { u: 'rook', t: 'how is he this cracked' }, { u: 'kaizen', t: 'keep it clean chat 🙏', mod: true },
      { u: 'lunaplays', t: 'the movement 🐐', sub: true }, { u: 'ghostlyy', t: 'W' },
      { u: 'pixel', t: 'gg that was a dub' }, { u: 'tenzfan', t: 'followed 🔥' },
    ],
  },
};

// ── Live-appending chat feed (grows over time so it never looks static). ──
function useLiveChat(pool, { start = 6, cap = 7, ms = 2400 } = {}) {
  const [msgs, setMsgs] = useState(() => pool.slice(0, start).map((m, i) => ({ ...m, key: `s${i}` })));
  const iRef = useRef(start);
  useEffect(() => {
    const id = setInterval(() => {
      setMsgs((prev) => [...prev, { ...pool[iRef.current % pool.length], key: `k${iRef.current++}` }].slice(-cap));
    }, ms);
    return () => clearInterval(id);
  }, [pool]);
  return msgs;
}

// ── Floating hearts (TikTok-style), spawned on a timer. ──
function FloatingHearts() {
  const [hearts, setHearts] = useState([]);
  useEffect(() => {
    const id = setInterval(() => {
      const key = Math.random();
      setHearts((h) => [...h, { key, dx: Math.random() * 26 - 6, dur: 1.4 + Math.random() * 0.7 }]);
      setTimeout(() => setHearts((h) => h.filter((z) => z.key !== key)), 2200);
    }, 650);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ position: 'absolute', right: 6, bottom: 60, width: 60, height: 220, pointerEvents: 'none', zIndex: 25 }}>
      {hearts.map((h) => (
        <span key={h.key} style={{ position: 'absolute', bottom: 0, right: 10 + h.dx, animation: `demoHeart ${h.dur}s ease-out forwards` }}>
          <Icon name="favorite" size={22} filled style={{ color: h.key > 0.5 ? '#ff3b5c' : '#b44fff' }} />
        </span>
      ))}
    </div>
  );
}

const KEYFRAMES = `@keyframes demoHeart{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1}100%{transform:translateY(-190px) scale(1.2) rotate(12deg);opacity:0}}
@keyframes demoIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`;

function LiveVideo({ radius = 0 }) {
  const ref = useRef(null);
  useEffect(() => { const v = ref.current; if (v) { v.muted = true; v.play?.().catch(() => {}); } }, []);
  return (
    <video ref={ref} src={STREAM_VIDEO} poster={cohostBg} autoPlay muted loop playsInline
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: radius, background: `#000 url(${cohostBg}) center/cover` }} />
  );
}

function GiftersCluster({ gifters }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {gifters.slice(0, 3).map((g, i) => (
        <span key={g.uid} style={{ marginLeft: i ? -7 : 0, display: 'inline-flex', borderRadius: '50%', border: `2px solid ${i === 0 ? '#F5C842' : 'rgba(10,8,22,0.6)'}`, zIndex: 3 - i }}>
          <UserAvatar src={av(g.name)} size={24} />
        </span>
      ))}
    </div>
  );
}
function ModBadge() { return <img src={modBadgeIcon} alt="moderator" style={{ height: 15, objectFit: 'contain', verticalAlign: '-3px' }} />; }
function SubPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', padding: '1px 5px 1px 3px', borderRadius: 6, fontSize: 8.5, fontWeight: 900, color: '#fff', background: 'linear-gradient(135deg,#7c3aed,#b44fff)' }}>
      <Icon name="star" size={9} filled style={{ color: '#F5C842' }} />SUB
    </span>
  );
}
function DockGlassBtn({ src, alt }) {
  return (
    <button title={alt} style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, padding: 0, overflow: 'hidden', cursor: 'pointer', ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} alt={alt} style={{ width: 28, height: 28, objectFit: 'contain' }} />
    </button>
  );
}

// ─────────────────────────── MOBILE (immersive) ───────────────────────────
function MobileViewer({ s }) {
  const chat = useLiveChat(s.pool);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
      <style>{KEYFRAMES}</style>
      <LiveVideo />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.25), transparent 22%, transparent 55%, rgba(0,0,0,0.55))' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 10, display: 'flex', alignItems: 'flex-start', gap: 8, zIndex: 5 }}>
        <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 5px', borderRadius: 22, minWidth: 0, cursor: 'pointer', textAlign: 'left', ...glass }}>
          <UserAvatar src={s.host.avatar} size={38} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><UserName user={s.host} masked /></span>
              <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: `linear-gradient(135deg,${C.purple},${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={10} /></span>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>{compactNum(s.hearts)} Likes</span>
          </div>
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <GiftersCluster gifters={s.gifters} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, ...glassDark }}><Icon name="visibility" size={14} />{compactNum(s.viewerCount)}</span>
          <button style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(10,8,22,0.4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="close" size={17} /></button>
        </div>
      </div>

      {s.goal?.active && <div style={{ position: 'absolute', top: 64, left: 10, right: 10, zIndex: 4 }}><StreamGoalBar goal={s.goal} compact /></div>}

      <FloatingHearts />

      {/* Bottom: chat + started-watching + composer */}
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 6 }}>
        <button style={{ position: 'absolute', right: 0, bottom: 58, zIndex: 20, width: 42, height: 42, borderRadius: '50%', cursor: 'pointer', padding: 0, overflow: 'hidden', ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={likeIcon} alt="like" style={{ width: 26, height: 26, objectFit: 'contain' }} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 26, maxHeight: 220, overflow: 'hidden', textShadow: '0 1px 3px rgba(0,0,0,0.85)', maskImage: 'linear-gradient(to top,#000 0%,#000 60%,transparent 96%)', WebkitMaskImage: 'linear-gradient(to top,#000 0%,#000 60%,transparent 96%)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
            <img src={waveIcon} alt="" aria-hidden style={{ width: 22, height: 22, objectFit: 'contain' }} /><span><b style={{ fontWeight: 800 }}>{s.watcher}</b> joined via share invitation</span>
          </div>
          {chat.map((m) => (
            <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', animation: 'demoIn .25s ease' }}>
              <span style={{ flexShrink: 0 }}><UserAvatar src={av(m.u)} size="xs" /></span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
                {m.mod && <span style={{ marginRight: 4 }}><ModBadge /></span>}
                {m.sub && <span style={{ marginRight: 5 }}><SubPill /></span>}
                <span style={{ fontWeight: 800, color: '#fff', marginRight: 6 }}>{m.u}</span>
                <span style={{ color: 'rgba(255,255,255,0.94)', wordBreak: 'break-word' }}>{m.t}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.85)', width: 'fit-content', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
          <img src={watchingIcon} alt="" aria-hidden style={{ width: 18, height: 18, objectFit: 'contain' }} /><span>{s.watcher} started watching</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, fontSize: 13, color: C.textMuted, ...glassDark }}>Add a comment…</div>
          <DockGlassBtn src={inviteIcon} alt="Invite" /><DockGlassBtn src={vcCoinIcon} alt="Tips & VC" /><DockGlassBtn src={giftboxIcon} alt="Gift Box" /><DockGlassBtn src={sendIcon} alt="Share" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── DESKTOP (Twitch-style) ───────────────────────
const badge = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 800 };
const tag = { padding: '3px 9px', borderRadius: 999, background: T.panel2, color: T.dim, fontSize: 12, fontWeight: 600 };
const pillBtn = (bg) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#fff', background: bg });

function DesktopViewer({ s }) {
  const chat = useLiveChat(s.pool, { start: 7, cap: 12, ms: 2000 });
  const cRef = useRef(null);
  useEffect(() => { const el = cRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: T.bg, color: T.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex' }}>
      <style>{KEYFRAMES}</style>
      {/* LEFT */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', flexShrink: 0 }}>
          <LiveVideo />
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}><span style={{ ...badge, background: T.red }}>● LIVE</span><span style={badge}>1080p60</span></div>
          {s.goal?.active && <div style={{ position: 'absolute', left: 12, right: 12, bottom: 54, zIndex: 3 }}><StreamGoalBar goal={s.goal} compact /></div>}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 14px 10px', background: 'linear-gradient(0deg, rgba(0,0,0,0.75), transparent)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Icon name="play_arrow" size={20} filled /><Icon name="volume_up" size={19} /><div style={{ width: 90, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.3)' }} /><div style={{ flex: 1 }} /><Icon name="settings" size={18} /><Icon name="picture_in_picture_alt" size={18} /><Icon name="fullscreen" size={20} />
          </div>
        </div>
        {/* Channel bar */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 2, borderRadius: '50%', background: `linear-gradient(135deg,${C.purple},${C.purpleLight})` }}><UserAvatar src={s.host.avatar} size={48} /></div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 17, fontWeight: 800 }}><UserName user={s.host} masked /></span><Icon name="verified" size={15} filled style={{ color: C.purpleLight }} /></div>
                <div style={{ fontSize: 12, color: T.dim }}>{compactNum(s.followers)} followers</div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <button style={pillBtn(C.purple)}><Icon name="favorite" size={15} filled /> Follow</button>
            <button style={pillBtn(T.panel2)}><Icon name="card_giftcard" size={15} /> Gift a Sub</button>
            <button style={pillBtn(T.panel2)}><Icon name="star" size={15} filled style={{ color: T.gold }} /> Subscribe</button>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{s.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: C.purpleLight, fontWeight: 700 }}>{s.game}</span><span style={tag}>English</span><div style={{ flex: 1 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: T.red, fontWeight: 700 }}><Icon name="person" size={15} filled /> {s.viewerCount.toLocaleString()}</span>
            <span style={{ fontSize: 13, color: T.dim }}>1:42:08</span><Icon name="ios_share" size={17} style={{ color: T.dim }} />
          </div>
        </div>
      </div>
      {/* RIGHT: chat */}
      <div style={{ width: 340, flexShrink: 0, background: T.panel, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: `1px solid ${T.border}` }}><div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.06em' }}>STREAM CHAT</div><Icon name="group" size={19} style={{ color: T.dim }} /></div>
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${T.border}`, overflow: 'hidden' }}>
          {s.gifters.map((g, i) => (
            <span key={g.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: T.panel2, fontSize: 11.5, fontWeight: 700 }}>
              {i === 0 ? <Icon name="emoji_events" size={13} style={{ color: T.gold }} /> : <img src={vcCoinIcon} alt="" style={{ width: 13, height: 13 }} />}<span>{g.name}</span><span style={{ color: T.gold }}>{compactNum(g.coins)}</span>
            </span>
          ))}
        </div>
        <div ref={cRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 9, padding: '10px 12px', fontSize: 13, lineHeight: 1.4 }}>
          {chat.map((m, i) => (
            <div key={m.key} style={{ animation: 'demoIn .25s ease' }}>
              <span style={{ fontSize: 11, color: T.muted, marginRight: 6 }}>{String(1 + (i % 6)).padStart(2, '0')}:0{i % 6}</span>
              {m.mod && <Icon name="build" size={13} filled style={{ color: T.green, verticalAlign: '-2px', marginRight: 3 }} />}
              {m.sub && <Icon name="star" size={13} filled style={{ color: C.purpleLight, verticalAlign: '-2px', marginRight: 3 }} />}
              <span style={{ fontWeight: 800, color: NAME_COLORS[m.u.length % NAME_COLORS.length] }}>{m.u}</span><span style={{ color: T.muted }}>: </span><span>{m.t}</span>
            </div>
          ))}
        </div>
        <div style={{ flexShrink: 0, padding: 12, borderTop: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: T.input, border: `1px solid ${T.border}` }}>
            <Icon name="badge" size={18} style={{ color: T.dim }} /><span style={{ flex: 1, fontSize: 13, color: T.muted }}>Send a message</span><Icon name="mood" size={18} style={{ color: T.dim }} /><img src={vcCoinIcon} alt="" style={{ width: 19, height: 19 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 800 }}><img src={vcCoinIcon} alt="" style={{ width: 20, height: 20 }} /> 24.5K</span><div style={{ flex: 1 }} /><Icon name="gavel" size={18} style={{ color: T.dim }} /><Icon name="settings" size={18} style={{ color: T.dim }} /><button style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#fff', background: C.purple }}>Chat</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DemoLiveViewer() {
  const { streamId } = useParams();
  const s = STREAMS[streamId] || STREAMS.live_nova;
  const { isDesktop } = useResponsive();
  return isDesktop ? <DesktopViewer s={s} /> : <MobileViewer s={s} />;
}
