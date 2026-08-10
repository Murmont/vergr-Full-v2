/**
 * DEMO-ONLY in-memory Firestore shim.
 *
 * Aliased over `firebase/firestore` by vite.config.js when building in demo
 * mode (`--mode demo`). Implements the subset of the modular Firestore API the
 * app uses, backed by a flat in-memory doc store seeded from ./fixtures.js.
 *
 * Makes ZERO network calls — the demo build cannot read or write the real
 * project. Writes mutate the in-memory store and re-run active listeners so
 * optimistic UI (like/follow/post) still works while browsing.
 */
import './demoBootstrap';
import { SEED } from './fixtures';

// ─── Store: flat map of "a/b/c" doc path → data object ────────────────────
const store = new Map();
let autoN = 1;
const autoId = () => `demo_${Date.now().toString(36)}_${autoN++}`;

// ─── Timestamp ────────────────────────────────────────────────────────────
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
}

// ─── Field-value sentinels ─────────────────────────────────────────────────
export const serverTimestamp = () => ({ __sentinel: 'ts' });
export const increment = (n) => ({ __sentinel: 'inc', n });
export const arrayUnion = (...v) => ({ __sentinel: 'au', v });
export const arrayRemove = (...v) => ({ __sentinel: 'ar', v });
export const deleteField = () => ({ __sentinel: 'del' });
export const documentId = () => ({ __fieldPath: '__name__' });

// Deep clone that PRESERVES Timestamp instances (so .toDate()/.toMillis()
// survive read round-trips) and revives { __ts__: ms } sentinels from fixtures.
function clone(o) {
  if (o == null || typeof o !== 'object') return o;
  if (o instanceof Timestamp) return o;
  if (o.__ts__ !== undefined) return Timestamp.fromMillis(o.__ts__);
  if (Array.isArray(o)) return o.map(clone);
  const out = {};
  for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = clone(o[k]);
  return out;
}

// Seed the store now.
for (const [path, data] of Object.entries(SEED)) store.set(path, clone(data));

// ─── Path helpers ───────────────────────────────────────────────────────────
const segs = (p) => p.split('/').filter(Boolean);
function colDocs(colPath) {
  const out = [];
  const prefix = colPath + '/';
  for (const [k, v] of store) {
    if (k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') === -1) out.push([k, v]);
  }
  return out;
}
function groupDocs(name) {
  const out = [];
  for (const [k, v] of store) {
    const s = segs(k);
    if (s.length % 2 === 0 && s[s.length - 2] === name) out.push([k, v]);
  }
  return out;
}

// ─── References ───────────────────────────────────────────────────────────
export function getFirestore() { return { _t: 'db' }; }
export function initializeFirestore() { return { _t: 'db' }; }
export function connectFirestoreEmulator() {}
export function enableIndexedDbPersistence() { return Promise.resolve(); }

function colRef(path) { return { _t: 'col', path, id: segs(path).pop(), parent: null }; }
function docRefOf(path) { const s = segs(path); return { _t: 'doc', path, id: s[s.length - 1], parent: colRef(s.slice(0, -1).join('/')) }; }

export function collection(first, ...rest) {
  if (first && first._t === 'db') return colRef(rest.join('/'));
  if (first && first._t === 'doc') return colRef(first.path + '/' + rest.join('/'));
  if (first && first._t === 'col') return colRef(first.path + '/' + rest.join('/'));
  return colRef(rest.join('/'));
}
export function collectionGroup(_db, name) { return { _t: 'cg', name }; }
export function doc(first, ...rest) {
  if (first && first._t === 'db') return docRefOf(rest.join('/'));
  if (first && first._t === 'col') {
    const id = rest[0] || autoId();
    return docRefOf(first.path + '/' + id);
  }
  if (first && first._t === 'doc') return docRefOf(first.path + '/' + rest.join('/'));
  return docRefOf(rest.join('/'));
}

// ─── Query building ─────────────────────────────────────────────────────────
export function query(ref, ...cs) { return { _t: 'query', ref, cs }; }
export const where = (f, op, v) => ({ k: 'where', f, op, v });
export const orderBy = (f, dir = 'asc') => ({ k: 'orderBy', f, dir });
export const limit = (n) => ({ k: 'limit', n });
export const limitToLast = (n) => ({ k: 'limit', n });
export const startAfter = (...v) => ({ k: 'startAfter', v });
export const startAt = (...v) => ({ k: 'startAt', v });
export const endBefore = (...v) => ({ k: 'endBefore', v });
export const endAt = (...v) => ({ k: 'endAt', v });

function getField(data, id, f) {
  if (f && f.__fieldPath === '__name__') return id;
  if (typeof f !== 'string') return undefined;
  if (f.indexOf('.') === -1) return data[f];
  return f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}
function cmp(a, b) {
  const av = a && a.toMillis ? a.toMillis() : a;
  const bv = b && b.toMillis ? b.toMillis() : b;
  if (av == null && bv == null) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : av > bv ? 1 : 0;
}
function matchWhere(data, id, w) {
  const val = getField(data, id, w.f);
  const t = w.v && w.v.toMillis ? w.v.toMillis() : w.v;
  const v = val && val.toMillis ? val.toMillis() : val;
  switch (w.op) {
    case '==': return v === t || cmp(val, w.v) === 0;
    case '!=': return v !== t;
    case '>': return cmp(val, w.v) > 0;
    case '>=': return cmp(val, w.v) >= 0;
    case '<': return cmp(val, w.v) < 0;
    case '<=': return cmp(val, w.v) <= 0;
    case 'in': return Array.isArray(w.v) && w.v.includes(v);
    case 'not-in': return Array.isArray(w.v) && !w.v.includes(v);
    case 'array-contains': return Array.isArray(val) && val.includes(w.v);
    case 'array-contains-any': return Array.isArray(val) && Array.isArray(w.v) && val.some((x) => w.v.includes(x));
    default: return true;
  }
}

function runQuery(target) {
  let ref = target, cs = [];
  if (target._t === 'query') { ref = target.ref; cs = target.cs; }
  let entries = ref._t === 'cg' ? groupDocs(ref.name) : colDocs(ref.path);
  let rows = entries.map(([k, v]) => ({ id: segs(k).pop(), path: k, data: v }));
  for (const c of cs) if (c.k === 'where') rows = rows.filter((r) => matchWhere(r.data, r.id, c));
  const ob = cs.filter((c) => c.k === 'orderBy');
  for (let i = ob.length - 1; i >= 0; i--) {
    const o = ob[i];
    rows.sort((a, b) => { const r = cmp(getField(a.data, a.id, o.f), getField(b.data, b.id, o.f)); return o.dir === 'desc' ? -r : r; });
  }
  const lim = cs.find((c) => c.k === 'limit');
  if (lim) rows = rows.slice(0, lim.n);
  return rows;
}

// ─── Snapshots ──────────────────────────────────────────────────────────────
function docSnap(path) {
  const data = store.get(path);
  const id = segs(path).pop();
  return {
    id, exists: () => data !== undefined, data: () => (data === undefined ? undefined : clone(data)),
    get: (f) => getField(data || {}, id, f), ref: docRefOf(path),
  };
}
function querySnap(target) {
  const rows = runQuery(target);
  const docs = rows.map((r) => ({
    id: r.id, exists: () => true, data: () => clone(r.data),
    get: (f) => getField(r.data, r.id, f), ref: docRefOf(r.path),
  }));
  return {
    docs, size: docs.length, empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
  };
}

export function getDoc(ref) { return Promise.resolve(docSnap(ref.path)); }
export function getDocs(target) { return Promise.resolve(querySnap(target)); }
export function getDocFromCache(ref) { return getDoc(ref); }
export function getCountFromServer(target) {
  return Promise.resolve({ data: () => ({ count: runQuery(target).length }) });
}

// listeners
const listeners = new Set();
function notify() { for (const l of listeners) { try { l(); } catch {} } }

export function onSnapshot(target, a, b) {
  const next = typeof a === 'function' ? a : a && a.next;
  const path = target._t === 'doc' ? target.path : null;
  const emit = () => { try { next(path ? docSnap(path) : querySnap(target)); } catch (e) { /* swallow in demo */ } };
  const l = () => emit();
  listeners.add(l);
  emit();
  return () => listeners.delete(l);
}
export function onSnapshotsInSync() { return () => {}; }

// ─── Writes ───────────────────────────────────────────────────────────────
function applySentinels(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.__sentinel === 'ts') out[k] = Timestamp.now();
    else if (v && v.__sentinel === 'inc') out[k] = (Number(out[k]) || 0) + v.n;
    else if (v && v.__sentinel === 'au') { const a = Array.isArray(out[k]) ? out[k].slice() : []; for (const x of v.v) if (!a.includes(x)) a.push(x); out[k] = a; }
    else if (v && v.__sentinel === 'ar') { out[k] = (Array.isArray(out[k]) ? out[k] : []).filter((x) => !v.v.includes(x)); }
    else if (v && v.__sentinel === 'del') { delete out[k]; }
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v.toMillis) && !v.__sentinel) out[k] = applySentinels(typeof out[k] === 'object' && out[k] ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}
export function setDoc(ref, data, opts) {
  const cur = opts && opts.merge ? (store.get(ref.path) || {}) : {};
  store.set(ref.path, applySentinels(cur, data));
  notify(); return Promise.resolve();
}
export function addDoc(colRefArg, data) {
  const id = autoId(); const path = colRefArg.path + '/' + id;
  store.set(path, applySentinels({}, data)); notify();
  return Promise.resolve(docRefOf(path));
}
export function updateDoc(ref, data, ...rest) {
  let patch = data;
  if (typeof data === 'string') { patch = {}; const args = [data, ...rest]; for (let i = 0; i < args.length; i += 2) patch[args[i]] = args[i + 1]; }
  const cur = store.get(ref.path);
  if (cur === undefined) { store.set(ref.path, applySentinels({}, patch)); }
  else store.set(ref.path, applySentinels(cur, patch));
  notify(); return Promise.resolve();
}
export function deleteDoc(ref) { store.delete(ref.path); notify(); return Promise.resolve(); }

export function writeBatch() {
  const ops = [];
  return {
    set: (r, d, o) => { ops.push(() => setDoc(r, d, o)); },
    update: (r, d, ...x) => { ops.push(() => updateDoc(r, d, ...x)); },
    delete: (r) => { ops.push(() => deleteDoc(r)); },
    commit: async () => { for (const op of ops) await op(); },
  };
}
export function runTransaction(_db, fn) {
  const tx = {
    get: (r) => Promise.resolve(docSnap(r.path)),
    set: (r, d, o) => setDoc(r, d, o),
    update: (r, d, ...x) => updateDoc(r, d, ...x),
    delete: (r) => deleteDoc(r),
  };
  return Promise.resolve(fn(tx));
}

export const GeoPoint = class { constructor(lat, lng) { this.latitude = lat; this.longitude = lng; } };
export const FieldValue = { serverTimestamp, increment, arrayUnion, arrayRemove, delete: deleteField };
export const FieldPath = { documentId };

export default { getFirestore };
