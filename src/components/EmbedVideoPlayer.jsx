import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { triggerInterstitial } from '../utils/interstitialAd';

// ── Helpers to parse video URLs ──
export function parseVideoUrl(url) {
  if (!url) return null;
  url = url.trim();

  let match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) return { platform: 'youtube', videoId: match[1] };

  match = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/);
  if (match) return { platform: 'twitch-clip', videoId: match[1] };

  match = url.match(/twitch\.tv\/videos\/(\d+)/);
  if (match) return { platform: 'twitch-vod', videoId: match[1] };

  match = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)$/);
  if (match) return { platform: 'twitch-channel', videoId: match[1] };

  return null;
}

export function getThumbnailUrl(parsed) {
  if (!parsed) return null;
  if (parsed.platform === 'youtube') {
    return `https://img.youtube.com/vi/${parsed.videoId}/hqdefault.jpg`;
  }
  return null;
}

function buildEmbedSrc(parsed, autoplay = true) {
  if (!parsed) return null;
  switch (parsed.platform) {
    case 'youtube':
      // Use YouTube's native controls — their branding can't be hidden from iframes.
      // modestbranding=1 minimizes logo, rel=0 prevents showing unrelated videos at end.
      return `https://www.youtube-nocookie.com/embed/${parsed.videoId}?autoplay=${autoplay ? 1 : 0}&mute=1&controls=1&modestbranding=1&rel=0&playsinline=1`;
    case 'twitch-clip':
      return `https://clips.twitch.tv/embed?clip=${parsed.videoId}&parent=${window.location.hostname}&autoplay=${autoplay}&muted=true`;
    case 'twitch-vod':
      return `https://player.twitch.tv/?video=${parsed.videoId}&parent=${window.location.hostname}&autoplay=${autoplay}&muted=true`;
    case 'twitch-channel':
      return `https://player.twitch.tv/?channel=${parsed.videoId}&parent=${window.location.hostname}&autoplay=${autoplay}&muted=true`;
    default:
      return null;
  }
}

// Re-export for other files
export function getEmbedUrl(parsed, autoplay = false) {
  return buildEmbedSrc(parsed, autoplay);
}

/**
 * Embedded video player for YouTube/Twitch.
 *
 * Shows a thumbnail with our branded play button.
 * On click, loads the YouTube/Twitch iframe with their native controls.
 * YouTube branding cannot be hidden from iframes — this is intentional.
 * Our wrapper provides the card design (rounded corners, badge, thumbnail).
 */
export default function EmbedVideoPlayer({ videoId, videoUrl, platform, thumbnail, onClickFullscreen, autoplayOnView = true }) {
  const [active, setActive] = useState(false);
  const containerRef = useRef(null);

  const parsed = videoId
    ? { platform: platform || 'youtube', videoId }
    : parseVideoUrl(videoUrl);

  const thumbUrl = thumbnail || getThumbnailUrl(parsed);

  // Auto-load the iframe when at least 60% of the player is visible.
  // Unload (back to thumbnail) when it scrolls fully out of view to free
  // memory and stop background audio. Mobile browsers refuse to autoplay
  // unmuted, but `mute=1` in the embed URL keeps the playback going.
  useEffect(() => {
    if (!autoplayOnView || !containerRef.current) return;
    const el = containerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.6) {
            setActive(true);
          } else if (entry.intersectionRatio < 0.05) {
            setActive(false);
          }
        }
      },
      { threshold: [0, 0.05, 0.6, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoplayOnView]);

  if (!parsed) return null;

  const embedSrc = buildEmbedSrc(parsed, true);

  return (
    <div
      ref={containerRef}
      className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] relative aspect-video bg-black"
    >
      {active ? (
        /* ── Playing: YouTube/Twitch iframe with their native controls ── */
        <iframe
          src={embedSrc}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video"
        />
      ) : (
        /* ── Thumbnail: our branded play button ── */
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            // Fire PropellerAds interstitial on the EXPLICIT play click only —
            // never from the IntersectionObserver autoplay path, which would
            // turn scrolling the feed into an ad-roulette.
            triggerInterstitial();
            setActive(true);
          }}
        >
          {thumbUrl && (
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          )}
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40" />
          {/* Play button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button className="w-16 h-16 rounded-full bg-brand-violet/90 flex items-center justify-center shadow-lg shadow-brand-violet/30 hover:bg-brand-violet hover:scale-105 transition-all">
              <Icon name="play_arrow" size={36} className="text-bg-dark ml-1" />
            </button>
          </div>
          {/* Badge */}
          <div className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Icon name="smart_display" size={13} />
            Video
          </div>
          {/* Fullscreen button */}
          {onClickFullscreen && (
            <button
              onClick={(e) => { e.stopPropagation(); onClickFullscreen(); }}
              className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/90 transition"
            >
              <Icon name="fullscreen" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
