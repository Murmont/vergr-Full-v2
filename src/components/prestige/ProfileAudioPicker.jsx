// Picks the track that plays on your profile. Effect 09.
//
// ⚠ IT BROWSES, IT DOES NOT ASK YOU TO SEARCH. The first version was a bare
// search box, and the founder called it correctly:
//
//   "this is going to be difficult for users, especially those like me who know
//    nothing about Audius... most of whom will search for songs by musicians
//    like Taylor Swift and get annoyed after the 3rd search that doesn't show
//    results. They need to actually see that songs exist and be able to hear
//    them before selecting the one they want."
//
// So: popular tracks are ON SCREEN before anyone types, filters give a way
// through the catalogue without knowing a single artist name, and every row
// previews.
//
// ── LAYOUT, and why it is ONE control row ──────────────────────────────
// This panel has been rebuilt three times. What was wrong each time was never
// the styling, it was the COUNT of things competing above the content:
//
//   v1  a bare search field             -> nothing to browse
//   v2  time pills + 20 genre pills + a search field, stacked
//                                       -> "overwhelming... just throwing more
//                                          pills", and the genre rail bled 10px
//                                          past the rows, because a horizontal
//                                          scroller inside a non-clipping parent
//                                          is fragile by construction
//   v3  tabs + search + filter, stacked -> STILL three rows before a track
//
// ⚠ THE TAB ROW IS GONE, AND THAT IS A WEIGHTING DECISION, NOT TIDYING.
// "Browse music" and "Upload your own" sat as equal-weight tabs, so a path
// almost nobody takes held half the visual weight at the top of the panel.
// Uploading is now one quiet button UNDER the list that opens the file dialog
// directly: one click instead of two, no mode to enter, and no way back to
// hunt for. Browsing is not a mode any more, it is just the screen.
//
// ⚠ THERE IS NO HORIZONTAL SCROLL ANYWHERE IN HERE. Filters open as a wrapped
// grid, so nothing can ever be wider than its box.
import { useEffect, useRef, useState, useCallback } from 'react';
import Icon from '../Icon';
import {
  searchTracks, trendingTracks, GENRES, TIME_WINDOWS, fmtDuration, trackUrl, streamUrl,
} from '../../utils/audius';
import { uploadToR2 } from '../../utils/r2Storage';

const UPLOAD_MAX_SECONDS = 30;
const ACCENT = 'var(--brand-violet,#7B1FFF)';

export default function ProfileAudioPicker({ current, onPick, saving }) {
  const [genre, setGenre] = useState(null);
  const [time, setTime] = useState('allTime');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const abortRef = useRef(null);
  const previewRef = useRef(null);

  // ── PREVIEW ────────────────────────────────────────────────────────
  // ⚠ ONE AT A TIME, and it must die with the component. The profile player
  // learned this the hard way: two overlapping Audio objects is the defect that
  // shipped there. Same discipline here.
  const stopPreview = useCallback(() => {
    const a = previewRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    previewRef.current = null;
    setPreviewId(null);
    setLoadingId(null);
  }, []);

  // ⚠ THERE IS A ~3 SECOND GAP BEFORE ANY SOUND, AND IT MUST BE SHOWN.
  // Measured on the live site: 2,876ms from click to the `playing` event, of
  // which 2,828ms is Audius resolving `/stream` through its 302 -> 307 redirect
  // chain to a content node. That is the network, not us, and it is not
  // fixable from here.
  //
  // What WAS fixable is that the button flipped straight to `stop`, so for
  // three seconds it claimed to be playing while silent. The obvious reaction
  // to that is to press it again, which stops the track that was about to
  // start. A spinner between `play()` and `playing` is the whole fix.
  //
  // ⚠ `play()` resolving is NOT the same as audio being audible, so the
  // spinner is cleared by the `playing` EVENT, never by the promise.
  const preview = useCallback((t) => {
    if (previewId === t.trackId) { stopPreview(); return; }
    stopPreview();
    const a = new Audio(streamUrl(t.trackId));
    a.volume = 0.7;
    a.addEventListener('playing', () => setLoadingId((id) => (id === t.trackId ? null : id)), { once: true });
    a.addEventListener('ended', () => { setPreviewId(null); setLoadingId(null); });
    a.play().catch(() => {
      // ⚠ Clear BOTH, or a failed track spins for ever.
      setLoadingId(null); setPreviewId(null);
      setErr('Could not preview that track.');
    });
    previewRef.current = a;
    setPreviewId(t.trackId);
    setLoadingId(t.trackId);
  }, [previewId, stopPreview]);

  useEffect(() => stopPreview, [stopPreview]);

  // ── LOAD ───────────────────────────────────────────────────────────
  // Browse by default; search only once the user has typed something real.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setBusy(true); setErr('');
      try {
        setRows(term.length >= 2
          ? await searchTracks(term, { limit: 20, signal: ctl.signal })
          : await trendingTracks({ genre, time, limit: 20, signal: ctl.signal }));
      } catch (e) {
        if (e.name !== 'AbortError') setErr('Could not reach Audius. Try again.');
      } finally {
        setBusy(false);
      }
    }, term ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, genre, time]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The button states what is in force, so the filters can stay closed.
  const filterLabel = `${(TIME_WINDOWS.find((w) => w.id === time) || {}).label || 'Popular'} · ${genre || 'All'}`;

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    if (!file.type.startsWith('audio/')) { setErr('That is not an audio file.'); return; }

    // ⚠ Duration is checked HERE because the server cannot: r2.js sees a byte
    // count, not an audio stream. Its 2MB cap is the backstop.
    const url = URL.createObjectURL(file);
    try {
      const secs = await new Promise((res, rej) => {
        const a = new Audio();
        a.preload = 'metadata';
        a.onloadedmetadata = () => res(a.duration);
        a.onerror = () => rej(new Error('unreadable'));
        a.src = url;
      });
      if (secs > UPLOAD_MAX_SECONDS + 0.5) {
        setErr(`Uploads must be ${UPLOAD_MAX_SECONDS}s or shorter (yours is ${Math.round(secs)}s). For a full song, pick one from the list above.`);
        return;
      }
      // ⚠ Its own flag, NOT `busy`. `busy` drives the track list's "Loading…"
      // state, so reusing it would blank the catalogue while a file uploads.
      setUploading(true);
      stopPreview();
      const out = await uploadToR2(file, 'ambiance');
      // ⚠ uploadToR2 returns an OBJECT, not a string.
      await onPick({ source: 'upload', url: out.url, title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), duration: Math.round(secs) });
    } catch {
      setErr('Could not read that file. Try MP3, OGG or WAV.');
    } finally {
      URL.revokeObjectURL(url);
      setUploading(false);
    }
  };

  // One pill definition for the whole panel. Unselected gets a real value
  // step (vg-tile); selected gets solid accent. Never an outline-only state —
  // that is the 'cheap glass' look CLAUDE.md bans in this panel.
  const Pill = ({ on, onClick, children }) => (
    <button type="button" onClick={onClick}
      className={`${on ? '' : 'vg-tile'} px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors`}
      style={on ? { background: ACCENT, color: '#fff' } : { color: 'var(--text-secondary,#9CA3AF)' }}>
      {children}
    </button>
  );

  return (
    <div className="mt-3">
      {current && (
        <div className="vg-tile flex items-center gap-3 p-2.5 mb-3 rounded-xl">
          {current.artwork
            ? <img src={current.artwork} alt="" width={36} height={36} className="rounded-md shrink-0" />
            : <div className="w-9 h-9 rounded-md grid place-items-center shrink-0" style={{ background: 'rgba(255,255,255,0.07)' }}><Icon name="music_note" size={16} /></div>}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold truncate">{current.title}</p>
            <p className="text-[10px] text-text-secondary truncate">
              {current.source === 'audius' ? current.artist : 'Your upload'}
            </p>
          </div>
          <button type="button" disabled={saving} onClick={() => { stopPreview(); onPick(null); }}
            className="text-[11px] font-bold text-text-secondary shrink-0 px-2">
            Remove
          </button>
        </div>
      )}

      {/* ── THE ONE CONTROL ROW ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <div className="vg-tile relative rounded-xl flex-1 min-w-0">
          <Icon name="search" size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tracks or artists"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px] outline-none bg-transparent"
            style={{ color: 'var(--text-primary,#fff)' }}
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className={`${filtersOpen ? '' : 'vg-tile'} flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-bold shrink-0 max-w-[46%]`}
          style={filtersOpen
            ? { background: ACCENT, color: '#fff' }
            : { color: 'var(--text-secondary,#9CA3AF)' }}
        >
          <Icon name="tune" size={15} />
          <span className="truncate">{filterLabel}</span>
          <Icon name={filtersOpen ? 'expand_less' : 'expand_more'} size={15} />
        </button>
      </div>

      {/* A wrapped grid, so it can never be wider than its parent. */}
      {filtersOpen && (
        <div className="vg-tile rounded-xl p-3 mb-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Sort</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {TIME_WINDOWS.map((w) => (
              <Pill key={w.id} on={time === w.id} onClick={() => { setTime(w.id); setQ(''); }}>
                {w.label}
              </Pill>
            ))}
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Genre</p>
          <div className="flex flex-wrap gap-1.5">
            <Pill on={!genre} onClick={() => { setGenre(null); setQ(''); }}>All</Pill>
            {GENRES.map((g) => (
              <Pill key={g} on={genre === g} onClick={() => { setGenre(g); setQ(''); }}>{g}</Pill>
            ))}
          </div>
        </div>
      )}

      {busy && <p className="text-[11px] text-text-muted py-2">Loading…</p>}
      {!busy && !rows.length && !err && (
        <p className="text-[11px] text-text-muted py-2">
          {q.trim().length >= 2
            ? 'No tracks matched. Try a genre from the filter instead.'
            : 'Nothing to show right now.'}
        </p>
      )}

      {/* ⚠ THE ROW IS THE TARGET, NOT A BUTTON ON IT. Twenty accent pills
          stacked down a panel is what made the first version look cheap: an
          accent repeated twenty times stops being an accent. One selected
          row carries it.

          The artwork doubles as the preview button, and its play control is
          REVEALED ON HOVER (.vg-artplay in surface.css) so the covers read as
          covers instead of as nineteen identical buttons. Touch devices, which
          have no hover to reveal it with, keep it visible. */}
      <div className="vg-fadelist max-h-[20rem]">
        {rows.map((t) => {
          const isPreviewing = previewId === t.trackId;
          const isLoading = loadingId === t.trackId;
          const isCurrent = current?.source === 'audius' && current.trackId === t.trackId;
          return (
            <div
              key={t.trackId}
              role="button"
              tabIndex={0}
              data-previewing={isPreviewing ? '1' : '0'}
              onClick={() => { if (!isCurrent && !saving) { stopPreview(); onPick(t); } }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isCurrent) { e.preventDefault(); stopPreview(); onPick(t); } }}
              aria-label={`Use ${t.title} by ${t.artist}`}
              className={`vg-row ${isCurrent ? '' : 'vg-tile'} flex items-center gap-3 p-2 mb-1.5 rounded-xl cursor-pointer`}
              style={isCurrent ? { background: ACCENT } : undefined}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); preview(t); }}
                aria-label={isLoading ? `Loading ${t.title}` : (isPreviewing ? `Stop preview of ${t.title}` : `Preview ${t.title}`)}
                className="vg-artbtn relative w-12 h-12 rounded-lg grid place-items-center shrink-0 overflow-hidden"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              >
                {t.artwork && (
                  <img src={t.artwork} alt="" className="absolute inset-0 w-full h-full object-cover" />
                )}
                <span className="vg-artscrim absolute inset-0" style={{ background: '#000' }} />
                {/* ⚠ Reduced motion fast-forwards an animation to its LAST
                    keyframe, and a spinner's last frame is rotate(360deg),
                    which is identical to its first. So this degrades to a
                    static glyph rather than disappearing, and needs no
                    separate reduced-motion pose. */}
                <Icon
                  name={isLoading ? 'progress_activity' : (isPreviewing ? 'stop' : 'play_arrow')}
                  size={20}
                  className={`vg-artplay relative text-white ${isLoading ? 'animate-spin' : ''}`}
                />
              </button>

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold truncate leading-tight">{t.title}</p>
                <p className="text-[11px] truncate mt-0.5"
                  style={{ color: isCurrent ? 'rgba(255,255,255,0.75)' : 'var(--text-secondary,#9CA3AF)' }}>
                  {t.artist}
                </p>
              </div>

              {t.explicit && (
                <span className="text-[9px] font-bold px-1 rounded shrink-0"
                  style={{ background: 'rgba(255,255,255,0.14)' }}>E</span>
              )}
              <span className="font-dmmono text-[11px] tabular-nums shrink-0 pr-1"
                style={{ color: isCurrent ? 'rgba(255,255,255,0.75)' : 'var(--text-muted,#6B7280)' }}>
                {fmtDuration(t.duration)}
              </span>
              {isCurrent && <Icon name="check_circle" size={18} className="text-white shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* ⚠ THE RARE PATH GOES LAST AND QUIET. It used to be a tab carrying the
          same weight as the entire catalogue. It opens the file dialog
          directly, so there is no upload MODE to enter or escape. */}
      <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <label className={`vg-tile flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold cursor-pointer shrink-0 ${uploading || saving ? 'opacity-50 pointer-events-none' : ''}`}
          style={{ color: 'var(--text-secondary,#9CA3AF)' }}>
          <Icon name={uploading ? 'hourglass_top' : 'upload'} size={15} />
          {uploading ? 'Uploading…' : 'Upload your own'}
          <input type="file" accept="audio/*" className="hidden" onChange={pickFile} />
        </label>
        <p className="text-[10px] text-text-muted leading-snug min-w-0">
          Up to {UPLOAD_MAX_SECONDS}s. Only audio you have the right to use.
        </p>
      </div>

      {err && <p className="mt-2 text-[11px] text-brand-ember">{err}</p>}
      {current?.source === 'audius' && (
        <a href={trackUrl(current)} target="_blank" rel="noopener noreferrer"
          className="mt-2 inline-block text-[10px] text-text-secondary underline">
          View current track on Audius
        </a>
      )}
    </div>
  );
}
