// Shorts playback from an HLS rendition ladder.
//
// WHY THIS EXISTS. A single uploaded file gives every viewer the same bitrate,
// so someone on a weak connection has nothing smaller to fall back to and just
// waits. That is the loading spinner TikTok never shows: they serve several
// renditions and the player picks one from the measured connection, switching
// mid-playback as conditions change.
//
// hls.js does that selection for us. The only thing worth tuning is that a
// SHORTS deck is not a long-form player — the reason a video is on screen is
// that someone flicked to it half a second ago, so the priorities are inverted:
//
//   • Start at a LOW rendition and climb. A short is over in seconds; guessing
//     high and stalling once is far worse than starting soft and sharpening,
//     because the stall is the only part the viewer actually notices.
//   • Keep the buffer SHORT. Buffering 30s ahead of a video the user is about
//     to swipe past is bandwidth taken from the video they swipe to next.
//
// Falls back to native HLS on Safari/iOS, which plays .m3u8 directly and does
// its own adaptation.

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import Icon from '../../components/Icon';

export default function LadderPlayer({ src, poster, active = true, muted = false, speed = 1, onProgress }) {
  const ref = useRef(null);
  const hlsRef = useRef(null);
  const rafRef = useRef(0);
  const userPaused = useRef(false);
  const wasActive = useRef(false);
  const [paused, setPaused] = useState(false);

  // Attach the engine. Only the ACTIVE slide gets one: an hls.js instance per
  // slide would put three ABR controllers on one connection, each concluding
  // the network is worse than it is and all three picking too low.
  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;

    if (!active) {
      // Neighbour: no engine, just the poster. The swipe-in cost is one manifest
      // fetch, which is small and parallel-friendly, unlike a video body.
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* ignore */ } hlsRef.current = null; }
      try { video.pause(); } catch { /* ignore */ }
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return () => { try { video.removeAttribute('src'); video.load(); } catch { /* ignore */ } };
    }
    if (!Hls.isSupported()) { video.src = src; return; }

    const hls = new Hls({
      // Start soft, climb. See the note at the top.
      startLevel: 0,
      // Roughly two seconds of runway. Enough to absorb jitter, small enough
      // that a swipe does not throw away a large download.
      maxBufferLength: 6,
      maxMaxBufferLength: 12,
      backBufferLength: 4,
      // Be quicker than the default to admit the connection got better or worse
      // — a short does not last long enough for a slow reaction to help.
      abrEwmaFastLive: 2.0,
      abrEwmaSlowLive: 6.0,
      lowLatencyMode: false,
      enableWorker: true,
    });
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data?.fatal) return;
      // A ladder that cannot play must never be a dead black slide. Drop to the
      // manifest URL and let the browser do whatever it can with it.
      try { hls.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
      try { video.src = src; } catch { /* ignore */ }
    });

    return () => {
      try { hls.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    };
  }, [src, active]);

  // Play/pause + mute follow `active`, matching VideoPlayer exactly so the two
  // paths feel identical to the finger.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.muted = muted;
      if (!wasActive.current) {
        try { v.currentTime = 0; } catch { /* ignore */ }
        userPaused.current = false;
        setPaused(false);
      }
      if (!userPaused.current) v.play().catch(() => {});
    } else {
      v.muted = true;
      try { v.pause(); } catch { /* ignore */ }
    }
    wasActive.current = active;
  }, [active, muted]);

  useEffect(() => {
    const v = ref.current;
    if (v) v.playbackRate = active ? speed : 1;
  }, [speed, active]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !onProgress) return;
    const onTime = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        onProgress(v.duration ? v.currentTime / v.duration : 0);
      });
    };
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [active, onProgress]);

  useEffect(() => {
    const onVis = () => {
      const v = ref.current;
      if (!v || !active) return;
      if (document.hidden) v.pause();
      else if (!userPaused.current) v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  const toggle = () => {
    const v = ref.current;
    if (!v || !active) return;
    if (v.paused) { v.play(); userPaused.current = false; setPaused(false); }
    else { v.pause(); userPaused.current = true; setPaused(true); }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black" onClick={toggle}>
      <video
        ref={ref}
        poster={poster}
        loop
        playsInline
        muted={active ? muted : true}
        className="w-full h-full object-contain"
      />
      {active && paused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={40} className="text-white" />
          </div>
        </div>
      )}
    </div>
  );
}
