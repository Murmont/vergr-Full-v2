/**
 * OTA frontend updates (mobile native shell only) — via tauri-plugin-hotswap.
 *
 * The Android APK bundles the web assets, so a `firebase deploy` can't reach
 * installed users. hotswap swaps the embedded asset provider for a downloaded,
 * minisign-signed code bundle (index.html + assets/, ~2MB); missing files fall
 * through to the embedded assets so the ~72MB of media is never re-downloaded.
 *
 * SELF-DIAGNOSING: every step emits a `vergr:ota-status` event with a plain
 * message (level: info | warn | error | ready). NativeUpdateBanner renders it
 * on-screen, so when a patch does NOT land we can read the exact reason on the
 * device itself — no adb, no guessing. Once the cause is known and fixed this
 * stays as a harmless status line.
 */
import { isMobileApp, IS_STORE_BUILD } from './platform';

let started = false;

function report(level, message) {
  try { console.warn('[OTA]', level, message); } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent('vergr:ota-status', { detail: { level, message } }));
  } catch { /* ignore */ }
}

export async function runMobileOtaUpdate() {
  // STORE builds: no self-updating of any kind (store policy) — the hotswap
  // OTA path must never even check for bundles. (OTA is also globally OFF via
  // min_binary 99.0.0; this is the belt-and-braces for the store variant.)
  if (IS_STORE_BUILD) return;
  if (started || !isMobileApp()) return;
  started = true;

  // OTA is globally OFF (the manifest pins min_binary_version to 99.0.0, so no
  // device ever qualifies). Running the check anyway buys nothing and costs
  // real harm: on a phone with a flaky connection the request fails and the
  // self-diagnosing banner paints a full-width red "Patch update error" over
  // the boot screen — which reads as the app being broken when it is only a
  // disabled feature failing to reach a manifest that would reject it anyway.
  // Turn OTA back on by flipping this and lowering min_binary_version.
  return;

  let api;
  try {
    api = await import('tauri-plugin-hotswap-api');
  } catch (e) {
    report('error', 'plugin not loaded: ' + (e?.message || e));
    return;
  }

  // STEP 1 — CONFIRM the currently-running bundle. hotswap auto-rolls-back any
  // unconfirmed bundle on the next launch (default SingleLaunch policy), so this
  // confirms the bundle that just booted (the previously-applied patch), keeping
  // it. No-op when running embedded assets (sequence 0).
  try { await api.notifyReady(); } catch (e) { report('warn', 'notifyReady: ' + (e?.message || e)); }

  let info = null;
  try { info = await api.getVersionInfo(); } catch { /* optional */ }

  // STEP 2 — check the manifest for something newer.
  let res;
  try {
    res = await api.checkUpdate();
  } catch (e) {
    report('error', 'checkUpdate failed: ' + (e?.message || e));
    return;
  }

  if (!res || !res.available) {
    report('info', `up to date (device seq ${info?.sequence ?? '?'} / binary ${info?.binary_version ?? '?'})`);
    return;
  }

  // STEP 3 — download + verify (minisign) + extract + activate. applyUpdate()
  // swaps the plugin's LIVE asset dir to the new bundle and sets its
  // current_sequence to the new seq, so a reload immediately serves it.
  let version;
  try {
    version = await api.applyUpdate();
  } catch (e) {
    report('error', `applyUpdate failed (server seq ${res.sequence}): ` + (e?.message || e));
    return;
  }

  // STEP 4 — CONFIRM THE JUST-APPLIED BUNDLE NOW. After applyUpdate the plugin's
  // current_sequence == the new seq, so notifyReady() marks the NEW bundle
  // confirmed on disk. Combined with min_binary_version == app version in the
  // manifest (so DiscardOnUpgrade does NOT nuke it), this is what makes the
  // patch SURVIVE a cold restart instead of rolling back.
  try { await api.notifyReady(); } catch (e) { report('warn', 'confirm new: ' + (e?.message || e)); }

  try { localStorage.setItem('vergr.ota.pendingVersion', String(version || res.version || '')); } catch { /* ignore */ }
  report('ready', `update ${version || res.version || res.sequence} applied`);
  try {
    window.dispatchEvent(new CustomEvent('vergr:ota-ready', {
      detail: { version, sequence: res.sequence, mandatory: res.mandatory },
    }));
  } catch { /* ignore */ }

  // STEP 5 — serve the new assets THIS session with ONE reload. Guarded by
  // sessionStorage (NOT localStorage): at most one reload per app launch, and
  // it auto-clears on the next cold start, so it can never become the permanent
  // reload-block that caused the earlier loop. The reload is safe (it is NOT a
  // process relaunch, which on Android just closes the app).
  try {
    if (!sessionStorage.getItem('vergr.ota.reloadedThisLaunch')) {
      sessionStorage.setItem('vergr.ota.reloadedThisLaunch', '1');
      // Reload from ROOT, not the current sub-path: with clean URLs the bundled
      // shell has no SPA fallback, so reloading a sub-path would 404. Root always
      // serves index.html and re-boots the SPA onto the freshly-applied bundle.
      setTimeout(() => { try { window.location.href = '/'; } catch { /* ignore */ } }, 500);
    }
  } catch { /* ignore */ }
}
