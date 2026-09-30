// /sound/:soundId — every clip that uses a sound, TikTok's sound page.
//
// `post_<id>` is a clip's ORIGINAL sound and has no document of its own; any
// other id is a sound someone uploaded (utils/sounds.js). Reads happen only when
// this page opens: the sound, one aggregate count, and one page of clips.
//
// Desktop gets its own proportions (a centred 1040px page, a larger cover and
// title, an ordinary-width button and a five-column grid) rather than the phone
// column stretched across a wide screen.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { reportUser } from '../../firebase/firestore';
import { compactCount, isShortFormat } from '../../utils/helpers';
import { getSoundByKey, listClipsForSound, countClipsForSound } from '../../utils/sounds';

const C = { tile: '#1A1A2A', solid: '#15151F', violet: '#7B1FFF', row: '#1E1E2C' };

export default function SoundScreen() {
  const { soundId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  const [sound, setSound] = useState(null);
  const [clips, setClips] = useState([]);
  const [count, setCount] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    let alive = true;
    setState('loading');
    setSound(null);
    setClips([]);
    setCount(null);
    (async () => {
      const s = await getSoundByKey(soundId);
      if (!alive) return;
      if (!s) { setState('missing'); return; }
      setSound(s);
      setState('ready');
      const [list, n] = await Promise.all([
        listClipsForSound(s.id).catch(() => []),
        countClipsForSound(s.id).catch(() => null),
      ]);
      if (!alive) return;
      const source = s.kind === 'original' && isShortFormat(s.sourcePost?.type) ? [s.sourcePost] : [];
      setClips([...source, ...list.filter((p) => p.id !== s.sourcePost?.id)]);
      setCount(n === null ? null : n + source.length);
    })();
    return () => { alive = false; };
  }, [soundId]);

  // The preview never keeps playing after the page is gone.
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* gone */ } }
  }, []);

  const togglePlay = () => {
    if (!sound?.url) return;
    let a = audioRef.current;
    if (!a) {
      a = new Audio(sound.url);
      a.onended = () => setPlaying(false);
      audioRef.current = a;
    }
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { a.pause(); setPlaying(false); }
  };

  const report = () => {
    if (!currentUser) { showToast?.('Sign in to report a sound.', 'info'); return; }
    if (!sound?.authorId) return;
    reportUser(currentUser.uid, sound.authorId, 'Inappropriate sound', `sound:${sound.id} "${sound.title}"`)
      .then(() => showToast?.('Thanks. Our moderators will review this sound.', 'success'))
      .catch(() => showToast?.('Could not send the report. Please try again.', 'error'));
  };

  const shell = `min-h-screen bg-bg-dark ${isDesktop ? 'w-full' : ''}`;
  const inner = isDesktop ? 'w-full max-w-[1040px] mx-auto px-6' : '';

  const header = (
    <div className={`flex items-center gap-2 ${isDesktop ? 'px-0 pb-2' : 'px-2'}`} style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}>
      <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="w-11 h-11 grid place-items-center text-white">
        <Icon name="arrow_back" size={24} />
      </button>
      <h1 className={`font-syne font-bold text-white ${isDesktop ? 'text-[20px]' : 'text-[17px]'}`}>Sound</h1>
    </div>
  );

  if (state === 'loading') {
    return (
      <div className={shell}>
        <div className={inner}>
          {header}
          <div className={`flex gap-4 pt-4 ${isDesktop ? '' : 'px-4'}`}>
            <div className={`${isDesktop ? 'w-36 h-36' : 'w-24 h-24'} rounded-xl`} style={{ background: C.tile }} />
            <div className="flex-1 pt-2 space-y-3">
              <div className="h-5 w-2/3 max-w-[360px] rounded" style={{ background: C.tile }} />
              <div className="h-4 w-1/3 max-w-[180px] rounded" style={{ background: C.tile }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className={shell}>
        <div className={inner}>
          {header}
          <div className="px-6 pt-20 text-center">
            <Icon name="music_off" size={40} className="text-text-muted" />
            <p className="mt-3 text-white font-semibold">This sound is not available</p>
            <p className="mt-1 text-[13px] text-text-muted">The clip it came from may have been removed.</p>
          </div>
        </div>
      </div>
    );
  }

  const own = !!currentUser?.uid && sound.authorId === currentUser.uid;

  return (
    <div className={shell} style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 40px)' }}>
      <div className={inner}>
        {header}

        <div className={`flex ${isDesktop ? 'gap-6 pt-4 items-center' : 'gap-4 px-4 pt-3'}`}>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause sound' : 'Play sound'}
            className={`relative shrink-0 overflow-hidden grid place-items-center ${isDesktop ? 'w-36 h-36 rounded-2xl' : 'w-24 h-24 rounded-xl'}`}
            style={{ background: C.tile }}
          >
            {sound.authorAvatar
              ? <img src={sound.authorAvatar} alt="" className="absolute inset-0 w-full h-full object-cover" />
              : <Icon name="music_note" size={isDesktop ? 56 : 40} className="text-white" />}
            <span className={`relative rounded-full grid place-items-center text-white ${isDesktop ? 'w-14 h-14' : 'w-11 h-11'}`} style={{ background: C.solid }}>
              <Icon name={playing ? 'pause' : 'play_arrow'} filled size={isDesktop ? 32 : 26} />
            </span>
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <p className={`font-syne font-bold text-white leading-tight break-words ${isDesktop ? 'text-[30px]' : 'text-[20px]'}`}>♫ {sound.title}</p>
            {sound.authorId ? (
              <button type="button" onClick={() => navigate(`/user/${sound.authorId}`)} className="mt-2 flex items-center gap-2 text-left">
                <UserAvatar src={sound.authorAvatar} size={isDesktop ? 24 : 20} showLiftRing={false} />
                <span className={`text-text-secondary truncate ${isDesktop ? 'text-[16px]' : 'text-[14px]'}`}>{sound.authorName}</span>
              </button>
            ) : (
              <p className="mt-1 text-[14px] text-text-secondary truncate">{sound.authorName}</p>
            )}
            <p className={`mt-1 text-text-muted ${isDesktop ? 'text-[14px]' : 'text-[13px]'}`}>
              {count === null ? ' ' : `${compactCount(count)} ${count === 1 ? 'clip' : 'clips'}`}
            </p>
            {isDesktop && (
              <div className="mt-4 flex items-center gap-2">
                <UseSoundButton onClick={() => navigate(`/create/clip?sound=${encodeURIComponent(sound.id)}`)} wide />
                {!own && sound.authorId && <ReportButton onClick={report} />}
              </div>
            )}
          </div>
        </div>

        {!isDesktop && (
          <div className="flex gap-2 px-4 pt-4">
            <UseSoundButton onClick={() => navigate(`/create/clip?sound=${encodeURIComponent(sound.id)}`)} />
            {!own && sound.authorId && <ReportButton onClick={report} />}
          </div>
        )}

        {isDesktop && <p className="pt-8 pb-3 text-[15px] font-semibold text-white">Clips using this sound</p>}

        {clips.length === 0 ? (
          <p className="px-6 pt-10 text-center text-[13px] text-text-muted">No clips use this sound yet. Be the first.</p>
        ) : (
          <div className={isDesktop ? 'grid grid-cols-5 gap-3' : 'grid grid-cols-3 gap-[2px] pt-5'}>
            {clips.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/clip/${p.id}`)}
                aria-label="Open clip"
                className={`relative aspect-[9/16] overflow-hidden ${isDesktop ? 'rounded-xl transition-transform hover:scale-[1.02]' : ''}`}
                style={{ background: C.tile }}
              >
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <video src={p.mediaUrls?.[0] || p.mediaUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                )}
                {p.id === sound.sourcePost?.id && (
                  <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold text-white" style={{ background: C.violet }}>Original</span>
                )}
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-white text-[12px] font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                  <Icon name="favorite" filled size={13} /> {compactCount(p.likeCount || 0)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UseSoundButton({ onClick, wide = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-12 rounded-xl flex items-center justify-center gap-2 text-white font-bold text-[15px] active:scale-[0.98] transition-transform ${wide ? 'px-8' : 'flex-1'}`}
      style={{ background: C.violet }}
    >
      <Icon name="videocam" size={20} /> Use this sound
    </button>
  );
}

function ReportButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label="Report this sound" className="w-12 h-12 rounded-xl grid place-items-center text-text-secondary" style={{ background: C.row }}>
      <Icon name="flag" size={20} />
    </button>
  );
}
