// A "people to follow" card injected into the feed.
//
// ⚠ THIS IS THE ONLY BOOST INVENTORY THAT SCALES. A rail has four slots forever,
// however many people buy a Profile Boost; a feed block appears again every N
// posts, so inventory grows with scroll depth instead of being fixed. Founder,
// 2026-08-28: *"we can't if we have a million users, 1 in 4 in the rail isn't
// going to work."* See docs/BOOST_DELIVERY_PLAN.md §2.3.
//
// ⚠ IT IS LABELLED AND DISMISSIBLE, AND BOTH ARE DELIBERATE. An unlabelled paid
// suggestion sitting inside the feed is an ad pretending to be content, which is
// the thing that makes a feed feel cheap. Founder decision, 2026-08-28: labelled.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { getBoostedUsers, followUser } from '../../firebase/firestore';
import { isBoosted } from '../../utils/promoBoost';
import { recordBoostImpressions, recordBoostEngagement } from '../../utils/boostStats';
import UserAvatar from '../UserAvatar';
import UserName from '../UserName';
import Icon from '../Icon';

const DISMISS_KEY = 'vergr.suggestedBlock.dismissed.v1';

/** Dismissals are per device and short-lived — a day, not forever. */
const dismissedRecently = () => {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY)) || 0;
    return Date.now() - t < 24 * 3600 * 1000;
  } catch { return false; }
};

export default function SuggestedPeopleBlock({ slotKey }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [people, setPeople] = useState([]);
  const [followed, setFollowed] = useState({});
  const [gone, setGone] = useState(() => dismissedRecently());

  useEffect(() => {
    if (gone || !currentUser?.uid) return undefined;
    let alive = true;
    (async () => {
      try {
        // The shared query: fair bucket rotation, interest ranking, and the
        // viewer excluded from their own suggestions.
        const rows = await getBoostedUsers({ viewerUid: currentUser.uid, want: 3 });
        if (!alive || !rows.length) return;
        setPeople(rows);
        // Only paid placements are counted, and only the ones actually rendered.
        //
        // ⚠ THIS IS THE ONLY SURFACE THAT COUNTS, AND THAT IS A COST DECISION,
        // NOT AN OVERSIGHT. Founder, 2026-08-28. Five other surfaces call
        // getBoostedUsers (home rail, discovery strip, right sidebar, both
        // Explore screens, onboarding) and deliberately do NOT report, because
        // every reporting surface adds callable invocations and Firestore writes
        // on page loads that would otherwise cost nothing. The receipt therefore
        // UNDERCOUNTS on purpose. Do not "fix" this by counting everywhere
        // without asking: that is a spend decision and it is not yours.
        recordBoostImpressions(rows.filter((u) => isBoosted(u)).map((u) => ({
          // runId identifies THIS boost run so a refresh cannot re-count a view
          // while a NEW boost on the same profile still can.
          target: 'user', targetId: u.id, runId: u.boostExpiresAt,
        })));
      } catch { /* the feed must never break over a suggestion block */ }
    })();
    return () => { alive = false; };
    // slotKey makes each block in a long scroll ask for its own rotation, so a
    // reader who scrolls far sees different people rather than the same three.
  }, [currentUser?.uid, gone, slotKey]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setGone(true);
  };

  // ⚠ ONLY a BOOSTED card reports. An organic suggestion costs the platform
  // nothing and nobody is owed a number for it, so counting it would be a write
  // with no buyer attached.
  const engaged = (u) => { if (isBoosted(u)) recordBoostEngagement({ target: 'user', targetId: u.id }); };

  const openProfile = (u) => { engaged(u); navigate(`/user/${u.id}`); };

  const follow = async (uid) => {
    if (!currentUser?.uid || followed[uid]) return;
    setFollowed((f) => ({ ...f, [uid]: true }));
    try { await followUser(currentUser.uid, uid); }
    catch { setFollowed((f) => ({ ...f, [uid]: false })); }
  };

  if (gone || people.length === 0) return null;

  return (
    <div className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="person_add" size={16} className="text-text-muted" />
        <span className="font-syne font-bold text-text-primary text-sm">People to follow</span>
        <button
          onClick={dismiss}
          aria-label="Hide suggestions"
          className="ml-auto text-text-muted hover:text-text-secondary p-1"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="space-y-2">
        {people.map((u) => (
          <div key={u.id} className="flex items-center gap-3">
            <button onClick={() => openProfile(u)} className="shrink-0">
              <UserAvatar src={u.avatar} size={38} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <button onClick={() => openProfile(u)} className="min-w-0 text-left">
                  <UserName user={u} className="text-sm font-bold" />
                </button>
                {/* ⚠ The label. Paid placement is disclosed, never disguised. */}
                {isBoosted(u) && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0"
                    style={{ background: 'rgba(240,64,96,0.15)', color: '#F04060' }}
                  >
                    Boosted
                  </span>
                )}
              </div>
              <p className="text-text-muted text-[11px] truncate">
                {u.followerCount || 0} followers
              </p>
            </div>
            <button
              onClick={() => { engaged(u); follow(u.id); }}
              disabled={!!followed[u.id]}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0"
              style={followed[u.id]
                ? { background: 'rgba(255,255,255,0.06)', color: '#9CA3AF' }
                : { background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)', color: '#fff' }}
            >
              {followed[u.id] ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
