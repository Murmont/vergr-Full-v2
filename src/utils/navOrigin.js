// Section entry origin — "where did I come into this section from?".
//
// Some sections (Squads) own their entire chrome, so entering them from the
// Community hub replaces the community rail with the section's own. Their
// "Back to Main" button then dumps the user on the home feed, which is not
// where they came from. This records the entry point so the section can send
// them back where they started instead.
//
// sessionStorage (NOT localStorage): an origin is a within-session breadcrumb.
// It must not survive a browser restart, and a second tab has its own trail.
//
// The record carries the `prefix` of the section it belongs to, so a stale
// origin can be detected + dropped the moment the user leaves that section
// (see `pruneNavOrigin`, called from the router on every navigation).

const KEY = 'vergr_nav_origin';

/**
 * Remember how the user entered a section.
 * @param {string} prefix  route prefix the origin is valid inside, e.g. '/squads'
 * @param {string} path    where "back" should return to
 * @param {string} label   button copy, e.g. 'Back to Community'
 */
export function setNavOrigin(prefix, path, label) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ prefix, path, label }));
  } catch { /* private mode — degrade to the default back target */ }
}

/** Read the origin for a section, or null when there isn't a valid one. */
export function getNavOrigin(prefix) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.prefix === prefix && o.path && o.label ? o : null;
  } catch { return null; }
}

export function clearNavOrigin() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Drop the origin once the user is neither inside the section it belongs to
 * nor on the origin route itself. Without this, a trail left by an earlier
 * Community → Squads trip would still be claimed by a later visit that
 * arrived from somewhere else entirely (a squad link in a chat, say).
 */
export function pruneNavOrigin(pathname) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o?.prefix) { clearNavOrigin(); return; }
    const inSection = pathname === o.prefix || pathname.startsWith(o.prefix + '/');
    const atOrigin = pathname === o.path || pathname.startsWith(o.path + '/');
    if (!inSection && !atOrigin) clearNavOrigin();
  } catch { clearNavOrigin(); }
}
