import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { trackEvent } from '../utils/trackEvent';

export default function AdCard({ ad }) {
  const [imgError, setImgError] = useState(false);
  const rootRef = useRef(null);
  const fired = useRef(false);

  // Fire ad_impression when the ad has been ≥50% visible for 1s
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !ad?.id) return;
    let enteredAt = 0;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!enteredAt) {
            enteredAt = performance.now();
            setTimeout(() => {
              if (enteredAt && !fired.current) {
                fired.current = true;
                trackEvent('ad_impression', { adId: ad.id, target: ad.title?.slice(0, 40) });
              }
            }, 1000);
          }
        } else {
          enteredAt = 0;
        }
      }
    }, { threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [ad?.id]);

  // Determine media URL and target URL based on ad source
  const isFirestoreAd = ad.isFirestoreAd;
  const mediaUrl = isFirestoreAd ? ad.imageUrl : ad.media_url;
  const targetUrl = isFirestoreAd ? ad.targetUrl : ad.targetUrl;
  const title = ad.title || 'Sponsored Content';
  const description = ad.description || '';
  const isVideo = !isFirestoreAd && ad.type === 'clip';
  const sponsorLabel = isFirestoreAd ? 'Ad' : 'Klipy';

  return (
    <div ref={rootRef} className="border-b border-white/[0.04] px-4 py-4 hover:bg-surface-1/30 transition-colors">
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-violet/10 flex items-center justify-center shrink-0">
            <Icon name="campaign" size={20} className="text-brand-violet-light" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-text-muted uppercase tracking-wider">Sponsored</span>
              <span className="text-[9px] bg-surface-2 px-1.5 py-0.5 rounded-full text-brand-violet-light">{sponsorLabel}</span>
            </div>
            <h3 className="font-bold text-text-primary text-sm">{title}</h3>
            {description && <p className="text-text-secondary text-xs mt-1">{description}</p>}
            {mediaUrl && !imgError && (
              <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.06]">
                {isVideo ? (
                  <video
                    src={mediaUrl}
                    controls
                    className="w-full max-h-64 object-cover"
                    poster={ad.preview_url}
                  />
                ) : (
                  <img
                    src={mediaUrl}
                    alt=""
                    className="w-full max-h-64 object-cover"
                    loading="lazy"
                    onError={() => setImgError(true)}
                  />
                )}
              </div>
            )}
            {targetUrl && (
              <button
                onClick={() => {
                  trackEvent('ad_click', { adId: ad.id, target: ad.title?.slice(0, 40) });
                  window.open(targetUrl, '_blank');
                }}
                className="mt-3 text-brand-violet-light text-xs font-semibold flex items-center gap-1"
              >
                Learn more <Icon name="arrow_forward" size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
