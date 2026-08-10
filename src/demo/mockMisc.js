/** DEMO-ONLY stubs for firebase/app, /app-check, /storage, /messaging. */

// firebase/app
export function initializeApp() { return { _t: 'app', name: '[DEFAULT]', options: {} }; }
export function getApp() { return { _t: 'app' }; }
export function getApps() { return [{ _t: 'app' }]; }
export function deleteApp() { return Promise.resolve(); }

// firebase/app-check
export function initializeAppCheck() { return { _t: 'appcheck' }; }
export function onTokenChanged() { return () => {}; }
export const ReCaptchaEnterpriseProvider = function () { return {}; };
export const ReCaptchaV3Provider = function () { return {}; };
export const CustomProvider = function () { return {}; };

// firebase/storage
export function getStorage() { return { _t: 'storage' }; }
export function connectStorageEmulator() {}
export function ref(_s, path = '') { return { _t: 'sref', fullPath: path }; }
export function uploadBytes() { return Promise.resolve({ ref: { fullPath: 'demo' } }); }
export function uploadBytesResumable() {
  return { on: (_e, _p, _err, done) => done && done(), snapshot: { ref: {} }, then: (f) => f({ ref: {} }) };
}
export function getDownloadURL() { return Promise.resolve(''); }
export function deleteObject() { return Promise.resolve(); }

// firebase/messaging
export function getMessaging() { return { _t: 'messaging' }; }
export function isSupported() { return Promise.resolve(false); }
export function getToken() { return Promise.resolve(null); }
export function onMessage() { return () => {}; }
export function deleteToken() { return Promise.resolve(); }
