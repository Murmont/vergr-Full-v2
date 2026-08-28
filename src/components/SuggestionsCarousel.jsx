import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, limit, orderBy, documentId } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { followUser, unfollowUser, isFollowing as checkFollowing } from '../firebase/firestore';
import UserAvatar from './UserAvatar';
import UserName from './UserName';

export default function SuggestionsCarousel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [followState, setFollowState] = useState({});
  const [toggling, setToggling] = useState({});

  useEffect(() => {
    if (!currentUser?.uid) return;

    const fetchUsers = async () => {
      try {
        // Get users the current user is already following
        const followsSnap = await getDocs(
          query(collection(db, 'follows'), where('followerId', '==', currentUser.uid))
        );
        const followingIds = new Set(followsSnap.docs.map(d => d.data().followingId));

        // Friends-of-friends: get who the followed accounts follow, score by overlap
        const scoreMap = new Map(); // userId -> count of mutual
        if (followingIds.size > 0) {
          const followedList = Array.from(followingIds).slice(0, 10); // cap to avoid quota
          const fofResults = await Promise.allSettled(
            followedList.map(fid => getDocs(
              query(collection(db, 'follows'), where('followerId', '==', fid), limit(25))
            ))
          );
          for (const r of fofResults) {
            if (r.status !== 'fulfilled') continue;
            for (const d of r.value.docs) {
              const targetId = d.data().followingId;
              if (!targetId || targetId === currentUser.uid || followingIds.has(targetId)) continue;
              scoreMap.set(targetId, (scoreMap.get(targetId) || 0) + 1);
            }
          }
        }

        // Resolve FoF user docs (chunks of 10 for 'in' query)
        let fofUsers = [];
        const fofIds = Array.from(scoreMap.keys()).slice(0, 20);
        if (fofIds.length > 0) {
          const chunks = [];
          for (let i = 0; i < fofIds.length; i += 10) chunks.push(fofIds.slice(i, i + 10));
          const results = await Promise.allSettled(
            chunks.map(ids => getDocs(query(collection(db, 'users'), where(documentId(), 'in', ids))))
          );
          for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            for (const d of r.value.docs) {
              fofUsers.push({ id: d.id, ...d.data(), _fofScore: scoreMap.get(d.id) || 0 });
            }
          }
        }

        // Fetch verified users + popular users as fallback pool
        let allUsers = [...fofUsers];
        if (allUsers.length < 10) {
          const verifiedSnap = await getDocs(
            query(collection(db, 'users'), where('isVerified', '==', true), limit(20))
          );
          const verifiedUsers = verifiedSnap.docs.map(d => ({ id: d.id, ...d.data(), _fofScore: 0 }));
          const existingIds = new Set(allUsers.map(u => u.id));
          for (const u of verifiedUsers) {
            if (!existingIds.has(u.id)) { allUsers.push(u); existingIds.add(u.id); }
          }
        }
        if (allUsers.length < 10) {
          const moreSnap = await getDocs(
            query(collection(db, 'users'), orderBy('followerCount', 'desc'), limit(20))
          );
          const moreUsers = moreSnap.docs.map(d => ({ id: d.id, ...d.data(), _fofScore: 0 }));
          const existingIds = new Set(allUsers.map(u => u.id));
          for (const u of moreUsers) {
            if (!existingIds.has(u.id)) { allUsers.push(u); existingIds.add(u.id); }
          }
        }

        // Filter out: current user, deleted users, bot accounts, already followed
        allUsers = allUsers.filter(u =>
          u.id !== currentUser.uid &&
          !u.deleted &&
          u.accountType !== 'news_bot' &&
          u.isOnboarded !== false &&
          !followingIds.has(u.id)
        );

        // Sort by FoF score descending, then follower count
        allUsers.sort((a, b) => {
          if ((b._fofScore || 0) !== (a._fofScore || 0)) return (b._fofScore || 0) - (a._fofScore || 0);
          return (b.followerCount || 0) - (a.followerCount || 0);
        });

        const finalUsers = allUsers.slice(0, 15);
        const state = {};
        for (const u of finalUsers) state[u.id] = false;

        setUsers(finalUsers);
        setFollowState(state);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
      }
    };
    fetchUsers();
  }, [currentUser?.uid]);

  const handleToggleFollow = async (e, userId) => {
    e.stopPropagation();
    if (!currentUser?.uid || toggling[userId]) return;

    setToggling(prev => ({ ...prev, [userId]: true }));
    const wasFollowing = followState[userId];

    // Optimistic update
    setFollowState(prev => ({ ...prev, [userId]: !wasFollowing }));

    try {
      if (wasFollowing) {
        await unfollowUser(currentUser.uid, userId);
      } else {
        await followUser(currentUser.uid, userId);
      }
    } catch {
      // Revert on error
      setFollowState(prev => ({ ...prev, [userId]: wasFollowing }));
    }
    setToggling(prev => ({ ...prev, [userId]: false }));
  };

  if (users.length === 0) return null;

  return (
    <div className="py-4 border-b border-white/[0.04]">
      <div className="flex items-center justify-between px-4 mb-3">
        <h3 className="text-sm font-syne font-bold text-text-primary">Who to Follow</h3>
        <button onClick={() => navigate('/browse-creators')} className="text-brand-violet-light text-xs">Show all</button>
      </div>
      <div className="flex overflow-x-auto no-scrollbar gap-3 px-4">
        {users.map(user => {
          const isFollowed = followState[user.id];
          return (
            <div key={user.id} className="flex flex-col items-center shrink-0 gap-1">
              <button onClick={() => navigate(`/user/${user.id}`)}>
                <UserAvatar src={user.avatar} size={56} isVerified={user.isVerified} />
              </button>
              <p className="text-text-primary text-xs font-semibold truncate w-16 text-center"><UserName user={user} masked /></p>
              <button
                onClick={(e) => handleToggleFollow(e, user.id)}
                disabled={toggling[user.id]}
                className={`px-3 py-0.5 rounded-full text-[9px] font-bold transition-colors ${
                  isFollowed
                    ? 'bg-surface-2 border border-white/[0.06] text-text-secondary'
                    : 'bg-brand-violet/10 text-brand-violet-light'
                }`}
              >
                {isFollowed ? 'Following' : 'Follow'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
