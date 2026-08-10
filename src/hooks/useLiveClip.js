// useLiveClip — "clip the last N seconds" of a live stream, from any viewer.
//
// This is the whole clip flow (tier gate → capture → upload → publish as a post)
// in one place, so the desktop watch page and the mobile/native viewer cannot
// drift apart. It wraps useStreamClipBuffer, which does the actual rolling-buffer
// capture, and falls back to a server-side ffmpeg cut where the browser can't
// capture the video element (Apple's native-HLS path taints the stream).
//
// The two paths produce the same result — a clip post owned by the VIEWER, not
// the host — so a caller only needs to render a button and call clip().

import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import useStreamClipBuffer from './useStreamClipBuffer';
import { createPost } from '../firebase/firestore';
import { uploadToR2 } from '../utils/r2Storage';
import { resolveTier } from '../utils/tierSystem';

// Clip length + how many clips per stream session, by the VIEWER's plan.
export const CLIP_TIER = {
  free: { sec: 30, max: 3 },
  lite: { sec: 60, max: 5 },
  pro:  { sec: 90, max: Infinity },
};

export function viewerClipTier(profile) {
  return resolveTier(profile);
}

export default function useLiveClip({
  videoRef, streamDoc, currentUser, profile, enabled = true, showToast,
}) {
  const tier = viewerClipTier(profile);
  const cfg = CLIP_TIER[tier];
  const { grab, isSupported } = useStreamClipBuffer(videoRef, { enabled });
  const [clipsUsed, setClipsUsed] = useState(0);
  const [clipping, setClipping] = useState(false);

  const clip = useCallback(async () => {
    if (clipping || !currentUser?.uid) return;
    if (clipsUsed >= cfg.max) {
      showToast?.(`Clip limit reached (${cfg.max} per stream on ${tier})`, 'info');
      return;
    }
    setClipping(true);
    try {
      let url;
      if (isSupported()) {
        // Chromium-class path: assemble locally from the rolling buffer.
        const blob = grab(cfg.sec);
        if (!blob || blob.size < 50_000) {
          showToast?.('Need a few more seconds of footage — try again shortly', 'info');
          return;
        }
        const file = new File([blob], `clip-${Date.now()}.webm`, { type: 'video/webm' });
        url = await uploadToR2(file, 'clip');
      } else {
        // Apple-webview / unsupported path: server-side ffmpeg cut on the box.
        const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'requestStreamClip');
        const { data } = await fn({ streamId: streamDoc?.id, durationSec: cfg.sec });
        if (!data?.clipUrl) throw new Error('Clip failed');
        url = data.clipUrl;
      }
      await createPost(currentUser.uid, {
        content: streamDoc?.title ? `Clip · ${streamDoc.title}` : 'Live clip',
        type: 'clip',
        mediaUrls: [url],
        hashtags: streamDoc?.game ? [String(streamDoc.game).toLowerCase()] : [],
        game: streamDoc?.game || null, // inherit the stream's game → For You categorization
        visibility: 'public',
      });
      setClipsUsed((n) => n + 1);
      showToast?.('Clip saved to your profile', 'success');
    } catch (err) {
      showToast?.(err?.message || 'Clip failed', 'error');
    } finally {
      setClipping(false);
    }
  }, [clipping, clipsUsed, cfg, tier, currentUser?.uid, streamDoc?.id, streamDoc?.title, streamDoc?.game, grab, isSupported, showToast]);

  return {
    clip,
    clipping,
    clipsUsed,
    clipsLeft: cfg.max === Infinity ? Infinity : Math.max(0, cfg.max - clipsUsed),
    clipSeconds: cfg.sec,
    tier,
  };
}
