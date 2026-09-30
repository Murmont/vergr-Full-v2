// The PUBLIC address of a page, for anything that leaves the app: share sheets,
// copied links, invite links, QR codes.
//
// ⚠ NEVER BUILD ONE FROM `window.location.origin`. Inside the Android and
// desktop apps that is `http://tauri.localhost`, a host that exists only inside
// the app. Founder, 2026-09-14, on the Android share sheet reading
// "http://tauri.localhost/share/clip/…": "That is not professional and its not
// how other platforms do it". Every clip, post, group invite and verification QR
// shared from the app pointed there and opened nowhere.
//
// vergr.app serves every one of these paths on the web, so one origin is right
// on every platform, the website included.
export const PUBLIC_ORIGIN = 'https://vergr.app';

export const publicUrl = (path = '') => `${PUBLIC_ORIGIN}${String(path).startsWith('/') ? '' : '/'}${path}`;
