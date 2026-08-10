import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUser, searchUsers } from '../../firebase/firestore';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import { timeAgo } from '../../utils/helpers';
import { markCallsSeen } from '../../utils/navBadges';

export default function CallsScreen() {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [favourites, setFavourites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState('start'); // start, link, schedule
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const searchRef = useRef(null);

  // "New call" used to only set activePanel, which just restyled a card — the
  // button read as dead. Starting a call means picking someone, so it drops the
  // cursor into the people search that already drives startCall().
  const startNewCall = () => {
    setActivePanel('start');
    const el = searchRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: 'nearest' });
  };

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    markCallsSeen(); // opening the calls view clears the missed-call badge/feed
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        // Load recent calls
        const callsQ = query(
          collection(db, 'calls'),
          where('participants', 'array-contains', currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const callsSnap = await getDocs(callsQ);
        const calls = [];
        for (const d of callsSnap.docs) {
          const call = { id: d.id, ...d.data() };
          const otherId = call.participants?.find(p => p !== currentUser.uid);
          if (otherId) call.otherUser = await getUser(otherId).catch(() => null);
          calls.push(call);
        }
        setRecentCalls(calls);

        // Load favourites
        const favQ = query(collection(db, 'users', currentUser.uid, 'call_favourites'), limit(10));
        const favSnap = await getDocs(favQ);
        const favs = [];
        for (const d of favSnap.docs) {
          const user = await getUser(d.id).catch(() => null);
          if (user) favs.push(user);
        }
        setFavourites(favs);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  useEffect(() => {
    if (!search.trim() || search.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(search, 10);
        setSearchResults(results.filter(u => u.id !== currentUser?.uid));
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, currentUser]);

  const startCall = async (userId, type = 'audio') => {
    if (!currentUser) return;
    const participants = [currentUser.uid, userId].sort();
    const chatId = participants.join('_');
    try {
      await setDoc(doc(db, 'calls', chatId), {
        callerId: currentUser.uid,
        callerName: profile?.displayName || 'User',
        callerAvatar: profile?.avatar || '',
        type,
        status: 'ringing',
        participants,
        createdAt: serverTimestamp(),
      });
      navigate(`/call/${chatId}/${type}`);
    } catch (err) { console.error('Call init failed:', err); }
  };

  // NOTE: this used to mint `/call/join/<uuid>` and copy it. There is no
  // `/call/join` route and no join-by-link backend, so every link a user shared
  // 404'd for the person who received it. Until that exists, say so instead of
  // handing out a dead link. The button stays — only the false promise goes.
  const copyCallLink = () => {
    setActivePanel('link');
    showToast('Call links are coming soon — search for someone to call them now', 'info');
  };

  const CALL_TYPE_ICONS = { audio: 'call', video: 'videocam', missed: 'call_missed', incoming: 'call_received', outgoing: 'call_made' };
  // These are a MEANING ladder, not decoration: audio vs video and incoming vs
  // outgoing must stay visually distinct. De-cyaning to violet would have
  // collided audio with video, so audio/outgoing move to gem-blue instead.
  const CALL_TYPE_COLORS = { audio: 'text-gem-blue', video: 'text-brand-violet', missed: 'text-brand-ember', incoming: 'text-green-500', outgoing: 'text-gem-blue' };

  // Left panel content
  const leftPanel = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h2 className="font-syne text-xl font-bold">Calls</h2>
        <button onClick={startNewCall} className="w-9 h-9 rounded-full bg-brand-violet/10 flex items-center justify-center hover:bg-brand-violet/20 transition-colors" title="New call">
          <Icon name="add_call" size={20} className="text-brand-violet" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 mt-1">
        <div className="relative">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input ref={searchRef} type="text" placeholder="Search by name or username..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-2.5 pl-9 pr-3 text-sm text-text-primary focus:border-brand-violet outline-none" />
        </div>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="px-4 mt-2 space-y-1">
          {searchResults.map(user => (
            <div key={user.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors">
              <UserAvatar src={user.avatar} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{user.displayName}</p>
                <p className="text-[10px] text-text-muted font-dmmono">@{user.username}</p>
              </div>
              <button onClick={() => startCall(user.id, 'audio')} className="p-2 rounded-full hover:bg-gem-blue/10" title="Audio call">
                <Icon name="call" size={18} className="text-gem-blue" />
              </button>
              <button onClick={() => startCall(user.id, 'video')} className="p-2 rounded-full hover:bg-brand-violet/10" title="Video call">
                <Icon name="videocam" size={18} className="text-brand-violet" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Favourites */}
      {favourites.length > 0 && !search && (
        <div className="px-4 mt-4">
          <p className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-2">Favourites</p>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {favourites.map(user => (
              <button key={user.id} onClick={() => startCall(user.id)} className="flex flex-col items-center gap-1 shrink-0 w-14">
                <UserAvatar src={user.avatar} size={44} />
                <p className="text-[10px] text-text-secondary truncate w-full text-center">{user.displayName?.split(' ')[0]}</p>
              </button>
            ))}
            <button className="flex flex-col items-center gap-1 shrink-0 w-14" title="Add favourite">
              <div className="w-11 h-11 rounded-full bg-surface-2 border border-dashed border-white/[0.06] flex items-center justify-center">
                <Icon name="add" size={20} className="text-text-muted" />
              </div>
              <p className="text-[10px] text-text-muted">Add</p>
            </button>
          </div>
        </div>
      )}

      {/* Recent calls */}
      <div className="flex-1 px-4 mt-4 overflow-y-auto">
        <p className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-2">Recent</p>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
        ) : recentCalls.length === 0 ? (
          <div className="text-center py-10">
            <Icon name="call" size={40} className="text-text-muted/20 mx-auto mb-2" />
            <p className="text-text-muted text-sm">No calls yet</p>
            <p className="text-text-muted text-xs mt-1">Search for someone to call</p>
          </div>
        ) : (
          <div className="space-y-1">
            {recentCalls.map(call => {
              const callType = call.type || 'audio';
              const isMissed = call.status === 'missed';
              const isOutgoing = call.callerId === currentUser?.uid;
              const displayType = isMissed ? 'missed' : isOutgoing ? 'outgoing' : 'incoming';
              return (
                <button key={call.id} onClick={() => call.otherUser && startCall(call.otherUser.id, callType)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors text-left">
                  <UserAvatar src={call.otherUser?.avatar} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isMissed ? 'text-brand-ember' : 'text-text-primary'}`}>
                      {call.otherUser?.displayName || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Icon name={CALL_TYPE_ICONS[displayType]} size={12} className={CALL_TYPE_COLORS[displayType]} />
                      <span className="text-text-muted text-[10px]">{displayType} · {callType}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-text-muted text-[10px]">{call.createdAt ? timeAgo(call.createdAt) : ''}</p>
                    {call.duration && <p className="text-text-muted text-[9px] font-dmmono">{Math.floor(call.duration / 60)}:{String(call.duration % 60).padStart(2, '0')}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // Right panel content (desktop only)
  const rightContent = (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="w-20 h-20 rounded-3xl bg-brand-violet/10 flex items-center justify-center mb-6">
        <Icon name="call" size={40} className="text-brand-violet" />
      </div>

      <div className="space-y-3 w-full max-w-xs">
        <button onClick={startNewCall}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${activePanel === 'start' ? 'bg-brand-violet/10 border-brand-violet/30' : 'bg-surface-1 border-white/[0.04] hover:border-white/[0.12]'}`}>
          <Icon name="call" size={22} className="text-brand-violet" />
          <div>
            <p className="text-sm font-bold text-text-primary">Start a Call</p>
            <p className="text-[10px] text-text-muted">Search and call someone directly</p>
          </div>
        </button>

        <button onClick={copyCallLink}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${activePanel === 'link' ? 'bg-brand-violet/10 border-brand-violet/30' : 'bg-surface-1 border-white/[0.04] hover:border-brand-violet/20'}`}>
          <Icon name="link" size={22} className="text-brand-violet" />
          <div>
            <p className="text-sm font-bold text-text-primary">Send Call Link</p>
            <p className="text-[10px] text-text-muted">Share a link to start a call</p>
          </div>
        </button>

        <button onClick={() => { setActivePanel('schedule'); showToast('Scheduled calls are coming soon', 'info'); }}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${activePanel === 'schedule' ? 'bg-brand-gold/10 border-brand-gold/30' : 'bg-surface-1 border-white/[0.04] hover:border-brand-gold/20'}`}>
          <Icon name="event" size={22} className="text-brand-gold" />
          <div>
            <p className="text-sm font-bold text-text-primary">Schedule a Call</p>
            <p className="text-[10px] text-text-muted">Set up a call for later</p>
          </div>
        </button>
      </div>

      <p className="text-text-muted text-[10px] mt-6 leading-relaxed max-w-xs">
        Calls are peer-to-peer. Audio and video calls are free for all users. Call quality depends on your connection.
      </p>
    </div>
  );

  if (!isDesktop) {
    return (
      <div className="min-h-screen pb-20">
        <TopBar title="Calls" showBack actions={
          <button onClick={startNewCall} className="p-2"><Icon name="add_call" size={22} className="text-brand-violet" /></button>
        } />
        {leftPanel}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: call list */}
      <div className="w-[380px] border-r border-white/[0.04] bg-bg-dark flex flex-col">
        {leftPanel}
      </div>
      {/* Right: actions */}
      <div className="flex-1 bg-bg-dark">
        {rightContent}
      </div>
    </div>
  );
}
