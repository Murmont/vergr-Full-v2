// NativeShortsScreen — dedicated phone build of /shorts.
// Phone-only immersive TikTok feed: single full-screen column, no desktop shell
// or scroll-arrows. Reuses the shared ShortsDeck (gestures + players +
// overlays) and the shared useShortsFeed loader, so the interaction logic and
// the data rules live in one place for /shorts and /clip/:postId alike.
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassSkeleton } from '../../../components/skeletons/GlassSkeletons';
import Icon from '../../../components/Icon';
import ShortsDeck, { ShortsBackFab } from '../ShortsDeck';
import useShortsFeed from '../useShortsFeed';

export default function NativeShortsScreen() {
  const navigate = useNavigate();
  const { feed, index, setIndex, loading, refreshing, refresh, remove } = useShortsFeed();

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate('/home');
  }, [navigate]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <ShortsBackFab onClick={goBack} />
        <GlassSkeleton variant="hero" style={{ width: 'min(420px, 92%)', aspectRatio: '9/16', borderRadius: 20 }} />
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-4 px-6">
        <ShortsBackFab onClick={goBack} />
        <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center">
          <Icon name="play_circle" size={44} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-white font-syne font-bold text-lg">No shorts or clips yet</p>
          <p className="text-text-muted text-sm mt-1">Be the first to post one. Shorts show your community's vertical clips.</p>
        </div>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={() => navigate('/create/clip')} className="px-6 py-3 rounded-full bg-brand-violet text-white font-bold text-sm active:scale-[0.97] transition-all">
            <span className="flex items-center gap-2"><Icon name="add" size={18} /> Create a clip</span>
          </button>
          <button type="button" onClick={goBack} className="px-6 py-3 rounded-full bg-surface-2 text-text-primary text-sm font-semibold">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <ShortsDeck
        feed={feed}
        index={index}
        setIndex={setIndex}
        isDesktop={false}
        onRefresh={refresh}
        refreshing={refreshing}
        onBack={goBack}
        onRemove={remove}
      />
    </div>
  );
}
