import { useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon';
import EmbedVideoPlayer from './EmbedVideoPlayer';

/**
 * Renders an RSS news item to look like a native post.
 * - Shows the source's bot avatar + name like a user account
 * - First 300 chars of the article paragraph as post text with "Read more" link
 * - YouTube video player if the article has an embedded video, otherwise the thumbnail image
 * - Engagement-style bar with external link
 *
 * Props:
 *  - item: { title, link, pubDate, description, thumbnail, youtubeVideoId, source, avatar }
 *  - onOpenVideo: callback(item) when user clicks a video to go fullscreen
 */
export default function NewsPostCard({ item, onOpenVideo }) {
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hasVideo = !!item.youtubeVideoId;
  const hasImage = !!item.thumbnail && !imgError;
  const fullText = item.description || '';
  const shouldTruncate = fullText.length > 300;
  const displayText = expanded || !shouldTruncate ? fullText : fullText.slice(0, 300) + '...';
  const timeStr = formatTimeAgo(item.pubDate);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full border-b border-white/[0.04] hover:bg-surface-1/30 transition-colors"
    >
      <div className="px-4 py-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-11 h-11 rounded-full overflow-hidden bg-surface-2 flex items-center justify-center shrink-0 border border-white/[0.08]">
            {item.avatar ? (
              <img src={item.avatar} alt={item.source} className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg">📰</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Header: source name + time */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-text-primary text-sm truncate">{item.source}</span>
              <span className="w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center shrink-0">
                <Icon name="check" size={10} className="text-bg-dark" />
              </span>
              <span className="text-text-muted text-sm truncate">@{item.source?.toLowerCase().replace(/[^a-z0-9]/g, '')}</span>
              <span className="text-text-muted text-xs shrink-0">· {timeStr}</span>
            </div>

            {/* Title */}
            <h3 className="font-syne font-bold text-text-primary text-[15px] leading-snug mt-1.5">
              {item.title}
            </h3>

            {/* Article preview text - first 300 chars + always show Read more toggle */}
            <div className="mt-1.5">
              {fullText ? (
                <p className="text-text-primary text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {displayText}
                </p>
              ) : (
                <p className="text-text-secondary text-[15px] leading-relaxed">
                  {item.title}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {shouldTruncate && (
                  <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-brand-violet-light text-xs font-semibold hover:underline"
                  >
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted text-xs font-semibold hover:text-brand-violet-light hover:underline"
                >
                  Open on {item.source} →
                </a>
              </div>
            </div>

            {/* Media: video takes priority over image */}
            {hasVideo ? (
              <EmbedVideoPlayer
                videoId={item.youtubeVideoId}
                thumbnail={item.thumbnail}
                onClickFullscreen={() => onOpenVideo?.(item)}
              />
            ) : hasImage ? (
              <div className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] aspect-video bg-black">
                <img
                  src={item.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={() => setImgError(true)}
                />
              </div>
            ) : null}

            {/* Bottom bar */}
            <div className="flex items-center justify-between mt-3 -ml-2">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-violet-light transition-colors"
              >
                <Icon name="open_in_new" size={18} />
                <span className="text-xs font-dmmono">Read</span>
              </a>

              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({ title: item.title, url: item.link }).catch(() => {});
                  } else {
                    navigator.clipboard?.writeText(item.link);
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-violet transition-colors"
              >
                <Icon name="share" size={18} />
                <span className="text-xs font-dmmono">Share</span>
              </button>

              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-gold transition-colors"
              >
                <Icon name="bookmark_border" size={18} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
