// Persistent store for the media the founder uploads into the stream simulator.
//
// ⚠ A BLOB URL DIES WITH THE TAB. The first version held uploads in React state
// as object URLs only, so every refresh emptied the rail and the founder had to
// re-pick every avatar and every video before capturing anything. For a tool
// whose whole job is producing screenshots over a long session, that is the
// difference between usable and not.
//
// ⚠ THE BLOB IS WHAT PERSISTS, NEVER THE URL. An object URL is a pointer into
// one document's memory; storing the string would give back a dead reference on
// the next load. IndexedDB stores the File itself and we mint a fresh URL each
// time the screen mounts.
//
// Dexie is already a dependency (messageCache, deviceMediaCache, chatCrypto),
// so this adds no weight. Its own database, so clearing it can never touch
// message history or the device media cache.
import Dexie from 'dexie';

const db = new Dexie('vergr-preview-assets');
db.version(1).stores({ assets: 'id' });   // { id, blob, name, type, ts }

// ⚠ IDS ARE NAMESPACED. An avatar for a cast member whose uid happened to be
// "stage" would otherwise overwrite the stage video.
export const avatarKey = (uid) => `avatar:${uid}`;
export const videoKey = (slot) => `video:${slot}`;

// ⚠ ONE SLOT PER TILE THAT CAN SHOW A DIFFERENT PERSON. The first version had
// exactly two videos, `stage` and `facecam`, and the co-host grid fed the SAME
// facecam clip to every guest tile — so a four-way capture showed one person
// duplicated three times, which is worse than an empty tile because it looks
// deliberate. A co-host stream is up to four publishers, so there are four
// publisher slots plus the facecam inset.
export const VIDEO_SLOTS = [
  { id: 'stage', label: 'Stage / host',
    hint: 'Fills the whole stage on a solo stream, and is the HOST tile in a co-host split.' },
  { id: 'facecam', label: 'Facecam (PiP)',
    hint: 'The inset tile composited over gameplay, and the large source in "Camera + screen PiP".' },
  { id: 'guest1', label: 'Co-host 1',
    hint: 'Second tile in a co-host split.' },
  { id: 'guest2', label: 'Co-host 2',
    hint: 'Third tile, only visible at 3 or 4 publishers.' },
  { id: 'guest3', label: 'Co-host 3',
    hint: 'Fourth tile, only visible at 4 publishers.' },
];
export const VIDEO_SLOT_IDS = VIDEO_SLOTS.map((s) => s.id);

export async function putAsset(id, file) {
  await db.assets.put({ id, blob: file, name: file.name || '', type: file.type || '', ts: Date.now() });
}

export async function deleteAsset(id) {
  await db.assets.delete(id);
}

// Every stored asset as { id: blob }. Callers mint their own object URLs so the
// revoke stays owned by whoever created it.
export async function loadAssets() {
  const rows = await db.assets.toArray();
  const out = {};
  rows.forEach((r) => { if (r?.blob) out[r.id] = r.blob; });
  return out;
}

export async function clearAssets() {
  await db.assets.clear();
}
