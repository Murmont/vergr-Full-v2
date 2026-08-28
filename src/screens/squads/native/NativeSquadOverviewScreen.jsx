// Native Squad Overview — /squads/:squadId on the APK. Single-column hub:
// hero, quick actions, recent activity, pinned, upcoming events, challenges.
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { getSquad, getSquadMembers, getSquadAnnouncements, getSquadEvents, getSquadChallenges } from '../../../firebase/firestore';
import { roleMeta, avatarClass, initials, nameOf, compact } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const ago = (t) => {
  const ms = Date.now() - tsMs(t);
  if (ms < 6e4) return 'just now';
  if (ms < 36e5) return `${Math.floor(ms / 6e4)}m ago`;
  if (ms < 864e5) return `${Math.floor(ms / 36e5)}h ago`;
  return `${Math.floor(ms / 864e5)}d ago`;
};

export default function NativeSquadOverviewScreen() {
  const { squadId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [events, setEvents] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!squadId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, m, a, ev, ch] = await Promise.all([
          getSquad(squadId), getSquadMembers(squadId), getSquadAnnouncements(squadId, 8),
          getSquadEvents(squadId, 10).catch(() => []), getSquadChallenges(squadId, 10).catch(() => []),
        ]);
        if (!alive) return;
        setSquad(s); setMembers(m); setAnnouncements(a); setEvents(ev); setChallenges(ch);
      } catch (e) { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [squadId]);

  const myRole = members.find((m) => m.id === currentUser?.uid)?.role;
  const myMeta = roleMeta(myRole);
  const memberCount = squad?.memberCount ?? members.length;
  const level = squad?.level || 1;
  const xp = squad?.xp || 0;
  const xpNext = squad?.xpNext || level * 500;
  const xpPct = Math.min(100, Math.round((xp / xpNext) * 100));
  const authorOf = (uid) => members.find((m) => m.id === uid)?.user;
  const pinned = announcements.find((a) => a.pinned);
  const splitTitle = (content) => {
    const i = (content || '').indexOf('\n');
    return i === -1 ? { title: '', body: content || '' } : { title: content.slice(0, i), body: content.slice(i + 1).trim() };
  };
  const now = Date.now();
  const upcoming = events.filter((e) => { const start = tsMs(e.startAt); const end = tsMs(e.endAt); return end ? end >= now : (start && start >= now - 4 * 3600 * 1000); }).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)).slice(0, 3);
  const activeCh = challenges.filter((c) => c.status !== 'completed' && !(c.deadline && tsMs(c.deadline) < Date.now())).slice(0, 3);

  return (
    <NativeSquadScaffold mode="squad" title={squad?.name || 'Overview'} activeId="overview" squadId={squadId} squadName={squad?.name}>
      <div className="content" style={{ padding: 0 }}>
        {loading ? (
          <div className="dim center" style={{ padding: 48 }}>Loading…</div>
        ) : (
          <>
            <div className="hero" style={squad?.banner ? { background: `linear-gradient(180deg, rgba(11,11,20,0) 0%, rgba(11,11,20,.55) 70%, rgba(11,11,20,.85) 100%), url(${squad.banner}) center/cover` } : undefined}>
              <div className="hero-row">
                <div className="hero-av">{squad?.avatar ? <img src={squad.avatar} alt="" /> : initials(squad?.name)}</div>
                <div className="hero-meta">
                  <div className="hero-name">{squad?.name || 'Squad'}{squad?.verified && <span className="material-symbols-outlined verified-tick">verified</span>}</div>
                  <div className="hero-tags">
                    <span>{squad?.game || 'Gaming'}</span><span className="pip" />
                    <span style={{ color: squad?.isPublic === false ? 'var(--violet-light)' : 'var(--cyan)' }}>{squad?.isPublic === false ? 'Private' : 'Public'}</span><span className="pip" />
                    <span>{memberCount} members</span>
                    {myMeta && myRole && (<span className={`role-pill ${myMeta.pill} role`}>{myMeta.icon && <span className="material-symbols-outlined">{myMeta.icon}</span>}You're the {myMeta.label}</span>)}
                  </div>
                  <div className="hero-actions">
                    <button className="btn primary" onClick={() => navigate(`/squads/${squadId}/chat`)}><span className="material-symbols-outlined">chat</span>Chat</button>
                    <button className="btn ghost" onClick={() => navigate(`/squads/${squadId}/members`)}><span className="material-symbols-outlined">group</span>Members</button>
                    <button className="btn ghost" onClick={() => navigate(`/squads/${squadId}/settings`)}><span className="material-symbols-outlined">settings</span>Settings</button>
                  </div>
                </div>
                <div className="hero-stats">
                  <div className="hero-level"><span className="pill">LEVEL {level}</span></div>
                  <div className="hero-xp">
                    <div className="row"><span>{compact(xp)} XP</span><span style={{ color: 'var(--violet-light)' }}>{xpPct}%</span><span>{compact(xpNext)} XP</span></div>
                    <div className="bar"><div style={{ width: `${xpPct}%` }} /></div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="qa-grid">
                <button className="qa chat" onClick={() => navigate(`/squads/${squadId}/chat`)}><div className="ic"><span className="material-symbols-outlined">chat</span></div><div><div className="t">Open Chat</div><div className="s">Squad messages</div></div></button>
                <button className="qa voice" onClick={() => navigate(`/squads/${squadId}/stream`)}><div className="ic"><span className="material-symbols-outlined">mic</span></div><div><div className="t">Voice Hangout</div><div className="s">Drop into voice now</div></div></button>
                <button className="qa events" onClick={() => navigate(`/squads/${squadId}/events`)}><div className="ic"><span className="material-symbols-outlined">event</span></div><div><div className="t">Events</div><div className="s">Scrims & events</div></div></button>
                <button className="qa lb" onClick={() => navigate(`/squads/${squadId}/leaderboard`)}><div className="ic"><span className="material-symbols-outlined">leaderboard</span></div><div><div className="t">Leaderboard</div><div className="s">VP rankings</div></div></button>
              </div>

              {/* Recent activity */}
              <div className="card">
                <div className="card-h"><div className="t">Recent Activity</div><button className="a" onClick={() => navigate(`/squads/${squadId}/announcements`)}>View all</button></div>
                {announcements.length === 0 ? <div className="dim" style={{ fontSize: 13 }}>No squad activity yet.</div> : (
                  <div className="feed">
                    {announcements.slice(0, 6).map((a) => {
                      const u = authorOf(a.authorId); const { title, body } = splitTitle(a.content);
                      return (
                        <div className="fitem ann" key={a.id}>
                          <div className="ic"><span className="material-symbols-outlined">campaign</span></div>
                          <div className="body"><b>{nameOf(u)}</b> posted{title ? `: “${title}”` : ` an announcement`}{!title && body ? `: “${body.slice(0, 80)}”` : ''}<span className="time">{ago(a.createdAt)}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pinned */}
              <div className="card">
                <div className="card-h"><div className="t">Pinned</div><button className="a" onClick={() => navigate(`/squads/${squadId}/announcements`)}>All</button></div>
                {pinned ? (() => {
                  const u = authorOf(pinned.authorId); const { title, body } = splitTitle(pinned.content);
                  return (
                    <div className="ann-card">
                      <div className="ann-h">
                        <div className={`av ${avatarClass(pinned.authorId)}`}>{u?.avatar ? <img src={u.avatar} alt="" /> : initials(nameOf(u))}</div>
                        <div className="name">{nameOf(u)}</div><div className="time">{ago(pinned.createdAt)}</div>
                        <div className="ann-pin"><span className="material-symbols-outlined">push_pin</span></div>
                      </div>
                      {title && <div className="ann-title">{title}</div>}
                      <div className="ann-body">{body}</div>
                    </div>
                  );
                })() : <div className="dim" style={{ fontSize: 13 }}>No pinned announcement.</div>}
              </div>

              {/* Upcoming events */}
              <div className="card">
                <div className="card-h"><div className="t">Upcoming events</div><button className="a" onClick={() => navigate(`/squads/${squadId}/events`)}>View all</button></div>
                {upcoming.length === 0 ? <div className="dim" style={{ fontSize: 13 }}>No events scheduled yet.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {upcoming.map((e) => {
                      const startMs = tsMs(e.startAt); const d = startMs ? new Date(startMs) : null;
                      return (
                        <button key={e.id} onClick={() => navigate(`/squads/${squadId}/events`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', textAlign: 'left', cursor: 'pointer' }}>
                          <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                            <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{d ? d.toLocaleString([], { month: 'short' }) : '--'}</div>
                            <div style={{ fontFamily: 'DM Mono', fontWeight: 800, fontSize: 18, color: 'var(--violet-light)' }}>{d ? d.getDate() : '--'}</div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title || 'Untitled'}</div>
                            <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)', marginTop: 2 }}>{d ? d.toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : ''} · {(e.attendees || []).length} going</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Active challenges */}
              <div className="card">
                <div className="card-h"><div className="t">Active challenges</div><button className="a" onClick={() => navigate(`/squads/${squadId}/challenges`)}>View all</button></div>
                {activeCh.length === 0 ? <div className="dim" style={{ fontSize: 13 }}>No active challenges.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeCh.map((c) => {
                      const progressMap = c.progress || {};
                      const value = c.scope === 'individual' ? (progressMap[currentUser?.uid] || 0) : Object.values(progressMap).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
                      const pct = Math.min(100, Math.round((value / Math.max(1, c.goal)) * 100));
                      return (
                        <button key={c.id} onClick={() => navigate(`/squads/${squadId}/challenges`)} style={{ padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', textAlign: 'left', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#fff', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title || 'Untitled'}</div>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)' }}>{value}/{c.goal}</span>
                          </div>
                          <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: 'var(--violet-light)' }} /></div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
