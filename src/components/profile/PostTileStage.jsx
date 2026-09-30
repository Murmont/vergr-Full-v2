// PostTileStage — the fixed 4:5 picture area of a profile post tile.
//
// Founder, 2026-09-14: "if a user posts a clip without text then all the elements
// like the like comments share repost etc push up ... we need a different post
// card, instagram does not have this problem". A feed card is as tall as its own
// text, so two side by side can never line up. A tile has a FIXED shape: header,
// this 4:5 stage, a two-line caption slot and the action row, so every tile in a
// row is the same height and every action row sits on the same line. Instagram's
// profile grid works the same way (one shape for every tile, 3:4 since 2025).
//
// Every post type gets a stage that fills the same box:
//   image / video / clip / embed  the media, uncropped, over a blurred fill of
//                                 itself (never crop for the user)
//   text                          the words themselves, large, on a tinted panel
//   poll, article, looking-for-group, tier list, achievement: their own panel
//
// ⚠ PURE AND FREE. No hooks that read, no network beyond the media URLs the post
// already carries. It must never import PostCard (PostCard imports this).
import { useState } from 'react';
import Icon from '../Icon';
import { compactCount, isShortFormat } from '../../utils/helpers';
import { parseVideoUrl, getThumbnailUrl } from '../EmbedVideoPlayer';

const VIDEO_RE = /\.(mp4|webm|mov|m4v|m3u8|ogg)(\?|#|$)/i;
const SOLID = '#15151F';
// A tinted panel for posts whose content IS text. Solid: the colour-mix is
// dropped by an old WebView and the plain colour shows instead.
const TEXT_BG = {
  backgroundColor: '#1A1628',
  backgroundImage: 'linear-gradient(160deg, color-mix(in srgb, var(--vg-accent, #7B1FFF) 24%, #14141F) 0%, #14141F 88%)',
};
const clamp = (lines) => ({ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' });

const mediaUrlsOf = (post) => {
  if (post?.mediaUrls?.length) return post.mediaUrls;
  if (post?.mediaUrl) return [post.mediaUrl];
  return [];
};

/** What the stage draws for this post. */
export function tileKind(post) {
  if (!post) return 'missing';
  if (post.locked?.priceCoins > 0) return 'locked';
  if (post.youtubeVideoId || post.embedVideoUrl) return 'embed';
  const urls = mediaUrlsOf(post);
  if (urls.length || post.thumbnailUrl) {
    if (isShortFormat(post.type) || post.type === 'video' || VIDEO_RE.test(urls[0] || '')) return 'video';
    return 'image';
  }
  if (post.type === 'poll') return 'poll';
  if (post.type === 'article' && post.articleData) return 'article';
  if (post.type === 'lfg' && post.lfgData) return 'lfg';
  if (post.type === 'tierlist' && post.tierListData?.tiers?.length) return 'tierlist';
  if (post.type === 'achievement' && post.achievementData) return 'achievement';
  if (post.linkPreview?.image) return 'link';
  return 'text';
}

/** True when the stage already shows the post's words, so the caption slot must not repeat them. */
export const tileStageShowsText = (post) => ['text', 'poll'].includes(tileKind(post));

function Placeholder({ icon, label }) {
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted" style={{ background: SOLID }}>
      <Icon name={icon} size={28} />
      {label && <span className="text-[12px] font-semibold">{label}</span>}
    </span>
  );
}

function ImageFill({ src }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Placeholder icon="image" />;
  return (
    <>
      <img src={src} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40" />
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-contain" />
    </>
  );
}

function PlayDisc() {
  return (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: SOLID }}>
        <Icon name="play_arrow" size={26} className="text-white" filled />
      </span>
    </span>
  );
}

function Label({ icon, text, color }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color }}>
      <Icon name={icon} size={14} /> {text}
    </span>
  );
}

function TextPanel({ text }) {
  const len = text.length;
  const s = len <= 70 ? { fs: 24, lh: 31, lines: 9, w: 700 }
    : len <= 160 ? { fs: 19, lh: 26, lines: 11, w: 600 }
    : { fs: 15, lh: 22, lines: 13, w: 500 };
  return (
    <span className="absolute inset-0 flex p-5 text-left" style={{ ...TEXT_BG, alignItems: len <= 160 ? 'center' : 'flex-start' }}>
      <span className="block text-white break-words whitespace-pre-line" style={{ fontSize: s.fs, lineHeight: `${s.lh}px`, fontWeight: s.w, ...clamp(s.lines) }}>
        {text || 'Post'}
      </span>
    </span>
  );
}

function InfoPanel({ icon, label, color, title, body, children }) {
  return (
    <span className="absolute inset-0 flex flex-col justify-center gap-2.5 p-5 text-left" style={TEXT_BG}>
      <Label icon={icon} text={label} color={color} />
      {title && <span className="block font-syne text-white text-[20px] leading-[26px] font-bold" style={clamp(4)}>{title}</span>}
      {body && <span className="block text-text-secondary text-[14px] leading-[21px]" style={clamp(6)}>{body}</span>}
      {children}
    </span>
  );
}

function PollPanel({ post, text }) {
  const opts = (post.options || []).map((o) => (typeof o === 'string' ? o : (o?.text || o?.label || ''))).filter(Boolean);
  return (
    <span className="absolute inset-0 flex flex-col justify-center gap-2.5 p-5 text-left" style={TEXT_BG}>
      <Label icon="poll" text="Poll" color="#B44FFF" />
      <span className="block text-white text-[18px] leading-[24px] font-bold" style={clamp(3)}>{text || 'Poll'}</span>
      <span className="flex flex-col gap-1.5">
        {opts.slice(0, 4).map((o, i) => (
          <span key={i} className="h-9 px-3 rounded-lg flex items-center text-[13px] text-text-primary" style={{ background: '#1E1E2C' }}>
            <span className="truncate">{o}</span>
          </span>
        ))}
        {opts.length > 4 && <span className="text-[12px] text-text-muted">+{opts.length - 4} more</span>}
      </span>
      <span className="text-[12px] text-text-muted tabular-nums">{compactCount(post.totalVotes || 0)} votes</span>
    </span>
  );
}

const ACHIEVEMENT = {
  win: ['emoji_events', '#F5C542'], rank: ['military_tech', '#B44FFF'], milestone: ['flag', '#7B6FFF'],
  record: ['speed', '#FF4D6A'], unlock: ['lock_open', '#C87FFF'], other: ['star', '#F5C542'],
};

export default function PostTileStage({ post, text = '' }) {
  const kind = tileKind(post);

  if (kind === 'missing') return <Placeholder icon="hide_source" label="Post unavailable" />;

  if (kind === 'locked') {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={TEXT_BG}>
        <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: SOLID }}>
          <Icon name="lock" size={24} className="text-white" />
        </span>
        <span className="text-[13px] font-bold text-white">Unlock for {compactCount(post.locked.priceCoins)} coins</span>
      </span>
    );
  }

  if (kind === 'embed') {
    const parsed = post.youtubeVideoId ? { platform: 'youtube', videoId: post.youtubeVideoId } : parseVideoUrl(post.embedVideoUrl);
    return (<><ImageFill src={post.thumbnailUrl || getThumbnailUrl(parsed)} /><PlayDisc /></>);
  }

  if (kind === 'video') {
    const first = mediaUrlsOf(post)[0];
    return (
      <>
        {post.thumbnailUrl
          ? <ImageFill src={post.thumbnailUrl} />
          : (
            <video
              src={first.includes('#') ? first : `${first}#t=0.1`}
              muted playsInline preload="metadata" tabIndex={-1} aria-hidden
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
          )}
        {isShortFormat(post.type) && (
          <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-brand-ember text-white text-[9px] font-bold uppercase tracking-wider">Clip</span>
        )}
        <PlayDisc />
      </>
    );
  }

  if (kind === 'image') {
    const urls = mediaUrlsOf(post);
    return (
      <>
        <ImageFill src={urls[0]} />
        {urls.length > 1 && (
          <span className="absolute top-2.5 right-2.5 h-7 px-2 rounded-full flex items-center gap-1 text-white text-[11px] font-bold tabular-nums" style={{ background: SOLID }}>
            <Icon name="collections" size={14} filled /> {urls.length}
          </span>
        )}
      </>
    );
  }

  if (kind === 'poll') return <PollPanel post={post} text={text} />;

  if (kind === 'article') {
    const d = post.articleData;
    const cover = d.coverUrl || d.coverImage || d.cover || d.imageUrl;
    if (cover) {
      return (
        <>
          <ImageFill src={cover} />
          <span className="absolute inset-x-0 bottom-0 p-3.5 flex flex-col gap-1 text-left" style={{ background: SOLID }}>
            <Label icon="article" text={`Article · ${d.readTime || 1} min`} color="#C87FFF" />
            <span className="block text-white text-[15px] leading-[20px] font-bold" style={clamp(2)}>{d.title}</span>
          </span>
        </>
      );
    }
    return <InfoPanel icon="article" label={`Article · ${d.readTime || 1} min read`} color="#C87FFF" title={d.title} body={d.body} />;
  }

  if (kind === 'lfg') {
    const d = post.lfgData;
    const facts = [d.platform, d.region, d.rank].filter(Boolean).join(' · ');
    const need = d.playersNeeded ? `Need ${d.playersNeeded} player${d.playersNeeded > 1 ? 's' : ''}` : '';
    return <InfoPanel icon="group_add" label="Looking for group" color="#F5C542" title={d.game || 'Teammates wanted'} body={[facts, need].filter(Boolean).join('\n')} />;
  }

  if (kind === 'tierlist') {
    const tiers = post.tierListData.tiers.filter((t) => t.items?.length).slice(0, 5);
    return (
      <InfoPanel icon="format_list_numbered" label="Tier list" color="#B44FFF" title={text || null}>
        <span className="flex flex-col gap-1.5">
          {tiers.map((t) => (
            <span key={t.label} className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center font-syne font-black text-[13px] text-white" style={{ background: t.color || '#26263A' }}>{t.label}</span>
              <span className="truncate text-[13px] text-text-secondary">{t.items.join(', ')}</span>
            </span>
          ))}
        </span>
      </InfoPanel>
    );
  }

  if (kind === 'achievement') {
    const d = post.achievementData;
    const [icon, color] = ACHIEVEMENT[d.achievementType] || ACHIEVEMENT.other;
    return <InfoPanel icon={icon} label={d.game || 'Achievement'} color={color} title={d.title} body={d.description} />;
  }

  if (kind === 'link') {
    return (
      <>
        <ImageFill src={post.linkPreview.image} />
        <span className="absolute inset-x-0 bottom-0 p-3.5 text-left" style={{ background: SOLID }}>
          <span className="block text-white text-[14px] leading-[19px] font-bold" style={clamp(2)}>{post.linkPreview.title}</span>
        </span>
      </>
    );
  }

  return <TextPanel text={text} />;
}
