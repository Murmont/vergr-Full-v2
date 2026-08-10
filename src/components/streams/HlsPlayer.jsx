// HLS player with optional P2P delivery (cuts Gcore/Origin egress ~40-50%
// on streams with 3+ viewers). Used by ViewerStreamScreen for public + casual
// streams. Tournament streams pass `disableP2P` to force pure CDN delivery
// (reliability mandate — no peering for prize-money matches).
//
// Browser support:
// - Safari + iOS: native HLS via <video src=...> works without hls.js
// - Chrome / Firefox / Edge: hls.js handles MSE-based playback
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { IS_NATIVE_BUILD } from '../../utils/platform';

// P2P (WebRTC peering) is unreliable inside the Android WebView and on touch
// devices generally: every failed peer fetch stalls up to the p2p timeout
// before HTTP fallback, which on a live stream reads as a "loop" (stall ->
// catch-up -> stall). Force pure-CDN delivery on native + coarse-pointer
// devices; keep P2P only for desktop web (where it cuts egress and works).
const isCoarsePointer = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export default function HlsPlayer({
  src,
  disableP2P = false,
  autoPlay = true,
  controls = true,
  muted = false,
  className = '',
  style,
  videoRef: forwardedRef,
  onReady,
  onError,
  onDrift,
}) {
  const localRef = useRef(null);
  const videoRef = forwardedRef || localRef;
  const hlsRef = useRef(null);
  const engineRef = useRef(null);
  const onDriftRef = useRef(onDrift);
  onDriftRef.current = onDrift;

  useEffect(() => {
    if (!src || !videoRef.current) return;

    let cancelled = false;
    const video = videoRef.current;

    // Effective P2P state: caller opt-out OR native build OR touch device.
    const mobileish = IS_NATIVE_BUILD || isCoarsePointer();
    const p2pDisabled = disableP2P || mobileish;
    let cleanupExtra = null;

    // Robust autoplay. The autoplay attribute alone is not enough: if
    // sound-on playback is blocked (or the WebView ignores the attribute),
    // the video never starts and the Android WebView paints its own grey
    // poster + play button (which is touch-dead inside the Tauri shell).
    // Strategy: explicit play(); on rejection fall back to muted playback
    // (always allowed, frames render immediately) and restore sound on the
    // first user gesture. Volume itself is the device's job — no on-screen
    // control.
    const gestureUnmute = () => {
      video.muted = false;
      const p = video.play(); p?.catch?.(() => {});
    };
    const detachGesture = () => {
      window.removeEventListener('pointerdown', gestureUnmute);
      window.removeEventListener('touchstart', gestureUnmute);
    };
    const attachGesture = () => {
      window.addEventListener('pointerdown', gestureUnmute, { once: true });
      window.addEventListener('touchstart', gestureUnmute, { once: true });
    };
    const ensurePlaying = () => {
      if (cancelled || !autoPlay || !video.paused) return;
      // Native (Android WebView): the promise-based play() dance can hang and
      // leaves the WebView's grey poster + play button on screen for the whole
      // startup window. Start muted IMMEDIATELY (always allowed → first frame
      // paints fast) and restore sound on the first tap if the caller wanted it.
      if (IS_NATIVE_BUILD) {
        const wantedSound = !muted;
        video.muted = true;
        const p = video.play(); p?.catch?.(() => {});
        if (wantedSound) attachGesture();
        return;
      }
      const p = video.play();
      if (!p?.catch) return;
      p.catch(() => {
        if (cancelled) return;
        const wantedSound = !muted;
        video.muted = true;
        const retry = video.play();
        retry?.then?.(() => { if (wantedSound && !cancelled) attachGesture(); });
        retry?.catch?.(() => { if (!cancelled) attachGesture(); });
      });
    };
    const onCanPlay = () => ensurePlaying();
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('loadedmetadata', onCanPlay);

    // Native HLS path (Safari, iOS). The OS player owns the live-edge logic, but
    // it can still drift back into the persisted past on a stall and "loop". We
    // can't reconfigure it, but we CAN report drift (so the viewer's LIVE/"GO
    // LIVE" pill works) and nudge it forward on large drift via seekable.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('loadedmetadata', () => onReady?.());
      let lastNativeDrift = 0;
      const onNativeTime = () => {
        const sk = video.seekable;
        if (!sk || !sk.length) return;
        const edge = sk.end(sk.length - 1);
        const drift = edge - video.currentTime;
        if (!Number.isFinite(drift)) return;
        const now = Date.now();
        if (now - lastNativeDrift > 1000) {
          lastNativeDrift = now;
          onDriftRef.current?.(Math.max(0, drift));
        }
        if (drift > 16) { try { video.currentTime = edge - 2; } catch { /* race */ } }
      };
      video.addEventListener('timeupdate', onNativeTime);
      return () => {
        video.src = '';
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadedmetadata', onCanPlay);
        video.removeEventListener('timeupdate', onNativeTime);
        detachGesture();
      };
    }

    if (!Hls.isSupported()) {
      onError?.(new Error('HLS not supported in this browser.'));
      return;
    }

    (async () => {
      // The box serves CLASSIC HLS (1s fMP4 fragments, no LL-HLS #EXT-X-PART).
      // lowLatencyMode is meant for true LL-HLS; on classic playlists it pins the
      // player aggressively to the live edge, so any mobile-network jitter falls
      // out of the small live window and the player stalls -> rebuffers -> skips,
      // which reads as a "loop".
      //
      // ADAPTIVE LATENCY (mobile/native): start LOW — sit only ~2 fragments
      // (≈2s) behind the edge for ~3-4s glass-to-glass. ONLY if THIS viewer
      // stalls repeatedly do we rebuild once on a STABLE deeper-buffer profile
      // (≈4s back) so a bad connection degrades gracefully instead of looping.
      // Good connections never pay the old flat 4s penalty. Desktop (wired,
      // P2P) keeps the tight low-latency profile.
      const lowConfig = {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 8,
        liveSyncDurationCount: 2,        // sit ~2 fragments (≈2s) back
        liveMaxLatencyDurationCount: 10, // ceiling before snapping to edge
        maxLiveSyncPlaybackRate: 1.5,    // gentle catch-up when behind
        startPosition: -1,               // always start at the live edge, not 0
        liveDurationInfinity: true,      // treat as a true live window, not VOD
        maxBufferLength: 10,
        fragLoadingMaxRetry: 6,          // ride out flaky mobile segment fetches
        manifestLoadingMaxRetry: 6,
      };
      const stableConfig = {
        ...lowConfig,
        backBufferLength: 12,
        liveSyncDurationCount: 4,        // deeper headroom for jittery networks
        liveMaxLatencyDurationCount: 12, // (server window is 18)
        maxBufferLength: 12,
      };
      const desktopConfig = {
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 6,
        maxLiveSyncPlaybackRate: 1.5,
        startPosition: -1,
        liveDurationInfinity: true,
      };

      // Build an hls.js config, injecting the P2P engine when allowed. Returns
      // the (possibly P2P-wrapped) config. Recreates the engine each rebuild.
      const buildConfig = async (cfg) => {
        if (p2pDisabled) return cfg;
        try {
          const { HlsJsP2PEngine } = await import('p2p-media-loader-hlsjs');
          if (cancelled) return cfg;
          engineRef.current = new HlsJsP2PEngine({
            core: {
              p2pDownloadTimeout: 3000,
              simultaneousHttpDownloads: 2,
              simultaneousP2PDownloads: 3,
              httpDownloadProbabilityInterval: 1000,
              webRtcMaxMessageSize: 64 * 1024,
            },
          });
          return HlsJsP2PEngine.getHlsJsConfig(cfg);
        } catch (e) {
          console.info('P2P loader not available, using plain HLS:', e.message);
          return cfg;
        }
      };

      const setupHls = async (cfg) => {
        const finalCfg = await buildConfig(cfg);
        if (cancelled) return;
        const hls = new Hls(finalCfg);
        hlsRef.current = hls;
        if (engineRef.current) engineRef.current.bindHls(hls);
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { onReady?.(); ensurePlaying(); });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) noteStall();
          if (data.fatal) {
            onError?.(new Error(`${data.type}: ${data.details}`));
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          }
        });
      };

      // Adaptive escalation: 3+ stalls within 30s on the LOW profile → rebuild
      // once on the STABLE profile (more buffer). One-shot, mobile/native only.
      let stalls = [];
      let escalated = false;
      const noteStall = () => {
        if (escalated || !mobileish) return;
        const now = Date.now();
        stalls = stalls.filter((t) => now - t < 30_000);
        stalls.push(now);
        if (stalls.length >= 3) {
          escalated = true;
          try { hlsRef.current?.destroy(); } catch { /* ignore */ }
          hlsRef.current = null;
          try { engineRef.current?.destroy?.(); } catch { /* ignore */ }
          engineRef.current = null;
          if (!cancelled) setupHls(stableConfig);
        }
      };
      video.addEventListener('waiting', noteStall);

      // Drift guard (attached once; reads the CURRENT hls instance so it
      // survives a rebuild): a player that falls behind the live edge keeps
      // replaying PAST segments (they persist on R2) instead of 404ing forward
      // = the "plays from when the broadcaster started" bug. Measure how far
      // behind liveSyncPosition we are; report it (throttled) and hard-seek to
      // the edge if we drift past 10s.
      let lastDriftReport = 0;
      const onTimeUpdate = () => {
        const sync = hlsRef.current?.liveSyncPosition;
        if (typeof sync !== 'number' || !Number.isFinite(sync)) return;
        const drift = sync - video.currentTime;
        const now = Date.now();
        if (now - lastDriftReport > 1000) {
          lastDriftReport = now;
          onDriftRef.current?.(Math.max(0, drift));
        }
        if (drift > 10) {
          try { video.currentTime = sync; } catch { /* seek may race teardown */ }
        }
      };
      video.addEventListener('timeupdate', onTimeUpdate);
      cleanupExtra = () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('waiting', noteStall);
      };

      await setupHls(mobileish ? lowConfig : desktopConfig);
    })();

    return () => {
      cancelled = true;
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadedmetadata', onCanPlay);
      detachGesture();
      cleanupExtra?.();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      engineRef.current?.destroy?.();
      engineRef.current = null;
    };
  }, [src, disableP2P, onReady, onError]);

  return (
    <video
      ref={videoRef}
      autoPlay={autoPlay}
      controls={controls}
      muted={muted}
      playsInline
      className={className}
      style={style}
    />
  );
}
