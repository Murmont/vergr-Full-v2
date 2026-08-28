import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLiveStreams } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import UserName from '../../components/UserName';

export default function SearchResultsStreamsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getLiveStreams(20).then(setStreams).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Live Streams" showBack />
      <div className="px-4 py-4">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
        : streams.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="live_tv" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No one is live right now</p>
            <p className="text-text-muted/60 text-xs mt-1">Be the first to go live!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {streams.map(stream => (
              <button key={stream.id} onClick={() => navigate(`/stream/${stream.id}`)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-brand-ember/30 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-xl">🎮</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{stream.title}</p>
                  <p className="text-xs text-text-muted"><UserName user={stream.streamer} masked fallback={'Streamer'} /> · {stream.game}</p>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-brand-ember/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-ember animate-pulse" />
                  <span className="text-[10px] font-bold text-brand-ember">{stream.viewerCount || 0}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
