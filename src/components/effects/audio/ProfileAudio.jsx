// Profile audio. Effect 09. Doc: docs/effects/09-profile-ambiance.md
//
// The MySpace idea, done with a source that actually works: a track the profile
// OWNER picked, playing for VISITORS, with the artist credited.
//
// Two sources, both the owner's choice (founder, 2026-08-25 — "let the user
// decide instead of forcing them into a choice"):
//   audius  a real track from ~1M, streamed direct from Audius. No ads, free,
//           costs Vergr nothing, so the WHOLE track plays.
//   upload  the owner's own file. DMCA safe harbour, exactly MySpace's footing
//           (UMG sued them over it and MySpace won). Capped, because unlike
//           Audius this one does occupy R2 storage.
//
// ⚠ THE FAB AND ITS POPUP ARE THE ATTRIBUTION. Founder's design, and it is also
// what discharges the credit obligation: artist, title, artwork, licence and a
// link back to the track on Audius. If the popup is ever removed, the credit
// goes with it, so it is not decoration.
//
// ⚠ IT PLAYS ON THE VISITOR'S SCREEN, NOT THE OWNER'S. Doc 09 §3: the owner
// opening their own page and being played at is pointless and annoying.
//
// ⚠ NO IFRAME. Audius' stream endpoint is CORS-open audio/mpeg, so this is a
// plain <audio> element. That is why there is no third-party player chrome, no
// tracking pixel, and no consent problem the way a YouTube embed would have.
import { useEffect, useRef, useState, useCallback } from 'react';
import Icon from '../../Icon';
import { streamUrl, trackUrl, fmtDuration, AUDIUS_URL } from '../../../utils/audius';

// ⚠ ONE TRACK AT A TIME, ENFORCED AT MODULE LEVEL. Measured on the live site:
// a single mounted component produced TWO Audio objects playing the same src in
// lockstep. React only mounted one component (verified: one wrapper in the DOM),
// so the cause was ASYNC — `play()` returns a promise, and its rejection handler
// outlived the cleanup that was supposed to cancel it, arming a second
// gesture listener against a torn-down element.
//
// The `cancelled` flag below fixes that specific race. This registry makes the
// whole class of bug impossible: whatever happens with effect timing, a new
// track always silences the previous one first. Doc 09 §5 calls audio surviving
// navigation the worst possible bug here, so it gets two defences, not one.
let liveAudio = null;
const claimAudio = (audio) => {
  if (liveAudio && liveAudio !== audio) {
    try { liveAudio.pause(); liveAudio.removeAttribute('src'); liveAudio.load(); } catch { /* already gone */ }
  }
  liveAudio = audio;
};
const releaseAudio = (audio) => { if (liveAudio === audio) liveAudio = null; };

const FADE_MS = 1200;
const TARGET_VOLUME = 0.55;
const FADE_STEP_MS = 50;

/**
 * @param {object}  track     users/{uid}.cosmetics.profileAudio
 * @param {boolean} enabled   the OWNER's unlock + opt-out, resolved by the caller
 * @param {Function} onReport opens the existing report flow for this profile
 */
export default function ProfileAudio({ track, enabled, onReport, accent = 'var(--brand-violet,#7B1FFF)' }) {
  const audioRef = useRef(null);
  const fadeRef = useRef(0);
  const armedRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [failed, setFailed] = useState(false);

  const src = track?.source === 'audius'
    ? (track.trackId ? streamUrl(track.trackId) : null)
    : track?.url || null;

  const fadeIn = useCallback((audio) => {
    clearInterval(fadeRef.current);
    const steps = FADE_MS / FADE_STEP_MS;
    let n = 0;
    fadeRef.current = setInterval(() => {
      n += 1;
      audio.volume = Math.min(TARGET_VOLUME, (n / steps) * TARGET_VOLUME);
      if (n >= steps) clearInterval(fadeRef.current);
    }, FADE_STEP_MS);
  }, []);

  useEffect(() => {
    if (!src || !enabled) return undefined;

    // ⚠ BOTH reduced-motion switches. Not literally the right control, but an
    // unprompted sound is the audio equivalent of unprompted motion, and someone
    // who asked for less sensory load has asked for this too. The FAB still
    // renders, so they can start it deliberately — it just never starts itself.
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.getAttribute('data-reduced-motion') === 'true';

    // ⚠ Set by cleanup. Every async continuation below checks it, because
    // `play()` can settle AFTER the component has gone.
    let cancelled = false;

    const audio = new Audio();
    audio.preload = 'none';   // a visitor who never plays it pays nothing
    audio.volume = 0;
    // ⚠ NOT `loop`. The owner picked a whole song, not a jingle. Looping a
    // 28-minute mix at someone would be hostile; it ends and that is correct.
    audio.src = src;
    audioRef.current = audio;
    claimAudio(audio);

    const onTime = () => setPos(audio.currentTime);
    const onMeta = () => setDur(audio.duration || track?.duration || 0);
    const onEnd = () => setPlaying(false);
    const onErr = () => { setFailed(true); setPlaying(false); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onErr);

    const start = () => {
      if (cancelled) return;
      claimAudio(audio);
      audio.play().then(() => { if (!cancelled) { setPlaying(true); fadeIn(audio); } }).catch(() => {});
    };

    if (!calm) {
      // ⚠ AUTOPLAY REFUSAL IS EXPECTED AND MUST BE SILENT. A visitor arriving on
      // a COLD LOAD — a shared profile link, the common case — has given no
      // gesture, so playback is refused. Attempt it, accept refusal, and arm a
      // ONE-SHOT listener so it starts on their first interaction. No error, no
      // nag. This wall applies to every source; no embed would have avoided it.
      audio.play().then(() => { if (!cancelled) { setPlaying(true); fadeIn(audio); } }).catch(() => {
        // ⚠ THIS IS THE RACE. Without the guard, a rejection that lands after
        // teardown arms a listener holding a stale element, and the next tap
        // starts BOTH the old and the new track.
        if (cancelled) return;
        const arm = () => {
          window.removeEventListener('pointerdown', arm);
          window.removeEventListener('keydown', arm);
          armedRef.current = null;
          start();
        };
        armedRef.current = arm;
        window.addEventListener('pointerdown', arm, { once: true });
        window.addEventListener('keydown', arm, { once: true });
      });
    }

    // ⚠ CLEANUP IS THE WORST POSSIBLE BUG HERE. This screen unmounts as the
    // visitor navigates, and audio that survives navigation follows them around
    // the app. `ResponsiveLayout` also REMOUNTS routed children when the
    // viewport crosses a breakpoint, so a resize must not leave a second track
    // playing over the first.
    return () => {
      cancelled = true;
      clearInterval(fadeRef.current);
      if (armedRef.current) {
        window.removeEventListener('pointerdown', armedRef.current);
        window.removeEventListener('keydown', armedRef.current);
        armedRef.current = null;
      }
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onErr);
      audio.pause();
      audio.removeAttribute('src');   // kills any in-flight fetch
      audio.load();
      releaseAudio(audio);
      audioRef.current = null;
      setPlaying(false);
      setPos(0);
    };
  }, [src, enabled, fadeIn, track?.duration]);

  if (!src || !enabled) return null;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.volume = TARGET_VOLUME; a.play().then(() => setPlaying(true)).catch(() => {}); }
    else { a.pause(); setPlaying(false); }
  };

  const seek = (e) => {
    const a = audioRef.current;
    const total = dur || track?.duration || 0;
    if (!a || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * total;
  };

  const total = dur || track?.duration || 0;
  const pct = total ? Math.min(100, (pos / total) * 100) : 0;
  const isAudius = track.source === 'audius';

  return (
    <>
      {/* ── THE MINI-PLAYER ────────────────────────────────────────
          ⚠ IT WAS UNCLICKABLE, and a programmatic .click() in testing HID that.
          The FAB sat in a viewport-fixed corner which, on desktop, lands ON TOP
          OF THE RIGHT RAIL — measured: elementFromPoint at the FAB's own centre
          returned the <aside>, so every real click hit the rail instead. A
          synthetic click bypasses hit-testing, which is exactly why my
          verification passed while the founder's click did nothing.
          It now floats INSIDE the profile column (founder: "it should be
          floating on the profile section"), where nothing overlaps it.

          ⚠ THE ICON IS THE STATE. Founder: "have the music icon and pause icon
          cleanly switch between each other so the user knows they can pause
          it." So the round button IS the play/pause control and its glyph
          swaps; the track name beside it opens the credit. Two targets, two
          jobs, no ambiguity.

          ⚠ COLOUR COMES FROM THE PROFILE'S ACCENT, not a hardcoded brand
          gradient — this is the owner's page, so it wears their colour. */}
      <div className="flex items-center gap-2">
        {open && (
          // The credit. Artist, title, artwork, licence, link back.
          <div
            className="rounded-2xl overflow-hidden shadow-2xl w-[248px]"
            style={{ background: 'var(--surface-1,#14141F)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <div className="flex items-center gap-2.5 p-2.5">
              {track.artwork
                ? <img src={track.artwork} alt="" width={40} height={40} className="rounded-lg shrink-0" />
                : <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}><Icon name="music_note" size={18} /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold truncate">{track.title || 'Unknown track'}</p>
                <p className="text-[10px] text-text-secondary truncate">
                  {track.artist || (isAudius ? 'Unknown artist' : 'Uploaded by the owner')}
                </p>
              </div>
              {track.explicit && (
                <span className="text-[9px] font-bold px-1 rounded shrink-0" style={{ background: 'rgba(255,255,255,0.10)' }}>E</span>
              )}
            </div>

            {failed ? (
              // ⚠ LINK ROT IS REAL: an Audius track can be deleted, gated or made
              // private after it was picked. Say so rather than leaving a dead control.
              <p className="px-2.5 pb-2.5 text-[11px] text-brand-ember">This track is no longer available.</p>
            ) : (
              <>
                <div role="presentation" onClick={seek} className="mx-2.5 h-1.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.12)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
                </div>
                <div className="flex items-center justify-between px-2.5 pt-1 text-[10px] font-dmmono tabular-nums text-text-muted">
                  <span>{fmtDuration(pos)}</span><span>{fmtDuration(total)}</span>
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 mt-1"
              style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {isAudius ? (
                <a href={trackUrl(track)} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-text-secondary hover:underline truncate">
                  {track.license ? `${track.license} · ` : ''}on Audius
                </a>
              ) : (
                <span className="text-[10px] text-text-muted truncate">Uploaded by this profile</span>
              )}
              {onReport && (
                <button type="button" onClick={onReport} aria-label="Report this audio"
                  className="w-7 h-7 rounded-full grid place-items-center text-text-muted shrink-0">
                  <Icon name="flag" size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Track name, tap to open the credit. Hidden while the popup is open. */}
        {!open && (
          <button type="button" onClick={() => setOpen(true)}
            aria-label="Show track details"
            className="max-w-[168px] px-3 py-1.5 rounded-full text-[11px] font-bold truncate shadow-lg"
            style={{ background: 'rgba(10,10,16,0.82)', color: '#fff', border: '1px solid rgba(255,255,255,0.10)' }}>
            {track.title || 'Profile music'}
          </button>
        )}

        {/* Play / pause. The glyph IS the state. */}
        <button
          type="button"
          onClick={open ? () => setOpen(false) : toggle}
          aria-label={open ? 'Close' : (playing ? 'Pause music' : 'Play music')}
          className="relative w-12 h-12 rounded-full grid place-items-center shadow-lg active:scale-90 transition-transform shrink-0"
          style={{ background: accent, color: '#fff' }}
        >
          <Icon name={open ? 'close' : (playing ? 'pause' : 'music_note')} size={22} />
          {playing && !open && (
            <span aria-hidden="true" className="absolute inset-0 rounded-full"
              style={{ boxShadow: `0 0 0 3px ${accent}55` }} />
          )}
        </button>
      </div>
    </>
  );
}

export { AUDIUS_URL };
