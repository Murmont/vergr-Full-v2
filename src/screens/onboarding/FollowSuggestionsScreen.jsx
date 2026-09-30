import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { formatCoins } from '../../utils/helpers';

export default function FollowSuggestionsScreen() {
  const [suggestions, setSuggestions] = useState([]);
  const [followed, setFollowed] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!auth.currentUser) return;

      try {
        // 1. Get the current user's following list to see who they already follow
        const currentUserDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const currentUserData = currentUserDoc.data();
        const followingIds = currentUserData?.followingIds || [];

        // 2. Query for the 'Vergr' official account
        const q = query(
          collection(db, 'users'), 
          where('username', '==', 'Vergr')
        );
        
        const querySnapshot = await getDocs(q);
        const users = [];
        
        querySnapshot.forEach((doc) => {
          const userData = doc.data();
          // 3. ONLY add to suggestions if the current user is NOT already following them
          if (!followingIds.includes(doc.id) && doc.id !== auth.currentUser.uid) {
            users.push({ uid: doc.id, ...userData });
          }
        });

        setSuggestions(users);
      } catch (error) {
        console.error("Error fetching suggestions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, []);

  const toggleFollow = (uid) => {
    setFollowed(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  return (
    <div className="screen-container min-h-screen">
      <TopBar title="Suggested For You" showBack />
      <div className="flex-1 px-4 pb-32">
        <p className="text-text-secondary text-sm mb-6">Follow people to fill your feed</p>
        
        {loading ? (
          <div className="flex justify-center pt-10">
            <div className="w-8 h-8 border-4 border-brand-violet border-t-transparent animate-spin rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.length > 0 ? (
              suggestions.map(user => {
                const isFollowed = followed.includes(user.uid);
                return (
                  <div key={user.uid} className="flex items-center gap-3 p-3 rounded-2xl border border-white/[0.06] bg-surface-1 hover:border-white/[0.12] transition-colors">
                    <UserAvatar src={user.avatar} size={50} tier={user.verificationTier} isVerified={user.verificationTier === 'verified'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm truncate">{user.displayName}</span>
                        {user.verificationTier === 'verified' && (
                          <span className="w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center shrink-0">
                            <Icon name="check" size={10} className="text-bg-dark" />
                          </span>
                        )}
                      </div>
                      <p className="text-text-muted text-xs truncate">@{user.username} · {formatCoins(user.followerCount || 0)} followers</p>
                      <p className="text-text-secondary text-xs truncate mt-0.5">{user.bio}</p>
                    </div>
                    <button
                      onClick={() => toggleFollow(user.uid)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                        isFollowed
                          ? 'bg-surface-2 border border-white/[0.06] text-text-secondary'
                          : 'bg-brand-violet text-white hover:brightness-110'
                      }`}
                    >
                      {isFollowed ? 'Following' : 'Follow'}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-10">
                <p className="text-text-muted">You're all caught up! No new suggestions.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4 glass-header border-t border-white/[0.04]" style={{ paddingBottom: 'calc(16px + var(--vg-safe-b, 0px))' }}>
        <button onClick={() => navigate('/', { replace: true })} className="btn-primary">
          {followed.length > 0 ? `Continue (${followed.length} followed)` : "Let's Go!"}
        </button>
      </div>
    </div>
  );
}