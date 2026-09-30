// ClipViewerScreen — /clip/:postId, what a clip tile in the feed, the Clips
// shelf and Explore all open, and where every /post link to a clip is redirected.
//
// It is the SAME player as /shorts (ShortsDeck) opened on the chosen clip, and
// the same loader (useShortsFeed). It used to be a separate, weaker copy: a
// flick detector instead of a slide that follows the thumb, no progress bar,
// no mute, no double-tap like, no preloading, a full-screen spinner while 30
// authors were fetched one after another, and, when the clip was older than
// the newest 30, it quietly played a different clip. Two players is how a clip
// and a short ended up behaving differently for no reason anybody chose.
//
// `?comments=1` opens the clip with its comment sheet already up: the feed's
// comment button and every comment notification use it, so a comment on a clip
// never lands on a separate page.
import { useEffect, useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';
import { GlassSkeleton } from '../../components/skeletons/GlassSkeletons';
import { triggerInterstitial } from '../../utils/interstitialAd';
import ShortsDeck, { ShortsBackFab, SHORTS_RAIL_W, SHORTS_PANEL_W, SHORTS_PANEL_GAP } from '../shorts/ShortsDeck';
import useShortsFeed from '../shorts/useShortsFeed';

export default function ClipViewerScreen() {
  const { postId } = useParams();
  const [params] = useSearchParams();
  const openComments = params.get('comments') === '1';
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();

  // Fire the interstitial when the user enters fullscreen video. The cooldown
  // inside triggerInterstitial() stops it firing again on every swipe. Not when
  // the viewer came to read or write a comment.
  useEffect(() => { if (!openComments) triggerInterstitial(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { feed, index, setIndex, loading, refreshing, refresh, remove, missing } = useShortsFeed({ startId: postId });
  const [panelOpen, setPanelOpen] = useState(false);

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate('/shorts');
  }, [navigate]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <ShortsBackFab onClick={goBack} />
        <GlassSkeleton variant="hero" style={{ width: 'min(420px, 92%)', aspectRatio: '9/16', borderRadius: 20 }} />
      </div>
    );
  }

  // Never play something other than what was opened.
  if (missing || feed.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-4 px-6 text-center">
        <ShortsBackFab onClick={goBack} />
        <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center">
          <Icon name="videocam_off" size={40} className="text-text-muted" />
        </div>
        <div>
          <p className="text-white font-syne font-bold text-lg">This clip isn't available</p>
          <p className="text-text-muted text-sm mt-1">It may have been removed, or the link is wrong.</p>
        </div>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={() => navigate('/shorts', { replace: true })} className="px-6 py-3 rounded-full bg-brand-violet text-white font-bold text-sm active:scale-[0.97] transition-all">
            Watch more clips
          </button>
          <button type="button" onClick={goBack} className="px-6 py-3 rounded-full bg-surface-2 text-text-primary text-sm font-semibold">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
      <div className={isDesktop ? 'relative' : 'bg-black overflow-hidden absolute inset-0'} style={isDesktop ? { height: '92vh', width: `calc(92vh * 9 / 16 + ${SHORTS_RAIL_W}px)`, maxWidth: '100%', marginLeft: SHORTS_RAIL_W, transform: panelOpen ? `translateX(-${(SHORTS_PANEL_W + SHORTS_PANEL_GAP) / 2}px)` : 'none', transition: 'transform 220ms ease-out' } : undefined}>
        <ShortsDeck
          feed={feed}
          index={index}
          setIndex={setIndex}
          isDesktop={isDesktop}
          onRefresh={refresh}
          refreshing={refreshing}
          onBack={goBack}
          onRemove={remove}
          openCommentsId={openComments ? postId : null}
          onSidePanel={setPanelOpen}
        />
      </div>
    </div>
  );
}
