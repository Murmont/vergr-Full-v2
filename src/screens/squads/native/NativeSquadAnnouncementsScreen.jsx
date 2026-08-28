// Native Squad Announcements — /squads/:squadId/announcements on the APK.
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import { getSquad, getSquadMembers, getSquadAnnouncements, createSquadAnnouncement } from '../../../firebase/firestore';
import { roleKey, roleMeta, avatarClass, initials, nameOf } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';
import UserName from '../../../components/UserName';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const when = (t) => { const d = new Date(tsMs(t)); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const splitTitle = (content) => { const i = (content || '').indexOf('\n'); return i === -1 ? { title: '', body: content || '' } : { title: content.slice(0, i), body: content.slice(i + 1).trim() }; };

export default function NativeSquadAnnouncementsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [posting, setPosting] = useState(false);

  const reload = async () => {
    const [s, m, a] = await Promise.all([getSquad(squadId), getSquadMembers(squadId), getSquadAnnouncements(squadId, 30)]);
    setSquad(s); setMembers(m); setAnnouncements(a);
  };

  useEffect(() => {
    if (!squadId) return;
    let alive = true;
    (async () => { setLoading(true); try { await reload(); } catch (e) { /* ignore */ } if (alive) setLoading(false); })();
    return () => { alive = false; };
  }, [squadId]);

  const myRole = members.find((m) => m.id === currentUser?.uid)?.role;
  const canPost = ['leader', 'co'].includes(roleKey(myRole));
  const authorOf = (uid) => members.find((m) => m.id === uid)?.user;

  const post = async () => {
    if (!body.trim() && !title.trim()) return;
    setPosting(true);
    try {
      const content = title.trim() ? `${title.trim()}\n${body.trim()}` : body.trim();
      await createSquadAnnouncement(squadId, currentUser.uid, content, pin);
      setTitle(''); setBody(''); setPin(false); await reload();
      showToast('Announcement posted', 'success');
    } catch (err) { showToast(err?.message || 'Failed to post', 'error'); }
    setPosting(false);
  };

  const pinned = announcements.filter((a) => a.pinned);
  const earlier = announcements.filter((a) => !a.pinned);

  const Card = (a) => {
    const u = authorOf(a.authorId);
    const meta = roleMeta(members.find((m) => m.id === a.authorId)?.role);
    const { title: t, body: b } = splitTitle(a.content);
    return (
      <div className={`ann${a.pinned ? ' pinned' : ''}`} key={a.id}>
        <div className="ann-h">
          <div className={`av ${avatarClass(a.authorId)}`}>{u?.avatar ? <img src={u.avatar} alt="" /> : initials(nameOf(u))}</div>
          <div>
            <div className="name">{nameOf(u)}<span className={`role-pill ${meta.pill}`} style={{ marginLeft: 4 }}>{meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}{meta.label}</span></div>
            <div className="time">{when(a.createdAt)}</div>
          </div>
          {a.pinned && <span className="pin-tag" style={{ marginLeft: 6 }}><span className="material-symbols-outlined">push_pin</span>Pinned</span>}
        </div>
        {t && <div className="ann-title">{t}</div>}
        <div className="ann-body">{b.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
      </div>
    );
  };

  return (
    <NativeSquadScaffold mode="squad" title="Announcements" activeId="announcements" squadId={squadId} squadName={squad?.name}>
      <div style={{ padding: 16 }}>
        {loading ? <div className="dim center" style={{ padding: 48 }}>Loading…</div> : (
          <>
            {canPost && (
              <div className="composer">
                <div className="composer-h">
                  <div className={`av ${avatarClass(currentUser?.uid)}`}>{initials(currentUser?.displayName || 'You')}</div>
                  <div className="name">Posting as <UserName user={currentUser} masked fallback={'You'} /></div>
                  <div className="lbl">New announcement</div>
                </div>
                <input className="title" placeholder="Announcement title…" value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea placeholder="Write to the squad — practice schedule, lineup changes, big wins…" value={body} onChange={(e) => setBody(e.target.value)} />
                <div className="composer-tools">
                  <div className="left" />
                  <div className="right">
                    <label className="pintog"><span>Pin to top</span><span className="switch"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /><span className="slider" /></span></label>
                    <button className="btn primary" onClick={post} disabled={posting}><span className="material-symbols-outlined">send</span>{posting ? 'Posting…' : 'Post'}</button>
                  </div>
                </div>
              </div>
            )}

            {announcements.length === 0 && (
              <div className="empty">
                <div className="ic"><span className="material-symbols-outlined">campaign</span></div>
                <div className="t">No announcements yet</div>
                <div className="d">Leadership posts here — schedules, lineup changes, wins.</div>
              </div>
            )}

            {pinned.length > 0 && (<><div className="section-label"><span className="material-symbols-outlined" style={{ fontSize: 13, color: 'var(--violet-light)' }}>push_pin</span><span>Pinned</span><span className="line" /></div>{pinned.map(Card)}</>)}
            {earlier.length > 0 && (<><div className="section-label"><span>Earlier</span><span className="line" /></div>{earlier.map(Card)}</>)}
          </>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
