// VergrMeStreamBanner — the fallback for the strip above a split-layout stream.
//
// In split portrait the tip goal sits ABOVE the video box. When the host hasn't
// set a goal that strip would be dead space, so it promotes the host's vergr.me
// page instead: a compact tap-through that turns an idle slot into a link back
// to everything else that creator does.
//
// It renders NOTHING unless the host actually has a published vergr.me page.
// Pointing viewers at an empty page is worse than an empty strip, which is why
// the container does a real existence check rather than assuming a handle
// resolves. Free of charge: one small doc read, and only when there's no goal.

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import { vergrMeDisplayUrl } from '../../utils/vergrMeUrl';

const glassDark = {
  background: 'rgba(10,8,22,0.42)',
  backdropFilter: 'blur(18px) saturate(140%)',
  WebkitBackdropFilter: 'blur(18px) saturate(140%)',
  border: '1px solid rgba(255,255,255,0.12)',
};

/** Presentational half — no data access, so the admin Stream Preview can use it. */
export function VergrMeBannerCard({ username, onClick, style }) {
  if (!username) return null;
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '9px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
        color: '#fff', ...glassDark, ...style,
      }}
    >
      <span style={{
        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><Icon name="link" size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 800, lineHeight: 1.25 }}>
          More from @{username}
        </span>
        <span style={{
          display: 'block', fontSize: 10.5, fontWeight: 600, lineHeight: 1.3,
          color: 'rgba(255,255,255,0.62)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{vergrMeDisplayUrl(username)}</span>
      </span>
      <Icon name="chevron_right" size={18} style={{ color: 'rgba(255,255,255,0.55)' }} />
    </button>
  );
}

/** Live half — checks the host has a published page before rendering anything. */
export default function VergrMeStreamBanner({ uid, username, style }) {
  const navigate = useNavigate();
  const [has, setHas] = useState(false);

  useEffect(() => {
    if (!uid || !username) { setHas(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'vergrMe', 'page'));
        // A page doc can exist as an untouched default. Require real content so
        // the banner never sends anyone to a blank page.
        const d = snap.exists() ? snap.data() : null;
        const live = !!d && ((d.blocks?.length || 0) > 0 || (d.links?.length || 0) > 0);
        if (!cancelled) setHas(live);
      } catch { if (!cancelled) setHas(false); }
    })();
    return () => { cancelled = true; };
  }, [uid, username]);

  if (!has) return null;
  return <VergrMeBannerCard username={username} onClick={() => navigate(`/u/${username}`)} style={style} />;
}
