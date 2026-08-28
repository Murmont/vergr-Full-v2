import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import UserName from '../../components/UserName';

export default function BrowseCreatorsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const q = query(collection(db, 'users'), where('role', '==', 'creator'), orderBy('followerCount', 'desc'), limit(30));
        const snap = await getDocs(q);
        setCreators(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, []);

  const formatCount = (n) => n >= 1000 ? (n/1000).toFixed(1)+'K' : (n||0).toString();

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Browse Creators" showBack />
      <div className="px-4 py-4">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet-light rounded-full animate-spin" /></div>
        : creators.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="video_camera_front" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No creators yet</p>
            <p className="text-text-muted/60 text-xs mt-1">Be the first! Apply for creator status in settings.</p>
          </div>
        ) : <div className="space-y-3">{creators.map(c => (
          <button key={c.id} onClick={() => navigate(`/user/${c.id}`)} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
            <UserAvatar src={c.avatar} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-sm truncate"><UserName user={c} masked /></p>
                {c.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light" />}
              </div>
              <p className="text-xs text-text-muted"><UserName user={c} masked handle /></p>
              <p className="text-xs text-brand-gold font-dmmono mt-1">{formatCount(c.followerCount)} fans</p>
            </div>
            <Icon name="chevron_right" size={18} className="text-text-muted" />
          </button>
        ))}</div>}
      </div>
    </div>
  );
}
