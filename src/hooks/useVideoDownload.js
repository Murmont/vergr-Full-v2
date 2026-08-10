// Keep a chat video on the phone, Telegram-style: nothing downloads by itself,
// there is a download button, and once it is down it plays from disk.
//
// WHY VIDEO IS NOT AUTO-CACHED like photos are. A photo is a few hundred KB and
// caching it silently is a favour. A video is tens or hundreds of MB, and
// pulling one down because it happened to scroll past would spend someone's
// mobile data without being asked. So this is opt-in per video, always.
//
// Android only. Everywhere else `supported` is false and the component renders
// no button, playing from the CDN exactly as before.

import { useCallback, useEffect, useState } from 'react';
import {
  isFileCacheAvailable, localSrcFor, hasLocal, downloadVideo, removeVideo,
} from '../utils/fileMediaCache';

export default function useVideoDownload(url) {
  const supported = isFileCacheAvailable();

  // Read the local path synchronously on first render. Same reasoning as the
  // avatar cache: a render cannot await, so a video already on disk has to be
  // playable from the very first frame rather than after a lookup resolves.
  const [localSrc, setLocalSrc] = useState(() => (supported && url ? localSrcFor(url) : null));
  const [downloading, setDownloading] = useState(false);
  const [pct, setPct] = useState(null);

  useEffect(() => {
    setLocalSrc(supported && url ? localSrcFor(url) : null);
    setDownloading(false);
    setPct(null);
  }, [url, supported]);

  const download = useCallback(async () => {
    if (!supported || !url || downloading || hasLocal(url)) return;
    setDownloading(true);
    setPct(0);
    const ok = await downloadVideo(url, (got, total) => {
      // A server that sends no Content-Length gives total <= 0. Leaving pct null
      // makes the UI show an indeterminate spinner, which is honest, rather than
      // a percentage computed from a number we do not have.
      setPct(total > 0 ? Math.min(99, Math.round((got / total) * 100)) : null);
    });
    setDownloading(false);
    setPct(null);
    if (ok) setLocalSrc(localSrcFor(url));
  }, [supported, url, downloading]);

  const discard = useCallback(() => {
    if (!supported || !url) return;
    removeVideo(url);
    setLocalSrc(null);
  }, [supported, url]);

  // If the file vanished under us (manifest said we had it, the OS or a budget
  // trim disagreed), forget it and fall back to the network rather than leaving
  // a permanently broken player.
  const onLocalError = useCallback(() => {
    if (!localSrc) return;
    removeVideo(url);
    setLocalSrc(null);
  }, [localSrc, url]);

  return {
    supported,
    saved: !!localSrc,
    src: localSrc || url,
    downloading,
    pct,
    download,
    discard,
    onLocalError,
  };
}
