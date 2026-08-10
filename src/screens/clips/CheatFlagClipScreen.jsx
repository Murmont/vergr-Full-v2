// CheatFlagClipScreen — mod-internal shareable clip viewer.
//
// Route: /clips/cheat-flag/:tournamentId/:matchId/:flagIndex
//
// Loads the match doc, picks `cheatFlag.flags[flagIndex]`, plays the
// existing `archiveVodUrl` with auto-seek to `flag.tSec - 10s` and auto-
// pause at `flag.tSec + 15s`. No separate clip file is generated server-
// side — R2 egress is $0 via the Cloudflare CDN and HTTP range requests
// only fetch bytes near the seek point.
//
// Gated by mod role (Vanguard non-recruit OR founder). Match docs are
// public-read in firestore.rules so the fetch works without auth; the
// UI gates rendering.

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { isVanguard } from '../../utils/vanguard';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import VodFlagScrubber from '../../components/tournament/VodFlagScrubber';

const PRE_ROLL_SEC  = 10;
const POST_ROLL_SEC = 15;

export default function CheatFlagClipScreen() {
  const { tournamentId, matchId, flagIndex } = useParams();
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const videoRef = useRef(null);

  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  // Once the mod manually seeks via the scrubber, drop the auto-pause that
  // confines playback to the original flag's window. They've explicitly
  // chosen to watch elsewhere — let them roam.
  const [freePlay, setFreePlay] = useState(false);
  const [error, setError] = useState(null);

  const idx = parseInt(flagIndex, 10);
  const flag = match?.cheatFlag?.flags?.[idx] || null;
  const startSec = Math.max(0, (flag?.tSec || 0) - PRE_ROLL_SEC);
  const endSec   = (flag?.tSec || 0) + POST_ROLL_SEC;

  // Gate UI on mod role. Founder + non-recruit Vanguard only.
  const iAmMod = profile?.role === 'admin' || (isVanguard(profile) && profile?.vanguard?.rank !== 'recruit');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tournaments', tournamentId, 'matches', matchId));
        if (cancelled) return;
        if (!snap.exists()) {
          setError('Match not found.');
        } else {
          setMatch({ id: snap.id, ...snap.data() });
        }
      } catch (e) {
        setError(e?.message || 'Failed to load match');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tournamentId, matchId]);

  // Seek + auto-pause once the video metadata is ready. Skips the
  // auto-pause once the mod has interacted with the scrubber (`freePlay`).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !match?.archiveVodUrl || !flag) return;
    const onLoaded = () => {
      try { v.currentTime = startSec; } catch {}
    };
    const onTime = () => {
      if (!freePlay && v.currentTime >= endSec) v.pause();
    };
    const onSeeked = () => {
      // User-initiated seek (scrubber click, native controls) trips free-play.
      // We can't perfectly distinguish from our own programmatic seek, so we
      // only trip if the new time is outside the original window.
      if (v.currentTime < startSec || v.currentTime > endSec + 1) setFreePlay(true);
    };
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [match?.archiveVodUrl, flag, startSec, endSec, freePlay]);

  const copyShare = async () => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      showToast('Mod-share link copied', 'success');
    } catch {
      showToast('Could not copy — long-press the URL to copy manually', 'error');
    }
  };

  if (!iAmMod) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
        <TopBar showBack title="Mod-only clip" />
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          <Icon name="lock" size={32} className="" />
          <p style={{ marginTop: 12, fontSize: 13 }}>
            This clip is for moderators only. The link should not be shared outside the Vanguard.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
        <TopBar showBack title="Loading clip…" />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#B44FFF',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
        <TopBar showBack title="Clip unavailable" />
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          {error || 'Match not found.'}
        </div>
      </div>
    );
  }

  if (!flag) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
        <TopBar showBack title="Flag not found" />
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          No AI cheat flag exists at index {idx} on this match.
        </div>
      </div>
    );
  }

  if (!match.archiveVodUrl) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
        <TopBar showBack title="No VOD" />
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          This match has no archived VOD yet. Clip cannot be played until the
          VOD archive pipeline completes.
        </div>
      </div>
    );
  }

  const sevColor = flag.severity >= 4 ? '#F04060'
                 : flag.severity >= 3 ? '#F0A500'
                 : '#B44FFF';

  return (
    <div style={{ minHeight: '100vh', background: '#0B0B14', color: '#fff' }}>
      <TopBar showBack title="Suspicious-moment clip" />
      <div style={{ padding: 16, maxWidth: 880, margin: '0 auto' }}>
        {/* Flag metadata header */}
        <div style={{
          padding: 14, borderRadius: 12,
          background: '#14141F', border: `1px solid ${sevColor}55`,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 10,
              fontWeight: 900, letterSpacing: '0.10em', textTransform: 'uppercase',
              background: sevColor + '22', color: sevColor,
              border: `1px solid ${sevColor}66`,
            }}>
              {flag.type} · sev {flag.severity}/5
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'DM Mono, monospace' }}>
              t = {flag.tSec?.toFixed(1)}s
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
              {match.name || `Match ${matchId.slice(0, 8)}`}
            </span>
          </div>
          {flag.note && (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, margin: 0 }}>
              {flag.note}
            </p>
          )}
        </div>

        {/* Video player */}
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          src={match.archiveVodUrl}
          style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 540 }}
        />

        {/* Flag scrubber overlay — every AI-flagged moment plotted along
            the VOD duration. Click a marker to jump; hover for context. */}
        <VodFlagScrubber
          videoRef={videoRef}
          flags={match.cheatFlag?.flags || []}
          currentFlagIdx={idx}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={copyShare} style={btn('#B44FFF')}>
            <Icon name="link" size={14} className="" /> Copy mod-share link
          </button>
          <button
            onClick={() => navigate(`/tournaments/${tournamentId}/match/${matchId}`)}
            style={btn('#F0A500')}
          >
            Open match
          </button>
          <button
            onClick={() => navigate('/vanguard/queue')}
            style={btn('#7B6FFF')}
          >
            Review queue
          </button>
        </div>

        <div style={{
          marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6,
        }}>
          Clip plays {PRE_ROLL_SEC}s before through {POST_ROLL_SEC}s after the flagged moment.
          Sharing outside the Vanguard / founder is a confidentiality breach — flags can be
          false positives until a mod confirms.
        </div>
      </div>
    </div>
  );
}

const btn = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  background: color + '15', color, border: `1px solid ${color}55`,
  fontSize: 12, fontWeight: 800, cursor: 'pointer',
});
