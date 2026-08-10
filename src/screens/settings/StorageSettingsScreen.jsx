import { useState, useEffect, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import {
  isGallerySaveSupported,
  getAutoSavePhotos, getAutoSaveVideos, setAutoSavePhotos, setAutoSaveVideos,
} from '../../utils/saveToGallery';
import { MEDIA_DL_OPTIONS, getMediaAutoDownload, setMediaAutoDownload } from '../../utils/networkPolicy';
import { cacheUsage, clearFileCache, MAX_VIDEO_BYTES } from '../../utils/fileMediaCache';

// B8 (NATIVE_APP_PLAN Part B): Telegram-style "Storage & Data" so VERGR never
// becomes the app silently eating the user's storage. Shows how much on-device
// space the app is using (Storage API estimate) + the local caches we control
// (feed/news caches, Cache Storage / offline shell), and a one-tap clear that
// frees space WITHOUT touching account data (everything here is a cache that
// re-fetches; messages/posts live in Firestore/relay, not in these caches).

const fmtBytes = (n) => {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// localStorage keys the app uses purely as caches (safe to clear).
const CACHE_LS_KEYS = [
  'vergr.feedcache.forYou', 'vergr.feedcache.following',
  'vergr.feedcache.trending', 'vergr.feedcache.shorts',
  'vergr_news_items_v1', 'vergr_news_bot_avatars_v1',
];

function localCacheBytes() {
  let bytes = 0;
  try {
    for (const k of CACHE_LS_KEYS) {
      const v = localStorage.getItem(k);
      if (v) bytes += (k.length + v.length) * 2; // UTF-16 ≈ 2 bytes/char
    }
  } catch {}
  return bytes;
}

export default function StorageSettingsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const [usage, setUsage] = useState(null);
  const [quota, setQuota] = useState(null);
  const [cacheCount, setCacheCount] = useState(0);
  const [localBytes, setLocalBytes] = useState(0);
  const [mediaUsage, setMediaUsage] = useState(null);
  const [clearing, setClearing] = useState(false);
  const galleryOn = isGallerySaveSupported();
  const [autoPhotos, setAutoPhotos] = useState(getAutoSavePhotos());
  const [autoVideos, setAutoVideos] = useState(getAutoSaveVideos());
  const [mediaDl, setMediaDl] = useState(getMediaAutoDownload());

  const toggleAutoPhotos = () => { const v = !autoPhotos; setAutoPhotos(v); setAutoSavePhotos(v); };
  const toggleAutoVideos = () => { const v = !autoVideos; setAutoVideos(v); setAutoSaveVideos(v); };
  const changeMediaDl = (v) => { setMediaDl(v); setMediaAutoDownload(v); };

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const measure = useCallback(async () => {
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        setUsage(est.usage ?? null);
        setQuota(est.quota ?? null);
      }
    } catch {}
    try {
      if (window.caches?.keys) setCacheCount((await caches.keys()).length);
    } catch {}
    setLocalBytes(localCacheBytes());
    // navigator.storage.estimate() cannot see the on-device media store — those
    // are real files written by Android, not browser storage. Without this the
    // screen would confidently report a number that omits the largest thing on
    // disk, which is worse than reporting nothing.
    setMediaUsage(cacheUsage());
  }, []);

  useEffect(() => { measure(); }, [measure]);

  const clearCache = async () => {
    setClearing(true);
    try {
      // 1. Local feed/news caches (instant-render caches — re-fill on next open).
      for (const k of CACHE_LS_KEYS) { try { localStorage.removeItem(k); } catch {} }
      // 2. Cache Storage (images, runtime, offline shell) — the SW re-precaches
      //    the shell on the next load; nothing here is user content.
      if (window.caches?.keys) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      // 3. The on-device media store (avatars, backgrounds, chat media). Real
      //    files, so the browser cache APIs above do not touch them.
      clearFileCache();
      showToast?.('Cache cleared', 'success');
    } catch {
      showToast?.('Could not clear all cache', 'error');
    }
    await measure();
    setClearing(false);
  };

  const pct = usage != null && quota ? Math.min(100, (usage / quota) * 100) : null;

  return (
    <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
      <TopBar title="Storage & Data" showBack />
      <div className="px-4 py-4 space-y-6">

        {/* Total on-device usage */}
        <div>
          <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">On this device</p>
          <div className="p-4 rounded-xl bg-surface-1 border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-primary font-semibold">VERGR storage used</span>
              <span className="font-dmmono font-bold tabular-nums text-brand-violet-light">
                {usage != null ? fmtBytes(usage) : '—'}
              </span>
            </div>
            {pct != null && (
              <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-violet to-brand-violet"
                     style={{ width: `${pct}%` }} />
              </div>
            )}
            {quota != null && (
              <p className="text-[11px] text-text-muted mt-2">
                {fmtBytes(usage || 0)} of {fmtBytes(quota)} available to the app
              </p>
            )}
          </div>
        </div>

        {/* Breakdown */}
        <div>
          <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">Caches</p>
          <div className="rounded-xl bg-surface-1 border border-white/[0.06] divide-y divide-white/[0.05]">
            {mediaUsage && (
              <>
                <Row
                  icon="account_circle"
                  label="Avatars & backgrounds"
                  value={`${fmtBytes(mediaUsage.permBytes || 0)} · ${mediaUsage.permCount || 0} files`}
                />
                <Row
                  icon="photo_library"
                  label="Chat media"
                  value={`${fmtBytes(mediaUsage.tempBytes || 0)} · ${mediaUsage.tempCount || 0} files`}
                />
                <Row
                  icon="download_done"
                  label="Downloaded videos"
                  value={`${fmtBytes(mediaUsage.videoBytes || 0)} of ${fmtBytes(MAX_VIDEO_BYTES)} · ${mediaUsage.videoCount || 0} files`}
                />
              </>
            )}
            <Row icon="dynamic_feed" label="Feed, news & shorts cache" value={fmtBytes(localBytes)} />
            <Row icon="image" label="Images & offline shell" value={`${cacheCount} store${cacheCount === 1 ? '' : 's'}`} />
          </div>
          <p className="text-[11px] text-text-muted mt-2 px-1">
            These speed up opening the app. Clearing them frees space and never deletes your
            messages, posts, or account data, they re-download as needed.
          </p>
        </div>

        {/* Auto-download media */}
        <div>
          <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">Auto-download media</p>
          <div className="rounded-xl bg-surface-1 border border-white/[0.06] p-3.5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-surface-2 text-text-muted flex items-center justify-center shrink-0">
                <Icon name="cloud_download" size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">Save chat media to this device</p>
                <p className="text-[11px] text-text-muted mt-0.5">Photos &amp; videos you view in chats are kept for instant, offline re-opening.</p>
              </div>
            </div>
            <Segmented value={mediaDl} options={MEDIA_DL_OPTIONS} onChange={changeMediaDl} />
          </div>
          <p className="text-[11px] text-text-muted mt-2 px-1">
            Media always displays; this only controls whether it's kept on the device.
            "Wi-Fi only" skips the extra save while you're on mobile data. Avatars are always kept.
          </p>
        </div>

        {/* Save to gallery (native only — a browser/desktop has no phone gallery) */}
        {galleryOn && (
          <div>
            <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">Save to gallery</p>
            <div className="rounded-xl bg-surface-1 border border-white/[0.06] divide-y divide-white/[0.05]">
              <ToggleRow icon="photo" label="Auto-save photos" sub="Save photos you receive in chats to a VERGR album"
                on={autoPhotos} onToggle={toggleAutoPhotos} />
              <ToggleRow icon="movie" label="Auto-save videos" sub="Save videos you receive in chats to a VERGR album"
                on={autoVideos} onToggle={toggleAutoVideos} />
            </div>
            <p className="text-[11px] text-text-muted mt-2 px-1">
              Auto-save runs while a chat is open. You can always save any photo or video by
              opening it and tapping the download icon.
            </p>
          </div>
        )}

        {/* Clear */}
        <button
          onClick={clearCache}
          disabled={clearing}
          className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl bg-surface-1 border border-white/[0.06] text-brand-ember font-semibold text-sm hover:bg-surface-2/50 active:scale-[0.99] transition disabled:opacity-50"
        >
          <Icon name={clearing ? 'hourglass_empty' : 'delete_sweep'} size={18} />
          {clearing ? 'Clearing…' : 'Clear cache'}
        </button>
      </div>
    </div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="w-9 h-9 rounded-lg bg-surface-2 text-text-muted flex items-center justify-center shrink-0">
        <Icon name={icon} size={18} />
      </div>
      <span className="flex-1 text-sm text-text-primary">{label}</span>
      <span className="font-dmmono tabular-nums text-text-muted text-sm">{value}</span>
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-surface-2/60 border border-white/[0.05]">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              active ? 'bg-brand-violet text-white shadow-[0_1px_6px_rgba(123,31,255,0.4)]' : 'text-text-secondary hover:text-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({ icon, label, sub, on, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3 p-3.5 text-left active:bg-surface-2/40">
      <div className="w-9 h-9 rounded-lg bg-surface-2 text-text-muted flex items-center justify-center shrink-0">
        <Icon name={icon} size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary">{label}</p>
        {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
      </div>
      <div className={`w-11 h-6 rounded-full shrink-0 relative transition-colors ${on ? 'bg-brand-violet' : 'bg-surface-3'}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </div>
    </button>
  );
}
