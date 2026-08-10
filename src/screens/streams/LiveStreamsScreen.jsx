// Live Streams — dedicated discovery screen for everything live right now.
// Reached from the main nav ("Live Streams" → /streams). Pulls real live
// streams (status == 'live'), newest/most-watched first, and links each to the
// viewer. Honest empty state when nothing is live.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardGridSkeleton } from '../../components/skeletons/GlassSkeletons';
import useResponsive from '../../hooks/useResponsive';
import { useLiveUsers } from '../../context/LiveUsersContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

// Live thumbnails: the ingest boxes write a fresh thumb.jpg per active stream
// (60s timer). Cards fall back to it when the host set no cover. ?t bust keeps
// it from caching past the box's 30s upload cadence.
const CDN = 'https://cdn.vergr.app';
const thumbFor = (streamKey) =>
  streamKey ? `${CDN}/streams/${streamKey}/thumb.jpg?t=${Math.floor(Date.now() / 30000)}` : null;

export default function LiveStreamsScreen() {
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { liveHosts, liveLoaded } = useLiveUsers();

  // Real-time: starts/ends reflect within seconds via the app-wide snapshot.
  const loading = !liveLoaded;
  const streams = useMemo(() => Array.from(liveHosts.values())
    .filter((h) => h.discoverable)
    .map((h) => ({
      id: h.streamId,
      title: h.title || 'Live Stream',
      creator: h.name || h.hostUid?.slice(0, 6) || 'creator',
      viewers: h.viewerCount || 0,
      boosted: !!h.boosted,
      coverUrl: h.coverUrl || h.thumbUrl || thumbFor(h.streamKey),
      orientation: h.orientation || 'landscape',
    }))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 48), [liveHosts]);

  return (
    <div className="pb-10">
      {isMobile ? <TopBar title="Live Streams" /> : (
        <div className="px-7 pt-6">
          <h1 className="font-syne text-2xl font-black text-text-primary">Live Streams</h1>
        </div>
      )}
      <div className="px-4 md:px-7 py-5 max-w-[1400px] mx-auto">
        {loading ? (
          <CardGridSkeleton count={8} columns={isMobile ? 2 : 4} aspect="16/9" />
        ) : streams.length === 0 ? (
          <div className="text-center py-20">
            <Icon name="podcasts" size={52} className="text-text-muted/25 mx-auto mb-3" />
            <p className="text-text-muted">No one is live right now. Check back soon.</p>
            <button onClick={() => navigate('/go-live')}
              className="mt-5 px-5 py-2.5 rounded-full text-sm font-bold"
              style={{ background: '#7B1FFF', color: '#fff' }}>
              Go Live
            </button>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(4, minmax(0,1fr))' }}>
            {streams.map((s) => (
              <button key={s.id} onClick={() => navigate(`/watch/${s.id}`)} className="text-left group">
                <div className="relative rounded-xl overflow-hidden aspect-video"
                  style={{ background: s.coverUrl ? '#0B0B14' : `linear-gradient(135deg, hsl(${(s.id.charCodeAt(0) * 9) % 360},50%,16%), #0B0B14)` }}>
                  {s.coverUrl && <img src={s.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    <span className="flex items-center gap-1 bg-brand-ember text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                    </span>
                    {s.boosted && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white"
                        style={{ background: 'linear-gradient(90deg,#7B1FFF,#C87FFF)' }}>BOOSTED</span>
                    )}
                  </div>
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] font-bold text-white bg-black/55 px-1.5 py-0.5 rounded">
                    <Icon name="visibility" size={10} /> {s.viewers.toLocaleString()}
                  </div>
                </div>
                <p className="mt-2 font-bold text-sm text-text-primary truncate">{s.title}</p>
                <p className="text-text-muted text-xs truncate">{s.creator}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
