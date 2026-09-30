// Sounds: the "♫ original sound – name" row on a clip, the sound page, and
// sounds people upload themselves.
//
// The model is TikTok's (researched 2026-09-13): the audio a clip was posted
// with IS a sound, "original sound – creator". Tapping it lists every clip that
// uses it, and "Use this sound" starts a new clip with it. People can also add
// a sound of their own (founder, 2026-09-13).
//
// COST, by construction, so nothing here scales a bill with every post:
//   - an ORIGINAL sound has NO document. Its key is `post_<postId>` and the page
//     builds it from that post, so posting a clip writes nothing extra.
//   - a clip that USES a sound carries `soundId` and a small `sound` snapshot on
//     the SAME createPost write, so the player draws the row with zero reads.
//   - only an UPLOADED sound writes a `sounds/{id}` doc (one write) and one R2
//     object, capped at the limits profile music already uses (30s, 2MB).
//   - a clip that uses a sound plays that audio BESIDE its video at playback
//     time. Nothing is re-encoded and nothing is stored twice.
import {
  collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit,
  serverTimestamp, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { getPost, getUser } from '../firebase/firestore';
import { uploadToR2 } from './r2Storage';

// The same caps profile music uploads already use (functions/r2.js
// AMBIANCE_MAX_BYTES). One place to change each.
export const SOUND_UPLOAD_MAX_SECONDS = 30;
export const SOUND_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const SOUND_TITLE_MAX = 80;

// Only audio we host is ever played. A post author can write any field on
// their own post, so a sound URL pointing anywhere else is ignored.
const CDN_PREFIX = 'https://cdn.vergr.app/';

export const ORIGINAL_PREFIX = 'post_';

/** The sound a clip's row opens. A clip with no chosen sound owns its original. */
export const soundKeyFor = (post) => (post?.soundId || (post?.id ? ORIGINAL_PREFIX + post.id : null));

/** The row text, e.g. "original sound – Verion". */
export function soundLineFor(post, ownerName) {
  if (post?.soundId && post?.sound?.title) {
    return `${post.sound.title} – ${post.sound.authorName || 'creator'}`;
  }
  return `original sound – ${ownerName || 'creator'}`;
}

/** Audio to play beside the video, or null when the clip plays its own. */
export function layeredSoundFor(post) {
  const url = post?.soundId ? post?.sound?.url : null;
  if (typeof url !== 'string' || !url.startsWith(CDN_PREFIX)) return null;
  return { url, keepOriginal: post.sound.keepOriginal !== false };
}

/** The fields createPost stores for a chosen sound. Empty when none is chosen. */
export function soundFieldsFor(sound, keepOriginal = true) {
  if (!sound?.id || typeof sound.url !== 'string' || !sound.url.startsWith(CDN_PREFIX)) return {};
  return {
    soundId: sound.id,
    sound: {
      title: String(sound.title || 'original sound').slice(0, SOUND_TITLE_MAX),
      authorId: sound.authorId || null,
      authorName: sound.authorName || 'creator',
      authorAvatar: sound.authorAvatar || null,
      url: sound.url,
      keepOriginal: !!keepOriginal,
    },
  };
}

// A masked Vanguard persona never has its real identity attached to a sound.
const maskedName = (user) => (user?.vanguard?.rank ? 'Vanguard' : null);

export async function getSoundByKey(key) {
  if (!key || typeof key !== 'string') return null;

  if (key.startsWith(ORIGINAL_PREFIX)) {
    const post = await getPost(key.slice(ORIGINAL_PREFIX.length)).catch(() => null);
    if (!post || post.status !== 'published') return null;
    // A clip that used someone else's sound hands on THAT sound, not a copy.
    if (post.soundId && post.soundId !== key) return getSoundByKey(post.soundId);
    const url = post.mediaUrls?.[0] || post.mediaUrl || null;
    if (!url || !url.startsWith(CDN_PREFIX)) return null;
    const author = post.authorId ? await getUser(post.authorId).catch(() => null) : null;
    const masked = maskedName(author);
    return {
      id: key,
      kind: 'original',
      title: 'original sound',
      authorId: masked ? null : post.authorId,
      authorName: masked || author?.displayName || author?.username || 'creator',
      authorAvatar: masked ? null : (author?.avatar || null),
      url,
      sourcePost: post,
    };
  }

  const snap = await getDoc(doc(db, 'sounds', key)).catch(() => null);
  if (!snap?.exists()) return null;
  const data = snap.data();
  if (data.status && data.status !== 'active') return null;
  return { id: snap.id, kind: 'upload', ...data };
}

/** Newest published clips using a sound. Reads only when the page opens. */
export async function listClipsForSound(key, max = 30) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    where('soundId', '==', key),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(max),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** An aggregate count: one read per 1,000 clips, never one per clip. */
export async function countClipsForSound(key) {
  const snap = await getCountFromServer(query(
    collection(db, 'posts'),
    where('soundId', '==', key),
    where('status', '==', 'published'),
  ));
  return snap.data().count;
}

export async function listMySounds(uid, max = 20) {
  if (!uid) return [];
  const snap = await getDocs(query(
    collection(db, 'sounds'),
    where('authorId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(max),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, kind: 'upload', ...d.data() }))
    .filter((s) => !s.status || s.status === 'active');
}

// ⚠ BOUNDED. A file the browser can neither decode nor reject never fires
// loadedmetadata OR error, and Chrome also defers media loading entirely in a
// hidden tab. Measured 2026-09-13: without this the Add a sound sheet sat on
// "Preparing" forever with no request ever sent.
const READ_AUDIO_TIMEOUT_MS = 15000;
export function readAudioSeconds(file) {
  const src = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const a = new Audio();
    let settled = false;
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(src); fn(); };
    const timer = setTimeout(() => finish(() => reject(new Error('Could not read that file. Keep the app open and try MP3, M4A, OGG or WAV.'))), READ_AUDIO_TIMEOUT_MS);
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(() => resolve(a.duration || 0));
    a.onerror = () => finish(() => reject(new Error('Could not read that file. Try MP3, M4A, OGG or WAV.')));
    a.src = src;
  });
}

/**
 * Upload a sound. Duration is checked HERE because the server only sees a
 * byte count; functions/r2.js enforces the size cap and audio-only type.
 */
export async function uploadSound(file, { uid, profile, title, onProgress }) {
  if (!uid) throw new Error('Sign in to add a sound.');
  if (!file?.type?.startsWith('audio/')) throw new Error('That is not an audio file.');
  if (file.size > SOUND_UPLOAD_MAX_BYTES) {
    throw new Error(`Sounds are limited to ${Math.round(SOUND_UPLOAD_MAX_BYTES / 1024 / 1024)}MB.`);
  }
  const secs = await readAudioSeconds(file);
  if (secs > SOUND_UPLOAD_MAX_SECONDS + 0.5) {
    throw new Error(`Sounds must be ${SOUND_UPLOAD_MAX_SECONDS}s or shorter (yours is ${Math.round(secs)}s).`);
  }
  const { url } = await uploadToR2(file, 'sound', onProgress);
  const masked = maskedName(profile);
  const cleanTitle = String(title || file.name || 'my sound')
    .replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, SOUND_TITLE_MAX) || 'my sound';
  const data = {
    title: cleanTitle,
    authorId: uid,
    authorName: String(masked || profile?.displayName || profile?.username || 'creator').slice(0, 100),
    authorAvatar: masked ? null : (profile?.avatar || null),
    url,
    duration: Math.round(secs),
    status: 'active',
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'sounds'), data);
  return { id: ref.id, kind: 'upload', ...data, createdAt: new Date() };
}
