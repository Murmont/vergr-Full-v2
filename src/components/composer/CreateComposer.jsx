import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, createPoll, getAudienceActivity, searchUsers, getFollowing, getTrendingHashtags, searchHashtags, editPost } from '../../firebase/firestore';
import { getLockedUploadUrl, createLockedPost, putSignedUpload, makeBlurredPreview } from '../../firebase/firestore';
import PriceSheet from '../monetization/PriceSheet';
import { compressVideo, compressMedia, getMediaDimensions } from '../../utils/mediaCompression';
import { uploadToR2 } from '../../utils/r2Storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { getPrivacy, passesVisibility } from '../../utils/privacy';
import { CONTENT_TOPICS } from '../../utils/constants';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import MediaPanel from '../MediaPanel';
import EmojiPicker from '../EmojiPicker';
import RichTextArea from './RichTextArea';
import { stripPostFormatting } from '../PostRichText';
import '../../styles/composer.css';
import { resolveTier } from '../../utils/tierSystem';

// A real mention only ever comes from this list — followed accounts who
// haven't restricted "who can tag me" below Everyone/Friends&Followers. This
// is also what the inline "@" dropdown and the toolbar "Tag players" tool
// both search, so there's exactly one tagging path with one set of rules.
async function searchMentionCandidates(query, followingIds) {
  if (!followingIds || followingIds.size === 0) return [];
  const results = await searchUsers(query, 20).catch(() => []);
  return results
    .filter(u => followingIds.has(u.id))
    .filter(u => passesVisibility(getPrivacy(u).tagMe, { viewerFollowsTarget: true }))
    .slice(0, 6);
}

/* Map the design pack's icon names → loaded material-symbols-outlined. */
const ICON = {
  bolt: 'bolt', flame: 'local_fire_department', target: 'ads_click', trophy: 'emoji_events', trophy2: 'emoji_events',
  radio: 'sensors', film: 'movie', poll: 'bar_chart', users: 'group',
  image: 'image', gif: 'gif_box', sticky: 'sticky_note_2', clip: 'movie', mood: 'mood', stats: 'insights',
  'tag-users': 'alternate_email', pin: 'location_on', smile: 'sentiment_satisfied', 'image-play': 'perm_media',
  plus: 'add', x: 'close', 'chevron-right': 'chevron_right', 'chevron-left': 'chevron_left',
  'caret-down': 'expand_more', 'caret-up': 'expand_less', calendar: 'calendar_month', send: 'send',
  sparkle: 'auto_awesome', 'sparkle-sm': 'auto_awesome', globe: 'public', clock: 'schedule',
  bold: 'format_bold', palette: 'palette', list: 'format_list_bulleted',
  grip: 'drag_indicator', draft: 'description', info: 'info', bell: 'notifications', chat: 'chat_bubble',
  heart: 'favorite', more: 'more_horiz', 'arrow-share': 'ios_share', wifi: 'wifi', battery: 'battery_full',
};
const CIcon = ({ name, size = 18, className = '' }) => <Icon name={ICON[name] || name} size={size} className={className} />;

// Each chip drops a real prompt prefix into the composer ('' = neutral default).
const QUICK_CHIPS = [
  { id: 'mind', label: "What's on your mind?", icon: 'bolt', color: 'var(--cyan)', prefix: '' },
  { id: 'hot', label: 'Hot take', icon: 'flame', color: 'var(--pink)', prefix: 'Hot take: ' },
  { id: 'strat', label: 'Strategy', icon: 'target', color: 'var(--violet)', prefix: 'Strategy: ' },
  { id: 'ach', label: 'Achievement', icon: 'trophy', color: 'var(--gold)', prefix: 'Achievement unlocked: ' },
];

const TOOLS = [
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'gif', label: 'GIF', icon: 'gif' },
  { id: 'poll', label: 'Poll', icon: 'sticky' },
  { id: 'clip', label: 'Clip', icon: 'clip' },
  { id: 'mood', label: 'Mood', icon: 'mood' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'tag', label: 'Tag players', icon: 'tag-users' },
  { id: 'loc', label: 'Location', icon: 'pin' },
];

const MOODS = [
  { e: '😄', l: 'happy' }, { e: '🔥', l: 'hyped' }, { e: '😎', l: 'chill' }, { e: '🎮', l: 'gaming' }, { e: '🏆', l: 'winning' },
  { e: '😤', l: 'locked in' }, { e: '😢', l: 'sad' }, { e: '😡', l: 'tilted' }, { e: '🤯', l: 'mind blown' }, { e: '😴', l: 'tired' },
];

const VIS_OPTIONS = [
  { id: 'public', title: 'Public', sub: 'Anyone on VERGR', icon: 'globe' },
  { id: 'followers', title: 'Followers', sub: 'People who follow you', icon: 'users' },
  { id: 'squad', title: 'Squad only', sub: 'Your squad members', icon: 'sticky' },
];

const OPTION_COLORS = ['#A87FFF', '#4D8AFF', '#B44FFF', '#FF9F45', '#FF4D6A', '#F5C542'];

// On-brand swatches for the composer's text-colour tool (no cyan — off-brand
// for new UI per design guidance; white doubles as a "reset to default" pick).
const TEXT_COLORS = ['#FFFFFF', '#7B1FFF', '#B44FFF', '#C87FFF', '#F0A500', '#F5C842', '#F04060', '#3D7FFF'];

const POLL_TEMPLATES = [
  { id: 'load', name: 'Best Loadout', sub: 'Find the meta', icon: 'target' },
  { id: 'who', name: 'Who Wins?', sub: 'Match predictions', icon: 'trophy' },
  { id: 'patch', name: 'Patch Opinion', sub: 'Rate the update', icon: 'stats' },
  { id: 'rate', name: 'Rate This Clip', sub: 'Community feedback', icon: 'clip' },
];

const Toggle = ({ on, onChange, label }) => (
  <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
    <span className="sw" />
    {label && <span>{label}</span>}
  </button>
);

const MAX_TAGS = 12;
const cleanTag = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i;
// Post types the composer can fully round-trip (text + media). Structured
// posts (poll/article/tierlist/achievement/lfg/repost/quote) keep their
// original type + structured data on edit — we only touch their caption text.
const STD_EDIT_TYPES = ['text', 'photo', 'carousel', 'media', 'video', 'clip', 'link'];

// Dedicated hashtag input: tags are ONLY what the user explicitly adds here
// (nothing is silently scraped from the post body anymore). As you type it
// completes the word / shows related tags (live prefix search of the trending
// `hashtags` collection), and a suggestion row surfaces your interests +
// what's trending so tags are one tap away.
const HashtagField = ({ tags, onAdd, onRemove, interests, trending }) => {
  const [inputVal, setInputVal] = useState('');
  const [matches, setMatches] = useState([]);
  const searchId = useRef(0);

  useEffect(() => {
    const q = cleanTag(inputVal);
    if (!q) { setMatches([]); return; }
    const id = ++searchId.current;
    const t = setTimeout(() => {
      const local = [...new Set([...interests, ...trending])].filter(x => x.startsWith(q) && !tags.includes(x));
      searchHashtags(q, 6)
        .then(remote => { if (id === searchId.current) setMatches([...new Set([...local, ...remote, q])].filter(x => !tags.includes(x)).slice(0, 8)); })
        .catch(() => { if (id === searchId.current) setMatches([...new Set([...local, q])].slice(0, 8)); });
    }, 200);
    return () => clearTimeout(t);
  }, [inputVal, tags, interests, trending]);

  const commit = (val) => { const t = cleanTag(val ?? inputVal); if (t) onAdd(t); setInputVal(''); setMatches([]); };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { if (inputVal.trim()) { e.preventDefault(); commit(); } }
    else if (e.key === 'Backspace' && !inputVal && tags.length) { onRemove(tags[tags.length - 1]); }
  };
  const suggestChips = [...new Set([...interests, ...trending])].filter(x => !tags.includes(x)).slice(0, 10);
  const atLimit = tags.length >= MAX_TAGS;

  return (
    <div className="section" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <CIcon name="tag" size={16} className="" />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Hashtags</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{tags.length}/{MAX_TAGS} · help people discover your post</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, borderRadius: 12, background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        {tags.map(t => (
          <button key={t} type="button" onClick={() => onRemove(t)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'rgba(123,31,255,0.16)', border: '1px solid rgba(123,31,255,0.4)', color: 'var(--violet-light, #B44FFF)', fontSize: 12, fontWeight: 700 }}>
            #{t}<CIcon name="x" size={11} />
          </button>
        ))}
        {!atLimit && (
          <input value={inputVal} onChange={e => setInputVal(e.target.value.replace(/\s/g, ''))} onKeyDown={onKey}
            placeholder={tags.length ? 'Add another…' : 'Add a hashtag…'}
            style={{ flex: 1, minWidth: 120, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', fontSize: 13 }} />
        )}
      </div>
      {matches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {matches.map(m => (
            <button key={m} type="button" onClick={() => commit(m)}
              style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--surface-2, #1A1A2A)', border: '1px solid var(--border)', color: 'var(--text-2, #e5e7eb)', fontSize: 12 }}>#{m}</button>
          ))}
        </div>
      )}
      {!atLimit && suggestChips.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Suggested for you</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestChips.map(s => (
              <button key={s} type="button" onClick={() => onAdd(s)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-3)', fontSize: 12 }}>
                <CIcon name="plus" size={11} />#{s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* Composer card — module-scope so the editor keeps focus across re-renders.
 * A real WYSIWYG box (RichTextArea): bold/colour/lists show up styled as you
 * apply them, not as raw markup. The editor is uncontrolled — CreateComposer
 * reads its content via richRef (getMarkup) or the onChangeText echo below;
 * it never feeds text back into the DOM. */
const ComposerCard = ({ compact, richRef, onChangeText, activeChip, onChip, followingIds }) => {
  const [colorOpen, setColorOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [mentionQuery, setMentionQuery] = useState(null); // string | null
  const [mentionRect, setMentionRect] = useState(null);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionActive, setMentionActive] = useState(0);
  const mentionSearchIdRef = useRef(0);

  const handleChange = useCallback((markup) => {
    onChangeText(markup);
    setCount(stripPostFormatting(markup).length);
  }, [onChangeText]);

  const insertEmoji = useCallback((emoji) => { richRef.current?.insertAtSaved(emoji); }, [richRef]);
  const closeEmoji = useCallback(() => setEmojiOpen(false), []);
  const noFocusSteal = (e) => e.preventDefault();
  const openEmoji = () => { if (!emojiOpen) richRef.current?.saveSelection(); setEmojiOpen(o => !o); setColorOpen(false); };

  const onMentionQuery = useCallback((query, rect) => {
    setMentionQuery(query);
    setMentionRect(rect || null);
    setMentionActive(0);
    if (query === null) { setMentionResults([]); return; }
    const searchId = ++mentionSearchIdRef.current;
    searchMentionCandidates(query, followingIds).then(list => {
      if (searchId === mentionSearchIdRef.current) setMentionResults(list);
    });
  }, [followingIds]);

  const pickMention = useCallback((u) => {
    richRef.current?.insertMention({ uid: u.id, username: u.username });
    setMentionQuery(null);
    setMentionResults([]);
  }, [richRef]);

  // Arrow keys / Enter / Escape steer the dropdown instead of the editor
  // (default text-editing behaviour) while it's open — capture phase so this
  // runs before the contentEditable's own key handling.
  useEffect(() => {
    if (mentionQuery === null) return;
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionActive(i => Math.min(i + 1, mentionResults.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionActive(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { if (mentionResults[mentionActive]) { e.preventDefault(); pickMention(mentionResults[mentionActive]); } }
      else if (e.key === 'Escape') { setMentionQuery(null); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [mentionQuery, mentionResults, mentionActive, pickMention]);

  useEffect(() => {
    if (mentionQuery === null) return;
    const onDocMouseDown = (e) => {
      if (!e.target.closest('.mention-pop') && !e.target.closest('.rte')) setMentionQuery(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [mentionQuery]);

  return (
    <div className={`composer ${compact ? 'compact' : ''}`}>
      <RichTextArea ref={richRef} compact={compact} maxLength={2000} onChange={handleChange} onMentionQuery={onMentionQuery}
        placeholder="Share a clip, strategy, achievement, or hot take... (@ to tag someone you follow)" />
      {mentionQuery !== null && mentionRect && (
        <div className="mention-pop" onMouseDown={(e) => e.preventDefault()}
          style={{ left: mentionRect.left, top: mentionRect.bottom + 6 }}>
          {mentionResults.length === 0 ? (
            <div className="mention-empty">{mentionQuery ? 'No matching followed users' : 'Keep typing a name…'}</div>
          ) : mentionResults.map((u, i) => (
            <button key={u.id} type="button" className={`mention-row ${i === mentionActive ? 'active' : ''}`} onClick={() => pickMention(u)}>
              <UserAvatar src={u.avatar} size={26} />
              <span><span className="mn">{u.displayName || u.username}</span><span className="mh">@{u.username}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-fmt">
        <button type="button" className="fmt-btn" title="Bold" onMouseDown={noFocusSteal} onClick={() => richRef.current?.toggleBold()}><CIcon name="bold" size={16} /></button>
        <button type="button" className="fmt-btn" title="Bullet list" onMouseDown={noFocusSteal} onClick={() => richRef.current?.toggleBulletList()}><CIcon name="list" size={17} /></button>
        <div className="fmt-wrap">
          <button type="button" className="fmt-btn" title="Text colour" onMouseDown={noFocusSteal} onClick={() => { setColorOpen(o => !o); setEmojiOpen(false); }}><CIcon name="palette" size={16} /></button>
          {colorOpen && (
            <div className="fmt-color-pop">
              {TEXT_COLORS.map(c => (
                <button key={c} type="button" className="fmt-swatch" style={{ background: c }} title={c}
                  onMouseDown={noFocusSteal} onClick={() => { richRef.current?.applyColor(c); setColorOpen(false); }} />
              ))}
            </div>
          )}
        </div>
        <div className="fmt-wrap">
          <button type="button" className="fmt-btn" title="Emoji" onClick={openEmoji}><CIcon name="smile" size={17} /></button>
          {emojiOpen && (
            <div className="fmt-emoji-pop">
              <EmojiPicker onSelect={insertEmoji} onClose={closeEmoji} height={380} emojiSize={28} />
            </div>
          )}
        </div>
      </div>
      <div className="composer-footer">
        {QUICK_CHIPS.map(c => (
          <button key={c.id} className={`chip ${activeChip === c.id ? 'active' : ''}`}
            onClick={() => onChip(c)}
            style={activeChip === c.id ? { color: c.color, borderColor: c.color + '55' } : { color: c.color }}>
            <CIcon name={c.icon} size={14} /><span style={{ color: 'inherit' }}>{c.label}</span>
          </button>
        ))}
        <div className="right"><span className="count">{count} / 2000</span></div>
      </div>
    </div>
  );
};

/* ---------- live poll preview ---------- */
const PollPreview = ({ name, avatar, question, options }) => {
  const total = options.reduce((s, o) => s + (o.pct || 0), 0) || 100;
  return (
    <div className="feed-post">
      <div className="feed-post-head">
        <UserAvatar src={avatar} size={32} />
        <div><div className="nm">{name}</div></div>
        <span className="ts">just now</span>
        <span className="more"><CIcon name="more" size={16} /></span>
      </div>
      <span className="badge-poll"><CIcon name="poll" size={11} /> POLL</span>
      <div className="feed-post-q">{question || 'Ask your community a question…'}</div>
      <div className="feed-post-sub">You can only choose one.</div>
      {options.map((o, i) => {
        const pct = Math.round((o.pct / total) * 100);
        return (
          <div className="bar-row" key={i}>
            <span className="bn">{o.text || `Option ${i + 1}`}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: o.color }} /></div>
            <span className="bv">{pct}%</span>
          </div>
        );
      })}
      <div className="feed-meta">
        <span>0 votes</span><span>·</span><span>open</span>
        <span style={{ marginLeft: 'auto' }} className="a"><CIcon name="heart" size={12} /> 0</span>
        <span className="a"><CIcon name="chat" size={12} /> 0</span>
        <span className="a"><CIcon name="arrow-share" size={12} /> 0</span>
      </div>
    </div>
  );
};

/* ---------- calendar ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const Calendar = ({ selected, onSelect }) => {
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [view, setView] = useState({ year: selected.year, month: selected.month });
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      return { date: d.getDate(), month: d.getMonth(), year: d.getFullYear(), dim: d.getMonth() !== view.month, past: d < today0 };
    });
  }, [view]);
  const prev = () => setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const next = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  return (
    <>
      <div className="cal-head">
        <div className="m">{MONTHS[view.month]} {view.year}</div>
        <div className="cal-nav">
          <button onClick={prev}><CIcon name="chevron-left" size={16} /></button>
          <button onClick={next}><CIcon name="chevron-right" size={16} /></button>
        </div>
      </div>
      <div className="cal-grid">
        {DOW.map(d => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((c, i) => {
          const sel = selected.year === c.year && selected.month === c.month && selected.date === c.date;
          return (
            <button key={i}
              className={`cal-cell ${c.dim ? 'dim' : ''} ${c.past ? 'disabled' : ''} ${sel ? 'selected' : ''}`}
              onClick={() => !c.past && onSelect({ year: c.year, month: c.month, date: c.date })}>
              {c.date}
            </button>
          );
        })}
      </div>
    </>
  );
};

/* ---------- real audience heatmap (from follower presence) ---------- */
const HEAT_LABELS = ['12 AM', '6 AM', '12 PM', '6 PM', 'Late'];
const HEAT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const heatColor = (v) => v <= 0 ? 'rgba(255,255,255,0.04)' : v < 0.2 ? 'rgba(108,80,180,0.35)' : v < 0.4 ? 'rgba(138,90,210,0.55)' : v < 0.6 ? 'rgba(168,127,255,0.75)' : v < 0.8 ? 'rgba(196,90,230,0.85)' : 'rgba(217,70,239,0.95)';
const Heatmap = ({ grid }) => (
  <div className="heat-wrap">
    <div className="heat-head"><div className="t"><CIcon name="info" size={14} /> When your followers are active</div></div>
    <div className="heat-grid" style={{ marginBottom: 4 }}>
      <span />{HEAT_DAYS.map(d => <div key={d} className="heat-col-lbl">{d}</div>)}
    </div>
    {grid.map((row, r) => (
      <div className="heat-grid" key={r} style={{ marginBottom: 3 }}>
        <span className="heat-row-lbl">{HEAT_LABELS[r]}</span>
        {row.map((v, c) => <div key={c} className="heat-cell" style={{ background: heatColor(v) }} />)}
      </div>
    ))}
    <div className="heat-legend"><span>Quiet</span><span className="grad" /><span>Most active</span></div>
  </div>
);

/* ---------- schedule view ---------- */
const ScheduleView = ({ name, avatar, onBack, onConfirm, isPoll, pollState, audience, schedOpts, setSchedOpts }) => {
  const base = new Date(Date.now() + 60 * 60 * 1000);
  const [selected, setSelected] = useState({ year: base.getFullYear(), month: base.getMonth(), date: base.getDate() });
  const [hour, setHour] = useState(((base.getHours() % 12) || 12));
  const [minute, setMinute] = useState(0);
  const [ampm, setAmpm] = useState(base.getHours() >= 12 ? 'PM' : 'AM');
  const [activeSlot, setActiveSlot] = useState(-1);

  const to24 = () => (ampm === 'PM' ? (hour % 12) + 12 : hour % 12);
  const dateObj = new Date(selected.year, selected.month, selected.date, to24(), minute, 0, 0);
  const inPast = dateObj.getTime() <= Date.now();
  const formattedTime = `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
  const formattedDate = `${MONTHS[selected.month]} ${selected.date}, ${selected.year}`;

  const confirm = () => { if (inPast) return; onConfirm({ ms: dateObj.getTime(), formatted: `${MONTHS[selected.month].slice(0, 3)} ${selected.date} · ${formattedTime}` }); };

  const clampMin = (v) => Math.max(0, Math.min(59, v));
  const setOpt = (k, v) => setSchedOpts(o => ({ ...o, [k]: v }));
  const pickSlot = (s, i) => {
    setActiveSlot(i);
    setSelected({ year: s.year, month: s.month, date: s.date });
    setHour((s.hour % 12) || 12); setMinute(0); setAmpm(s.hour >= 12 ? 'PM' : 'AM');
  };
  const fmtSlot = (h) => `${(h % 12) || 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;
  // Honest preview: a brand-new poll has no votes yet, so every option shows 0%.
  const previewOpts = isPoll ? pollState.options.filter(o => o.text).map(o => ({ ...o, pct: 0 })) : [];

  return (
    <>
      <div className="modal-head">
        <div className="left"><button className="x-btn" onClick={onBack}><CIcon name="x" size={18} /></button></div>
        <div className="center">
          <div className="modal-title"><CIcon name="calendar" size={20} /> Schedule {isPoll ? 'poll' : 'post'}</div>
          <div className="modal-sub">Pick the perfect time to reach your followers</div>
        </div>
        <div className="right">
          <button className="btn" onClick={onBack}>Back to editor</button>
          <button className="btn btn-primary" onClick={confirm} disabled={inPast}><CIcon name="send" size={16} /> Confirm schedule</button>
        </div>
      </div>
      <div className="modal-body scroll" style={{ paddingBottom: 32 }}>
        <div className="schedule-grid">
          {/* COL 1 — date & time */}
          <div className="panel">
            <div className="panel-head"><span className="step-num">1</span><span className="t">Select date &amp; time</span></div>
            <Calendar selected={selected} onSelect={setSelected} />
            <div className="field-lbl">Time</div>
            <div className="time-row">
              <div className="time-box">
                <input value={String(hour).padStart(2, '0')} onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, '')) || 0; setHour(Math.max(1, Math.min(12, v))); }} />
              </div>
              <span className="colon">:</span>
              <div className="time-box">
                <input value={String(minute).padStart(2, '0')} onChange={e => setMinute(clampMin(parseInt(e.target.value.replace(/\D/g, '')) || 0))} />
              </div>
              <span />
              <button className="ampm" onClick={() => setAmpm(a => a === 'AM' ? 'PM' : 'AM')}>{ampm} <CIcon name="caret-down" size={14} /></button>
            </div>
            <div className="field-lbl">Quick select</div>
            <div className="quick-chips">
              {['+1 Hour', '+3 Hours', 'Tonight 7PM', 'Tomorrow 9AM', 'This Weekend'].map(q => (
                <button key={q} className="qchip" onClick={() => {
                  const n = new Date();
                  if (q === '+1 Hour') n.setHours(n.getHours() + 1);
                  if (q === '+3 Hours') n.setHours(n.getHours() + 3);
                  if (q === 'Tonight 7PM') n.setHours(19, 0);
                  if (q === 'Tomorrow 9AM') { n.setDate(n.getDate() + 1); n.setHours(9, 0); }
                  if (q === 'This Weekend') { n.setDate(n.getDate() + ((6 - n.getDay() + 7) % 7 || 7)); n.setHours(14, 0); }
                  setSelected({ year: n.getFullYear(), month: n.getMonth(), date: n.getDate() });
                  setHour((n.getHours() % 12) || 12); setMinute(n.getMinutes()); setAmpm(n.getHours() >= 12 ? 'PM' : 'AM'); setActiveSlot(-1);
                }}>{q}</button>
              ))}
            </div>
            {inPast && <div className="field-lbl" style={{ color: 'var(--pink)' }}>Pick a time in the future.</div>}
          </div>

          {/* COL 2 — optimize (real data) */}
          <div className="panel">
            <div className="panel-head">
              <span className="step-num">2</span><span className="t">Optimize</span><span className="opt">(optional)</span>
            </div>
            {!audience ? (
              <div className="opt-best"><div className="opt-best-head"><div><div className="t">Loading follower activity…</div></div></div></div>
            ) : !audience.enough ? (
              <div className="opt-best">
                <div className="opt-best-head"><div>
                  <div className="t">Not enough follower activity yet</div>
                  <div className="s"><CIcon name="info" size={11} /> We need a few active followers to suggest times. Pick any time above.</div>
                </div></div>
              </div>
            ) : (
              <>
                <div className="opt-best">
                  <div className="opt-best-head"><div>
                    <div className="t">Best time to post</div>
                    <div className="s"><CIcon name="info" size={11} /> From {audience.sampleSize} active followers</div>
                  </div></div>
                  <div className="time-slots scroll">
                    {audience.best.map((s, i) => (
                      <button key={i} className={`slot ${activeSlot === i ? 'active' : ''}`} onClick={() => pickSlot(s, i)}>
                        <div className="d">{s.label} {i === 0 && <CIcon name="sparkle-sm" size={11} />}</div>
                        <div className="tm">{fmtSlot(s.hour)}</div>
                        <div className="eng">Peak follower activity</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  <Heatmap grid={audience.grid} />
                </div>
              </>
            )}
            <div className="panel-head" style={{ marginTop: 18, marginBottom: 10 }}><span className="step-num">3</span><span className="t">Additional options</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div className="opt-card"><div className="ic-w"><CIcon name="clock" size={16} /></div><div><div className="t">Allow early posting</div><div className="d">Release up to 15 min early when the batch runs</div></div><div className="sw-w"><Toggle on={!!schedOpts.allowEarly} onChange={v => setOpt('allowEarly', v)} /></div></div>
              <div className="opt-card"><div className="ic-w"><CIcon name="bell" size={16} /></div><div><div className="t">Notify me when it posts</div><div className="d">Get a notification the moment it goes live</div></div><div className="sw-w"><Toggle on={!!schedOpts.reminder} onChange={v => setOpt('reminder', v)} /></div></div>
              <div className="opt-card"><div className="ic-w"><CIcon name="chat" size={16} /></div><div><div className="t">Auto-share to my squads</div><div className="d">Drop a link in your squad chats on publish</div></div><div className="sw-w"><Toggle on={!!schedOpts.autoShareSquad} onChange={v => setOpt('autoShareSquad', v)} /></div></div>
            </div>
          </div>

          {/* COL 3 — preview */}
          <div className="panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Preview</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>How your scheduled {isPoll ? 'poll' : 'post'} will look</p>
            </div>
            <div className="preview-feed">
              <div className="feed-post-head">
                <UserAvatar src={avatar} size={36} />
                <div><div className="nm" style={{ fontSize: 14 }}>{name}</div>{isPoll && <span className="badge-poll" style={{ marginTop: 4 }}><CIcon name="poll" size={11} /> POLL</span>}</div>
                <span className="more"><CIcon name="more" size={16} /></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--text-3)', fontSize: 11 }}>
                <CIcon name="calendar" size={12} /> <span className="mono">Scheduled · {formattedDate.replace(`, ${selected.year}`, '')} · {formattedTime}</span>
              </div>
              {isPoll ? (
                <>
                  <div className="feed-post-q" style={{ marginTop: 10 }}>{pollState.question || 'Your poll question'}</div>
                  {previewOpts.map((o, i) => (
                    <div className="bar-row" key={i}><span className="bn">{o.text}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${o.pct}%`, background: o.color }} /></div><span className="bv">{o.pct}%</span></div>
                  ))}
                  <div className="feed-meta"><span>0 votes</span></div>
                </>
              ) : (
                <div className="feed-post-q" style={{ marginTop: 10 }}>{pollState.text || 'Your post will appear here.'}</div>
              )}
            </div>
            <div className="publish-note" style={{ marginTop: 14 }}>
              <span className="ic"><CIcon name="calendar" size={16} /></span>
              <div><div className="l">This {isPoll ? 'poll' : 'post'} will be published on</div><div className="v">{formattedDate} at {formattedTime}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default function CreateComposer({ onClose, originRect, editingPost = null, onEdited }) {
  const isEditing = !!editingPost;
  const isStdEdit = !isEditing || STD_EDIT_TYPES.includes(editingPost.type);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const richRef = useRef(null);

  const [open, setOpen] = useState(true);
  const [dragIndex, setDragIndex] = useState(null);
  const [mediaDragIndex, setMediaDragIndex] = useState(null);
  const [mediaDragOverIndex, setMediaDragOverIndex] = useState(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const fileDragCounter = useRef(0);
  const [showMediaPanel, setShowMediaPanel] = useState(null);
  const [view, setView] = useState('compose'); // compose | poll | schedule
  const [returnView, setReturnView] = useState('compose');
  const [text, setText] = useState('');
  const [activeChip, setActiveChip] = useState(null);
  const [visibility, setVisibility] = useState('public');
  const [visMenu, setVisMenu] = useState(false);
  // Locked post: 0 = an ordinary post. Locking is a CREATE-TIME choice and
  // cannot be applied later, because an existing post's media is already on a
  // public immutable CDN URL and "locking" it would hide it in the UI while
  // leaving the bytes exactly as reachable (functions/lockedPosts.js).
  const [lockPrice, setLockPrice] = useState(0);
  const [lockSheet, setLockSheet] = useState(false);
  const [media, setMedia] = useState([]);
  // B8: per-media upload state (id → { phase:'optimizing'|'uploading'|'error', pct }).
  // Drives the progress bar / retry chip on each media thumb.
  const [uploads, setUploads] = useState({});
  const uploadedRef = useRef({}); // id → url, cached per attempt so a retry skips done files
  const mediaMetaRef = useRef({}); // id → {w,h} (B11-4): reserved-box dims per media item
  const [tags, setTags] = useState([]);
  const [trendingTags, setTrendingTags] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [schedOpts, setSchedOpts] = useState({ allowEarly: false, reminder: true, autoShareSquad: false });
  const [audience, setAudience] = useState(null);
  const [tipOpen, setTipOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState(null);       // optional CONTENT_TOPICS tag

  // poll state (lifted)
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState([
    { id: 1, text: '', color: OPTION_COLORS[0] },
    { id: 2, text: '', color: OPTION_COLORS[1] },
  ]);
  const [pollDuration, setPollDuration] = useState('24h');
  const [pollMulti, setPollMulti] = useState(false);
  const [pollAnon, setPollAnon] = useState(false);
  const [pollAdv, setPollAdv] = useState(false);
  const [durMenu, setDurMenu] = useState(false);

  const [activeTool, setActiveTool] = useState(null); // mood | stats | tag | loc
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState([]);
  const [statLabel, setStatLabel] = useState('');
  const [statValue, setStatValue] = useState('');
  const [locText, setLocText] = useState('');
  const [followingIds, setFollowingIds] = useState(null); // Set|null — tagging candidates are followed accounts only

  const isPoll = view === 'poll';
  const name = profile?.displayName || profile?.username || 'You';
  const avatar = profile?.avatar || profile?.photoURL;
  const vis = VIS_OPTIONS.find(v => v.id === visibility) || VIS_OPTIONS[0];
  // Scheduling is a Lite/Pro perk; free users see it but get an upgrade prompt.
  // Admins (founder/ops) bypass every paywall.
  const isAdmin = profile?.role === 'admin' || (profile?.email || '').toLowerCase() === 'vergenerd@gmail.com';
  const tier = isAdmin ? 'pro' : resolveTier(profile);
  const isPaid = tier === 'lite' || tier === 'pro';
  // Only the official @Vergr account (or an admin) can post platform
  // announcements — pinned to every feed + a broadcast push to all devices.
  const canAnnounce = String(profile?.username || '').toLowerCase() === 'vergr' || isAdmin;
  const [asAnnouncement, setAsAnnouncement] = useState(false);

  const requestClose = () => { if (!loading) setOpen(false); };

  const insertText = (s) => { richRef.current?.appendText(s); };
  const toggleTool = (id) => setActiveTool(t => t === id ? null : id);

  // Tag-players tool searches the SAME candidate pool as the inline "@"
  // dropdown — followed accounts who allow tagging (see searchMentionCandidates).
  useEffect(() => {
    if (activeTool !== 'tag' || !tagQuery.trim() || !followingIds) { setTagResults([]); return; }
    let alive = true;
    const id = setTimeout(() => { searchMentionCandidates(tagQuery.trim(), followingIds).then(r => { if (alive) setTagResults(r || []); }).catch(() => {}); }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [activeTool, tagQuery, followingIds]);

  // Load real follower-activity once (drives the Optimize panel + heatmap).
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let alive = true;
    getAudienceActivity(uid).then(a => { if (alive) setAudience(a); }).catch(() => { if (alive) setAudience({ enough: false, sampleSize: 0, grid: [], best: [] }); });
    return () => { alive = false; };
  }, []);

  // Who you can tag = who you follow (+ their own "who can tag me" setting,
  // checked in searchMentionCandidates). Fetched once per composer session.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let alive = true;
    getFollowing(uid).then(list => { if (alive) setFollowingIds(new Set((list || []).map(f => f.followingId))); }).catch(() => { if (alive) setFollowingIds(new Set()); });
    return () => { alive = false; };
  }, []);

  // Hashtag suggestions = the user's interests (gameTags) + what's trending.
  const interests = useMemo(() => [...new Set((profile?.gameTags || []).map(cleanTag).filter(Boolean))], [profile?.gameTags]);
  useEffect(() => { getTrendingHashtags(12).then(t => setTrendingTags((t || []).map(cleanTag).filter(Boolean))).catch(() => {}); }, []);
  const addTag = useCallback((t) => { const c = cleanTag(t); if (!c) return; setTags(prev => (prev.includes(c) || prev.length >= MAX_TAGS) ? prev : [...prev, c]); }, []);
  const removeTag = useCallback((t) => setTags(prev => prev.filter(x => x !== t)), []);

  // EDIT MODE: seed the whole composer from the post being edited so the user
  // gets the real editor (formatting, colour, lists, media, hashtags), not a
  // raw-markup textarea. Runs once when the composer opens on a post.
  useEffect(() => {
    if (!editingPost) return;
    const body = editingPost.content ?? editingPost.previewText ?? '';
    richRef.current?.setMarkup(body);
    setText(body);
    if (editingPost.visibility) setVisibility(editingPost.visibility);
    if (editingPost.topic) setTopic(editingPost.topic);
    if (Array.isArray(editingPost.hashtags)) setTags(editingPost.hashtags.map(cleanTag).filter(Boolean));
    const urls = editingPost.mediaUrls?.length ? editingPost.mediaUrls : (editingPost.mediaUrl ? [editingPost.mediaUrl] : []);
    if (isStdEdit && urls.length) {
      const single = urls.length === 1;
      setMedia(urls.map(u => ({
        id: Math.random().toString(36).slice(2), url: u, preview: u,
        type: VIDEO_EXT_RE.test(u) || ((editingPost.type === 'clip' || editingPost.type === 'video') && single) ? 'video' : 'image',
      })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPost]);

  const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const ox = originRect ? originRect.left + originRect.width / 2 : cx;
  const oy = originRect ? originRect.top + originRect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight : 0);
  const fly = { opacity: 0, scale: 0.12, x: ox - cx, y: oy - cy };

  const addFiles = (fileList, kind) => {
    const files = Array.from(fileList || []);
    const items = files.map(file => ({ id: Math.random().toString(36).slice(2), file, preview: URL.createObjectURL(file), type: kind === 'clip' || file.type.startsWith('video/') ? 'video' : 'image' }));
    if (items.length) setMedia(prev => [...prev, ...items]);
  };
  const removeMedia = (id) => setMedia(prev => { const it = prev.find(m => m.id === id); if (it) URL.revokeObjectURL(it.preview); return prev.filter(m => m.id !== id); });
  const reorderMedia = (from, to) => setMedia(prev => {
    if (from == null || to == null || from === to || from >= prev.length) return prev;
    const next = [...prev]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    return next;
  });

  // OS file drag-and-drop onto the Add-media section (images + videos).
  const handleFileDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!e.dataTransfer?.types?.includes('Files')) return;
    fileDragCounter.current += 1;
    setIsFileDropActive(true);
  };
  const handleFileDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleFileDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    fileDragCounter.current -= 1;
    if (fileDragCounter.current <= 0) { fileDragCounter.current = 0; setIsFileDropActive(false); }
  };
  // Single drop handler for the whole media area — a drop can land on the empty
  // dropzone, on a thumbnail (reorder target), or carry real OS files (add media).
  // Individual thumbnails no longer own their own onDrop, so a file dropped
  // directly on top of an existing thumbnail still gets added instead of being
  // silently swallowed by that thumbnail's reorder logic.
  const handleFileDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    fileDragCounter.current = 0;
    setIsFileDropActive(false);
    if (mediaDragIndex !== null) {
      const to = mediaDragOverIndex !== null ? mediaDragOverIndex : mediaDragIndex;
      reorderMedia(mediaDragIndex, to);
      setMediaDragIndex(null); setMediaDragOverIndex(null);
      return;
    }
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files, 'media');
  };

  const updateOpt = (i, v) => setPollOpts(o => o.map((x, j) => j === i ? { ...x, text: v } : x));
  const rmOpt = (i) => setPollOpts(o => o.length > 2 ? o.filter((_, j) => j !== i) : o);
  const addOpt = () => setPollOpts(o => o.length < 6 ? [...o, { id: Date.now(), text: '', color: OPTION_COLORS[o.length % OPTION_COLORS.length] }] : o);
  const reorderOpt = (from, to) => setPollOpts(o => {
    if (from == null || to == null || from === to) return o;
    const next = [...o]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    return next.map((x, i) => ({ ...x, color: OPTION_COLORS[i % OPTION_COLORS.length] }));
  });

  // Clicking a quick chip drops its prompt prefix into the composer (real action).
  const applyChip = (c) => {
    setActiveChip(prev => prev === c.id ? null : c.id);
    if (c.prefix) richRef.current?.insertPrefixOnce(c.prefix);
    richRef.current?.focus();
  };

  // GIF/stickers picked from the existing MediaPanel are added as URL media.
  const handleMediaSelect = (type, url, item) => {
    if (type === 'clips') {
      const videoUrl = (item && item.videoUrl) || url;
      setMedia(prev => [...prev, { id: Math.random().toString(36).slice(2), url: videoUrl, preview: videoUrl, type: 'video' }]);
    } else {
      setMedia(prev => [...prev, { id: Math.random().toString(36).slice(2), url, preview: url, type: 'image' }]);
    }
    setShowMediaPanel(null);
  };

  // Brand-new poll: no votes yet, so the live preview honestly shows 0% bars.
  const previewOpts = pollOpts.filter(o => o.text).map(o => ({ ...o, pct: 0 }));

  const branch = (path) => { setOpen(false); setTimeout(() => navigate(path), 220); };

  // B8: upload one media item with tier-aware compression + live progress.
  // Videos get the same on-device re-encode/down-scale the vergr.me flow uses
  // (keeps them under the plan's R2 cap + off the CDN as huge files; uploadToR2
  // strips the `;codecs=` suffix per the locked rule). Already-uploaded urls are
  // cached so a retry never re-does a file that already went up.
  const setItemProgress = (id, phase, pct) => setUploads(u => ({ ...u, [id]: { phase, pct } }));
  const clearItemProgress = (id) => setUploads(u => { const n = { ...u }; delete n[id]; return n; });

  const uploadMediaItem = async (m) => {
    if (!m.file) return m.url;
    if (uploadedRef.current[m.id]) return uploadedRef.current[m.id];
    let url;
    if (m.type === 'video') {
      setItemProgress(m.id, 'optimizing', 0);
      const optimized = await compressVideo(
        m.file, tier,
        (p) => setItemProgress(m.id, 'optimizing', Math.round((p || 0) * 100)),
        'clip',
      );
      setItemProgress(m.id, 'uploading', 0);
      ({ url } = await uploadToR2(optimized, 'clip', (pct) => setItemProgress(m.id, 'uploading', pct)));
    } else {
      const blob = m.file.type?.startsWith('image/') ? await compressMedia(m.file, tier, 'post') : m.file;
      // Capture the compressed image's dimensions so the card can reserve the
      // exact box → zero layout shift (B11-4). Best-effort; never blocks upload.
      if (blob.type?.startsWith('image/')) {
        try { const d = await getMediaDimensions(blob); if (d?.width && d?.height) mediaMetaRef.current[m.id] = { w: d.width, h: d.height }; } catch {}
      }
      setItemProgress(m.id, 'uploading', 0);
      ({ url } = await uploadToR2(blob, 'post', (pct) => setItemProgress(m.id, 'uploading', pct)));
    }
    uploadedRef.current[m.id] = url;
    clearItemProgress(m.id);
    return url;
  };

  // Upload all media in parallel; on failure mark every not-yet-done file errored
  // (its thumb shows a retry chip) and rethrow so the caller can surface a toast.
  const uploadAllMedia = async (snapMedia) => {
    try {
      return await Promise.all(snapMedia.map(uploadMediaItem));
    } catch (err) {
      setUploads(u => {
        const n = { ...u };
        snapMedia.forEach(m => { if (m.file && !uploadedRef.current[m.id]) n[m.id] = { phase: 'error', pct: 0 }; });
        return n;
      });
      throw err;
    }
  };

  const friendlyUploadError = (err) => {
    const msg = String(err?.message || err || '');
    if (/plan limit|resource-exhausted|exceeds your/i.test(msg)) {
      return tier === 'pro'
        ? 'That file is over the 5GB Pro limit — try trimming it.'
        : `That file is too big for your ${tier} plan. Upgrade for a larger limit, or trim the clip.`;
    }
    if (/max \d+s|is \d+s|too long/i.test(msg)) return msg; // duration reject is already readable
    return `Upload failed: ${msg || 'something went wrong'}`;
  };

  /**
   * Post a LOCKED post: one media file, private prefix, no public URL anywhere.
   *
   * A separate path from handlePostNow rather than a flag inside it, because
   * almost nothing is shared: the upload is presigned by `getLockedUploadUrl`
   * into `locked/{uid}/` (not the public prefix `uploadToR2` uses), a blurred
   * preview is generated here on the sender's device and uploaded alongside,
   * and the post document is written by a callable so the private object key
   * never touches the client's Firestore write.
   */
  const handlePostLocked = async () => {
    if (loading) return;
    const item = media[0];
    if (!item?.file) { showToast('Add a photo or video to lock', 'error'); return; }
    setLoading(true);
    const trimmed = (richRef.current?.getMarkup() ?? text).trim();
    try {
      // R2's CORS exact-matches the content type, so a MediaRecorder type
      // carrying ";codecs=" fails the signature silently. Strip it.
      const contentType = (item.file.type || 'image/jpeg').split(';')[0];
      const isVideo = item.type === 'video';

      const signed = await getLockedUploadUrl({ contentType, sizeBytes: item.file.size });
      await putSignedUpload(signed.mediaUploadUrl, item.file, contentType, signed.cacheControl);

      // Destroyed on THIS device before upload. Never blur on the viewer's side:
      // that is a CSS filter over bytes they already downloaded.
      const previewBlob = await makeBlurredPreview(item.file).catch(() => null);
      let previewUrl = '';
      if (previewBlob) {
        await putSignedUpload(signed.previewUploadUrl, previewBlob, 'image/jpeg', signed.cacheControl);
        previewUrl = signed.previewUrl;
      }

      await createLockedPost({
        mediaKey: signed.mediaKey,
        previewUrl,
        caption: trimmed,
        priceCoins: lockPrice,
        isVideo,
        audience: visibility === 'followers' ? 'followers' : 'public',
      });

      media.forEach(m => { try { URL.revokeObjectURL(m.preview); } catch {} });
      showToast('Locked post published', 'success');
      onClose?.();
    } catch (e) {
      showToast(e?.message || 'Could not publish the locked post', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePostNow = async () => {
    if (loading) return;
    if (lockPrice > 0) { handlePostLocked(); return; }
    const trimmed = (richRef.current?.getMarkup() ?? text).trim();
    if (!trimmed && media.length === 0) { showToast('Add some text or media first', 'error'); return; }
    setLoading(true);

    // Snapshot state, then close the composer IMMEDIATELY (optimistic, like
    // X/Instagram) and finish the upload + write in the background so the UI
    // never blocks on the network. Media uploads run in parallel.
    const uid = auth.currentUser.uid;
    const snapMedia = media;
    const snapTags = [...tags];
    const type = snapMedia.length === 0 ? 'text' : (snapMedia.length === 1 && snapMedia[0].type === 'video' ? 'clip' : 'media');
    // Real mentions only ever come from the "@" chip (@[username](uid)) — a
    // hand-typed "@name" never picked from the dropdown has no uid here and
    // stays plain text, not a tag.
    const mentionedUids = [...new Set([...trimmed.matchAll(/@\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]))];
    const scheduled = !!schedule;
    // A video needs on-device compression + a (possibly long) upload, so the
    // composer must STAY OPEN with live progress until it lands — a silent
    // background upload of a 250MB clip is the exact B8 bug. Text / image-only
    // posts keep the instant optimistic close (fast, X/Instagram feel).
    const hasVideoUpload = snapMedia.some(m => m.file && m.type === 'video');

    // Shared write step once the media urls are ready.
    // Per-image dimensions aligned to the url order (B11-4). Null where unknown
    // (videos / legacy). Only sent when at least one item has real dims.
    const mediaMeta = snapMedia.map(m => mediaMetaRef.current[m.id] || null);
    const hasMeta = mediaMeta.some(Boolean);

    const writeAndBroadcast = async (urls) => {
      const announce = canAnnounce && asAnnouncement && !scheduled;
      const postId = await createPost(uid, {
        content: trimmed, type, mediaUrls: urls, hashtags: snapTags, mentionedUids, visibility,
        mediaMeta: hasMeta ? mediaMeta : undefined,
        scheduledFor: scheduled ? new Date(schedule.ms) : null,
        scheduleOptions: scheduled ? schedOpts : null,
        isAnnouncement: announce, topic,
      });
      // Broadcast push to every device (server verifies @Vergr/admin). Never
      // blocks the post; failure is surfaced but the post still went out.
      if (announce) {
        httpsCallable(functions, 'postAnnouncement')({ postId })
          .then(() => showToast('Announcement sent to everyone', 'success'))
          .catch(() => showToast('Posted, but the broadcast push failed', 'error'));
      }
      snapMedia.forEach(m => { try { URL.revokeObjectURL(m.preview); } catch {} });
      // Let an already-open feed prepend it instantly (HomeFeedScreen listens).
      if (!scheduled) {
        window.dispatchEvent(new CustomEvent('vergr:post-created', { detail: {
          id: postId, authorId: uid,
          author: { id: uid, displayName: name, username: profile?.username, avatar, isVerified: profile?.isVerified, tier: resolveTier(profile) },
          content: trimmed, type, mediaUrls: urls, hashtags: snapTags, mentionedUids, visibility,
          mediaMeta: hasMeta ? mediaMeta : undefined,
          likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, viewCount: 0,
          status: 'published', createdAt: new Date(), isAnnouncement: announce, topic,
        } }));
      }
      showToast(scheduled ? 'Post scheduled!' : 'Posted!', 'success');
    };

    if (hasVideoUpload) {
      showToast(scheduled ? 'Preparing your video…' : 'Uploading your video…', 'info');
      let urls;
      try {
        urls = await uploadAllMedia(snapMedia);
      } catch (err) {
        console.error(err);
        showToast(friendlyUploadError(err), 'error');
        setLoading(false); // stay OPEN — the failed thumb shows a retry chip
        return;
      }
      try {
        await writeAndBroadcast(urls);
        uploadedRef.current = {};
        mediaMetaRef.current = {};
        setUploads({});
        setOpen(false);
      } catch (err) {
        console.error(err);
        showToast(`Couldn't post: ${err?.message || 'something went wrong'}`, 'error');
        setLoading(false);
      }
      return;
    }

    // Text / image-only: optimistic instant close + background upload.
    setOpen(false);
    showToast(scheduled ? 'Scheduling…' : 'Posting…', 'info');
    (async () => {
      try {
        const urls = await uploadAllMedia(snapMedia);
        await writeAndBroadcast(urls);
        uploadedRef.current = {};
      } catch (err) {
        console.error(err);
        showToast(friendlyUploadError(err), 'error');
      }
    })();
  };

  // Save an EDIT to an existing post (updates in place — keeps likes/comments).
  const handleSaveEdit = async () => {
    if (loading) return;
    const trimmed = (richRef.current?.getMarkup() ?? text).trim();
    if (!trimmed && media.length === 0) { showToast('Add some text or media first', 'error'); return; }
    setLoading(true);
    const snapMedia = media;
    const snapTags = [...tags];
    const mentionedUids = [...new Set([...trimmed.matchAll(/@\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]))];
    try {
      // Existing media carry a .url (reuse as-is); newly added media carry a
      // .file that still needs uploading — B8: compress (tier-aware) + show
      // per-thumb progress just like the create path.
      const urls = await uploadAllMedia(snapMedia);
      // Only recompute type / rewrite media for standard posts; structured posts
      // (poll/article/…) keep their type + data, we just changed their caption.
      const patch = { content: trimmed, hashtags: snapTags, mentionedUids, topic };
      if (isStdEdit) {
        patch.mediaUrls = urls;
        patch.type = urls.length === 0 ? 'text' : (urls.length === 1 && snapMedia[0]?.type === 'video' ? 'clip' : (urls.length === 1 ? 'photo' : 'carousel'));
        // Aspect dims for any newly-uploaded image (B11-4); null for reused/legacy.
        const editMeta = snapMedia.map(m => mediaMetaRef.current[m.id] || null);
        patch.mediaMeta = editMeta.some(Boolean) ? editMeta : null;
      }
      await editPost(editingPost.id, auth.currentUser.uid, patch);
      snapMedia.forEach(m => { try { if (m.file) URL.revokeObjectURL(m.preview); } catch {} });
      const applied = { content: trimmed, hashtags: snapTags, mentionedUids, topic, ...(isStdEdit ? { mediaUrls: urls, type: patch.type } : {}) };
      onEdited?.(applied);
      window.dispatchEvent(new CustomEvent('vergr:post-updated', { detail: { id: editingPost.id, ...applied } }));
      uploadedRef.current = {};
      mediaMetaRef.current = {};
      setUploads({});
      showToast('Post updated!', 'success');
      setOpen(false);
    } catch (err) {
      console.error(err);
      showToast(friendlyUploadError(err), 'error');
      setLoading(false);
    }
  };

  const handlePostPoll = async () => {
    if (loading) return;
    const opts = pollOpts.map(o => o.text.trim()).filter(Boolean);
    if (!pollQ.trim()) { showToast('Add a poll question', 'error'); return; }
    if (opts.length < 2) { showToast('Add at least 2 options', 'error'); return; }
    setLoading(true);
    try {
      await createPoll(auth.currentUser.uid, {
        question: pollQ.trim(), options: opts, duration: pollDuration,
        multiSelect: pollMulti, anonymous: pollAnon, caption: (richRef.current?.getMarkup() ?? text).trim(), visibility,
        scheduledFor: schedule ? new Date(schedule.ms) : null,
        scheduleOptions: schedule ? schedOpts : null,
        status: schedule ? 'scheduled' : 'active',
      });
      showToast(schedule ? 'Poll scheduled!' : 'Poll created!', 'success');
      setOpen(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to create poll', 'error');
      setLoading(false);
    }
  };

  const promptUpgrade = () => { showToast('Scheduling is a Lite/Pro feature — upgrade to unlock it', 'info'); branch('/settings/subscription'); };
  const openSchedule = () => {
    if (!isPaid) { promptUpgrade(); return; }
    setReturnView(view === 'schedule' ? returnView : view); setView('schedule');
  };

  const header = (
    <div className="modal-head">
      <div className="left"><button className="x-btn" onClick={requestClose}><CIcon name="x" size={18} /></button></div>
      <div className="center">
        <div className="modal-title">{isEditing ? 'Edit post' : `Create ${isPoll ? 'poll' : 'post'}`} <CIcon name="sparkle" size={18} className="sparkle" /></div>
        <div className="modal-sub">{isEditing ? 'Update your post — likes and comments are kept' : 'Share with the VERGR community'}</div>
      </div>
      <div className="right">
        {isEditing ? (
          <button className="btn btn-primary" onClick={handleSaveEdit} disabled={loading}><CIcon name="send" size={16} /> {loading ? 'Saving…' : 'Save changes'}</button>
        ) : (
          <>
            <button className="btn btn-outline-violet icon-l" onClick={openSchedule}><CIcon name="calendar" size={16} /> Schedule{!isPaid && <span className="up-pill">PRO</span>}</button>
            {isPoll
              ? <button className="btn btn-primary" onClick={handlePostPoll} disabled={loading}><CIcon name="poll" size={16} /> {loading ? 'Posting…' : 'Post poll'}</button>
              : <button className="btn btn-primary" onClick={handlePostNow} disabled={loading}><CIcon name="send" size={16} /> {loading ? 'Posting…' : (schedule ? 'Schedule' : 'Post now')}</button>}
          </>
        )}
      </div>
    </div>
  );

  const composeTop = (
    <div className="compose-top">
      <div className="compose-id">
        <UserAvatar src={avatar} size={56} isVerified={profile?.isVerified} />
        <div>
          <div className="name">{name}</div>
          <div className="meta">
            <span className="badge badge-violet">◆ VERGR Member</span>
            <span className="lvl">LVL {profile?.vpLevel || 1} <span className="gem" /></span>
          </div>
        </div>
      </div>
      <div className="visibility" onClick={() => setVisMenu(m => !m)} role="button">
        <span style={{ color: 'var(--text-3)', display: 'grid', placeItems: 'center' }}><CIcon name={vis.icon} size={18} /></span>
        <div><div className="title">{vis.title}</div><div className="sub">{vis.sub}</div></div>
        <span style={{ color: 'var(--text-3)', display: 'grid', placeItems: 'center' }}><CIcon name="caret-down" size={16} /></span>
        {visMenu && (
          <div className="vis-menu" onClick={e => e.stopPropagation()}>
            {VIS_OPTIONS.map(o => (
              <button key={o.id} className={o.id === visibility ? 'active' : ''} onClick={() => { setVisibility(o.id); setVisMenu(false); }}>
                <CIcon name={o.icon} size={16} />
                <span><span className="vt">{o.title}</span><br /><span className="vd">{o.sub}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!isEditing && (
        <button
          type="button"
          onClick={() => setLockSheet(true)}
          title={media.length === 0 ? 'Add a photo or video first' : 'Charge coins to unlock this post'}
          disabled={media.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
            borderRadius: 999, cursor: media.length === 0 ? 'not-allowed' : 'pointer',
            opacity: media.length === 0 ? 0.45 : 1,
            border: lockPrice > 0 ? '1px solid var(--gold, #F0A500)' : '1px solid var(--stroke, rgba(255,255,255,.12))',
            background: lockPrice > 0 ? 'rgba(240,165,0,.15)' : 'transparent',
            color: lockPrice > 0 ? 'var(--gold, #F0A500)' : 'var(--text-3)',
            font: 'inherit', fontSize: 13, fontWeight: 600,
          }}
        >
          <CIcon name="lock" size={16} />
          {lockPrice > 0 ? `${lockPrice.toLocaleString()}c` : 'Lock'}
        </button>
      )}
      {canAnnounce && !isEditing && (
        <button type="button" onClick={() => setAsAnnouncement(v => !v)}
          title="Pin to every feed + push to all devices"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, padding: '8px 12px',
            borderRadius: 12, cursor: 'pointer',
            border: `1px solid ${asAnnouncement ? 'rgba(180,79,255,0.55)' : 'rgba(255,255,255,0.10)'}`,
            background: asAnnouncement ? 'rgba(180,79,255,0.16)' : 'rgba(255,255,255,0.03)',
            color: asAnnouncement ? '#fff' : 'var(--text-3)',
          }}>
          <CIcon name="campaign" size={18} />
          <div style={{ textAlign: 'left', lineHeight: 1.15 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Announcement</div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>{asAnnouncement ? 'Notifies everyone' : 'Pin + notify all'}</div>
          </div>
        </button>
      )}
    </div>
  );

  return (
    <div className="cmp">
      <AnimatePresence onExitComplete={onClose}>
        {open && (
          <motion.div className="cmp-overlay" key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={requestClose}>
            <motion.div className="modal" onClick={e => e.stopPropagation()}
              initial={fly} animate={{ opacity: 1, scale: 1, x: 0, y: 0 }} exit={fly}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}>

              {view === 'schedule' ? (
                <ScheduleView
                  name={name} avatar={avatar} isPoll={returnView === 'poll'}
                  pollState={{ question: pollQ, options: pollOpts, text }}
                  audience={audience} schedOpts={schedOpts} setSchedOpts={setSchedOpts}
                  onBack={() => setView(returnView)}
                  onConfirm={(s) => { setSchedule(s); setView(returnView); showToast('Schedule set — tap Post to confirm', 'success'); }}
                />
              ) : (
                <>
                  {header}
                  <div className="modal-body scroll">
                    {composeTop}

                    {isPoll ? (
                      <div className="poll-layout">
                        <div className="poll-main">
                          <ComposerCard compact richRef={richRef} onChangeText={setText} activeChip={activeChip} onChip={applyChip} followingIds={followingIds} />
                          <div className="poll-card">
                            <div className="poll-head">
                              <div className="icon"><CIcon name="poll" size={20} /></div>
                              <div><div className="ttl">Create Poll</div><div className="desc">Ask your community &amp; start a discussion.</div></div>
                              <div className="duration">
                                <div className="duration-pill" onClick={() => setDurMenu(m => !m)} role="button">
                                  <div><div className="lbl">Duration</div><div className="val"><CIcon name="clock" size={13} /> {pollDuration}</div></div>
                                  <CIcon name="caret-down" size={14} />
                                  {durMenu && (
                                    <div className="dur-menu" onClick={e => e.stopPropagation()}>
                                      {['6h', '12h', '24h', '48h', '1w'].map(d => (
                                        <button key={d} className={d === pollDuration ? 'active' : ''} onClick={() => { setPollDuration(d); setDurMenu(false); }}>{d}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="switches">
                                <Toggle on={pollMulti} onChange={setPollMulti} label="Multi-select" />
                                <Toggle on={pollAnon} onChange={setPollAnon} label="Anonymous" />
                              </div>
                            </div>

                            <div className="poll-card-grid">
                              <div>
                                <div className="step-label"><span className="step-num">1</span><span className="t">Poll Question</span></div>
                                <div className="poll-input">
                                  <input value={pollQ} onChange={e => setPollQ(e.target.value)} maxLength={120} placeholder="Which agent should I main next?" />
                                  <span className="ct">{pollQ.length} / 120</span>
                                </div>
                                <div className="step-label"><span className="step-num">2</span><span className="t">Poll Options</span></div>
                                {pollOpts.map((o, i) => (
                                  <div className="opt-row" key={o.id}
                                    style={dragIndex === i ? { opacity: 0.5 } : undefined}
                                    onDragOver={e => { e.preventDefault(); }}
                                    onDrop={() => { reorderOpt(dragIndex, i); setDragIndex(null); }}>
                                    <span className="drag" draggable onDragStart={() => setDragIndex(i)} onDragEnd={() => setDragIndex(null)}><CIcon name="grip" size={16} /></span>
                                    <span className="glyph" style={{ color: o.color, borderColor: o.color + '55', background: o.color + '14' }}><CIcon name="sparkle-sm" size={12} /></span>
                                    <input value={o.text} onChange={e => updateOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                                    <span className="swatch" style={{ background: o.color }} />
                                    <button className="rm" onClick={() => rmOpt(i)}><CIcon name="x" size={14} /></button>
                                  </div>
                                ))}
                                {pollOpts.length < 6 && <button className="add-option" onClick={addOpt}><CIcon name="plus" size={14} /> Add option</button>}
                                <button className="advanced" onClick={() => setPollAdv(a => !a)}>
                                  <span className="step-num">3</span><span className="t">Advanced options</span>
                                  <span className="chev"><CIcon name={pollAdv ? 'caret-up' : 'caret-down'} size={16} /></span>
                                </button>
                                {pollAdv && (
                                  <div style={{ marginTop: 10, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-0)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                    <Toggle on={pollMulti} onChange={setPollMulti} label="Allow multiple answers" />
                                    <Toggle on={pollAnon} onChange={setPollAnon} label="Anonymous voting" />
                                  </div>
                                )}
                              </div>
                              <div className="tpl-card">
                                <h5><CIcon name="sparkle-sm" size={14} /> Quick templates</h5>
                                {POLL_TEMPLATES.map(t => (
                                  <button key={t.id} className="tpl-item" onClick={() => setPollQ(t.name.replace('?', '') + '?')}>
                                    <div><div className="ti-name">{t.name}</div><div className="ti-sub">{t.sub}</div></div>
                                    <span className="ti-icon"><CIcon name={t.icon} size={20} /></span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="preview-panel">
                          <div className="ph"><h3>Preview</h3><p>See how your poll will look in the feed</p></div>
                          <div className="mock-desktop"><PollPreview name={name} avatar={avatar} question={pollQ} options={previewOpts} /></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ComposerCard richRef={richRef} onChangeText={setText} activeChip={activeChip} onChip={applyChip} followingIds={followingIds} />
                        <HashtagField tags={tags} onAdd={addTag} onRemove={removeTag} interests={interests} trending={trendingTags} />
                        {/* Optional topic — helps For You show this to the right
                            people. One tap to pick, tap again to clear. */}
                        <div className="section" style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <CIcon name="category" size={16} />
                            <span style={{ fontSize: 13, fontWeight: 700 }}>Topic</span>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>optional · helps the right people discover it</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }} className="no-scrollbar">
                            {CONTENT_TOPICS.map(t => {
                              const on = t === topic;
                              return (
                                <button key={t} type="button" onClick={() => setTopic(on ? null : t)}
                                  style={{ whiteSpace: 'nowrap', flexShrink: 0, padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                                    background: on ? 'rgba(123,31,255,0.16)' : 'transparent',
                                    border: `1px ${on ? 'solid rgba(123,31,255,0.4)' : 'dashed var(--border)'}`,
                                    color: on ? 'var(--violet-light, #B44FFF)' : 'var(--text-3)' }}>
                                  {t}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div
                          className={`section add-media ${isFileDropActive ? 'drop-active' : ''}`}
                          onDragEnter={handleFileDragEnter}
                          onDragOver={handleFileDragOver}
                          onDragLeave={handleFileDragLeave}
                          onDrop={handleFileDrop}
                        >
                          {isFileDropActive && (
                            <div className="drop-overlay">
                              <div className="ic-w"><CIcon name="image-play" size={26} /></div>
                              <div className="t">Drop to add media</div>
                            </div>
                          )}
                          <div className="media-dropzone" onClick={() => fileRef.current?.click()}>
                            <div className="media-icon-tile"><CIcon name="image-play" size={32} /></div>
                            <div className="t">Add media</div>
                            <div className="d">Images, videos, GIFs or clips</div>
                            <div className="d">Click to <span className="browse">browse</span>, or drag files in</div>
                          </div>
                          <div className="thumbs">
                            {media.map((m, i) => (
                              <div
                                key={m.id}
                                className={`thumb ${mediaDragIndex === i ? 'dragging' : ''} ${mediaDragOverIndex === i && mediaDragIndex !== i ? 'drag-over' : ''}`}
                                draggable
                                onDragStart={(e) => { setMediaDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                                onDragEnter={(e) => { e.preventDefault(); if (mediaDragIndex !== null && mediaDragIndex !== i) setMediaDragOverIndex(i); }}
                                onDragOver={(e) => e.preventDefault()}
                                onDragEnd={() => { setMediaDragIndex(null); setMediaDragOverIndex(null); }}
                              >
                                {m.type === 'video' ? <video src={m.preview} muted /> : <img src={m.preview} alt="" draggable={false} />}
                                <span className="grip"><CIcon name="grip" size={13} /></span>
                                {i === 0 && media.length > 1 && <span className="cover-tag">Cover</span>}
                                <button className="x" onClick={() => removeMedia(m.id)} onPointerDown={(e) => e.stopPropagation()}><CIcon name="x" size={12} /></button>
                                {uploads[m.id] && (
                                  <div onPointerDown={(e) => e.stopPropagation()} draggable={false}
                                    style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, background: 'rgba(0,0,0,0.58)', backdropFilter: 'blur(2px)', borderRadius: 'inherit', zIndex: 4 }}>
                                    {uploads[m.id].phase === 'error' ? (
                                      <button onClick={() => (isEditing ? handleSaveEdit() : handlePostNow())}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: 'var(--brand-ember, #F04060)', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                                        <CIcon name="refresh" size={14} /> Retry
                                      </button>
                                    ) : (
                                      <>
                                        <div style={{ color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 0.2 }}>
                                          {uploads[m.id].phase === 'optimizing' ? 'Optimizing' : 'Uploading'} {uploads[m.id].pct}%
                                        </div>
                                        <div style={{ width: '74%', height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                                          <div style={{ height: '100%', width: `${uploads[m.id].pct}%`, background: '#7B1FFF', transition: 'width .2s' }} />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                            <button className="thumb-add" onClick={() => fileRef.current?.click()}><CIcon name="plus" size={24} /></button>
                            {media.length > 1 && (
                              <div className="reorder-hint"><CIcon name="grip" size={14} /> Drag a thumbnail to reorder &middot; first image is the cover</div>
                            )}
                          </div>
                        </div>

                        {!isEditing && <div className="actions-row">
                          <button className="action-card ac-pink" onClick={() => branch('/go-live')}>
                            <div className="icon-wrap"><CIcon name="radio" size={20} /></div>
                            <div><div className="t">Go Live</div><div className="d">Stream to the world</div></div>
                            <span className="live-tag">LIVE</span>
                          </button>
                          <button className="action-card ac-cyan" onClick={() => videoRef.current?.click()}>
                            <div className="icon-wrap"><CIcon name="film" size={20} /></div>
                            <div><div className="t">Share Clip</div><div className="d">Upload gameplay clip</div></div>
                          </button>
                          <button className="action-card ac-magenta" onClick={() => setView('poll')}>
                            <div className="icon-wrap"><CIcon name="poll" size={20} /></div>
                            <div><div className="t">Create Poll</div><div className="d">Ask your community</div></div>
                          </button>
                          <button className="action-card ac-gold" onClick={() => branch('/squads')}>
                            <div className="icon-wrap"><CIcon name="users" size={20} /></div>
                            <div><div className="t">Squad Update</div><div className="d">Share with your squad</div></div>
                          </button>
                          <button className="action-card ac-orange" onClick={() => branch('/tournaments')}>
                            <div className="icon-wrap"><CIcon name="trophy2" size={20} /></div>
                            <div><div className="t">Tournament Result</div><div className="d">Post match results</div></div>
                            <span className="chev"><CIcon name="chevron-right" size={16} /></span>
                          </button>
                        </div>}

                        {!isEditing && tipOpen && (
                          <div className="tip">
                            <span className="sp"><CIcon name="sparkle" size={16} /></span>
                            <span><strong>Tip:</strong> Great posts get more engagement! Try adding clips, polls or asking your community a question.</span>
                            <button className="x-tip" onClick={() => setTipOpen(false)}><CIcon name="x" size={16} /></button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* toolbar */}
                  <div className="toolbar">
                    {activeTool && <div className="tool-popover-backdrop" onClick={() => setActiveTool(null)} />}
                    <div className="tool-icons">
                      {TOOLS.map(t => {
                        const active = (t.id === 'poll' && isPoll) || activeTool === t.id;
                        return (
                          <button key={t.id} className={`tool ${active ? 'active' : ''}`} onClick={() => {
                            if (t.id === 'poll') setView(isPoll ? 'compose' : 'poll');
                            else if (t.id === 'media') fileRef.current?.click();
                            else if (t.id === 'gif') setShowMediaPanel('gifs');
                            else if (t.id === 'clip') videoRef.current?.click();
                            else { if (t.id === 'tag') richRef.current?.saveSelection(); toggleTool(t.id); }
                          }}>
                            <span className="ic"><CIcon name={t.icon} size={20} /></span>
                            <span className="lbl">{t.label}</span>
                          </button>
                        );
                      })}

                      {/* Mood / Stats / Tag / Location popovers — all insert real content */}
                      {activeTool === 'mood' && (
                        <div className="tool-popover" onClick={e => e.stopPropagation()}>
                          <div className="tp-title">How are you feeling?</div>
                          <div className="tp-moods">
                            {MOODS.map(m => (
                              <button key={m.l} className="tp-mood" onClick={() => { insertText(`${m.e} feeling ${m.l}`); setActiveTool(null); }}>
                                <span style={{ fontSize: 20 }}>{m.e}</span><span>{m.l}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {activeTool === 'stats' && (
                        <div className="tool-popover" onClick={e => e.stopPropagation()}>
                          <div className="tp-title">Add a stat line</div>
                          <div className="tp-quick">
                            {['K/D', 'Win streak', 'Rank', 'Score', 'Kills', 'Accuracy'].map(s => (
                              <button key={s} className="qchip" onClick={() => setStatLabel(s)}>{s}</button>
                            ))}
                          </div>
                          <div className="tp-row">
                            <input className="tp-input" placeholder="Stat" value={statLabel} onChange={e => setStatLabel(e.target.value)} />
                            <input className="tp-input" placeholder="Value" value={statValue} onChange={e => setStatValue(e.target.value)} />
                            <button className="btn btn-primary" disabled={!statLabel.trim() || !statValue.trim()}
                              onClick={() => { insertText(`📊 ${statLabel.trim()}: ${statValue.trim()}`); setStatLabel(''); setStatValue(''); setActiveTool(null); }}>Add</button>
                          </div>
                        </div>
                      )}
                      {activeTool === 'tag' && (
                        <div className="tool-popover" onClick={e => e.stopPropagation()}>
                          <div className="tp-title">Tag players</div>
                          <div className="tp-sub">Only accounts you follow who allow tagging</div>
                          <input className="tp-input" autoFocus placeholder="Search players…" value={tagQuery} onChange={e => setTagQuery(e.target.value)} />
                          <div className="tp-list">
                            {tagResults.map(u => (
                              <button key={u.id} className="tp-user" onClick={() => { richRef.current?.insertMentionAtCursor({ uid: u.id, username: u.username }); setTagQuery(''); setActiveTool(null); }}>
                                <UserAvatar src={u.avatar} size={26} />
                                <span><span className="tp-name">{u.displayName || u.username}</span><span className="tp-handle">@{u.username}</span></span>
                              </button>
                            ))}
                            {tagQuery.trim() && tagResults.length === 0 && <div className="tp-empty">No taggable followed accounts match "{tagQuery.trim()}"</div>}
                          </div>
                        </div>
                      )}
                      {activeTool === 'loc' && (
                        <div className="tool-popover" onClick={e => e.stopPropagation()}>
                          <div className="tp-title">Add a location</div>
                          <div className="tp-row">
                            <input className="tp-input" autoFocus placeholder="e.g. Los Angeles, CA" value={locText} onChange={e => setLocText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && locText.trim()) { insertText(`📍 ${locText.trim()}`); setLocText(''); setActiveTool(null); } }} />
                            <button className="btn btn-primary" disabled={!locText.trim()} onClick={() => { insertText(`📍 ${locText.trim()}`); setLocText(''); setActiveTool(null); }}>Add</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {!isEditing && (schedule ? (
                      <div className="pill-schedule">
                        <span className="ic"><CIcon name="calendar" size={16} /></span>
                        <div><div className="lbl">Scheduled for</div><div className="dt">{schedule.formatted}</div></div>
                        <button className="x" onClick={() => setSchedule(null)}><CIcon name="x" size={14} /></button>
                      </div>
                    ) : (
                      <button className="pill-schedule" onClick={openSchedule}>
                        <span className="ic"><CIcon name="calendar" size={16} /></span>
                        <div><div className="lbl">Schedule for later</div><div className="dt" style={{ color: 'var(--text-3)' }}>Pick date &amp; time</div></div>
                        {!isPaid && <span className="up-pill">PRO</span>}
                      </button>
                    ))}
                    {isEditing
                      ? <button className="btn btn-primary" onClick={handleSaveEdit} disabled={loading}><CIcon name="send" size={16} /> {loading ? 'Saving…' : 'Save changes'}</button>
                      : isPoll
                        ? <button className="btn btn-primary" onClick={handlePostPoll} disabled={loading}><CIcon name="poll" size={16} /> {loading ? 'Posting…' : (schedule ? 'Schedule poll' : 'Post poll')}</button>
                        : <button className="btn btn-primary" onClick={handlePostNow} disabled={loading}><CIcon name="send" size={16} /> {loading ? 'Posting…' : (schedule ? 'Schedule' : 'Post now')}</button>}
                  </div>
                </>
              )}

              <input type="file" ref={fileRef} onChange={e => { addFiles(e.target.files, 'media'); e.target.value = ''; }} className="hidden" accept="image/*,video/*" multiple />
              <input type="file" ref={videoRef} onChange={e => { addFiles(e.target.files, 'clip'); e.target.value = ''; }} className="hidden" accept="video/*" />
              {showMediaPanel && <MediaPanel defaultTab={showMediaPanel} onSelect={handleMediaSelect} onClose={() => setShowMediaPanel(null)} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PriceSheet
        open={lockSheet}
        onClose={() => setLockSheet(false)}
        onConfirm={({ isPaid, priceCoins }) => { setLockPrice(isPaid ? priceCoins : 0); setLockSheet(false); }}
        title="Lock this post"
        subtitle="Followers see a blurred preview and pay coins to unlock the real thing. Only the first photo or video is included, and a post cannot be locked after it goes out."
        confirmLabel="Set"
        initialPaid={lockPrice > 0}
        initialPrice={lockPrice > 0 ? lockPrice : 100}
      />
    </div>
  );
}
