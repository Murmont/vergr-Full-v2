import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

export default function TrendingHashtagsScreen() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'trending', 'daily'));
        if (snap.exists() && snap.data().hashtags?.length > 0) {
          setTags(snap.data().hashtags);
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="min-h-screen pb-8 lg:pb-0">
      <TopBar title="Trending" showBack />
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
          </div>
        ) : tags.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="trending_up" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No trending hashtags yet</p>
            <p className="text-text-muted/60 text-xs mt-1">Start using hashtags in your posts to see trends here</p>
          </div>
        ) : (
          <div className={isDesktop ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
            {tags.map((tag, i) => (
              <button key={tag.tag || i}
                onClick={() => navigate(`/search?q=${encodeURIComponent(tag.tag || tag)}`)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
                <span className="font-dmmono text-text-muted w-6 text-center">#{i+1}</span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-brand-violet-light">#{typeof tag === 'string' ? tag : tag.tag}</p>
                  {tag.count && <p className="text-xs text-text-muted">{tag.count} posts</p>}
                </div>
                <Icon name="trending_up" size={18} className="text-green-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
