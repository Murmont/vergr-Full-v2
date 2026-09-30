/**
 * Bundled app version — keep in lockstep with src-tauri/tauri.conf.json `version`.
 * Used by the native update channel (A2): the bundled APK ships frozen web
 * assets, so we can't hot-swap JS over the air. Instead the app fetches a small
 * remote version.json on launch and, if a newer APK exists, prompts a one-tap
 * download. Bump BOTH this and tauri.conf.json on every APK release.
 */
export const APP_VERSION = '1.0.219';

/** Numeric build code — must increase every release (compared for "is newer"). */
export const APP_VERSION_CODE = 219;
