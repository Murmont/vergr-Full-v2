// GR8 — StreamerBattleOverlay: OBS browser-source overlay for a two-streamer
// "battle" (multi-guest co-stream), reusing the TournamentOverlayNeon visual
// language (same OVERLAY_CSS, top rail + lower-third + tug-of-war bar) but
// driven by stream/co-host data instead of tournament/match.
//
// URL: https://vergr.app/#/overlay/battle/<streamId>/neon
// Subscribes to:
//   - streams/{streamId}                       (host side)
//   - streams/{linkedStreamIds[0]} (if any)    (opponent side)
//   - users/{hostUid} for each side            (avatar, tag, country)
// Battle meter = each side's tip total (falls back to viewer count, then 50/50).

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser } from '../../firebase/firestore';
import { OVERLAY_CSS } from './TournamentOverlayNeon';

function tagFor(u) { return u?.tag || (u?.username || u?.displayName || '').slice(0, 4).toUpperCase(); }

export default function StreamerBattleOverlay() {
  const { streamId } = useParams();
  const overlayRef = useRef(null);
  const [host, setHost] = useState(null);     // host stream doc
  const [oppStream, setOppStream] = useState(null); // opponent stream doc
  const [hostUser, setHostUser] = useState(null);
  const [oppUser, setOppUser] = useState(null);

  // Inject CSS + transparent body (same as the tournament overlay).
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    document.head.appendChild(styleEl);
    document.documentElement.classList.add('tneon-host');
    document.body.classList.add('tneon-host');
    return () => {
      styleEl.remove();
      document.documentElement.classList.remove('tneon-host');
      document.body.classList.remove('tneon-host');
    };
  }, []);

  useEffect(() => {
    const fit = () => {
      const el = overlayRef.current;
      if (!el) return;
      el.style.setProperty('--fit', Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Host stream.
  useEffect(() => {
    if (!streamId) return undefined;
    return onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setHost(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [streamId]);

  // Opponent stream — first linked stream (TikTok-style multi-guest link).
  const oppStreamId = host?.linkedStreamIds?.[0] || null;
  useEffect(() => {
    if (!oppStreamId) { setOppStream(null); return undefined; }
    return onSnapshot(doc(db, 'streams', oppStreamId), (snap) => {
      setOppStream(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [oppStreamId]);

  // Resolve host users for each side.
  useEffect(() => {
    if (!host?.hostUid) { setHostUser(null); return; }
    let c = false;
    getUser(host.hostUid).then((u) => { if (!c) setHostUser(u); }).catch(() => {});
    return () => { c = true; };
  }, [host?.hostUid]);
  useEffect(() => {
    const ouid = oppStream?.hostUid || host?.coHostUids?.[0];
    if (!ouid) { setOppUser(null); return; }
    let c = false;
    getUser(ouid).then((u) => { if (!c) setOppUser(u); }).catch(() => {});
    return () => { c = true; };
  }, [oppStream?.hostUid, host?.coHostUids]);

  if (!host) {
    return <div className="tneon"><div className="stage" /></div>;
  }

  // Battle meter: tip totals → viewer counts → 50/50.
  const sideVal = (s) => s?.tipTotal ?? s?.totalTips ?? s?.goal?.currentCoins ?? null;
  let a = sideVal(host);
  let b = sideVal(oppStream);
  let unit = 'c';
  if (a == null && b == null) { a = host?.viewerCount || 0; b = oppStream?.viewerCount || 0; unit = ''; }
  a = a || 0; b = b || 0;
  const total = a + b;
  const pctA = total > 0 ? Math.round((a / total) * 100) : 50;

  const hu = hostUser || { username: host?.hostName, avatar: host?.hostAvatar };
  const ou = oppUser || { username: oppStream?.hostName };

  return (
    <div className="tneon">
      <div className="stage">
        <div className="overlay" ref={overlayRef}>
          {/* TOP RAIL */}
          <div className="top-rail">
            <div className="t-tag">
              <div className="live-pip"><span className="pip-dot" /><span className="label">LIVE</span></div>
              <div className="meta">
                <span className="game">{host?.game || 'STREAMER BATTLE'}</span>
                <span className="name">{host?.title || 'Battle'}</span>
              </div>
            </div>
            <div className="t-status">
              <div className="round-card">
                <span className="kicker">MODE</span>
                <span className="round">Battle</span>
              </div>
            </div>
          </div>

          {/* LOWER THIRD — two streamer cells */}
          <div className="lower-third">
            <BattleCell user={hu} side="left" count={host?.viewerCount} />
            <div className="series">
              <span className="series-format">VS</span>
              <div className="series-score">
                <span className="a">{pctA}</span>
                <span className="sep">—</span>
                <span className="b">{100 - pctA}</span>
              </div>
            </div>
            <BattleCell user={ou} side="right" count={oppStream?.viewerCount} />
          </div>

          {/* TUG-OF-WAR BATTLE BAR (reuses picks-bar styling) */}
          <div className={`picks-bar ${total === 0 ? 'empty' : ''}`}>
            <span className="picks-kicker">Battle</span>
            <div className="picks-row">
              <span className="picks-side a"><span className="picks-amount">{a.toLocaleString()}</span>{unit && <span className="picks-unit">{unit}</span>}</span>
              <div className="picks-track">
                <div className="picks-fill-a" style={{ width: `${pctA}%` }} />
                <div className="picks-fill-b" style={{ width: `${100 - pctA}%` }} />
                <div className="picks-pivot" style={{ left: `${pctA}%` }} />
              </div>
              <span className="picks-side b"><span className="picks-amount">{b.toLocaleString()}</span>{unit && <span className="picks-unit">{unit}</span>}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BattleCell({ user, side }) {
  const username = user?.username || user?.displayName || '…';
  const avatarUrl = user?.avatar;
  return (
    <div className={`player ${side}`}>
      <div className="player-wash" />
      <div className={`avatar-wrap ${!avatarUrl ? 'fallback' : ''}`}>
        {avatarUrl ? <img alt="" src={avatarUrl} /> : (username || '?').slice(0, 1).toUpperCase()}
      </div>
      <div className="player-info">
        <div className="player-meta"><span className="tag">{tagFor(user)}</span></div>
        <div className="player-name">{username}</div>
      </div>
    </div>
  );
}
