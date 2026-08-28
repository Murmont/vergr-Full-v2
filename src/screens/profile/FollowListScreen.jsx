import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useLiveUsers } from '../../context/LiveUsersContext';
import { getFollowersDetailed, getFollowingDetailed, getFans, followUser, unfollowUser, isFollowing as checkFollowing } from '../../firebase/firestore';
import { applyVanguardMask } from '../../utils/vanguard';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import { filterForEnumeration } from '../../utils/enumerationFilter';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import VanguardBadge from '../../components/VanguardBadge';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import UserName from '../../components/UserName';
import RankBadge from '../../components/RankBadge';

export default function FollowListScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { tab: initialTab, uid: routeUid } = useParams();
  const [activeTab, setActiveTab] = useState(initialTab || 'followers');
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [fans, setFans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followStates, setFollowStates] = useState({});

  const { currentUser } = useAuth();
  const { profile: viewer } = useUser();
  const { isUserLive } = useLiveUsers();
  const navigate = useNavigate();

  // Whose list to show: the :uid route param (other users) or the signed-in user.
  const targetUid = routeUid || currentUser?.uid;
  const isSelf = targetUid === currentUser?.uid;

  useEffect(() => {
    if (!targetUid || !currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        // Fans (paying members) are private to the creator — only fetch on own profile.
        const [followerList, followingList, fanList] = await Promise.all([
          getFollowersDetailed(targetUid, 100),
          getFollowingDetailed(targetUid, 100),
          isSelf ? getFans(targetUid, 100) : Promise.resolve([]),
        ]);
        setFollowers(followerList);
        setFollowing(followingList);
        setFans(fanList);

        // Resolve the viewer's follow status for everyone shown (all lists), so
        // the Follow/Following button is correct on another user's lists too.
        const states = {};
        const everyone = [...followerList, ...followingList, ...fanList];
        await Promise.all(everyone.map(async (user) => {
          if (user.id === currentUser.uid) return;
          states[user.id] = await checkFollowing(currentUser.uid, user.id);
        }));
        setFollowStates(states);
      } catch (err) {
        console.error('Failed to load follow data:', err);
      }
      setLoading(false);
    };
    load();
  }, [targetUid, currentUser]);

  const handleFollowToggle = async (userId) => {
    const isCurrentlyFollowing = followStates[userId];
    setFollowStates(prev => ({ ...prev, [userId]: !isCurrentlyFollowing }));
    try {
      if (isCurrentlyFollowing) {
        await unfollowUser(currentUser.uid, userId);
      } else {
        await followUser(currentUser.uid, userId);
      }
    } catch (err) {
      console.error(err);
      setFollowStates(prev => ({ ...prev, [userId]: isCurrentlyFollowing }));
    }
  };

  const TAB_LABEL = { followers: 'Followers', following: 'Following', fans: 'Fans' };
  const listFor = { followers, following, fans };
  // Fans tab is only shown on your own profile (paying-member lists are private).
  const TABS = isSelf ? ['followers', 'following', 'fans'] : ['followers', 'following'];
  const safeTab = TABS.includes(activeTab) ? activeTab : 'followers';
  const currentListRaw = listFor[safeTab] || [];
  // Drop operator + opt-in-hidden accounts from these lists (anti-enumeration).
  const currentList = filterForEnumeration(currentListRaw, viewer);

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar showBack title={TAB_LABEL[safeTab] || 'Followers'} />

      {/* Tabs — Followers (clicked Follow) vs Following vs Fans (paying members) */}
      <div className="flex border-b border-white/[0.04]">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3.5 text-sm font-bold text-center relative transition-colors ${
              safeTab === tab ? 'text-white' : 'text-text-muted'
            }`}
          >
            {`${TAB_LABEL[tab]}${listFor[tab].length > 0 ? ` (${listFor[tab].length})` : ''}`}
            {safeTab === tab && (
              <motion.div
                layoutId="followTabIndicator"
                className="absolute bottom-0 left-4 right-4 h-[2px] bg-brand-violet-light rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="px-4 py-3">
        {loading ? (
          <ListSkeleton rows={8} />
        ) : currentList.length === 0 ? (
          <div className="text-center py-16">
            <Icon name={safeTab === 'fans' ? 'workspace_premium' : safeTab === 'followers' ? 'group' : 'person_search'} size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">
              {safeTab === 'fans'
                ? (isSelf ? "No fans yet. Set up membership tiers so supporters can subscribe." : "No fans yet.")
                : safeTab === 'followers'
                  ? "No followers yet. Share your content to grow your audience!"
                  : "Not following anyone yet. Discover creators and gamers!"}
            </p>
            {safeTab === 'fans' && isSelf && (
              <button onClick={() => navigate('/creator/membership')} className="mt-4 px-5 py-2.5 rounded-full bg-brand-violet-light text-white text-sm font-bold">
                Set up tiers
              </button>
            )}
            {safeTab === 'following' && (
              <button onClick={() => navigate('/explore')} className="mt-4 px-5 py-2.5 rounded-full bg-brand-violet-light text-white text-sm font-bold">
                Explore
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {currentList.map(user => {
              const masked = applyVanguardMask(user, viewer);
              const isMasked = !!masked?.isVanguardPersona;
              const vRank = user.vanguard?.rank;
              return (
              <div key={user.id} className="flex items-center gap-3 py-3">
                <button onClick={() => navigate(`/user/${user.id}`)} className="shrink-0">
                  {/* FIX: changed size="md" to size={40} for consistent avatar sizing */}
                  <UserAvatar src={masked.avatar} size={40} isLive={!isMasked && isUserLive(user.id)} />
                </button>
                <button onClick={() => navigate(`/user/${user.id}`)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold truncate"><UserName user={masked} masked /></p>
                    <RankBadge level={masked?.vpLevel} role={masked?.role} size={12} style={{ verticalAlign: '-2px' }} />
                    {!isMasked && user.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light shrink-0" />}
                    {vRank && <VanguardBadge rank={vRank} size={13} />}
                  </div>
                  <p className="text-xs text-text-muted"><UserName user={masked} masked handle /></p>
                  {safeTab === 'fans' && user._fanTier && (
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: 'rgba(240,165,0,0.12)', color: '#F5C842' }}>
                      <Icon name="workspace_premium" filled size={11} /> {user._fanTier}
                    </span>
                  )}
                </button>
                {user.id !== currentUser.uid && (
                  <motion.button
                    onClick={() => handleFollowToggle(user.id)}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      followStates[user.id]
                        ? 'bg-surface-2 border border-white/[0.06] text-text-secondary'
                        : 'bg-brand-violet-light text-white'
                    }`}
                  >
                    {followStates[user.id] ? 'Following' : 'Follow'}
                  </motion.button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}