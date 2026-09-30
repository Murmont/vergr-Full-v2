import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { GlassSkeleton } from '../../components/skeletons/GlassSkeletons';
import Icon from '../../components/Icon';
import ShortsDeck, { ShortsBackFab, SHORTS_RAIL_W, SHORTS_PANEL_W, SHORTS_PANEL_GAP } from './ShortsDeck';
import useShortsFeed from './useShortsFeed';

// Re-export the shared slide/player sub-components so older imports keep working.
export { ShortsBackFab, LiveSlide, VideoPlayer, EmbedFullscreen, EngageBtn } from './ShortsDeck';

export default function ShortsScreen() {
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();
  const { feed, index, setIndex, loading, refreshing, refresh, remove } = useShortsFeed();
  // Desktop comments open beside the video; the frame slides left to make room.
  const [panelOpen, setPanelOpen] = useState(false);

  // Desktop takes the whole width beside the sidebar and centres the player in
  // it (YouTube Shorts). The default 680px column pinned it to the left and left
  // half the screen empty (measured on vergr.app, 2026-09-13).
  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate('/home');
  }, [navigate]);

  // On desktop, stay inside the app layout (sidebar visible). On mobile, immersive.
  const shellClass = isDesktop
    ? 'relative w-full flex items-center justify-center'
    : 'fixed inset-0 z-[100] bg-black flex items-center justify-center';
  const shellStyle = isDesktop ? { minHeight: '100vh' } : undefined;
  // The video fills the height; the rail column sits beside it.
  const frame = isDesktop ? { height: 'calc(100vh - 40px)', width: `calc((100vh - 40px) * 9 / 16 + ${SHORTS_RAIL_W}px)`, maxWidth: '100%', marginLeft: SHORTS_RAIL_W, transform: panelOpen ? `translateX(-${(SHORTS_PANEL_W + SHORTS_PANEL_GAP) / 2}px)` : 'none', transition: 'transform 220ms ease-out' } : undefined;

  if (loading) {
    return (
      <div className={shellClass} style={shellStyle}>
        <ShortsBackFab onClick={goBack} />
        <GlassSkeleton variant="hero" style={{ width: 'min(420px, 92%)', aspectRatio: '9/16', borderRadius: 20 }} />
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div className={`${shellClass} flex-col gap-4 px-6`} style={shellStyle}>
        <ShortsBackFab onClick={goBack} />
        <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center">
          <Icon name="play_circle" size={44} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-white font-syne font-bold text-lg">No shorts or clips yet</p>
          <p className="text-text-muted text-sm mt-1">Be the first to post one. Shorts show your community's vertical clips.</p>
        </div>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={() => navigate('/create/clip')} className="px-6 py-2.5 rounded-full bg-brand-violet text-white font-bold text-sm hover:brightness-110 active:scale-[0.97] transition-all">
            <span className="flex items-center gap-2"><Icon name="add" size={18} /> Create a clip</span>
          </button>
          <button type="button" onClick={goBack} className="px-6 py-2.5 rounded-full bg-surface-2 text-text-primary text-sm font-semibold">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass} style={shellStyle}>
      <div className={isDesktop ? 'relative' : 'bg-black overflow-hidden absolute inset-0'} style={frame}>
        <ShortsDeck
          feed={feed}
          index={index}
          setIndex={setIndex}
          isDesktop={isDesktop}
          onRefresh={refresh}
          refreshing={refreshing}
          onBack={goBack}
          onRemove={remove}
          onSidePanel={setPanelOpen}
        />
      </div>
    </div>
  );
}
