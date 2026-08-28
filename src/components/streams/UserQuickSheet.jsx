// UserQuickSheet — bottom-sheet "mini profile" for taps on usernames /
// avatars during a live stream. Spring-physics slide-up. Swipe-down or
// backdrop-tap to close.
//
// Used by:
//   - Multi-Guest overlay pills (tap to inspect the linked streamer, not
//     just switch to them)
//   - Chat message taps (Phase 7)
//   - Any inline "@mention" tap
//
// Loads the target user doc on open. Shows: large avatar, display name,
// @handle, follower count, bio, Follow / Following toggle, "Watch live"
// (when streamId is provided), "View profile".

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import { spring, prefersReducedMotion } from '../primitives/springs';
import { haptic } from '../../utils/haptics';
import { followUser, unfollowUser, isFollowing } from '../../firebase/firestore';
import UserName from '../UserName';

const C = {
  bg: '#12121e',
  bgSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.12)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  textMuted: 'rgba(255,255,255,0.45)',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  green: '#22c55e',
  gold: '#F0A500',   // tips are coins — gold, not a recoloured cyan
};

export default function UserQuickSheet({ open, uid, onClose, watchLiveStreamId = null }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [followed, setFollowed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // Track touch swipe-to-dismiss.
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open || !uid) return;
    setLoading(true);
    setUser(null);
    let cancelled = false;
    getDoc(doc(db, 'users', uid)).then((snap) => {
      if (cancelled) return;
      setLoading(false);
      if (snap.exists()) setUser({ id: snap.id, ...snap.data() });
    }).catch(() => { if (!cancelled) setLoading(false); });
    if (currentUser?.uid && currentUser.uid !== uid) {
      isFollowing(currentUser.uid, uid).then((v) => {
        if (!cancelled) setFollowed(!!v);
      }).catch(() => {});
    }
    haptic.light();
    return () => { cancelled = true; };
  }, [open, uid, currentUser?.uid]);

  const onFollowToggle = async () => {
    if (!currentUser?.uid || followBusy || !uid || currentUser.uid === uid) return;
    setFollowBusy(true);
    try {
      if (followed) {
        await unfollowUser(currentUser.uid, uid);
        setFollowed(false);
        haptic.light();
      } else {
        await followUser(currentUser.uid, uid);
        setFollowed(true);
        haptic.success();
      }
    } catch (err) {
      showToast(err?.message || 'Could not update follow', 'error');
    } finally {
      setFollowBusy(false);
    }
  };

  const goProfile = () => {
    onClose?.();
    if (user?.username) navigate(`/u/${user.username}`);
    else if (uid)       navigate(`/u/${uid}`);
  };

  const goWatchLive = () => {
    onClose?.();
    if (watchLiveStreamId) navigate(`/watch/${watchLiveStreamId}`);
  };

  const reduced = prefersReducedMotion();
  const isSelf = currentUser?.uid === uid;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.55)', zIndex: 250,
              backdropFilter: 'blur(2px)',
            }}
          />
          {/* Sheet */}
          <motion.div
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: dragY }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={reduced ? { duration: 0.15 } : spring.bouncy}
            drag={reduced ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 300 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) {
                onClose?.();
              } else {
                setDragY(0);
              }
            }}
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0,
              zIndex: 251,
              background: C.bg,
              borderTop: `1px solid ${C.border}`,
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              padding: '12px 18px 28px',
              color: C.text,
              fontFamily: '"Inter", system-ui, sans-serif',
              maxHeight: '70vh',
              overflowY: 'auto',
            }}
          >
            {/* Drag handle */}
            <div style={{
              width: 44, height: 4, borderRadius: 2,
              background: C.border, margin: '0 auto 16px',
            }} />

            {loading || !user ? (
              <div style={{
                padding: '40px 0', textAlign: 'center', color: C.textDim, fontSize: 13,
              }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <UserAvatar src={user.avatar} size="xl" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 17, fontWeight: 800,
                    }}>
                      <UserName user={user} masked />
                      {user.verified && (
                        <Icon name="verified" size={16} className="" />
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: C.textDim, marginTop: 2 }}>
                      <UserName user={user} masked handle />
                    </div>
                    <div style={{
                      display: 'flex', gap: 14, marginTop: 8, fontSize: 12,
                    }}>
                      <Stat label="Followers" value={user.followerCount || 0} />
                      <Stat label="Following" value={user.followingCount || 0} />
                      {typeof user.tipsReceived === 'number' && (
                        <Stat label="Tips" value={user.tipsReceived} accent={C.gold} />
                      )}
                    </div>
                  </div>
                </div>

                {user.bio && (
                  <div style={{
                    fontSize: 13, color: C.text, lineHeight: 1.5,
                    padding: '10px 12px', borderRadius: 10,
                    background: C.bgSoft, border: `1px solid ${C.border}`,
                    marginBottom: 14,
                  }}>{user.bio}</div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  {!isSelf && (
                    <button
                      onClick={onFollowToggle}
                      disabled={followBusy}
                      style={{
                        flex: 1, padding: '12px 14px', borderRadius: 12, border: 'none',
                        background: followed
                          ? 'transparent'
                          : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                        boxShadow: followed ? `inset 0 0 0 1px ${C.border}` : 'none',
                        color: followed ? C.textDim : '#fff',
                        fontSize: 13, fontWeight: 800,
                        cursor: 'pointer', opacity: followBusy ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      <Icon name={followed ? 'check' : 'person_add'} size={14} className="" />
                      {followed ? 'Following' : 'Follow'}
                    </button>
                  )}
                  {watchLiveStreamId && (
                    <button onClick={goWatchLive} style={ghostBtn(C.green)}>
                      <Icon name="play_circle" size={14} className="" /> Watch live
                    </button>
                  )}
                  <button onClick={goProfile} style={ghostBtn(C.textDim)}>
                    <Icon name="person" size={14} className="" /> Profile
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 14, fontWeight: 800,
        color: accent || '#fff',
        fontFamily: 'DM Mono, ui-monospace, monospace',
      }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function ghostBtn(borderColor) {
  return {
    flex: 1, padding: '12px 14px', borderRadius: 12, border: `1px solid ${borderColor}33`,
    background: 'transparent', color: borderColor, fontSize: 13, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}
