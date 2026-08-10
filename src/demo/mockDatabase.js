/** DEMO-ONLY firebase/database (RTDB) shim. Presence = everyone offline/empty. */
export function getDatabase() { return { _t: 'rtdb' }; }
export function connectDatabaseEmulator() {}
export function ref(_db, path = '') { return { _t: 'rtref', path }; }
export function child(r, p) { return { _t: 'rtref', path: (r.path || '') + '/' + p }; }
export function onValue(r, cb) {
  const val = r && r.path && r.path.endsWith('.info/connected') ? true : null;
  Promise.resolve().then(() => cb({ val: () => val, exists: () => val != null, key: null }));
  return () => {};
}
export function onDisconnect() { return { set: () => Promise.resolve(), update: () => Promise.resolve(), remove: () => Promise.resolve(), cancel: () => Promise.resolve() }; }
export function set() { return Promise.resolve(); }
export function update() { return Promise.resolve(); }
export function remove() { return Promise.resolve(); }
export function get() { return Promise.resolve({ val: () => null, exists: () => false }); }
export function push() { return { key: 'demo', ref: { path: '' } }; }
export function serverTimestamp() { return Date.now(); }
export function query(r) { return r; }
export function orderByChild() { return {}; }
export function limitToLast() { return {}; }
export function equalTo() { return {}; }
export default { getDatabase };
