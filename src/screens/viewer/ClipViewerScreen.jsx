import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser, toggleLike, incrementShareCount, getComments } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import VergrAd from '../../components/VergrAd';
import { ADS_CONFIG } from '../../config/ads';
import InlineVideoPlayer from '../../components/media/InlineVideoPlayer';
import { getEmbedUrl } from '../../components/EmbedVideoPlayer';
import { triggerInterstitial } from '../../utils/interstitialAd';
import { timeAgo } from '../../utils/helpers';

/**
 * Full-screen vertical video viewer.
 * Opens when tapping a clip/video post.
 * Supports both uploaded videos and embedded YouTube/Twitch videos.
 * Swipe up for next, swipe down for previous. Video loops.
 * Engagement bar on right side (TikTok-style).
 */
export default function ClipViewerScreen() {
  const { postId } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Fire PropellerAds interstitial when the user enters fullscreen video mode.
  // This is the highest-intent video moment in the app, and the cooldown
  // inside triggerInterstitial() ensures we don't fire it again on every
  // swipe to the next clip.
  useEffect(() => { triggerInterstitial(); }, []);

  const [clips, setClips] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const containerRef = useRef(null);
  const touchStartY = useRef(0);
  const isScrolling = useRef(false);

  // Load the target clip + more clips
  useEffect(() => {
    const loadClips = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'posts'),
          where('status', '==', 'published'),
          where('type', 'in', ['clip', 'video']),
          orderBy('createdAt', 'desc'),
          limit(30)
        );
        const snap = await getDocs(q);
        const all = [];
        let targetIdx = 0;

        for (const d of snap.docs) {
          const post = { id: d.id, ...d.data() };
          post.author = await getUser(post.authorId);
          // Get the video URL — support both uploaded and embedded videos
          post.videoUrl = post.mediaUrls?.[0] || post.mediaUrl || null;
          post.isEmbed = !!(post.embedVideoUrl || post.youtubeVideoId);
          if (post.isEmbed) {
            post.embedParsed = post.youtubeVideoId
              ? { platform: 'youtube', videoId: post.youtubeVideoId }
              : null;
          }
          if (post.videoUrl || post.isEmbed) {
            // postId may be a doc id or a SEO slug (news/article posts).
            if (post.id === postId || post.slug === postId) targetIdx = all.length;
            all.push(post);
          }
        }

        setClips(all);
        setCurrentIndex(targetIdx);
      } catch (err) {
        console.error('Failed to load clips:', err);
      }
      setLoading(false);
    };
    loadClips();
  }, [postId]);

  const currentClip = clips[currentIndex];

  const goNext = useCallback(() => {
    if (currentIndex < clips.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowComments(false);
      setComments([]);
    }
  }, [currentIndex, clips.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setShowComments(false);
      setComments([]);
    }
  }, [currentIndex]);

  // Load comments when drawer opens
  useEffect(() => {
    if (!showComments || !currentClip?.id) return;
    setCommentsLoading(true);
    getComments(currentClip.id, 50)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [showComments, currentClip?.id]);

  const handleShare = async () => {
    if (!currentClip) return;
    // Use /share/clip/:id (server-rendered OG tags) so messengers show
    // a proper preview card with thumbnail + title instead of a turquoise box.
    const url = `${window.location.origin}/share/clip/${currentClip.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: currentClip.content?.slice(0, 50) || 'Check out this clip on VERGR',
          url,
        });
        incrementShareCount(currentClip.id).catch(() => {});
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        incrementShareCount(currentClip.id).catch(() => {});
      } catch {}
    }
  };

  // Touch/swipe handling
  const touchStartX = useRef(0);
  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    isScrolling.current = false;
  };

  const handleTouchEnd = (e) => {
    if (isScrolling.current) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(deltaY) > 60 && Math.abs(deltaY) > Math.abs(deltaX)) {
      if (deltaY > 0) goNext();
      else goPrev();
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') goNext();
      else if (e.key === 'ArrowUp' || e.key === 'k') goPrev();
      else if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, navigate]);

  // Mouse wheel
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let wheelTimeout;
    const handleWheel = (e) => {
      e.preventDefault();
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        if (e.deltaY > 30) goNext();
        else if (e.deltaY < -30) goPrev();
      }, 100);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [goNext, goPrev]);

  const formatCount = (n) => {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentClip) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center text-white">
        <Icon name="videocam_off" size={48} className="text-text-muted mb-3" />
        <p className="text-text-muted">No clips found</p>
        <button onClick={() => navigate(-1)} className="mt-4 px-6 py-2 rounded-full bg-surface-2 text-sm">Go Back</button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Video — uploaded or embedded */}
      {currentClip.isEmbed ? (
        <EmbedVideoFullscreen
          key={currentClip.id}
          youtubeVideoId={currentClip.youtubeVideoId}
          embedVideoUrl={currentClip.embedVideoUrl}
        />
      ) : (
        <VideoPlayer key={currentClip.id} src={currentClip.videoUrl} poster={currentClip.thumbnailUrl} />
      )}

      {/* Gesture catcher: thin strips on left + right edges that capture
          vertical swipes the iframe would otherwise eat. The center column
          stays clickable so users can hit YouTube's native controls. */}
      {currentClip.isEmbed && (
        <>
          <div
            className="absolute top-16 bottom-32 left-0 w-16 z-[5]"
            style={{ touchAction: 'pan-y' }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
          <div
            className="absolute top-16 bottom-32 right-16 w-16 z-[5]"
            style={{ touchAction: 'pan-y' }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
        </>
      )}

      {/* Top bar — back + clip counter */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-4 pb-8 bg-gradient-to-b from-black/60 to-transparent safe-top">
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <Icon name="arrow_back" size={22} className="text-white" />
        </button>
        <span className="text-white/60 text-xs font-dmmono">{currentIndex + 1} / {clips.length}</span>
      </div>

      {/* Right side engagement bar */}
      <div className="absolute right-3 bottom-32 z-10 flex flex-col items-center gap-5">
        <EngagementButton
          icon="favorite"
          activeIcon="favorite"
          count={currentClip.likeCount}
          active={currentClip.isLiked}
          activeColor="text-brand-ember"
          onTap={() => {
            if (currentUser) toggleLike?.(currentClip.id, currentUser.uid);
          }}
        />
        <EngagementButton
          icon="chat_bubble"
          count={currentClip.commentCount}
          onTap={() => setShowComments(!showComments)}
        />
        <EngagementButton icon="bookmark" count={currentClip.saveCount} />
        <EngagementButton icon="share" count={currentClip.shareCount} onTap={handleShare} />
      </div>

      {/* Bottom info — author, caption */}
      <div className="absolute bottom-0 left-0 right-16 z-10 px-4 pb-6 bg-gradient-to-t from-black/70 via-black/30 to-transparent safe-bottom">
        <div className="flex items-center gap-2.5 mb-2">
          <button onClick={() => navigate(`/user/${currentClip.authorId}`)}>
            <UserAvatar src={currentClip.author?.avatar} size={36} />
          </button>
          <div>
            <p className="text-white font-bold text-sm">{currentClip.author?.displayName || 'User'}</p>
            <p className="text-white/50 text-xs font-dmmono">@{currentClip.author?.username}</p>
          </div>
        </div>
        {currentClip.content && (
          <p className="text-white/90 text-sm leading-relaxed line-clamp-3">{currentClip.content}</p>
        )}
        {currentClip.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {currentClip.hashtags.map(tag => (
              <span key={tag} className="text-brand-violet-light text-xs font-semibold">#{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Scroll hint */}
      {currentIndex === 0 && clips.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 ">
          <Icon name="keyboard_arrow_up" size={28} className="text-white/40" />
        </div>
      )}

      {/* Comments drawer */}
      {showComments && (
        <div className="absolute inset-x-0 bottom-0 z-20 h-[60vh] bg-surface-1 rounded-t-3xl border-t border-white/[0.04] shadow-2xl animate-slide-up flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.03] shrink-0">
            <h3 className="font-syne font-bold text-sm">Comments ({currentClip.commentCount || comments.length || 0})</h3>
            <button onClick={() => setShowComments(false)} className="text-text-muted"><Icon name="close" size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {commentsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-10">
                <Icon name="chat_bubble_outline" size={36} className="text-text-muted/30 mx-auto mb-2" />
                <p className="text-text-muted text-sm">No comments yet</p>
                <button
                  onClick={() => { setShowComments(false); navigate(`/post/${currentClip.id}`); }}
                  className="mt-3 text-brand-violet-light text-xs font-semibold hover:underline"
                >
                  Be the first to comment
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {comments.map((c, ci) => (
                  <Fragment key={c.id}>
                  <div className="flex gap-2.5">
                    <UserAvatar src={c.author?.avatar} size={30} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-text-primary text-xs font-semibold truncate">{c.author?.displayName || 'User'}</span>
                        <span className="text-text-muted text-[10px] font-dmmono">· {timeAgo(c.createdAt?.toDate ? c.createdAt.toDate() : c.createdAt)}</span>
                      </div>
                      {c.content && <p className="text-text-secondary text-xs leading-relaxed break-words">{c.content}</p>}
                      {c.mediaUrl && (
                        <div className="mt-1.5 rounded-lg overflow-hidden border border-white/[0.06] max-w-[200px]">
                          {c.mediaType === 'video' || c.mediaType === 'clip'
                            ? <InlineVideoPlayer src={c.mediaUrl} maxHeightClass="max-h-[180px]" objectFit="contain" />
                            : <img src={c.mediaUrl} alt="" className="w-full h-auto max-h-[180px] object-cover" />}
                        </div>
                      )}
                    </div>
                  </div>
                  {(ci + 1) % ADS_CONFIG.commentAdInterval === 0 && ci < comments.length - 1 && <VergrAd zone="inpage" />}
                  </Fragment>
                ))}
                <button
                  onClick={() => { setShowComments(false); navigate(`/post/${currentClip.id}`); }}
                  className="w-full text-center text-brand-violet-light text-xs font-semibold py-2 hover:underline"
                >
                  Add a comment →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Video Player component with loop ───
function VideoPlayer({ src, poster }) {
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {});
    setPaused(false);
  }, [src]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black" onClick={togglePlay}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        loop
        playsInline
        muted={false}
        className="w-full h-full object-contain"
      />
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={40} className="text-white" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Embedded video fullscreen (YouTube/Twitch) ───
function EmbedVideoFullscreen({ youtubeVideoId, embedVideoUrl }) {
  const iframeRef = useRef(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  let embedSrc;
  let posterUrl = null;
  if (youtubeVideoId) {
    embedSrc = `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&mute=0`;
    posterUrl = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;
  } else if (embedVideoUrl) {
    const parsed = (() => {
      const match = embedVideoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match) return { platform: 'youtube', videoId: match[1] };
      const twitchClip = embedVideoUrl.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/);
      if (twitchClip) return { platform: 'twitch-clip', videoId: twitchClip[1] };
      const twitchVod = embedVideoUrl.match(/twitch\.tv\/videos\/(\d+)/);
      if (twitchVod) return { platform: 'twitch-vod', videoId: twitchVod[1] };
      return null;
    })();
    if (parsed?.platform === 'youtube') {
      posterUrl = `https://img.youtube.com/vi/${parsed.videoId}/hqdefault.jpg`;
    }
    embedSrc = parsed ? getEmbedUrl(parsed, true)?.replace('mute=1', 'mute=0')?.replace('muted=true', 'muted=false') : null;
  }

  if (!embedSrc) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      {/* Poster behind the iframe so the screen isn't blank while YouTube boots */}
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${iframeLoaded ? 'opacity-0' : 'opacity-100'}`}
        />
      )}
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={embedSrc}
        onLoad={() => setIframeLoaded(true)}
        className="w-full h-full relative z-[1]"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        frameBorder="0"
        title="Video"
      />
    </div>
  );
}

// ─── Engagement button ───
function EngagementButton({ icon, activeIcon, count, active, activeColor, onTap }) {
  const [isActive, setIsActive] = useState(active);

  return (
    <button
      onClick={() => { setIsActive(!isActive); onTap?.(); }}
      className="flex flex-col items-center gap-0.5"
    >
      <div className={`w-11 h-11 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center ${isActive && activeColor ? activeColor : 'text-white'}`}>
        <Icon name={isActive && activeIcon ? activeIcon : icon} filled={isActive} size={24} />
      </div>
      <span className="text-white text-[10px] font-dmmono font-bold">
        {count ? (count >= 1000 ? (count / 1000).toFixed(1) + 'K' : count) : ''}
      </span>
    </button>
  );
}
