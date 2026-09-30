// "Add sound" on the create screens. A clip with no chosen sound keeps its own
// audio as its sound ("original sound – you"), exactly as TikTok does, so this
// is optional and the default is to do nothing.
//
// Solid values only: no translucent fills, no hairline rings (house rules).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { listMySounds, uploadSound, getSoundByKey, SOUND_UPLOAD_MAX_SECONDS, SOUND_UPLOAD_MAX_BYTES } from '../../utils/sounds';

const C = {
  card: '#1A1A2A',
  sheet: '#14141F',
  row: '#1E1E2C',
  violet: '#7B1FFF',
  track: '#2E2E40',
};

const fmt = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;

export function SoundDisc({ src, size = 40 }) {
  return (
    <span
      className="relative shrink-0 rounded-full grid place-items-center overflow-hidden"
      style={{ width: size, height: size, background: '#161823' }}
    >
      {src
        ? <UserAvatar src={src} size={Math.round(size * 0.6)} showLiftRing={false} />
        : <Icon name="music_note" size={Math.round(size * 0.5)} className="text-white" />}
    </span>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 pt-3"
    >
      <span className="text-[13px] text-text-secondary text-left">{label}</span>
      <span className="relative shrink-0 rounded-full transition-colors" style={{ width: 44, height: 26, background: checked ? C.violet : C.track }}>
        <span
          className="absolute top-[3px] rounded-full bg-white transition-transform"
          style={{ width: 20, height: 20, left: 3, transform: `translateX(${checked ? 18 : 0}px)` }}
        />
      </span>
    </button>
  );
}

export default function SoundPicker({ value, onChange, keepOriginal, onKeepOriginal }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="rounded-2xl p-3" style={{ background: C.card }}>
        {value ? (
          <div className="flex items-center gap-3">
            <SoundDisc src={value.authorAvatar} />
            <div className="min-w-0 flex-1">
              <p className="text-white text-[14px] font-semibold truncate">♫ {value.title}</p>
              <p className="text-text-muted text-[12px] truncate">{value.authorName}</p>
            </div>
            <button type="button" onClick={() => setOpen(true)} className="h-9 px-2 text-[13px] font-bold text-brand-violet-light">Change</button>
            <button type="button" onClick={() => onChange(null)} aria-label="Remove sound" className="w-9 h-9 grid place-items-center text-text-secondary">
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="w-full flex items-center gap-3 text-left">
            <span className="w-10 h-10 shrink-0 rounded-full grid place-items-center" style={{ background: C.row }}>
              <Icon name="music_note" size={20} className="text-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-white text-[14px] font-semibold">Add sound</span>
              <span className="block text-text-muted text-[12px]">Skip this and your clip&apos;s own audio becomes its sound</span>
            </span>
            <Icon name="chevron_right" size={20} className="text-text-muted" />
          </button>
        )}
        {value && (
          <Switch checked={keepOriginal} onChange={onKeepOriginal} label="Keep my video's own sound playing too" />
        )}
      </div>
      {open && (
        <SoundSheet
          selectedId={value?.id}
          onClose={() => setOpen(false)}
          onPick={(s) => { onChange(s); setOpen(false); }}
        />
      )}
    </>
  );
}

// Exported so the create screen can open it from its Sound row and preview pill.
export function SoundSheet({ selectedId, onClose, onPick }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  // null while the file is being read (before any byte is sent), then 0-100.
  const [pct, setPct] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const inputRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    let alive = true;
    listMySounds(currentUser?.uid)
      .then((list) => { if (alive) setMine(list); })
      .catch(() => { if (alive) setMine([]); });
    return () => { alive = false; };
  }, [currentUser?.uid]);

  // Preview audio never outlives the sheet.
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* gone */ } }
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview = (s) => {
    let a = audioRef.current;
    if (!a) { a = new Audio(); audioRef.current = a; a.onended = () => setPlayingId(null); }
    if (playingId === s.id) { a.pause(); setPlayingId(null); return; }
    a.src = s.url;
    a.play().then(() => setPlayingId(s.id)).catch(() => setPlayingId(null));
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setUploading(true);
    setPct(null);
    try {
      const s = await uploadSound(file, { uid: currentUser?.uid, profile, onProgress: (p) => setPct(Math.round(p || 0)) });
      onPick(s);
    } catch (ex) {
      setErr(ex?.message || 'Could not add that sound.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div data-vg-noswipe="" className="fixed inset-0 z-[200] flex flex-col justify-end lg:justify-center lg:items-center lg:px-6" role="dialog" aria-modal="true" aria-label="Add a sound">
      <button type="button" data-scrim="" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close" />
      <div
        className="relative w-full max-w-[520px] mx-auto rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[70vh] overflow-y-auto"
        style={{ background: C.sheet, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 16px)' }}
      >
        <span aria-hidden className="block lg:hidden mx-auto mt-2 mb-1 w-9 h-1 rounded-full" style={{ background: C.track }} />
        <div className="flex items-center justify-between px-4 pt-2 pb-3">
          <h2 className="font-syne font-bold text-white text-[17px]">Add a sound</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center text-text-secondary">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="px-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center gap-3 rounded-2xl p-3 text-left disabled:opacity-60"
            style={{ background: C.card }}
          >
            <span className="w-10 h-10 shrink-0 rounded-full grid place-items-center" style={{ background: C.violet }}>
              <Icon name={uploading ? 'progress_activity' : 'upload'} size={20} className={`text-white ${uploading ? 'animate-spin' : ''}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-white text-[14px] font-semibold">{uploading ? (pct === null ? 'Preparing…' : `Uploading ${pct}%`) : 'Upload a sound'}</span>
              <span className="block text-text-muted text-[12px]">
                Up to {SOUND_UPLOAD_MAX_SECONDS}s and {Math.round(SOUND_UPLOAD_MAX_BYTES / 1024 / 1024)}MB. Only audio you have the right to use.
              </span>
            </span>
          </button>
          <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={pickFile} />
          {err && <p className="mt-2 text-[12px] text-brand-ember">{err}</p>}
        </div>

        <p className="px-4 pt-5 pb-2 text-[12px] font-bold uppercase tracking-wider text-text-muted">Your sounds</p>
        {mine === null ? (
          <p className="px-4 py-3 text-[13px] text-text-muted">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-text-muted">Sounds you upload show up here so you can use them again.</p>
        ) : (
          <ul className="px-2">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xl px-2 py-2" style={s.id === selectedId ? { background: C.row } : undefined}>
                <button
                  type="button"
                  onClick={() => preview(s)}
                  aria-label={playingId === s.id ? `Pause ${s.title}` : `Play ${s.title}`}
                  className="w-10 h-10 shrink-0 rounded-full grid place-items-center text-white"
                  style={{ background: C.card }}
                >
                  <Icon name={playingId === s.id ? 'pause' : 'play_arrow'} filled size={22} />
                </button>
                <button type="button" onClick={() => onPick(s)} className="min-w-0 flex-1 text-left">
                  <span className="block text-white text-[14px] font-semibold truncate">{s.title}</span>
                  <span className="block text-text-muted text-[12px] font-dmmono tabular-nums">{fmt(s.duration)}</span>
                </button>
                <button type="button" onClick={() => onPick(s)} className="h-9 px-3 rounded-full text-[13px] font-bold text-white" style={{ background: C.violet }}>
                  Use
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The sound a create screen is using. "Use this sound" on a sound page arrives
// as ?sound=<key>, so every create screen reads it the same way.
export function useSoundChoice() {
  const [params] = useSearchParams();
  const key = params.get('sound');
  const [sound, setSound] = useState(null);
  const [keepOriginal, setKeepOriginal] = useState(true);
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    getSoundByKey(key).then((s) => { if (alive && s) setSound(s); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return {
    sound,
    keepOriginal,
    picker: { value: sound, onChange: setSound, keepOriginal, onKeepOriginal: setKeepOriginal },
  };
}
