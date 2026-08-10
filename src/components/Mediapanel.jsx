import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { searchGifs, getTrendingGifs, searchStickers, getTrendingStickers, searchClips, getTrendingClips, trackKlipyImpression } from '../utils/klipyApi';

const TABS = [
  { id: 'gifs', label: 'GIFs', icon: 'gif_box', provider: 'klipy' },
  { id: 'stickers', label: 'Stickers', icon: 'sticky_note_2', provider: 'klipy' },
  { id: 'clips', label: 'Clips', icon: 'movie', provider: 'klipy' },
];

const SEARCHERS = {
  gifs: { search: searchGifs, trending: getTrendingGifs },
  stickers: { search: searchStickers, trending: getTrendingStickers },
  clips: { search: searchClips, trending: getTrendingClips },
};

export default function MediaPanel({ defaultTab = 'gifs', onSelect, onClose }) {
  const [tab, setTab] = useState(defaultTab);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  useEffect(() => {
    setLoading(true); setResults([]);
    clearTimeout(debounceRef.current);
    const api = SEARCHERS[tab] || SEARCHERS.gifs;
    if (!query.trim()) {
      api.trending().then(r => { setResults(r); setLoading(false); });
      return;
    }
    debounceRef.current = setTimeout(() => {
      api.search(query).then(r => { setResults(r); setLoading(false); });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, tab]);

  const isSticker = tab === 'stickers';
  const isClip = tab === 'clips';
  const provider = TABS.find(t => t.id === tab)?.provider || 'klipy';

  return (
    <div className="bg-surface-1 border-t border-white/[0.03] max-h-[320px] flex flex-col">
      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
        <div className="flex gap-0.5 shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setQuery(''); }}
              className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-colors ${
                tab === t.id ? 'bg-brand-violet/10 text-brand-violet-light' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative min-w-0">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={provider === 'klipy' ? 'Search KLIPY...' : `Search ${tab}...`}
            className="w-full bg-surface-2 border border-white/[0.06] rounded-lg py-1.5 pl-7 pr-2 text-[11px] text-text-primary outline-none focus:border-brand-violet/30" />
        </div>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary shrink-0"><Icon name="close" size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-8">{query ? `No ${tab} found` : `No trending ${tab}`}</p>
        ) : (
          <div className={`grid ${isSticker ? 'grid-cols-4 sm:grid-cols-5 gap-2' : 'grid-cols-3 sm:grid-cols-4 gap-1'}`}>
            {results.map(item => (
              <button key={item.id}
                onClick={() => {
                  if (item.isAd) {
                    // KLIPY ads: open the advertiser URL in a new tab, don't insert into chat
                    if (item.click_url) window.open(item.click_url, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  // For clips, send the mp4 video URL for chat playback
                  const sendUrl = isClip ? (item.videoUrl || item.url) : item.url;
                  onSelect?.(tab, sendUrl, item);
                }}
                className={`relative rounded-lg overflow-hidden hover:ring-2 hover:ring-brand-violet/40 transition-all ${
                  isSticker ? 'aspect-square p-1.5 hover:bg-surface-2/30' : 'aspect-square bg-surface-2'
                }`}>
                {/* Always show gif/webp preview thumbnail — never raw video in grid */}
                <img src={item.preview || item.url} alt={item.title || ''}
                  className={isSticker ? 'w-full h-full object-contain' : 'w-full h-full object-cover'}
                  loading="lazy"
                  onLoad={() => { if (item.isAd) trackKlipyImpression(item); }} />
                {isClip && !item.isAd && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                      <Icon name="play_arrow" size={18} className="text-white" />
                    </div>
                  </div>
                )}
                {item.isAd && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[8px] font-bold text-white uppercase tracking-wider">
                    Ad
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1 border-t border-white/[0.04]">
        <p className="text-[8px] text-text-muted text-center font-dmmono">
          {provider === 'klipy' ? 'Powered by KLIPY' : `Powered by ${provider}`}
        </p>
      </div>
    </div>
  );
}
