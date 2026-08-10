/**
 * Native update channel (A2). The Android APK bundles frozen web assets, so a
 * `firebase deploy` no longer reaches installed users automatically. On launch
 * (native Android only) this fetches the remote version.json from vergr.app and,
 * if a newer APK exists, shows a one-tap "Update" banner that downloads it.
 * Web / installed-PWA users always run the latest deploy, so this is a no-op there.
 */
import { useEffect, useState } from 'react';
import { isAndroidApp, IS_STORE_BUILD, IS_DEV_CHANNEL } from '../utils/platform';
import { APP_VERSION_CODE } from '../utils/appVersion';
import Icon from './Icon';

// Two SEPARATE channels, and they must never read each other's manifest.
//
//   version.json      stable. The public /platform download + every existing
//                     sideload install. Frozen at whatever is released.
//   version-dev.json  the founder's private playground. Only a device running a
//                     dev-channel build ever fetches this.
//
// A dev build that polled the stable manifest would offer to "update" itself
// backwards onto the public release; a stable build that polled the dev
// manifest would push unreleased code to everyone who ever sideloaded. Hence
// the compile-time split rather than a runtime toggle.
const VERSION_URL = IS_DEV_CHANNEL
  ? 'https://vergr.app/version-dev.json'
  : 'https://vergr.app/version.json';
const DISMISS_KEY = 'vergr.updateDismissed.code';

export default function NativeUpdateBanner() {
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | downloading | permission | error
  const [pct, setPct] = useState(0);
  const [otaReady, setOtaReady] = useState(false); // a code-only OTA patch is staged
  const [otaStatus, setOtaStatus] = useState(null); // { level, message } diagnostic

  // OTA patch staged (otaUpdate.js fires this after a signed bundle is applied).
  // It activates on the next cold start, so offer a one-tap restart to apply now.
  useEffect(() => {
    const onReady = () => setOtaReady(true);
    // Surface ONLY real problems on-screen. 'ready' is handled by the patch
    // banner; routine 'info' (e.g. "up to date") must NEVER render — it was a
    // debug aid and nagged on every launch once a patch was applied. Errors and
    // warnings stay visible so a genuine failure can still be read off-device.
    const onStatus = (e) => {
      const d = e?.detail || {};
      if (d.level !== 'error' && d.level !== 'warn') return;
      setOtaStatus({ level: d.level, message: String(d.message || '') });
    };
    window.addEventListener('vergr:ota-ready', onReady);
    window.addEventListener('vergr:ota-status', onStatus);
    return () => {
      window.removeEventListener('vergr:ota-ready', onReady);
      window.removeEventListener('vergr:ota-status', onStatus);
    };
  }, []);

  // NOTE: there is intentionally no in-app "apply" action. A hotswap bundle is
  // activated for the NEXT real app launch and is only made permanent when the
  // app calls notifyReady() on that launch (see otaUpdate.js). A webview reload
  // does NOT count as that launch (the patch rolls back), and Android
  // relaunch() just closes the app without reopening. So the only reliable
  // action is for the user to fully close and reopen VERGR — the banner says so.

  // Native updater feedback (window.VergrUpdate dispatches these).
  useEffect(() => {
    const onProgress = (e) => { setPhase('downloading'); setPct(Number(e?.detail?.pct || 0)); };
    const onPerm = () => setPhase('permission');
    const onErr = () => setPhase('error');
    window.addEventListener('vergr:update-progress', onProgress);
    window.addEventListener('vergr:update-need-permission', onPerm);
    window.addEventListener('vergr:update-error', onErr);
    return () => {
      window.removeEventListener('vergr:update-progress', onProgress);
      window.removeEventListener('vergr:update-need-permission', onPerm);
      window.removeEventListener('vergr:update-error', onErr);
    };
  }, []);

  useEffect(() => {
    // STORE builds must not self-update (AppGallery/Play policy): the store
    // delivers updates. Never fetch version.json or offer an APK download.
    //
    // The dev channel is the one exception. It is a store build so that it
    // behaves like the Play bundle in every other respect, but it is never
    // distributed through a store, so no store policy applies to it and it
    // keeps the updater (that is the entire point of the channel).
    if (IS_STORE_BUILD && !IS_DEV_CHANNEL) return;
    if (!isAndroidApp()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const remoteCode = Number(data?.androidVersionCode || 0);
        if (!remoteCode || remoteCode <= APP_VERSION_CODE) return;
        // Respect a per-version dismissal so we don't nag every launch.
        if (Number(localStorage.getItem(DISMISS_KEY) || 0) >= remoteCode) return;
        if (!cancelled) setInfo({ ...data, remoteCode });
      } catch { /* offline / blocked — silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // OTA diagnostic banner — shows the exact patch-check result on-screen so a
  // failure can be read off the device (no adb). Errors are sticky; the "no
  // update" info line is dismissible.
  if (otaStatus && !otaReady && !info) {
    const isErr = otaStatus.level === 'error' || otaStatus.level === 'warn';
    return (
      <div
        className="fixed left-3 right-3 z-[9999] rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{
          bottom: 'calc(76px + env(safe-area-inset-bottom))',
          background: isErr ? 'linear-gradient(135deg,#2a0f14,#3a0e12)' : 'linear-gradient(135deg,#0e1426,#10182e)',
          border: `1px solid ${isErr ? 'rgba(240,64,96,0.4)' : 'rgba(120,140,200,0.35)'}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
             style={{ background: isErr ? 'rgba(240,64,96,0.18)' : 'rgba(120,140,200,0.18)' }}>
          <Icon name={isErr ? 'sync_problem' : 'sync'} size={18} className={isErr ? 'text-brand-ember' : 'text-text-secondary'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-white leading-tight">{isErr ? 'Patch update error' : 'Patch check'}</p>
          <p className="text-[11px] text-text-muted break-words">{otaStatus.message}</p>
        </div>
        <button onClick={() => setOtaStatus(null)} className="text-text-muted hover:text-white shrink-0" aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  // OTA patch banner (code-only, no full APK). Takes priority — it's the common case.
  if (otaReady && !info) {
    return (
      <div
        className="fixed left-3 right-3 z-[9999] rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))', background: 'linear-gradient(135deg,#0c2a24,#0e3a30)', border: '1px solid rgba(180,79,255,0.4)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(180,79,255,0.18)' }}>
          <Icon name="bolt" size={18} className="text-brand-violet-light" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-white leading-tight">Applying latest update…</p>
          <p className="text-[11px] text-text-muted">VERGR will refresh in a moment.</p>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const download = async () => {
    // Fallback must stay on the same channel as the manifest we read, or a dev
    // build with a malformed manifest would quietly install the public release.
    const url = info.apkUrl || (IS_DEV_CHANNEL
      ? 'https://cdn.vergr.app/downloads/VERGR-dev.apk'
      : 'https://cdn.vergr.app/downloads/VERGR.apk');
    // Preferred: native in-app download with progress + auto-install.
    if (typeof window !== 'undefined' && window.VergrUpdate?.download) {
      setPhase('downloading'); setPct(0);
      try { window.VergrUpdate.download(url); return; } catch { /* fall through */ }
    }
    // Fallback (older shells / web): hand off to the browser.
    try {
      const shell = await import('@tauri-apps/plugin-opener').catch(() => null);
      if (shell?.openUrl) { await shell.openUrl(url); return; }
    } catch { /* fall through */ }
    window.open(url, '_blank');
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(info.remoteCode)); } catch { /* ignore */ }
    setInfo(null);
  };

  return (
    <div
      className="fixed left-3 right-3 z-[9999] rounded-2xl px-4 py-3 flex items-center gap-3"
      style={{
        bottom: 'calc(76px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(135deg,#1a1030,#241048)',
        border: '1px solid rgba(180,79,255,0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
           style={{ background: 'rgba(180,79,255,0.18)' }}>
        <Icon name="system_update" size={18} className="text-brand-violet-light" />
      </div>
      <div className="flex-1 min-w-0">
        {phase === 'downloading' ? (
          <>
            <p className="text-[13px] font-bold text-white leading-tight">
              {pct >= 100 ? 'Opening installer…' : `Downloading… ${pct}%`}
            </p>
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <div className="h-full rounded-full transition-all"
                   style={{ width: `${Math.max(4, pct)}%`, background: '#B44FFF' }} />
            </div>
          </>
        ) : phase === 'permission' ? (
          <>
            <p className="text-[13px] font-bold text-white leading-tight">Allow app installs</p>
            <p className="text-[11px] text-text-muted truncate">Enable it for VERGR, then tap Update again.</p>
          </>
        ) : phase === 'error' ? (
          <>
            <p className="text-[13px] font-bold text-white leading-tight">Update failed</p>
            <p className="text-[11px] text-text-muted truncate">Check your connection and try again.</p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold text-white leading-tight">Update available</p>
            <p className="text-[11px] text-text-muted truncate">{info.notes || 'A newer version of VERGR is ready.'}</p>
          </>
        )}
      </div>
      {phase !== 'downloading' && (
        <button onClick={download}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-bold text-white shrink-0"
                style={{ background: '#B44FFF', boxShadow: '0 0 16px rgba(180,79,255,0.45)' }}>
          {phase === 'idle' ? 'Update' : 'Retry'}
        </button>
      )}
      {phase !== 'downloading' && (
        <button onClick={dismiss} className="text-text-muted hover:text-white shrink-0" aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
