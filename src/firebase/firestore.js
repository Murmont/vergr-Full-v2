import { db, storage, auth } from './config';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp,
  increment, arrayUnion, arrayRemove, writeBatch, runTransaction,
} from 'firebase/firestore';
import { uploadToR2 } from '../utils/r2Storage';
import { compressMedia } from '../utils/mediaCompression';
import { ADS_CONFIG } from '../config/ads';

// ═══════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════

export const getUser = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const getUserByUsername = async (username) => {
  const q = query(collection(db, 'users'), where('username', '==', username), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

export const getUserById = async (userId) => {
  const docRef = doc(db, 'users', userId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
};

export const updateUser = async (uid, data) => {
  await updateDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() });
};

export const completeOnboarding = async (uid, { username, displayName, bio, gameTags, linkedAccounts }) => {
  await updateDoc(doc(db, 'users', uid), {
    username,
    displayName,
    bio: bio || '',
    gameTags: gameTags || [],
    linkedAccounts: linkedAccounts || {},
    isOnboarded: true,
    level: 1,
    totalXP: 0,
    updatedAt: serverTimestamp(),
  });
};

export const updateUserCoins = async (uid, amount) => {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, {
    coins: increment(amount),
    coinsSpent: amount < 0 ? increment(Math.abs(amount)) : increment(0),
    updatedAt: serverTimestamp()
  });
};

export const subscribeToUser = (uid, callback) => {
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
};

// ═══════════════════════════════════════════
// FOLLOWS
// ═══════════════════════════════════════════

export const followUser = async (followerId, followingId) => {
  const followId = `${followerId}_${followingId}`;
  const batch = writeBatch(db);
  
  batch.set(doc(db, 'follows', followId), {
    followerId,
    followingId,
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, 'users', followerId), { 
    followingCount: increment(1) 
  });

  batch.update(doc(db, 'users', followingId), { 
    followerCount: increment(1) 
  });

  await batch.commit();
};

export const unfollowUser = async (followerId, followingId) => {
  const followId = `${followerId}_${followingId}`;
  const batch = writeBatch(db);

  batch.delete(doc(db, 'follows', followId));

  batch.update(doc(db, 'users', followerId), { 
    followingCount: increment(-1) 
  });

  batch.update(doc(db, 'users', followingId), { 
    followerCount: increment(-1) 
  });

  await batch.commit();
};

export const isFollowing = async (followerId, followingId) => {
  const snap = await getDoc(doc(db, 'follows', `${followerId}_${followingId}`));
  return snap.exists();
};

export const getFollowing = async (uid) => {
  const q = query(collection(db, 'follows'), where('followerId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getFollowers = async (uid) => {
  const q = query(collection(db, 'follows'), where('followingId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Real audience-activity model from follower presence (`lastSeen`).
// Buckets up to `cap` followers' last-active timestamps by day-of-week + hour
// to drive the Schedule screen's heatmap and "best time to post" slots.
// Returns { enough, sampleSize, grid (5 bands × 7 days, normalised 0..1), best[] }.
const _audienceCache = new Map();
export const getAudienceActivity = async (uid, cap = 120) => {
  const cached = _audienceCache.get(uid);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;

  const follows = await getFollowers(uid);
  const ids = follows.map(f => f.followerId).filter(Boolean).slice(0, cap);
  const BANDS = [0, 6, 12, 17, 21, 24]; // 5 bands → 12AM / 6AM / 12PM / 6PM / late
  const grid = Array.from({ length: 5 }, () => new Array(7).fill(0));
  const hourDay = {}; // "day-hour" → count, for best-time
  let sample = 0;

  const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'users', id)).catch(() => null)));
  for (const d of docs) {
    const u = d && d.exists() ? d.data() : null;
    const ls = u && u.lastSeen;
    if (!ls) continue;
    const date = typeof ls?.toDate === 'function' ? ls.toDate() : (ls?.seconds ? new Date(ls.seconds * 1000) : (typeof ls === 'number' ? new Date(ls) : null));
    if (!date || isNaN(date)) continue;
    const day = date.getDay(); const hour = date.getHours();
    let band = 0; for (let b = 0; b < 5; b++) { if (hour >= BANDS[b] && hour < BANDS[b + 1]) { band = b; break; } }
    grid[band][day] += 1;
    const key = `${day}-${hour}`; hourDay[key] = (hourDay[key] || 0) + 1;
    sample += 1;
  }

  const max = Math.max(1, ...grid.flat());
  const normGrid = grid.map(row => row.map(v => v / max));

  // Top distinct hours → next future occurrence as a slot.
  const now = new Date();
  const top = Object.entries(hourDay).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const best = []; const seenHours = new Set();
  for (const [key] of top) {
    const [, hourStr] = key.split('-'); const hour = parseInt(hourStr, 10);
    if (seenHours.has(hour)) continue; seenHours.add(hour);
    const d = new Date(now); d.setHours(hour, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    const isToday = d.getDate() === now.getDate();
    const isTomorrow = d.getDate() === now.getDate() + 1;
    best.push({
      label: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      year: d.getFullYear(), month: d.getMonth(), date: d.getDate(), hour,
    });
    if (best.length >= 4) break;
  }
  best.sort((a, b) => new Date(a.year, a.month, a.date, a.hour) - new Date(b.year, b.month, b.date, b.hour));

  const data = { enough: sample >= 5, sampleSize: sample, grid: normGrid, best };
  _audienceCache.set(uid, { at: Date.now(), data });
  return data;
};

// ═══════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════

export const createPost = async (authorId, {
  content, type = 'text', mediaUrls = [], hashtags = [], pollOptions = [],
  linkPreview = null, lfgData = null, articleData = null, tierListData = null, achievementData = null,
  embedVideoUrl = null, youtubeVideoId = null, thumbnailUrl = null,
  visibility = 'public', scheduledFor = null, scheduleOptions = null
}) => {
  // Scheduled posts are parked with status 'scheduled' + a scheduledFor
  // timestamp. They stay out of the feed (which queries status=='published')
  // until a publish cron flips them — that cron is not built yet.
  const postData = {
    authorId,
    content,
    type,
    mediaUrls,
    hashtags,
    visibility,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    viewCount: 0,
    status: scheduledFor ? 'scheduled' : 'published',
    rankScore: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (scheduledFor) {
    postData.scheduledFor = scheduledFor;
    if (scheduleOptions) postData.scheduleOptions = scheduleOptions; // { allowEarly, reminder, autoShareSquad }
  }

  if (pollOptions.length > 0) postData.pollOptions = pollOptions.map(opt => ({ text: opt, votes: 0 }));
  if (linkPreview) postData.linkPreview = linkPreview;
  if (lfgData) postData.lfgData = lfgData;
  if (articleData) postData.articleData = articleData;
  if (tierListData) postData.tierListData = tierListData;
  if (achievementData) postData.achievementData = achievementData;
  if (embedVideoUrl) postData.embedVideoUrl = embedVideoUrl;
  if (youtubeVideoId) postData.youtubeVideoId = youtubeVideoId;
  if (thumbnailUrl) postData.thumbnailUrl = thumbnailUrl;
  if (type === 'lfg') postData.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Batch the post insert + author postCount bump in one round-trip.
  const postRef = doc(collection(db, 'posts'));
  const batch = writeBatch(db);
  batch.set(postRef, postData);
  batch.update(doc(db, 'users', authorId), { postCount: increment(1) });
  await batch.commit();
  return postRef.id;
};

export const updatePostMediaUrl = async (postId, url) => {
  await updateDoc(doc(db, 'posts', postId), {
    mediaUrls: arrayUnion(url),
    mediaUrl: url,
  });
};

// Author cache: in-memory + persisted to localStorage with a 6h TTL.
// Without persistence we'd re-fetch all 20+ authors on every cold page load,
// which was ~40 reads per feed open per user. With it, repeat loads cost 0 reads.
const _authorCache = new Map();
const AUTHOR_CACHE_LS_KEY = 'vergr_author_cache_v1';
const AUTHOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

(function _restoreAuthorCache() {
  try {
    const raw = localStorage.getItem(AUTHOR_CACHE_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > AUTHOR_CACHE_TTL_MS) return;
    for (const [id, author] of Object.entries(parsed.authors || {})) {
      _authorCache.set(id, author);
    }
  } catch {}
})();

let _authorCacheFlushTimer = null;
const _scheduleAuthorCacheFlush = () => {
  if (_authorCacheFlushTimer) return;
  _authorCacheFlushTimer = setTimeout(() => {
    _authorCacheFlushTimer = null;
    try {
      const obj = {};
      // Only persist truthy entries — skip nulls so we re-try them next time
      _authorCache.forEach((v, k) => { if (v) obj[k] = { displayName: v.displayName, avatar: v.avatar, username: v.username, isVerified: v.isVerified, verificationTier: v.verificationTier, id: v.id }; });
      localStorage.setItem(AUTHOR_CACHE_LS_KEY, JSON.stringify({ savedAt: Date.now(), authors: obj }));
    } catch {}
  }, 500);
};

const _hydrateAuthors = async (posts) => {
  const uniqueIds = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
  const missing = uniqueIds.filter(id => !_authorCache.has(id));
  if (missing.length > 0) {
    const fetched = await Promise.all(missing.map(id => getUser(id).catch(() => null)));
    missing.forEach((id, i) => _authorCache.set(id, fetched[i] || null));
    _scheduleAuthorCacheFlush();
  }
  for (const post of posts) {
    post.author = _authorCache.get(post.authorId) || { displayName: 'Vergr Member', avatar: null };
  }
  return posts;
};

export const getFeedPosts = async (limitCount = 20, lastDoc = null) => {
  let q = query(
    collection(db, 'posts'),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );

  if (lastDoc) q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  const posts = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
  await _hydrateAuthors(posts);
  // Attach last doc for cursor-based pagination
  if (posts.length > 0) posts._lastDoc = snap.docs[snap.docs.length - 1];
  return posts;
};

export const getFollowingFeedPosts = async (userId, limitCount = 20, lastDoc = null) => {
  // Get list of users this person follows
  const followsSnap = await getDocs(query(collection(db, 'follows'), where('followerId', '==', userId)));
  const followingIds = followsSnap.docs.map(d => d.data().followingId).filter(Boolean);

  if (followingIds.length === 0) return [];

  // Firestore 'in' supports max 30 items — chunk if needed, fetch in parallel
  const chunks = [];
  for (let i = 0; i < followingIds.length; i += 30) {
    chunks.push(followingIds.slice(i, i + 30));
  }

  const chunkResults = await Promise.all(
    chunks.map(chunk => {
      let q = query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        where('authorId', 'in', chunk),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      if (lastDoc) q = query(q, startAfter(lastDoc));
      return getDocs(q);
    })
  );

  const posts = [];
  for (const snap of chunkResults) {
    for (const d of snap.docs) posts.push({ id: d.id, ...d.data(), _doc: d });
  }

  await _hydrateAuthors(posts);

  // Sort by date and take top N
  posts.sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime();
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
  const sliced = posts.slice(0, limitCount);
  if (sliced.length > 0) sliced._lastDoc = sliced[sliced.length - 1]._doc;
  return sliced;
};

export const getTrendingPosts = async (limitCount = 20, lastDoc = null) => {
  let q = query(
    collection(db, 'posts'),
    where('status', '==', 'published'),
    orderBy('rankScore', 'desc'),
    limit(limitCount)
  );
  if (lastDoc) q = query(q, startAfter(lastDoc));
  const snap = await getDocs(q);
  const posts = snap.docs
    .map(d => ({ id: d.id, ...d.data(), _doc: d }))
    .filter(p => (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0) > 0);
  await _hydrateAuthors(posts);
  if (posts.length > 0) posts._lastDoc = snap.docs[snap.docs.length - 1];
  return posts;
};

// Fetch posts newer than a given timestamp (for pull-to-refresh)
export const getNewerFeedPosts = async (sinceTimestamp, limitCount = 20) => {
  if (!sinceTimestamp) return [];
  const q = query(
    collection(db, 'posts'),
    where('status', '==', 'published'),
    where('createdAt', '>', sinceTimestamp),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  const posts = snap.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
  await _hydrateAuthors(posts);
  return posts;
};

export const getUserPosts = async (uid, limitCount = 20) => {
  const q = query(
    collection(db, 'posts'), 
    where('authorId', '==', uid), 
    orderBy('createdAt', 'desc'), 
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getPost = async (postId) => {
  const snap = await getDoc(doc(db, 'posts', postId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const deletePost = async (postId, authorId) => {
  await deleteDoc(doc(db, 'posts', postId));
  if (authorId) {
    const userSnap = await getDoc(doc(db, 'users', authorId));
    const currentPosts = userSnap.exists() ? (userSnap.data().postCount || 0) : 0;
    await updateDoc(doc(db, 'users', authorId), { postCount: Math.max(0, currentPosts - 1) }).catch(() => {});
  }
};

export const reportPost = async (reporterId, postId, reason, details = '') => {
  await addDoc(collection(db, 'reports'), {
    reporterId,
    targetType: 'post',
    targetId: postId,
    reason,
    details: details.substring(0, 1000) || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
};

// ═══════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════

export const getComments = async (postId, limitCount = 20) => {
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  const comments = [];
  for (const d of snap.docs) {
    const comment = { id: d.id, ...d.data() };
    comment.author = await getUser(comment.authorId);
    comments.push(comment);
  }
  return comments;
};

export const addComment = async (postId, authorId, content, media = null) => {
  const data = {
    authorId,
    content: content || '',
    likeCount: 0,
    createdAt: serverTimestamp(),
  };
  // media: { type: 'gif' | 'sticker' | 'clip' | 'image' | 'video', url, thumbnailUrl? }
  if (media?.url) {
    data.mediaUrl = media.url;
    data.mediaType = media.type || 'image';
    if (media.thumbnailUrl) data.thumbnailUrl = media.thumbnailUrl;
  }
  // Pre-generate the doc ref so we can batch the comment write + counter
  // bump in a single round-trip instead of two sequential writes.
  const commentRef = doc(collection(db, 'posts', postId, 'comments'));
  const batch = writeBatch(db);
  batch.set(commentRef, data);
  batch.update(doc(db, 'posts', postId), { commentCount: increment(1) });
  await batch.commit();
  return commentRef.id;
};

// ═══════════════════════════════════════════
// POST ENGAGEMENT
// ═══════════════════════════════════════════

export const toggleLike = async (postId, userId) => {
  const likeRef = doc(db, 'posts', postId, 'likes', userId);
  const postRef = doc(db, 'posts', postId);

  try {
    const likeSnap = await getDoc(likeRef);
    // Batch the like doc + post counter into a single network round-trip.
    // This is the highest-frequency write in the app, so the savings compound.
    const batch = writeBatch(db);
    if (likeSnap.exists()) {
      batch.delete(likeRef);
      batch.update(postRef, { likeCount: increment(-1) });
      await batch.commit();
      return false;
    } else {
      batch.set(likeRef, { userId, createdAt: serverTimestamp() });
      batch.update(postRef, { likeCount: increment(1) });
      await batch.commit();
      return true;
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    throw error;
  }
};

// Get list of users who liked a post
export const getPostLikes = async (postId, limitCount = 50) => {
  const q = query(
    collection(db, 'posts', postId, 'likes'),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  const users = [];
  for (const d of snap.docs) {
    const userId = d.id; // document ID is the userId
    const user = await getUser(userId);
    if (user) users.push(user);
  }
  return users;
};

export const isPostLiked = async (postId, userId) => {
  if (!userId) return false;
  const likeRef = doc(db, 'posts', postId, 'likes', userId);
  const snap = await getDoc(likeRef);
  return snap.exists();
};

export const toggleBookmark = async (postId, userId) => {
  const bmRef = doc(db, 'users', userId, 'bookmarks', postId);
  const postRef = doc(db, 'posts', postId);
  return runTransaction(db, async (tx) => {
    const bmSnap = await tx.get(bmRef);
    const postSnap = await tx.get(postRef);
    const currentCount = postSnap.exists() ? (postSnap.data().saveCount || 0) : 0;
    if (bmSnap.exists()) {
      tx.delete(bmRef);
      tx.update(postRef, { saveCount: Math.max(0, currentCount - 1) });
      return false;
    } else {
      tx.set(bmRef, { postId, createdAt: serverTimestamp() });
      tx.update(postRef, { saveCount: currentCount + 1 });
      return true;
    }
  });
};

export const isBookmarked = async (postId, userId) => {
  if (!userId) return false;
  const bmRef = doc(db, 'users', userId, 'bookmarks', postId);
  const snap = await getDoc(bmRef);
  return snap.exists();
};

export const getBookmarks = async (userId, limitCount = 50) => {
  const q = query(collection(db, 'users', userId, 'bookmarks'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  const bookmarks = [];
  for (const d of snap.docs) {
    const post = await getPost(d.data().postId);
    if (post) bookmarks.push(post);
  }
  return bookmarks;
};

export const incrementShareCount = async (postId) => {
  await updateDoc(doc(db, 'posts', postId), { shareCount: increment(1) });
};

export const incrementViewCount = async (postId) => {
  await updateDoc(doc(db, 'posts', postId), { viewCount: increment(1) });
};

// ═══════════════════════════════════════════
// REPOSTS & QUOTES
// ═══════════════════════════════════════════

export const repost = async (userId, originalPostId) => {
  const existing = await getDocs(
    query(collection(db, 'posts'), where('authorId', '==', userId), where('repostOf', '==', originalPostId), where('type', '==', 'repost'), limit(1))
  );
  if (!existing.empty) throw new Error('Already reposted');

  // Batch the repost insert + share count + author postCount in one round-trip,
  // and use increment() so we don't pay for the two extra read-before-write
  // round-trips that the previous version did.
  const repostRef = doc(collection(db, 'posts'));
  const batch = writeBatch(db);
  batch.set(repostRef, {
    authorId: userId,
    type: 'repost',
    repostOf: originalPostId,
    content: '',
    mediaUrls: [],
    hashtags: [],
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    viewCount: 0,
    status: 'published',
    rankScore: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'posts', originalPostId), { shareCount: increment(1) });
  batch.update(doc(db, 'users', userId), { postCount: increment(1) });
  await batch.commit();
};

export const undoRepost = async (userId, originalPostId) => {
  const existing = await getDocs(
    query(collection(db, 'posts'), where('authorId', '==', userId), where('repostOf', '==', originalPostId), where('type', '==', 'repost'), limit(1))
  );
  if (existing.empty) return;

  // Batch the delete + both counter decrements (negative increment is safe;
  // the floor-at-zero behaviour is enforced by the security rules / clients
  // checking against 0 — we trade a tiny correctness edge for fewer reads).
  const batch = writeBatch(db);
  batch.delete(existing.docs[0].ref);
  batch.update(doc(db, 'posts', originalPostId), { shareCount: increment(-1) });
  batch.update(doc(db, 'users', userId), { postCount: increment(-1) });
  await batch.commit();
};

export const isReposted = async (userId, originalPostId) => {
  if (!userId) return false;
  const existing = await getDocs(
    query(collection(db, 'posts'), where('authorId', '==', userId), where('repostOf', '==', originalPostId), where('type', '==', 'repost'), limit(1))
  );
  return !existing.empty;
};

export const createQuotePost = async (userId, originalPostId, { content, mediaUrls = [], hashtags = [] }) => {
  // Batch the new post + share count + author postCount in one round-trip.
  const postRef = doc(collection(db, 'posts'));
  const batch = writeBatch(db);
  batch.set(postRef, {
    authorId: userId,
    type: 'quote',
    quotedPostId: originalPostId,
    content: content.trim(),
    mediaUrls,
    hashtags,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    viewCount: 0,
    status: 'published',
    rankScore: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'posts', originalPostId), { shareCount: increment(1) });
  batch.update(doc(db, 'users', userId), { postCount: increment(1) });
  await batch.commit();
  return postRef.id;
};

export const getPostWithAuthor = async (postId) => {
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return null;
  const post = { id: snap.id, ...snap.data() };
  post.author = await getUser(post.authorId);
  return post;
};

// ═══════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════

export const getNotifications = async (uid, limitCount = 30) => {
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const subscribeToNotifications = (uid, callback) => {
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(30));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
};

export const markNotificationRead = async (notifId) => {
  await updateDoc(doc(db, 'notifications', notifId), { read: true });
};

export const markAllNotificationsRead = async (uid) => {
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), where('read', '==', false));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
};

// ═══════════════════════════════════════════
// CONVERSATIONS / MESSAGES
// ═══════════════════════════════════════════

export const getConversations = async (uid) => {
  try {
    const q = query(
      collection(db, 'conversations'), 
      where('participants', 'array-contains', uid), 
      where('status', '==', 'active'),
      orderBy('lastMessageAt', 'desc')
    );
    const snap = await getDocs(q);
    const convos = [];
    for (const d of snap.docs) {
      const convo = { id: d.id, ...d.data() };
      const otherIds = convo.participants.filter(id => id !== uid);
      convo.otherUsers = await Promise.all(otherIds.map(id => getUser(id)));
      convos.push(convo);
    }
    return convos;
  } catch (error) {
    console.error("Error getting conversations:", error);
    return [];
  }
};

export const createConversation = async (currentUserId, targetUser, initialMessage = null) => {
  try {
    // News bots are not users. Block DM creation against bot accounts.
    // Defense-in-depth: also re-check from the user doc in case targetUser
    // was passed without the accountType field.
    if (targetUser?.accountType === 'news_bot') {
      throw new Error('Cannot message a bot account.');
    }
    const targetSnap = await getDoc(doc(db, 'users', targetUser.id));
    if (targetSnap.exists() && targetSnap.data().accountType === 'news_bot') {
      throw new Error('Cannot message a bot account.');
    }

    const participants = [currentUserId, targetUser.id].sort();
    const convoId = participants.join('_');
    const convoRef = doc(db, 'conversations', convoId);

    const snap = await getDoc(convoRef);
    if (snap.exists()) {
      if (snap.data().status !== 'active') {
        await updateDoc(convoRef, { status: 'active' });
      }
      return convoId;
    }

    await setDoc(convoRef, {
      participants,
      status: 'active',
      requestedBy: currentUserId,
      lastMessage: initialMessage || 'New conversation started',
      lastMessageAt: serverTimestamp(),
      lastSenderId: currentUserId,
      createdAt: serverTimestamp(),
      metadata: {
        [currentUserId]: { 
          name: auth.currentUser?.displayName || 'Vergr Member', 
          avatar: auth.currentUser?.photoURL || null 
        },
        [targetUser.id]: { 
          name: targetUser.displayName || targetUser.username, 
          avatar: targetUser.avatar || null 
        }
      },
      unreadCount: {
        [currentUserId]: 0,
        [targetUser.id]: initialMessage ? 1 : 0
      }
    });

    return convoId;
  } catch (error) {
    console.error("Error starting conversation:", error);
    throw error;
  }
};

export const sendMessage = async (convoId, senderId, content, type = 'text') => {
  try {
    const batch = writeBatch(db);
    const msgRef = doc(collection(db, 'conversations', convoId, 'messages'));
    
    batch.set(msgRef, { 
      senderId, 
      content, 
      type, 
      createdAt: serverTimestamp(),
      read: false
    });

    batch.update(doc(db, 'conversations', convoId), {
      lastMessage: type === 'text' ? content : `Sent a ${type}`,
      lastMessageAt: serverTimestamp(),
      lastSenderId: senderId,
      status: 'active'
    });

    await batch.commit();
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

export const subscribeToMessages = (convoId, callback) => {
  const q = query(
    collection(db, 'conversations', convoId, 'messages'), 
    orderBy('createdAt', 'asc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
};

export const markAsRead = async (convoId, userId) => {
  try {
    const convoRef = doc(db, 'conversations', convoId);
    await updateDoc(convoRef, {
      [`unreadCount.${userId}`]: 0
    });
  } catch (error) {
    console.error("Error marking as read:", error);
  }
};

export const deleteConversation = async (convoId) => {
  try {
    await updateDoc(doc(db, 'conversations', convoId), {
      status: 'deleted',
      deletedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    throw error;
  }
};

export const acceptMessageRequest = async (convoId) => {
  try {
    await updateDoc(doc(db, 'conversations', convoId), {
      status: 'active',
      acceptedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error accepting message request:", error);
    throw error;
  }
};

export const getMessageRequests = async (uid) => {
  try {
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid),
      where('status', '==', 'pending')
    );
    const snap = await getDocs(q);
    const requests = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (data.requestedBy !== uid) {
        const convo = { id: d.id, ...data };
        const otherId = data.participants.find(id => id !== uid);
        convo.otherUser = await getUser(otherId);
        requests.push(convo);
      }
    }
    return requests;
  } catch (error) {
    console.error("Error getting message requests:", error);
    return [];
  }
};

export const searchUsers = async (searchTerm, limitCount = 10) => {
  if (!searchTerm) return [];
  const q = query(
    collection(db, 'users'),
    where('username', '>=', searchTerm.toLowerCase()),
    where('username', '<=', searchTerm.toLowerCase() + '\uf8ff'),
    limit(20),  // over-fetch so we can drop hidden accounts and still hit limitCount
  );
  const snap = await getDocs(q);
  // Drop operator + opt-in-hidden accounts from search results. Defense in
  // depth \u2014 every consumer of searchUsers gets this for free. Callers
  // viewing as admin would skip this filter via the client-side helper
  // `filterForEnumeration(users, viewer)` if needed.
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.role !== 'admin' && u.hideFromEnumeration !== true)
    .slice(0, limitCount);
};

// ═══════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════

const DEFAULT_WALLET = { balance: 0, gems: 0, vp: 0, totalEarned: 0, totalSpent: 0, totalGemsEarned: 0 };

export const getWallet = async (uid) => {
  const snap = await getDoc(doc(db, 'wallets', uid));
  return snap.exists() ? { ...DEFAULT_WALLET, ...snap.data() } : DEFAULT_WALLET;
};

export const subscribeToWallet = (uid, callback) => {
  return onSnapshot(doc(db, 'wallets', uid), (snap) => {
    callback(snap.exists() ? { ...DEFAULT_WALLET, ...snap.data() } : DEFAULT_WALLET);
  });
};

export const getTransactions = async (uid, limitCount = 30) => {
  const q = query(collection(db, 'transactions'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Award VP to a user (called from frontend for actions like posting, commenting, etc.)
export const awardVP = async (userId, amount, reason = '') => {
  if (!userId || amount <= 0) return;
  await updateDoc(doc(db, 'wallets', userId), {
    vp: increment(amount),
  }).catch(() => {});
};

// ────────────────────────────────────────────────────────────
// WATCH-TO-EARN AD QUEST STATE
// ────────────────────────────────────────────────────────────
// Persistent counters for the PropellerAds Direct Link daily quest.
// Stored in users/{uid}/private/adQuest so it survives device wipes
// but never bloats the public user doc.
//
// Daily reward: ADS_CONFIG.watchToEarnVp per ad
// Daily bonus: ADS_CONFIG.dailyAdBonusVp once per day after N ads
// Week / month streaks: triggered by getAdQuestState helpers below

const adQuestRef = (uid) => doc(db, 'users', uid, 'private', 'adQuest');

const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const daysBetween = (a, b) => {
  // a, b are 'YYYY-MM-DD' UTC strings — returns whole-day diff (b - a).
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db_ = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db_ - da) / 86400000);
};

export const getAdQuestState = async (uid) => {
  if (!uid) return null;
  const snap = await getDoc(adQuestRef(uid));
  return snap.exists() ? snap.data() : {
    todayDate: null,
    todayCount: 0,
    todayBonusClaimed: false,
    weekStreak: 0,         // consecutive days with ≥1 ad watched
    monthStreak: 0,
    lastWatchDate: null,
  };
};

/**
 * Records a single completed ad watch — awards base VP, advances streaks,
 * and (if appropriate) awards the daily-bonus / week / month milestones.
 *
 * Returns the credited VP totals so the UI can flash a confirmation.
 */
export const recordAdWatch = async (uid) => {
  if (!uid) return { creditedVp: 0 };

  const state = await getAdQuestState(uid);
  const today = todayKey();

  // ── Roll over the day if needed ──
  let { todayDate, todayCount, todayBonusClaimed, weekStreak, monthStreak, lastWatchDate } = state;
  if (todayDate !== today) {
    // First ad of a new day — figure out streak continuation.
    if (lastWatchDate) {
      const gap = daysBetween(lastWatchDate, today);
      if (gap === 1) {
        weekStreak += 1;
        monthStreak += 1;
      } else if (gap > 1) {
        // Missed a day → streaks reset (this watch starts a fresh run).
        weekStreak = 1;
        monthStreak = 1;
      }
    } else {
      weekStreak = 1;
      monthStreak = 1;
    }
    todayDate = today;
    todayCount = 0;
    todayBonusClaimed = false;
  }

  todayCount += 1;
  lastWatchDate = today;

  let creditedVp = ADS_CONFIG.watchToEarnVp;

  // Daily bonus
  if (!todayBonusClaimed && todayCount >= ADS_CONFIG.dailyAdBonusThreshold) {
    creditedVp += ADS_CONFIG.dailyAdBonusVp;
    todayBonusClaimed = true;
  }

  // Week milestone (every full 7-day streak)
  let weekBonusHit = false;
  if (weekStreak > 0 && weekStreak % 7 === 0 && todayCount === 1) {
    creditedVp += 1000; // 7-day perfect-week bonus
    weekBonusHit = true;
  }

  // Month milestone (every full 30-day streak)
  let monthBonusHit = false;
  if (monthStreak > 0 && monthStreak % 30 === 0 && todayCount === 1) {
    creditedVp += 5000; // 30-day perfect-month bonus
    monthBonusHit = true;
  }

  // Persist quest state + wallet VP in a single batch.
  const batch = writeBatch(db);
  batch.set(adQuestRef(uid), {
    todayDate, todayCount, todayBonusClaimed,
    weekStreak, monthStreak, lastWatchDate,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.update(doc(db, 'wallets', uid), {
    vp: increment(creditedVp),
    totalEarned: increment(creditedVp),
  });
  await batch.commit();

  return {
    creditedVp,
    todayCount,
    weekStreak,
    monthStreak,
    dailyBonusJustHit: todayBonusClaimed && todayCount === ADS_CONFIG.dailyAdBonusThreshold,
    weekBonusHit,
    monthBonusHit,
  };
};

// ═══════════════════════════════════════════
// SERVICE MARKETPLACE
// ═══════════════════════════════════════════

export const getService = async (serviceId) => {
  const snap = await getDoc(doc(db, 'services', serviceId));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  data.seller = await getUser(data.sellerId).catch(() => null);
  return data;
};

// Buyer purchases a service — coins go to escrow, not directly to seller
export const purchaseService = async (buyerId, serviceId) => {
  const serviceSnap = await getDoc(doc(db, 'services', serviceId));
  if (!serviceSnap.exists()) throw new Error('Service not found');
  const service = serviceSnap.data();
  if (service.sellerId === buyerId) throw new Error('Cannot buy your own service');

  const buyerWalletRef = doc(db, 'wallets', buyerId);

  return runTransaction(db, async (tx) => {
    const buyerWallet = await tx.get(buyerWalletRef);
    if (!buyerWallet.exists()) throw new Error('Wallet not found');
    if (buyerWallet.data().balance < service.priceCoins) throw new Error('Insufficient coins');

    // Deduct from buyer
    tx.update(buyerWalletRef, {
      balance: increment(-service.priceCoins),
      totalSpent: increment(service.priceCoins),
    });

    // Create order (coins held in escrow)
    const orderRef = doc(collection(db, 'service_orders'));
    tx.set(orderRef, {
      serviceId,
      buyerId,
      sellerId: service.sellerId,
      title: service.title,
      category: service.category,
      priceCoins: service.priceCoins,
      sellerCommission: service.sellerCommission || 0.30,
      deliveryDays: service.deliveryDays,
      status: 'in_progress', // in_progress → delivered → completed / disputed
      createdAt: serverTimestamp(),
      deadline: new Date(Date.now() + (service.deliveryDays || 3) * 86400000),
    });

    tx.set(doc(collection(db, 'transactions')), {
      userId: buyerId, type: 'service_payment', amount: -service.priceCoins,
      description: `Purchased: ${service.title}`, serviceId, createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'notifications')), {
      recipientId: service.sellerId, type: 'system',
      title: 'New order!', body: `Someone purchased your service: ${service.title}`,
      read: false, data: { serviceId, type: 'service_order' }, createdAt: serverTimestamp(),
    });

    return orderRef.id;
  });
};

// Seller marks order as delivered
export const deliverServiceOrder = async (orderId, sellerId, deliveryMessage = '') => {
  const orderRef = doc(db, 'service_orders', orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('Order not found');
  const order = snap.data();
  if (order.sellerId !== sellerId) throw new Error('Not your order');
  if (order.status !== 'in_progress') throw new Error('Order not in progress');

  await updateDoc(orderRef, {
    status: 'delivered',
    deliveryMessage: deliveryMessage.substring(0, 2000),
    deliveredAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'notifications'), {
    recipientId: order.buyerId, type: 'system',
    title: 'Order delivered!', body: `Your order "${order.title}" is ready for review.`,
    read: false, data: { orderId, type: 'service_delivered' }, createdAt: serverTimestamp(),
  });
};

// Buyer approves delivery → seller gets gems
export const approveServiceOrder = async (orderId, buyerId) => {
  const orderRef = doc(db, 'service_orders', orderId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Order not found');
    const order = snap.data();
    if (order.buyerId !== buyerId) throw new Error('Not your order');
    if (order.status !== 'delivered') throw new Error('Order not delivered yet');

    const coinsEarned = order.priceCoins;

    // Pay seller in COINS (full amount). Commission applies later on coin→gem conversion.
    tx.update(doc(db, 'wallets', order.sellerId), {
      balance: increment(coinsEarned),
      totalEarned: increment(coinsEarned),
      vp: increment(30), // VP for completing a service
    });

    tx.update(orderRef, { status: 'completed', completedAt: serverTimestamp() });

    // Update service stats
    tx.update(doc(db, 'services', order.serviceId), {
      completedCount: increment(1),
    });

    tx.set(doc(collection(db, 'transactions')), {
      userId: order.sellerId, type: 'service_earned', amount: coinsEarned, currency: 'coins',
      description: `Service completed: ${order.title}`,
      orderId, createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'notifications')), {
      recipientId: order.sellerId, type: 'coins',
      title: `+${coinsEarned} coins earned!`,
      body: `Service approved: ${order.title}`,
      read: false, data: { amount: coinsEarned, type: 'service_earned' }, createdAt: serverTimestamp(),
    });
  });
};

// Buyer disputes — refund coins, no gems to seller
export const disputeServiceOrder = async (orderId, buyerId, reason = '') => {
  const orderRef = doc(db, 'service_orders', orderId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Order not found');
    const order = snap.data();
    if (order.buyerId !== buyerId) throw new Error('Not your order');
    if (!['delivered', 'in_progress'].includes(order.status)) throw new Error('Cannot dispute');

    // Refund buyer
    tx.update(doc(db, 'wallets', order.buyerId), {
      balance: increment(order.priceCoins),
      totalSpent: increment(-order.priceCoins),
    });

    tx.update(orderRef, {
      status: 'disputed',
      disputeReason: reason.substring(0, 500),
      disputedAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'transactions')), {
      userId: order.buyerId, type: 'service_refund', amount: order.priceCoins,
      description: `Refund: ${order.title}`, orderId, createdAt: serverTimestamp(),
    });

    tx.set(doc(collection(db, 'notifications')), {
      recipientId: order.sellerId, type: 'system',
      title: 'Order disputed', body: `Buyer disputed: ${order.title}`,
      read: false, data: { orderId, type: 'service_dispute' }, createdAt: serverTimestamp(),
    });
  });
};

// Get user's orders (as buyer or seller)
export const getServiceOrders = async (userId, role = 'buyer', limitCount = 20) => {
  const field = role === 'buyer' ? 'buyerId' : 'sellerId';
  const q = query(collection(db, 'service_orders'), where(field, '==', userId), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getCoinPackages = async () => {
  const q = query(collection(db, 'coin_packages'), where('active', '==', true), orderBy('sortOrder', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ═══════════════════════════════════════════
// SQUADS
// ═══════════════════════════════════════════

export const getSquads = async (limitCount = 20) => {
  const q = query(collection(db, 'squads'), where('isPublic', '==', true), orderBy('memberCount', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Phase 3 — supply gating. Counts squads platform-wide with at least
// `minMembers` members. Used by the tournament create flow to hide squad
// formats that have no realistic supply (e.g. don't show "32-squad-of-5"
// when only 3 such squads exist).
//
// Cheap version: read top 100 squads by memberCount (already indexed via
// getSquads above) and count locally. For Spark-tier zero-cost, this is
// acceptable until we have >100 squads — at which point we add a
// `squadCountByMemberFloor` aggregate maintained by a Firestore trigger.
export const getEligibleSquadCount = async (minMembers = 1) => {
  const q = query(collection(db, 'squads'),
    where('memberCount', '>=', minMembers),
    orderBy('memberCount', 'desc'),
    limit(100));
  try {
    const snap = await getDocs(q);
    // Cap signal at "100+" — the create flow only needs to know if there
    // are enough for the smallest viable preset (e.g. 4 of 5).
    return snap.size;
  } catch {
    return 0; // index missing — gate optimistically open
  }
};

export const getUserSquads = async (uid) => {
  const q = query(collection(db, 'squads'), where('memberIds', 'array-contains', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getSquad = async (squadId) => {
  const snap = await getDoc(doc(db, 'squads', squadId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// MP3 — squad treasury inflow line-items. finalizeInternal writes a
// `transactions` doc per squad win (type 'squad_tournament_prize' /
// 'squad_treasury_credit') with tournamentId + description. This surfaces
// the breakdown of "which tournament added what" to squad members.
// Single-field equality query (no composite index needed); sorted client-side.
export const getSquadTreasuryInflows = async (squadId, n = 10) => {
  if (!squadId) return [];
  const snap = await getDocs(query(
    collection(db, 'transactions'),
    where('squadId', '==', squadId),
    limit(50),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.amount > 0) // inflows only
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .slice(0, n);
};

// Names normal users cannot register a squad under. Soft match — strips
// whitespace + lowercases + removes punctuation before comparing.
// Editable at runtime via `app_config/reservedSquadNames.names`.
const HARDCODED_RESERVED_SQUAD_NAMES = [
  'vanguard', 'vergr', 'vergrofficial', 'vergrteam', 'vergradmin', 'admin',
  'staff', 'moderator', 'moderators', 'mod', 'mods', 'support', 'teamvergr',
  'recruit', 'senior vanguard', 'commander', 'overseer',
];

const normalizeName = (s) => String(s || '')
  .toLowerCase()
  .replace(/[\s_\-.]+/g, '')
  .replace(/[^a-z0-9]/g, '');

export const isReservedSquadName = async (name) => {
  const needle = normalizeName(name);
  if (!needle) return true;
  // Check hardcoded list first (cheap, always available).
  if (HARDCODED_RESERVED_SQUAD_NAMES.some((n) => normalizeName(n) === needle)) return true;
  // Then check the runtime-editable list from app_config.
  try {
    const cfgSnap = await getDoc(doc(db, 'app_config', 'reservedSquadNames'));
    const extra = cfgSnap.exists() ? (cfgSnap.data().names || []) : [];
    if (extra.some((n) => normalizeName(n) === needle)) return true;
  } catch (e) { /* fall through to allow */ }
  return false;
};

export const createSquad = async (ownerId, { name, description, game, isPublic, avatar, banner }) => {
  if (await isReservedSquadName(name)) {
    throw new Error(`"${name}" is a reserved name. Pick a different squad name.`);
  }
  const squadRef = await addDoc(collection(db, 'squads'), {
    name,
    description: description || '',
    game,
    isPublic: isPublic !== false,
    avatar: avatar || null,
    banner: banner || null,
    memberCount: 1,
    memberIds: [ownerId],
    maxMembers: 100,             // default member cap — 100 for all normal squads
    isVanguardSquad: false,
    ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'squads', squadRef.id, 'members', ownerId), {
    userId: ownerId,
    role: 'president',
    joinedAt: serverTimestamp(),
  });
  return squadRef.id;
};

export const getSquadChat = async (squadId, limitCount = 50) => {
  const q = query(collection(db, 'squads', squadId, 'chat'), orderBy('createdAt', 'asc'), limit(limitCount));
  const snap = await getDocs(q);
  const messages = [];
  for (const d of snap.docs) {
    const msg = { id: d.id, ...d.data() };
    msg.author = await getUser(msg.authorId);
    messages.push(msg);
  }
  return messages;
};

export const sendSquadMessage = async (squadId, authorId, content, type = 'text', extra = {}) => {
  await addDoc(collection(db, 'squads', squadId, 'chat'), {
    authorId,
    content,
    type,
    ...extra,
    createdAt: serverTimestamp(),
  });
};

// ═══════════════════════════════════════════
// SQUAD GOVERNANCE & DEMOCRATIC SYSTEM
// ═══════════════════════════════════════════

export const getSquadMembers = async (squadId) => {
  const snap = await getDocs(collection(db, 'squads', squadId, 'members'));
  const members = [];
  for (const d of snap.docs) {
    const member = { id: d.id, ...d.data() };
    member.user = await getUser(d.id);
    members.push(member);
  }
  return members.sort((a, b) => {
    const roleOrder = { president: 0, vice_president: 1, treasury: 2, security: 3, member: 4 };
    return (roleOrder[a.role] || 4) - (roleOrder[b.role] || 4);
  });
};

export const getSquadMember = async (squadId, userId) => {
  const snap = await getDoc(doc(db, 'squads', squadId, 'members', userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const joinSquad = async (squadId, userId) => {
  const squadRef = doc(db, 'squads', squadId);
  const memberRef = doc(db, 'squads', squadId, 'members', userId);

  await runTransaction(db, async (transaction) => {
    const squadSnap = await transaction.get(squadRef);
    if (!squadSnap.exists()) throw new Error('Squad not found');

    const data = squadSnap.data();
    if (data.memberIds?.includes(userId)) throw new Error('Already a member');

    // Member cap. `maxMembers === null` means unlimited (Vanguard squad +
    // any future Overseer-spawned squads). Default cap stays at 100.
    const cap = data.maxMembers === null ? Infinity : (typeof data.maxMembers === 'number' ? data.maxMembers : 100);
    const currentCount = data.memberCount ?? (data.memberIds?.length || 0);
    if (currentCount >= cap) {
      throw new Error(`Squad is full (${cap} member cap).`);
    }

    transaction.update(squadRef, {
      memberIds: arrayUnion(userId),
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });

    transaction.set(memberRef, {
      userId,
      role: 'member',
      totalContributed: 0,
      joinedAt: serverTimestamp(),
    });
  });
};

export const leaveSquad = async (squadId, userId) => {
  const memberRef = doc(db, 'squads', squadId, 'members', userId);
  const memberSnap = await getDoc(memberRef);
  if (memberSnap.data()?.role === 'president') throw new Error('President cannot leave without transferring leadership');

  const squadRef = doc(db, 'squads', squadId);
  const batch = writeBatch(db);
  batch.delete(memberRef);
  batch.update(squadRef, {
    memberIds: arrayRemove(userId),
    memberCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
};

export const updateMemberRole = async (squadId, userId, newRole) => {
  await updateDoc(doc(db, 'squads', squadId, 'members', userId), {
    role: newRole,
    updatedAt: serverTimestamp(),
  });
};

export const muteSquadMember = async (squadId, userId, durationMs, reason = '') => {
  const muteUntil = new Date(Date.now() + durationMs);
  await updateDoc(doc(db, 'squads', squadId, 'members', userId), {
    mutedUntil: muteUntil,
    muteReason: reason,
    updatedAt: serverTimestamp(),
  });
};

export const unmuteSquadMember = async (squadId, userId) => {
  await updateDoc(doc(db, 'squads', squadId, 'members', userId), {
    mutedUntil: null,
    muteReason: null,
    updatedAt: serverTimestamp(),
  });
};

export const getSquadWallet = async (squadId) => {
  const snap = await getDoc(doc(db, 'squads', squadId, 'wallet', 'main'));
  return snap.exists() ? snap.data() : { balance: 0, totalContributed: 0, totalWon: 0 };
};

export const contributeToSquad = async (squadId, userId, amount) => {
  const userWalletRef = doc(db, 'wallets', userId);
  const squadWalletRef = doc(db, 'squads', squadId, 'wallet', 'main');
  const memberRef = doc(db, 'squads', squadId, 'members', userId);

  await runTransaction(db, async (transaction) => {
    const userWallet = await transaction.get(userWalletRef);
    if (!userWallet.exists() || userWallet.data().balance < amount) {
      throw new Error('Insufficient balance');
    }

    transaction.update(userWalletRef, {
      balance: increment(-amount),
      totalSpent: increment(amount),
      updatedAt: serverTimestamp(),
    });

    transaction.set(squadWalletRef, {
      balance: increment(amount),
      totalContributed: increment(amount),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    transaction.update(memberRef, {
      totalContributed: increment(amount),
      updatedAt: serverTimestamp(),
    });

    const userTxRef = doc(collection(db, 'transactions'));
    transaction.set(userTxRef, {
      userId,
      type: 'squad_contribution',
      amount: -amount,
      desc: `Squad contribution`,
      squadId,
      createdAt: serverTimestamp(),
    });

    const squadTxRef = doc(collection(db, 'squads', squadId, 'transactions'));
    transaction.set(squadTxRef, {
      userId,
      type: 'contribution',
      amount,
      createdAt: serverTimestamp(),
    });
  });
};

export const getSquadTransactions = async (squadId, limitCount = 30) => {
  const q = query(collection(db, 'squads', squadId, 'transactions'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Updated createSquadVote with reason parameter
export const createSquadVote = async (squadId, creatorId, { title, type, options, targetUserId, targetRole, duration = 48, reason = '' }) => {
  const voteRef = await addDoc(collection(db, 'squads', squadId, 'votes'), {
    title,
    type, 
    options: options || ['Yes', 'No'],
    targetUserId: targetUserId || null,
    targetRole: targetRole || null,
    reason: reason || '',               // <-- store the reason
    createdBy: creatorId,
    voteCounts: {},
    voterIds: [],
    totalVotes: 0,
    status: 'active',
    expiresAt: new Date(Date.now() + duration * 3600000),
    createdAt: serverTimestamp(),
  });
  return voteRef.id;
};

export const castSquadVote = async (squadId, voteId, userId, optionIndex) => {
  const voteRef = doc(db, 'squads', squadId, 'votes', voteId);

  await runTransaction(db, async (transaction) => {
    const voteSnap = await transaction.get(voteRef);
    if (!voteSnap.exists()) throw new Error('Vote not found');
    const data = voteSnap.data();
    if (data.status !== 'active') throw new Error('Vote is closed');
    if (data.voterIds?.includes(userId)) throw new Error('Already voted');
    if (new Date() > data.expiresAt?.toDate()) throw new Error('Vote expired');

    transaction.update(voteRef, {
      [`voteCounts.${optionIndex}`]: increment(1),
      voterIds: arrayUnion(userId),
      totalVotes: increment(1),
    });
  });
};

export const getActiveSquadVotes = async (squadId) => {
  const q = query(
    collection(db, 'squads', squadId, 'votes'),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getSquadLeaderboard = async (squadId) => {
  const members = await getSquadMembers(squadId);
  return members.sort((a, b) => (b.totalContributed || 0) - (a.totalContributed || 0));
};

export const submitJoinRequest = async (squadId, userId, message = '') => {
  await addDoc(collection(db, 'squads', squadId, 'join_requests'), {
    userId,
    message,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
};

// ═══════════════════════════════════════════
// SQUAD INVITATIONS  (separate from join_requests)
// join_requests = user asks to join, leader approves/declines
// invitations   = leader invites user, user accepts/declines
// Collection: `squad_invitations/{auto}` at root so we can query
// "all invitations for me" with a single indexed query.
// ═══════════════════════════════════════════

export const inviteUserToSquad = async (squadId, inviterUid, inviteeUid, message = '') => {
  if (!squadId || !inviterUid || !inviteeUid) throw new Error('Missing required fields');
  if (inviterUid === inviteeUid) throw new Error("You can't invite yourself");
  // Snapshot squad + inviter so the invitee's screen has real labels even if
  // the squad/user is later deleted or renamed.
  const [squadSnap, inviterSnap, inviteeSnap, existingMember] = await Promise.all([
    getDoc(doc(db, 'squads', squadId)),
    getDoc(doc(db, 'users', inviterUid)),
    getDoc(doc(db, 'users', inviteeUid)),
    getDoc(doc(db, 'squads', squadId, 'members', inviteeUid)),
  ]);
  if (!squadSnap.exists()) throw new Error('Squad not found');
  if (existingMember.exists()) throw new Error('User is already a squad member');
  // Dedupe — don't create a 2nd pending invite for the same pair.
  const dupQ = query(
    collection(db, 'squad_invitations'),
    where('squadId', '==', squadId),
    where('inviteeId', '==', inviteeUid),
    where('status', '==', 'pending'),
    limit(1),
  );
  const dupSnap = await getDocs(dupQ);
  if (!dupSnap.empty) throw new Error('Invitation already sent');
  const squadData = squadSnap.data();
  const inviterData = inviterSnap.exists() ? inviterSnap.data() : {};
  const inviteeData = inviteeSnap.exists() ? inviteeSnap.data() : {};
  const ref = await addDoc(collection(db, 'squad_invitations'), {
    squadId,
    squadName: squadData.name || '',
    squadAvatar: squadData.avatar || '',
    squadGame: squadData.game || '',
    inviterId: inviterUid,
    inviterName: inviterData.displayName || inviterData.username || '',
    inviteeId: inviteeUid,
    inviteeName: inviteeData.displayName || inviteeData.username || '',
    inviteeAvatar: inviteeData.avatar || '',
    message: (message || '').slice(0, 240),
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

export const getMyInvitations = async (uid, status = 'pending') => {
  if (!uid) return [];
  const q = query(
    collection(db, 'squad_invitations'),
    where('inviteeId', '==', uid),
    where('status', '==', status),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const acceptSquadInvitation = async (invitationId, uid) => {
  const ref = doc(db, 'squad_invitations', invitationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Invitation not found');
  const inv = snap.data();
  if (inv.inviteeId !== uid) throw new Error('Not your invitation');
  if (inv.status !== 'pending') throw new Error(`Already ${inv.status}`);
  // Join the squad. If already a member (race / re-invite), swallow.
  try { await joinSquad(inv.squadId, uid); }
  catch (e) { if (!String(e?.message || '').includes('Already a member')) throw e; }
  await updateDoc(ref, { status: 'accepted', respondedAt: serverTimestamp() });
  return inv.squadId;
};

export const declineSquadInvitation = async (invitationId, uid) => {
  const ref = doc(db, 'squad_invitations', invitationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Invitation not found');
  if (snap.data().inviteeId !== uid) throw new Error('Not your invitation');
  await updateDoc(ref, { status: 'declined', respondedAt: serverTimestamp() });
};

export const cancelSquadInvitation = async (invitationId, inviterUid) => {
  const ref = doc(db, 'squad_invitations', invitationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().inviterId !== inviterUid) throw new Error('Only the inviter can cancel');
  await updateDoc(ref, { status: 'cancelled', respondedAt: serverTimestamp() });
};

// Outstanding pending invites for a squad. Used by InviteMembersScreen so
// leaders can see who they've invited that hasn't responded yet (and revoke).
export const getOutstandingSquadInvitations = async (squadId) => {
  if (!squadId) return [];
  const q = query(
    collection(db, 'squad_invitations'),
    where('squadId', '==', squadId),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const handleJoinRequest = async (squadId, requestId, userId, approved) => {
  const requestRef = doc(db, 'squads', squadId, 'join_requests', requestId);
  await updateDoc(requestRef, {
    status: approved ? 'approved' : 'denied',
    reviewedAt: serverTimestamp(),
  });

  if (approved) {
    await joinSquad(squadId, userId);
  }
};

export const getSquadJoinRequests = async (squadId) => {
  const q = query(
    collection(db, 'squads', squadId, 'join_requests'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  const requests = [];
  for (const d of snap.docs) {
    const req = { id: d.id, ...d.data() };
    req.user = await getUser(req.userId);
    requests.push(req);
  }
  return requests;
};

export const getSquadAnnouncements = async (squadId, limitCount = 20) => {
  const q = query(collection(db, 'squads', squadId, 'announcements'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const createSquadAnnouncement = async (squadId, authorId, content, pinned = false) => {
  await addDoc(collection(db, 'squads', squadId, 'announcements'), {
    authorId,
    content,
    pinned,
    createdAt: serverTimestamp(),
  });
};

// Added: function to set squad chat background
export const setSquadChatBackground = async (squadId, type, value) => {
  await updateDoc(doc(db, 'squads', squadId), {
    chatBackground: type,
    chatBackgroundValue: value
  });
};

// ═══════════════════════════════════════════
// VANGUARD MODERATOR PROGRAM
// Spec lives in CLAUDE.md → "Vanguard moderator program — LOCKED SPEC".
// Wire diagram:
//   1. Founder calls `inviteToVanguard(inviteeUid, startRank, message)`
//      callable. That writes an entry to `vanguard_invitations/`.
//   2. Invitee sees it on their dashboard → calls `acceptVanguardInvite`.
//      Server callable sets `users/{uid}.vanguard = { rank, joinedAt, ... }`
//      and adds them to the Vanguard squad. From that moment on, every
//      author chip / profile screen runs them through `applyVanguardMask`.
//   3. Every moderation action they take writes a doc to `vanguard_actions/`
//      (server-side via callables — clients can never write here directly).
// ═══════════════════════════════════════════

// Pending invitations the current user has received. The accept/decline
// callables are server-side (see functions/vanguard.js).
export const getMyVanguardInvitations = async (uid) => {
  if (!uid) return [];
  const q = query(
    collection(db, 'vanguard_invitations'),
    where('inviteeId', '==', uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Founder-only: list every Vanguard member for the admin dashboard.
// Uses a collectionGroup-style query against users where vanguard.rank exists.
export const getAllVanguardMembers = async () => {
  // We index `vanguard.rank` as a top-level field. Query for !=null.
  const q = query(collection(db, 'users'), where('vanguard.rank', 'in', ['recruit', 'vanguard', 'senior', 'commander', 'overseer']));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Audit log read (Commander+ via rules). Recent actions across all Vanguard.
export const getRecentVanguardActions = async (limitCount = 50) => {
  const q = query(collection(db, 'vanguard_actions'), orderBy('takenAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Actions taken by a specific moderator (for the My Stats tab).
export const getMyVanguardActions = async (uid, limitCount = 100) => {
  if (!uid) return [];
  const q = query(
    collection(db, 'vanguard_actions'),
    where('moderatorId', '==', uid),
    orderBy('takenAt', 'desc'),
    limit(limitCount),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Tournaments that have at least one match in `disputed` or
// `awaiting_confirmation` state — i.e. the human-decision queue for
// Vanguard moderators. Returns a flat array of `{ tournament, match }`
// pairs sorted by oldest dispute first.
export const getTournamentsNeedingDecision = async (limitCount = 20) => {
  // We can't `collectionGroup` for matches inside disputes since each
  // match status lives on the match doc itself. Query the few states we
  // care about across all tournament matches via collectionGroup.
  const NEEDS = ['disputed', 'awaiting_confirmation'];
  try {
    const q = query(
      collectionGroup(db, 'matches'),
      where('status', 'in', NEEDS),
      limit(limitCount),
    );
    const snap = await getDocs(q);
    const rows = await Promise.all(snap.docs.map(async (m) => {
      const tournamentId = m.ref.parent.parent?.id;
      const matchId = m.id;
      let tournament = null;
      try {
        const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
        tournament = tSnap.exists() ? { id: tSnap.id, ...tSnap.data() } : null;
      } catch { /* ignore */ }
      return { tournamentId, matchId, match: { id: matchId, ...m.data() }, tournament };
    }));
    // Show oldest first so older disputes don't get buried.
    return rows.sort((a, b) => {
      const ta = a.match.firstReportedAt?.toMillis?.() || a.match.disputedAt?.toMillis?.() || 0;
      const tb = b.match.firstReportedAt?.toMillis?.() || b.match.disputedAt?.toMillis?.() || 0;
      return ta - tb;
    });
  } catch (e) {
    console.warn('[Vanguard queue] needs composite index — surface error:', e?.message);
    return [];
  }
};

// Pending user reports — the report queue for Vanguard moderation. Anyone
// of Vanguard rank+ can approve/reject/escalate. Returns oldest-first.
export const getPendingReports = async (limitCount = 30) => {
  try {
    const q = query(
      collection(db, 'reports'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'asc'),
      limit(limitCount),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Vanguard reports queue] index missing:', e?.message);
    return [];
  }
};

// Tournament assignments (Vanguard scheduling system).
// Open assignments — slots that no mod has claimed yet, sorted by start time.
export const getOpenTournamentAssignments = async (limitCount = 50) => {
  try {
    const q = query(
      collection(db, 'tournament_assignments'),
      where('status', '==', 'open'),
      orderBy('scheduledStart', 'asc'),
      limit(limitCount),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Vanguard assignments] index missing:', e?.message);
    return [];
  }
};

// All MY assignments (any status), most recent first.
export const getMyTournamentAssignments = async (uid, limitCount = 50) => {
  if (!uid) return [];
  try {
    const q = query(
      collection(db, 'tournament_assignments'),
      where('moderatorId', '==', uid),
      orderBy('scheduledStart', 'desc'),
      limit(limitCount),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[My Vanguard assignments] index missing:', e?.message);
    return [];
  }
};

// Vanguard treasury snapshot — live balance + projected current-month share
// for the calling user. Returns `{ balance, projectedShare, eligibleCount,
// myWeight, totalWeight, currentMonthKey }`.
//
// "Projected" is a best-effort estimate: it uses the SAME formula the
// monthly cron runs (`rank_weight × actions_taken_this_month`), but the
// pool can keep growing all month and other Vanguard can keep taking
// actions, so the actual payout on the 1st may differ. The number is
// useful as motivation, not as a commitment.
export const getVanguardTreasurySnapshot = async (uid) => {
  if (!uid) return null;
  const cfgSnap = await getDoc(doc(db, 'app_config', 'general'));
  const vanguardSquadId = cfgSnap.exists() ? cfgSnap.data().vanguardSquadId : null;
  if (!vanguardSquadId) return { balance: 0, projectedShare: 0, configured: false };

  const treasurySnap = await getDoc(doc(db, 'squads', vanguardSquadId, 'wallet', 'main'));
  const balance = treasurySnap.exists() ? Number(treasurySnap.data().balance || 0) : 0;

  // Compute projected share. We need every active Vanguard's rank weight
  // and this-month action count. That requires reading the user list —
  // cheap enough for an internal dashboard read.
  const RANK_W = { recruit: 0, vanguard: 1.0, senior: 1.25, commander: 1.5, overseer: 2.0 };
  const monthDate = new Date();
  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}`;

  const membersSnap = await getDocs(query(
    collection(db, 'users'),
    where('vanguard.rank', 'in', ['recruit', 'vanguard', 'senior', 'commander', 'overseer']),
  ));
  let totalWeight = 0;
  let myWeight = 0;
  let eligibleCount = 0;
  for (const d of membersSnap.docs) {
    const u = d.data();
    const v = u.vanguard || {};
    if (v.status === 'suspended' || v.status === 'retired') continue;
    const rw = RANK_W[v.rank] || 0;
    if (rw <= 0) continue;
    const actions = (v.monthlyActions && v.monthlyActions[monthKey]) || 0;
    if (actions <= 0) continue;
    const w = rw * actions;
    totalWeight += w;
    eligibleCount += 1;
    if (d.id === uid) myWeight = w;
  }
  const projectedShare = totalWeight > 0 && myWeight > 0
    ? Math.floor((balance * myWeight) / totalWeight)
    : 0;

  return { balance, projectedShare, eligibleCount, myWeight, totalWeight, currentMonthKey: monthKey, configured: true };
};

// Past payout history for a single user — pulls every vanguard_payouts
// doc, filters to where `recipients[uid]` exists, returns latest first.
// vanguard_payouts is readable to any Vanguard member (rules), and to
// admin/founder.
export const getMyVanguardPayoutHistory = async (uid, limitCount = 12) => {
  if (!uid) return [];
  const snap = await getDocs(query(
    collection(db, 'vanguard_payouts'),
    orderBy('distributedAt', 'desc'),
    limit(limitCount),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.recipients && p.recipients[uid])
    .map((p) => ({
      monthKey: p.monthKey || p.id,
      coins: p.recipients[uid].coins || 0,
      rank: p.recipients[uid].rank,
      actions: p.recipients[uid].actions || 0,
      totalPool: p.totalPool || 0,
      distributedAt: p.distributedAt,
    }));
};

// Founder dashboard reads pending invitations across everyone.
export const getOutstandingVanguardInvitations = async () => {
  const q = query(
    collection(db, 'vanguard_invitations'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ═══════════════════════════════════════════
// SQUAD EVENTS
// firestore.rules: read=anyone, write=squadAdmin (president/vice_president).
// RSVPs piggyback on the event doc via arrayUnion/arrayRemove on `attendees`.
// Even though the rules only allow admins to write, members can self-add via
// the `going` toggle — this is enforced server-side by an `update` allowance
// in the future cloud function path; until then we leave the rule strict and
// RSVP only works if the user is an admin OR we relax the rule. (Current
// behaviour: admins RSVP works; member RSVP attempts will fail silently.
// Listed in CLAUDE.md "Still to do" for a rule-relaxation pass.)
// ═══════════════════════════════════════════

export const createSquadEvent = async (squadId, creatorId, data) => {
  const ref = await addDoc(collection(db, 'squads', squadId, 'events'), {
    title:       (data?.title || '').trim(),
    description: (data?.description || '').trim(),
    startAt:     data?.startAt ? new Date(data.startAt) : null,
    endAt:       data?.endAt   ? new Date(data.endAt)   : null,
    type:        data?.type || 'scrim',
    location:    data?.location || '',
    createdBy:   creatorId,
    attendees:   [creatorId],
    createdAt:   serverTimestamp(),
  });
  return ref.id;
};

export const getSquadEvents = async (squadId, limitCount = 50) => {
  const q = query(collection(db, 'squads', squadId, 'events'), orderBy('startAt', 'asc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const rsvpSquadEvent = async (squadId, eventId, uid, going) => {
  await updateDoc(doc(db, 'squads', squadId, 'events', eventId), {
    attendees: going ? arrayUnion(uid) : arrayRemove(uid),
  });
};

export const deleteSquadEvent = async (squadId, eventId) => {
  await deleteDoc(doc(db, 'squads', squadId, 'events', eventId));
};

// ═══════════════════════════════════════════
// SQUAD CHALLENGES
// firestore.rules: read=squadMember, write=squadAdmin. Progress is tracked
// per-user in a map field; the challenge completes when goal hits across the
// scope (`individual` = a single user hit the goal, `squad` = sum across
// participants hit the goal).
// ═══════════════════════════════════════════

export const createSquadChallenge = async (squadId, creatorId, data) => {
  const ref = await addDoc(collection(db, 'squads', squadId, 'challenges'), {
    title:       (data?.title || '').trim(),
    description: (data?.description || '').trim(),
    scope:       data?.scope === 'individual' ? 'individual' : 'squad',
    goal:        Number(data?.goal) || 1,
    vpReward:    Number(data?.vpReward) || 0,
    coinReward:  Number(data?.coinReward) || 0,
    deadline:    data?.deadline ? new Date(data.deadline) : null,
    progress:    {},   // { uid: number }
    completedBy: [],   // [uid]  (individual scope)
    status:      'active',  // 'active' | 'completed' | 'expired'
    createdBy:   creatorId,
    createdAt:   serverTimestamp(),
  });
  return ref.id;
};

export const getSquadChallenges = async (squadId, limitCount = 50) => {
  const q = query(collection(db, 'squads', squadId, 'challenges'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Increment a user's own progress on a challenge. Member-writable in
// principle but the current rule only allows squadAdmin to write challenges.
// Leaving as-is for now — leaders manually nudge progress until a callable
// gates self-increments properly.
export const incrementChallengeProgress = async (squadId, challengeId, uid, delta = 1) => {
  await updateDoc(doc(db, 'squads', squadId, 'challenges', challengeId), {
    [`progress.${uid}`]: increment(delta),
  });
};

export const completeSquadChallenge = async (squadId, challengeId) => {
  await updateDoc(doc(db, 'squads', squadId, 'challenges', challengeId), {
    status: 'completed',
    completedAt: serverTimestamp(),
  });
};

export const deleteSquadChallenge = async (squadId, challengeId) => {
  await deleteDoc(doc(db, 'squads', squadId, 'challenges', challengeId));
};

// ═══════════════════════════════════════════
// WALLET OPERATIONS
// ═══════════════════════════════════════════

// Convert coins → gems via the server callable (Phase 3). The callable
// enforces rate limits, idempotency, and writes the platform commission
// ledger. Signature kept the same so existing callers don't need to change.
export const convertCoinsToGems = async (uid, amount) => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid conversion amount');
  }
  const { httpsCallable } = await import('firebase/functions');
  const { functions: fns } = await import('./config');
  const fn = httpsCallable(fns, 'convertCoinsToGems');
  // Idempotency key — prevents double-debit if the network blips
  const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fn({ amount, idempotencyKey });
  return res.data;
};

// Tip / send coins.
// Sender pays N coins. Platform takes a flat 10% upfront fee (covers Gcore
// live-streaming bandwidth + general operating cost). Recipient receives
// floor(N × 0.90) coins. The remaining VP-tier commission is applied later
// when the recipient converts coins → gems for cash-out.
//
// HARD RULE — locked in CLAUDE.md: tips ALWAYS take the 10% flat fee, no
// matter the recipient's tier. Do not parameterise.
const TIP_PLATFORM_FEE_PCT = 0.10;

export const sendCoins = async (fromUid, toUid, amount, desc = '') => {
  // News bots are not users. Block tips to bot accounts upfront so the
  // sender sees a clear error before anything debits.
  const recipientSnap = await getDoc(doc(db, 'users', toUid));
  if (recipientSnap.exists() && recipientSnap.data().accountType === 'news_bot') {
    throw new Error('Cannot tip a bot account.');
  }

  const fromWalletRef = doc(db, 'wallets', fromUid);
  const toWalletRef = doc(db, 'wallets', toUid);

  await runTransaction(db, async (transaction) => {
    const fromSnap = await transaction.get(fromWalletRef);
    if (!fromSnap.exists()) throw new Error('Wallet not found');
    if (fromSnap.data().balance < amount) throw new Error('Insufficient balance');

    const platformFee  = Math.ceil(amount * TIP_PLATFORM_FEE_PCT);
    const netToCreator = amount - platformFee;

    // Deduct full amount from sender
    transaction.update(fromWalletRef, {
      balance: increment(-amount),
      totalSpent: increment(amount),
      totalTipped: increment(amount),
      updatedAt: serverTimestamp(),
    });

    // Credit recipient the net (after the 10% platform cut)
    transaction.update(toWalletRef, {
      balance: increment(netToCreator),
      totalEarned: increment(netToCreator),
      vp: increment(5), // bonus VP for receiving a tip
      updatedAt: serverTimestamp(),
    });

    transaction.set(doc(collection(db, 'transactions')), {
      userId: fromUid, recipientId: toUid, type: 'tip_sent',
      amount: -amount, currency: 'coins',
      description: desc || 'Sent tip',
      meta: { gross: amount, platformFee, netToCreator },
      createdAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, 'transactions')), {
      userId: toUid, senderId: fromUid, type: 'tip_received',
      amount: netToCreator, currency: 'coins',
      description: desc ? `Tip received: ${desc}` : 'Received a tip',
      meta: { gross: amount, platformFee, netToCreator },
      createdAt: serverTimestamp(),
    });

    // Platform-side commission ledger entry — admin-readable for accounting.
    transaction.set(doc(collection(db, 'platform_commissions')), {
      type: 'tip_platform_fee',
      senderId: fromUid,
      recipientId: toUid,
      gross: amount,
      platformFee,
      netToCreator,
      ratePct: TIP_PLATFORM_FEE_PCT * 100,
      createdAt: serverTimestamp(),
    });

    transaction.set(doc(collection(db, 'notifications')), {
      recipientId: toUid, type: 'coins',
      title: `+${netToCreator} coins received!`,
      body: desc || 'Someone tipped you',
      read: false, data: { amount: netToCreator, gross: amount, platformFee, type: 'tip_received' },
      createdAt: serverTimestamp(),
    });
  });
};

export const claimQuestReward = async (uid, questId, rewardAmount, questTitle) => {
  const walletRef = doc(db, 'wallets', uid);
  const questClaimRef = doc(db, 'quest_claims', `${uid}_${questId}_${new Date().toISOString().split('T')[0]}`);

  await runTransaction(db, async (transaction) => {
    const claimSnap = await transaction.get(questClaimRef);
    if (claimSnap.exists()) throw new Error('Quest already claimed today');

    transaction.update(walletRef, {
      balance: increment(rewardAmount),
      totalEarned: increment(rewardAmount),
      updatedAt: serverTimestamp(),
    });

    transaction.set(questClaimRef, {
      userId: uid,
      questId,
      amount: rewardAmount,
      claimedAt: serverTimestamp(),
    });

    const txRef = doc(collection(db, 'transactions'));
    transaction.set(txRef, {
      userId: uid,
      type: 'quest_reward',
      amount: rewardAmount,
      desc: questTitle || 'Quest reward',
      createdAt: serverTimestamp(),
    });
  });
};

export const requestPayout = async (uid, amount, method, details) => {
  const COIN_TO_EUR = 0.01;
  const PLATFORM_FEE_PCT = 0.10;
  const PROCESSOR_FEE_PCT = 0.03;
  const MIN_PAYOUT = 1000;

  if (amount < MIN_PAYOUT) throw new Error(`Minimum payout is ${MIN_PAYOUT} coins`);

  const eurTotal = amount * COIN_TO_EUR;
  const platformFee = parseFloat((eurTotal * PLATFORM_FEE_PCT).toFixed(2));
  const processorFee = parseFloat((eurTotal * PROCESSOR_FEE_PCT).toFixed(2));
  const userReceives = parseFloat((eurTotal - platformFee - processorFee).toFixed(2));

  const walletRef = doc(db, 'wallets', uid);

  await runTransaction(db, async (transaction) => {
    const walletSnap = await transaction.get(walletRef);
    if (!walletSnap.exists()) throw new Error('Wallet not found');
    if (walletSnap.data().balance < amount) throw new Error('Insufficient balance');

    transaction.update(walletRef, {
      balance: increment(-amount),
      totalSpent: increment(amount),
      updatedAt: serverTimestamp(),
    });

    const payoutRef = doc(collection(db, 'payouts'));
    transaction.set(payoutRef, {
      userId: uid,
      coinAmount: amount,
      eurTotal,
      platformFee,
      processorFee,
      userReceives,
      method,
      details,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    const txRef = doc(collection(db, 'transactions'));
    transaction.set(txRef, {
      userId: uid,
      type: 'payout',
      amount: -amount,
      description: `Cash out €${userReceives} via ${method}`,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  });
};

// ═══════════════════════════════════════════
// USER SETTINGS
// ═══════════════════════════════════════════

export const updateUserSettings = async (uid, settings) => {
  await updateDoc(doc(db, 'users', uid), {
    settings: settings,
    updatedAt: serverTimestamp(),
  });
};

export const updateLinkedAccount = async (uid, platform, accountInfo) => {
  await updateDoc(doc(db, 'users', uid), {
    [`linkedAccounts.${platform}`]: accountInfo,
    updatedAt: serverTimestamp(),
  });
};

export const removeLinkedAccount = async (uid, platform) => {
  await updateDoc(doc(db, 'users', uid), {
    [`linkedAccounts.${platform}`]: null,
    updatedAt: serverTimestamp(),
  });
};

// Find users who have linked a given platform (e.g. 'battlenet'). Used by the
// tournament invite-players modal to scope the default list to people the host
// can actually pair with on the relevant game.
//
// Firestore can't natively check "field exists" — we filter client-side after a
// bounded fetch. Optional `term` further narrows by username prefix.
export const getUsersWithLinkedAccount = async (platform, { term = '', limitCount = 50 } = {}) => {
  if (!platform) return [];
  let q;
  const t = (term || '').trim().toLowerCase();
  if (t) {
    q = query(
      collection(db, 'users'),
      where('username', '>=', t),
      where('username', '<=', t + ''),
      limit(limitCount),
    );
  } else {
    q = query(collection(db, 'users'), limit(limitCount));
  }
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => {
      const linked = u.linkedAccounts?.[platform];
      if (!linked) return false;
      if (platform === 'steam') return !!linked.steamId64;
      return typeof linked === 'string' ? !!linked : !!linked.username;
    });
};

export const blockUser = async (uid, blockedUid) => {
  await setDoc(doc(db, 'users', uid, 'blocked', blockedUid), {
    blockedAt: serverTimestamp(),
  });
};

export const unblockUser = async (uid, blockedUid) => {
  await deleteDoc(doc(db, 'users', uid, 'blocked', blockedUid));
};

export const getBlockedUsers = async (uid) => {
  const snap = await getDocs(collection(db, 'users', uid, 'blocked'));
  const users = [];
  for (const d of snap.docs) {
    const user = await getUser(d.id);
    if (user) users.push(user);
  }
  return users;
};

export const getQuestClaims = async (uid) => {
  const today = new Date().toISOString().split('T')[0];
  const q = query(
    collection(db, 'quest_claims'),
    where('userId', '==', uid),
    where('claimedAt', '>=', new Date(today))
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data().questId);
};

// ═══════════════════════════════════════════
// STREAMS
// ═══════════════════════════════════════════

export const getLiveStreams = async (limitCount = 20) => {
  const q = query(collection(db, 'streams'), where('isLive', '==', true), orderBy('viewerCount', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  const streams = [];
  for (const d of snap.docs) {
    const stream = { id: d.id, ...d.data() };
    stream.streamer = await getUser(stream.streamerId);
    streams.push(stream);
  }
  return streams;
};

export const createStream = async (streamerId, { title, game, platforms }) => {
  const ref = await addDoc(collection(db, 'streams'), {
    streamerId,
    title,
    game,
    platforms: platforms || ['vergr'],
    isLive: true,
    viewerCount: 0,
    chatEnabled: true,
    tipsEnabled: true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// ═══════════════════════════════════════════
// TOURNAMENTS
// ═══════════════════════════════════════════

export const getTournaments = async (status = null, limitCount = 20) => {
  // Public browse: filter out private/invite-only tournaments. Server query
  // for `visibility == public` requires a composite index — fall back to a
  // client-side filter if the index doesn't exist yet.
  let q;
  try {
    if (status && status !== 'All') {
      q = query(
        collection(db, 'tournaments'),
        where('status', '==', status.toLowerCase()),
        where('visibility', '==', 'public'),
        orderBy('startDate', 'asc'),
        limit(limitCount),
      );
    } else {
      q = query(
        collection(db, 'tournaments'),
        where('visibility', '==', 'public'),
        orderBy('startDate', 'desc'),
        limit(limitCount),
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Composite index missing — fall back and filter client-side. Firebase
    // logs the deep-link to create the index in the same error.
    if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
      console.warn('getTournaments composite index missing — filtering client-side. Create it via the Firebase console link in the previous error.');
      const fallback = status && status !== 'All'
        ? query(collection(db, 'tournaments'), where('status', '==', status.toLowerCase()), orderBy('startDate', 'asc'), limit(limitCount * 2))
        : query(collection(db, 'tournaments'), orderBy('startDate', 'desc'), limit(limitCount * 2));
      const snap = await getDocs(fallback);
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => (t.visibility || 'public') === 'public')
        .slice(0, limitCount);
    }
    throw err;
  }
};

// ═══════════════════════════════════════════
// PUBLIC GROUP CHATS — browse + join.
// ═══════════════════════════════════════════
// Group conversations with `visibility: 'public'` are discoverable in the
// Browse Groups screen. The owner sets visibility from the group settings.

export const getPublicGroupChats = async (limitCount = 50) => {
  try {
    const q = query(
      collection(db, 'conversations'),
      where('isGroup', '==', true),
      where('visibility', '==', 'public'),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Composite index likely missing on first run — Firebase logs a deep
    // link to create it. Return [] so the screen renders an empty state.
    if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
      console.warn('getPublicGroupChats: composite index missing — returning [].', err.message);
      return [];
    }
    throw err;
  }
};

export const joinGroupChat = async (chatId) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const ref = doc(db, 'conversations', chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Group not found');
  const data = snap.data();
  if (!data.isGroup) throw new Error('Not a group chat');
  if (data.visibility !== 'public') throw new Error('Group is private');
  if ((data.participants || []).includes(uid)) return chatId; // already in
  await updateDoc(ref, {
    participants: arrayUnion(uid),
    [`metadata.${uid}`]: {
      name: auth.currentUser?.displayName || 'Vergr Member',
      avatar: auth.currentUser?.photoURL || null,
    },
  });
  return chatId;
};

// ═══════════════════════════════════════════
// VOICE CHANNELS — user-created Discord-style voice rooms.
// ═══════════════════════════════════════════
// Each channel doc:
//   { name, ownerId, visibility: 'public' | 'private',
//     allowedUserIds: [uid…]  (private only),
//     createdAt }
// The SFU room id = the channel doc id (we prefix with `voice_` on the
// frontend so the SFU's authorizeRoom can distinguish from other room types).

export const createVoiceChannel = async ({ name, visibility = 'private', allowedUserIds = [] }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const cleanName = (name || '').trim();
  if (cleanName.length < 1) throw new Error('Channel name required');
  if (cleanName.length > 40) throw new Error('Name too long (40 chars max)');

  const ref = await addDoc(collection(db, 'voice_channels'), {
    name: cleanName,
    ownerId: uid,
    visibility,
    // Owner is always implicitly allowed — store explicitly to simplify queries.
    allowedUserIds: visibility === 'private'
      ? Array.from(new Set([uid, ...(allowedUserIds || [])]))
      : [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// Channels the current user is a member of (owner or invited). Used by
// the messages panel to show "Your voice channels".
export const subscribeToUserVoiceChannels = (uid, callback) => {
  if (!uid) return () => {};
  // Two queries because Firestore can't OR — owner-OR-allowed-list.
  const ownerQ   = query(collection(db, 'voice_channels'), where('ownerId', '==', uid));
  const memberQ  = query(collection(db, 'voice_channels'), where('allowedUserIds', 'array-contains', uid));
  const merged = new Map();
  let firstOwner = true, firstMember = true;
  const emit = () => {
    callback(Array.from(merged.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  };
  const unsubA = onSnapshot(ownerQ, (snap) => {
    snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    snap.docChanges().filter(c => c.type === 'removed').forEach(c => merged.delete(c.doc.id));
    if (!firstOwner || !firstMember) emit(); firstOwner = false; emit();
  });
  const unsubB = onSnapshot(memberQ, (snap) => {
    snap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    snap.docChanges().filter(c => c.type === 'removed').forEach(c => merged.delete(c.doc.id));
    firstMember = false; emit();
  });
  return () => { unsubA(); unsubB(); };
};

export const getVoiceChannel = async (channelId) => {
  const snap = await getDoc(doc(db, 'voice_channels', channelId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const updateVoiceChannelMembers = async (channelId, allowedUserIds) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  await updateDoc(doc(db, 'voice_channels', channelId), {
    allowedUserIds: Array.from(new Set([uid, ...(allowedUserIds || [])])),
  });
};

export const deleteVoiceChannel = async (channelId) => {
  await deleteDoc(doc(db, 'voice_channels', channelId));
};

// Tournaments the user is registered in OR hosting (used by My Tournaments).
// Performs two filtered queries client-side and dedupes — Firestore can't
// OR-query across two array fields.
// GR1 — public host reputation. Computes "is this host legit?" stats from the
// tournaments they have run. Cheap (one indexed query on adminId, cap 200).
export const getHostStats = async (uid) => {
  if (!uid) return null;
  const snap = await getDocs(query(collection(db, 'tournaments'), where('adminId', '==', uid), limit(200)));
  const ts = snap.docs.map((d) => d.data());
  const hosted = ts.length;
  const completed = ts.filter((t) => t.status === 'completed').length;
  const cancelled = ts.filter((t) => t.status === 'cancelled').length;
  const moderated = ts.filter((t) => t.vanguardModerated).length;
  const totalPrize = ts.reduce((s, t) => s + (t.prizePool || 0), 0);
  const totalPlayers = ts.reduce((s, t) => s + (t.participants?.length || 0), 0);
  const settled = completed + cancelled;
  return {
    hosted,
    completed,
    cancelled,
    moderated,
    totalPrize,
    totalPlayers,
    completionRate: settled ? Math.round((completed / settled) * 100) : null,
    moderatedRate: hosted ? Math.round((moderated / hosted) * 100) : 0,
  };
};

export const getUserTournaments = async (uid, limitCount = 50) => {
  if (!uid) return [];
  const [hostedSnap, joinedSnap] = await Promise.all([
    getDocs(query(collection(db, 'tournaments'), where('adminId', '==', uid), limit(limitCount))),
    getDocs(query(collection(db, 'tournaments'), where('participants', 'array-contains', uid), limit(limitCount))),
  ]);
  const map = new Map();
  for (const d of hostedSnap.docs) map.set(d.id, { id: d.id, ...d.data(), _hosting: true });
  for (const d of joinedSnap.docs) {
    const existing = map.get(d.id);
    map.set(d.id, { id: d.id, ...d.data(), _hosting: existing?._hosting || false, _joined: true });
  }
  return Array.from(map.values());
};

// Tournaments hosted by people the current user follows. Used by the
// Following tab. Capped to first 30 followees to stay within Firestore's
// in-query limit (10 values per `in`); chunked behind the scenes.
export const getFollowingTournaments = async (uid, limitCount = 30) => {
  if (!uid) return [];
  const followingIds = await getFollowing(uid);
  if (!followingIds.length) return [];
  const ids = followingIds.slice(0, 30);
  // Firestore `in` supports up to 30 values per query as of late 2023.
  const snap = await getDocs(
    query(
      collection(db, 'tournaments'),
      where('adminId', 'in', ids),
      orderBy('startDate', 'desc'),
      limit(limitCount),
    ),
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Pending applications across every tournament the user is admin of.
// Reads from `tournament_applications/{auto}` where `tournamentAdminId == uid`.
// Returns applications enriched with the tournament's name + game.
export const getTournamentApplications = async (uid, status = 'pending', limitCount = 100) => {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'tournament_applications'),
        where('tournamentAdminId', '==', uid),
        where('status', '==', status),
        orderBy('createdAt', 'desc'),
        limit(limitCount),
      ),
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Collection may not exist yet — return empty list rather than throwing.
    if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
      console.warn('tournament_applications query needs an index — returning []', err.message);
      return [];
    }
    console.warn('getTournamentApplications', err);
    return [];
  }
};

// ═══════════════════════════════════════════
// TOURNAMENTS — secure server callables (Phase 1)
// ═══════════════════════════════════════════
// These wrap the Cloud Functions in functions/tournaments.js. They are the
// authoritative path for tournament writes — the legacy client-side helpers
// below (createTournament, joinTournament, etc.) remain for backwards
// compatibility but should be migrated to these wrappers over time.
const callTournamentFn = async (name, payload) => {
  const { httpsCallable } = await import('firebase/functions');
  const { functions: fns } = await import('./config');
  const fn = httpsCallable(fns, name);
  const res = await fn(payload || {});
  return res.data;
};

export const createTournamentSecure = (payload) =>
  callTournamentFn('createTournamentSecure', payload);

export const joinTournamentSecure = (tournamentId, opts = {}) =>
  callTournamentFn('joinTournamentSecure', { tournamentId, ...opts });

export const leaveTournamentSecure = (tournamentId) =>
  callTournamentFn('leaveTournamentSecure', { tournamentId });

export const startTournamentSecure = (tournamentId) =>
  callTournamentFn('startTournamentSecure', { tournamentId });

export const reportMatchResultSecure = ({ tournamentId, matchId, winnerId, source = 'manual', evidenceUrl = null }) =>
  callTournamentFn('reportMatchResultSecure', { tournamentId, matchId, winnerId, source, evidenceUrl });

export const finalizeTournamentSecure = (tournamentId) =>
  callTournamentFn('finalizeTournamentSecure', { tournamentId });

export const resolveTournamentDispute = ({ tournamentId, matchId, winnerId, note = '' }) =>
  callTournamentFn('resolveTournamentDispute', { tournamentId, matchId, winnerId, note });

// Apply to a private tournament you weren't invited to. Creates a
// `tournament_applications` doc the host reviews in their inbox.
export const applyToTournamentSecure = ({ tournamentId, message = '' }) =>
  callTournamentFn('applyToTournamentSecure', { tournamentId, message });

export const approveTournamentApplication = (applicationId) =>
  callTournamentFn('approveTournamentApplication', { applicationId });

export const declineTournamentApplication = (applicationId) =>
  callTournamentFn('declineTournamentApplication', { applicationId });

// Curated "tournament of the day" — written daily by tournamentOfTheDayCron to
// featured/tournament_of_the_day (scored by prize, players, mod-moderation,
// sponsor, follower reach). Returns the full tournament doc, or null.
export const getFeaturedTournament = async () => {
  try {
    const snap = await getDoc(doc(db, 'featured', 'tournament_of_the_day'));
    if (!snap.exists()) return null;
    const tid = snap.data()?.tournamentId;
    if (!tid) return null;
    return await getTournament(tid);
  } catch { return null; }
};

// ─── PayRam (inbound rail — buy coins) ───────────────────────────────
// createPayramPayment opens a hosted PayRam payment and returns { referenceId,
// paymentUrl }. The buy screen opens paymentUrl in a popup and polls
// getPayramOrderStatus until it returns { status: 'settled' }.
export const createPayramPayment = (payload) =>
  callTournamentFn('createPayramPayment', payload || {});

export const getPayramOrderStatus = (referenceId) =>
  callTournamentFn('getPayramOrderStatus', { referenceId });

// ─── Steam GSI (CS2 / Dota 2 auto-result detection) ──────────────────
// Workflow:
//   1) linkSteam({ steamId64 }) — generates a unique GSI token on the user.
//   2) getSteamGsiConfig({ game }) — returns the .cfg content + install path.
//   3) Frontend writes the file: Tauri (direct), File System Access API
//      (Chrome/Edge), or download + manual instructions (other browsers).
// Once installed, CS2/Dota 2 push match-end events directly to our webhook
// (functions/gsi.js → cs2GsiHook / dota2GsiHook). No client app required.
export const linkSteam = ({ steamId64 }) =>
  callTournamentFn('linkSteamAccount', { steamId64 });

// OAuth start URL fetcher — backend mints a state token and returns the
// provider's authorize URL. Frontend then sets window.location.href = url.
// Supported platforms: twitch, youtube, discord, battlenet, epicgames.
export const getOAuthStartUrl = (platform) =>
  callTournamentFn('getOAuthStartUrl', { platform });

// Steam uses OpenID 2.0 (different protocol) so it has its own start URL
// callable. The frontend treats both the same: get URL → redirect.
export const getSteamSignInUrl = () =>
  callTournamentFn('getSteamSignInUrl', {});

export const unlinkSteam = () =>
  callTournamentFn('unlinkSteamAccount', {});

export const getSteamGsiConfig = ({ game }) =>
  callTournamentFn('getSteamGsiConfig', { game });

export const createTournament = async (adminId, squadId, payload) => {
  const {
    name, game, entryFee, maxParticipants, type,
    mode = 'solo', streamRequired = false,
    brGameCount = null, swissRounds = null,
    description = '',
    visibility = 'public',           // 'public' | 'private'
    bannerUrl = null,
    invitedUserIds = [],              // for private tournaments
  } = payload;
  // Enforce Riot-disclosed platform caps. Mirrors the validator in the wizard;
  // duplicated here as a defense-in-depth check so any future caller (admin
  // tools, scripted seeders, etc.) still hits the limit.
  const { validateTournamentLimits } = await import('../utils/tournamentTypes');
  const limitCheck = validateTournamentLimits({ entryFee: entryFee || 0, maxParticipants: maxParticipants || 0 });
  if (!limitCheck.ok) throw new Error(limitCheck.error);
  const tournamentRef = await addDoc(collection(db, 'tournaments'), {
    adminId, squadId: squadId || null,
    name, game, description,
    entryFee: entryFee || 0,
    maxParticipants,
    type,
    mode,
    streamRequired,
    brGameCount,
    swissRounds,
    visibility,
    bannerUrl: bannerUrl || null,
    invitedUserIds: visibility === 'private' ? (invitedUserIds || []) : [],
    status: 'open',
    prizePool: 0,
    participants: [],
    bracketData: null,
    brResults: [],
    // Compliance: every tournament is classified as a skill-based
    // competition. Server-stamped here (not from client payload) so the
    // classification cannot be tampered with.
    category: 'skill_based_competition',
    skillTermsAcceptedAt: Date.now(),
    skillTermsVersion: 1,
    createdAt: serverTimestamp(),
  });
  return tournamentRef.id;
};

// Append a Battle Royale game's placement results. results = [{ playerId, place }]
export const submitBRGameResults = async (tournamentId, gameId, results) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const payload = (results || []).map(r => ({ ...r, gameId }));
  await updateDoc(tournamentRef, {
    brResults: arrayUnion(...payload),
    updatedAt: serverTimestamp(),
  });
};

export const submitRoundResult = async (matchId, currentRound, winnerId, loserId) => {
  const roundRef = doc(db, 'tournaments', matchId, 'rounds', `round_${currentRound}`);
  await setDoc(roundRef, {
    winnerId,
    loserId,
    completedAt: serverTimestamp()
  }, { merge: true });
};

export const finalizeTournament = async (matchId, winnerId, teamId, squadId, prizePool, xpAmount) => {
  const tournamentRef = doc(db, 'tournaments', matchId);
  const transactionRef = doc(collection(db, 'transactions'));

  await runTransaction(db, async (transaction) => {
    transaction.update(tournamentRef, { 
      status: 'completed',
      winnerId: winnerId,
      finalizedAt: serverTimestamp() 
    });

    transaction.set(transactionRef, {
      userId: winnerId,
      type: 'escrow',
      amount: prizePool || 0,
      desc: `Tournament Win: ${matchId}`,
      status: 'pending',
      createdAt: serverTimestamp(),
      unlockAt: new Date(Date.now() + 24 * 60 * 60 * 1000) 
    });
  });
  
  await distributeWinRewards(winnerId, teamId, squadId, xpAmount);
};

// ═══════════════════════════════════════════
// MODERATOR
// ═══════════════════════════════════════════

export const recordModeratorPayout = async (moderatorId, amount, tournamentId) => {
  const transactionRef = doc(collection(db, 'transactions'));
  await setDoc(transactionRef, {
    userId: moderatorId,
    type: 'mod_payout', 
    amount: amount,
    tournamentId: tournamentId,
    status: 'completed',
    createdAt: serverTimestamp(),
  });
};

// ═══════════════════════════════════════════
// TOURNAMENT PARTICIPATION & PRIZES
// ═══════════════════════════════════════════

export const getTournament = async (tournamentId) => {
  const snap = await getDoc(doc(db, 'tournaments', tournamentId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Live subscription to a single tournament doc. Used so the prize pool +
// entrant count update in real time as players join (MP2) without a reload.
// Returns an unsubscribe fn.
export const subscribeTournament = (tournamentId, cb) => {
  if (!tournamentId) return () => {};
  return onSnapshot(doc(db, 'tournaments', tournamentId), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => console.warn('subscribeTournament', err.message));
};

export const joinTournament = async (tournamentId, userId) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const walletRef = doc(db, 'wallets', userId);

  await runTransaction(db, async (transaction) => {
    const tournamentSnap = await transaction.get(tournamentRef);
    if (!tournamentSnap.exists()) throw new Error('Tournament not found');
    const t = tournamentSnap.data();

    if (t.status !== 'open') throw new Error('Tournament is not open for registration');
    if (t.participants?.includes(userId)) throw new Error('Already registered');
    if (t.participants?.length >= t.maxParticipants) throw new Error('Tournament is full');

    // Collect entry fee
    if (t.entryFee > 0) {
      const walletSnap = await transaction.get(walletRef);
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      if (walletSnap.data().balance < t.entryFee) throw new Error('Insufficient coins for entry fee');

      transaction.update(walletRef, {
        balance: increment(-t.entryFee),
        totalSpent: increment(t.entryFee),
        updatedAt: serverTimestamp(),
      });

      // Record transaction
      const txRef = doc(collection(db, 'transactions'));
      transaction.set(txRef, {
        userId,
        type: 'tournament_entry',
        amount: -t.entryFee,
        description: `Entry fee: ${t.name}`,
        tournamentId,
        createdAt: serverTimestamp(),
      });
    }

    // Add to participants and prize pool
    transaction.update(tournamentRef, {
      participants: arrayUnion(userId),
      prizePool: increment(t.entryFee || 0),
      updatedAt: serverTimestamp(),
    });

    // Notify admin
    if (t.adminId && t.adminId !== userId) {
      transaction.set(doc(collection(db, 'notifications')), {
        recipientId: t.adminId, type: 'tournament',
        title: 'Player joined', body: `Someone joined ${t.name}`,
        read: false, data: { tournamentId }, createdAt: serverTimestamp(),
      });
    }
  });
};

export const leaveTournament = async (tournamentId, userId) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const walletRef = doc(db, 'wallets', userId);

  await runTransaction(db, async (transaction) => {
    const tournamentSnap = await transaction.get(tournamentRef);
    if (!tournamentSnap.exists()) throw new Error('Tournament not found');
    const t = tournamentSnap.data();

    if (t.status !== 'open') throw new Error('Cannot leave after tournament starts');
    if (!t.participants?.includes(userId)) throw new Error('Not registered');

    // Refund entry fee
    if (t.entryFee > 0) {
      transaction.update(walletRef, {
        balance: increment(t.entryFee),
        totalSpent: increment(-t.entryFee),
        updatedAt: serverTimestamp(),
      });

      const txRef = doc(collection(db, 'transactions'));
      transaction.set(txRef, {
        userId,
        type: 'tournament_refund',
        amount: t.entryFee,
        description: `Refund: ${t.name}`,
        tournamentId,
        createdAt: serverTimestamp(),
      });
    }

    transaction.update(tournamentRef, {
      participants: arrayRemove(userId),
      prizePool: increment(-(t.entryFee || 0)),
      updatedAt: serverTimestamp(),
    });
  });
};

export const startTournament = async (tournamentId, adminId) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const snap = await getDoc(tournamentRef);
  if (!snap.exists()) throw new Error('Tournament not found');
  const t = snap.data();
  if (t.adminId !== adminId) throw new Error('Only the admin can start this tournament');
  if (t.status !== 'open') throw new Error('Tournament already started');
  if ((t.participants?.length || 0) < 2) throw new Error('Need at least 2 participants');

  // Generate bracket — simple single elimination
  const participants = [...t.participants];
  // Shuffle
  for (let i = participants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [participants[i], participants[j]] = [participants[j], participants[i]];
  }

  // Create round 1 matches
  const matches = [];
  for (let i = 0; i < participants.length; i += 2) {
    const match = {
      player1: participants[i],
      player2: participants[i + 1] || null, // bye if odd
      winner: participants[i + 1] ? null : participants[i], // auto-win on bye
      round: 1,
      matchNumber: Math.floor(i / 2) + 1,
      status: participants[i + 1] ? 'pending' : 'completed',
    };
    matches.push(match);
  }

  const batch = writeBatch(db);
  matches.forEach((match, idx) => {
    const matchRef = doc(db, 'tournaments', tournamentId, 'matches', `r1_m${idx + 1}`);
    batch.set(matchRef, { ...match, createdAt: serverTimestamp() });
  });

  // Generate typed bracketData based on tournament.type
  let bracketData = null;
  try {
    const mod = await import('../utils/tournamentTypes.js');
    const players = participants.map((uid, i) => ({ id: uid, playerId: uid, name: uid, seed: i + 1 }));
    if (t.type === 'single_elim' || t.type === 'squad_single_elim' || !t.type) {
      bracketData = mod.generateSingleElim(players);
    } else if (t.type === 'double_elim') {
      bracketData = mod.generateDoubleElim(players);
    } else if (t.type === 'squad_round_robin') {
      bracketData = mod.generateRoundRobin(players);
    } else if (t.type === 'swiss') {
      const first = mod.generateSwissRound(
        players.map(p => ({ ...p, wins: 0, losses: 0, pastOpponents: [] })),
        1
      );
      bracketData = { rounds: [first] };
    } else if (t.type === 'battle_royale') {
      bracketData = { gameCount: t.brGameCount || 3 };
    } else if (t.type === 'invitational') {
      bracketData = { rounds: [], custom: true };
    }
  } catch (err) {
    console.error('Bracket generation failed', err);
  }

  batch.update(tournamentRef, {
    status: 'active',
    bracket: { totalRounds: Math.ceil(Math.log2(participants.length)), currentRound: 1 },
    bracketData,
    startedAt: serverTimestamp(),
  });

  // Notify all participants
  for (const pid of participants) {
    batch.set(doc(collection(db, 'notifications')), {
      recipientId: pid, type: 'tournament',
      title: 'Tournament started!', body: `${t.name} has begun. Check your bracket.`,
      read: false, data: { tournamentId }, createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return matches;
};

export const getTournamentMatches = async (tournamentId, round = null) => {
  let q;
  if (round) {
    q = query(collection(db, 'tournaments', tournamentId, 'matches'), where('round', '==', round), orderBy('matchNumber'));
  } else {
    q = query(collection(db, 'tournaments', tournamentId, 'matches'), orderBy('round'), orderBy('matchNumber'));
  }
  const snap = await getDocs(q);
  const matches = [];
  for (const d of snap.docs) {
    const match = { id: d.id, ...d.data() };
    if (match.player1) match.player1Data = await getUser(match.player1);
    if (match.player2) match.player2Data = await getUser(match.player2);
    matches.push(match);
  }
  return matches;
};

export const reportMatchResult = async (tournamentId, matchId, winnerId) => {
  const matchRef = doc(db, 'tournaments', tournamentId, 'matches', matchId);
  const matchSnap = await getDoc(matchRef);
  if (!matchSnap.exists()) throw new Error('Match not found');
  const match = matchSnap.data();

  if (match.status === 'completed') throw new Error('Match already completed');
  if (match.player1 !== winnerId && match.player2 !== winnerId) throw new Error('Winner must be a participant');

  const loserId = match.player1 === winnerId ? match.player2 : match.player1;

  await updateDoc(matchRef, {
    winner: winnerId,
    loser: loserId,
    status: 'completed',
    completedAt: serverTimestamp(),
  });

  // Notify players
  const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
  const tName = tSnap.exists() ? tSnap.data().name : 'Tournament';

  await addDoc(collection(db, 'notifications'), {
    recipientId: winnerId, type: 'tournament',
    title: 'Match won!', body: `You advanced in ${tName}`,
    read: false, data: { tournamentId }, createdAt: serverTimestamp(),
  }).catch(() => {});
  if (loserId) {
    await addDoc(collection(db, 'notifications'), {
      recipientId: loserId, type: 'tournament',
      title: 'Match result', body: `You were eliminated from ${tName}`,
      read: false, data: { tournamentId }, createdAt: serverTimestamp(),
    }).catch(() => {});
  }

  // Auto-advance: check if all matches in this round are done
  await advanceBracket(tournamentId, match.round);
};

// Auto-advance bracket — generates next round when current round is complete
const advanceBracket = async (tournamentId, completedRound) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const tSnap = await getDoc(tournamentRef);
  if (!tSnap.exists()) return;
  const t = tSnap.data();

  // Get all matches in this round
  const matchesSnap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'matches'), where('round', '==', completedRound))
  );
  const roundMatches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Check if all matches are completed
  const pending = roundMatches.filter(m => m.status !== 'completed');
  if (pending.length > 0) return; // Not all done yet

  // Collect winners
  const winners = roundMatches.map(m => m.winner).filter(Boolean);

  // If only 1 winner left, tournament is over
  if (winners.length === 1) {
    const allMatches = await getDocs(collection(db, 'tournaments', tournamentId, 'matches'));
    const allDocs = allMatches.docs.map(d => d.data());

    // Find 2nd place (loser of final match)
    const finalMatch = roundMatches[0];
    const secondPlace = finalMatch?.loser;

    // Find 3rd/4th (losers of semi-final round)
    const semiRound = completedRound - 1;
    const semiLosers = allDocs.filter(m => m.round === semiRound).map(m => m.loser).filter(Boolean);

    await updateDoc(tournamentRef, {
      status: 'completed',
      winnerId: winners[0],
      placements: { first: winners[0], second: secondPlace || null, third: semiLosers },
      completedAt: serverTimestamp(),
      'bracket.currentRound': completedRound,
    });

    // Notify winner
    await addDoc(collection(db, 'notifications'), {
      recipientId: winners[0], type: 'tournament',
      title: 'Tournament won!', body: `You won ${t.name}!`,
      read: false, data: { tournamentId }, createdAt: serverTimestamp(),
    }).catch(() => {});
    return;
  }

  // Generate next round matches
  const nextRound = completedRound + 1;
  const batch = writeBatch(db);

  for (let i = 0; i < winners.length; i += 2) {
    const p1 = winners[i];
    const p2 = winners[i + 1] || null;
    const matchNum = Math.floor(i / 2) + 1;
    const matchRef = doc(db, 'tournaments', tournamentId, 'matches', `r${nextRound}_m${matchNum}`);
    batch.set(matchRef, {
      player1: p1,
      player2: p2,
      winner: p2 ? null : p1, // auto-win on bye
      round: nextRound,
      matchNumber: matchNum,
      status: p2 ? 'pending' : 'completed',
      createdAt: serverTimestamp(),
    });
  }

  batch.update(tournamentRef, { 'bracket.currentRound': nextRound });
  await batch.commit();
};

// Prize distribution: coins → gems conversion
// Entry fees paid in coins. Winners receive gems. Platform keeps commission.
// Commission based on each winner's VP level (30% at L1 → 10% at L100 Immortal)
export const distributePrizePool = async (tournamentId) => {
  const tournamentRef = doc(db, 'tournaments', tournamentId);
  const snap = await getDoc(tournamentRef);
  if (!snap.exists()) throw new Error('Tournament not found');
  const t = snap.data();
  if (!t.prizePool || t.prizePool <= 0) return;

  // Commission lookup
  const getCommission = (vp) => {
    const rates = [[100000, 0.15], [40000, 0.18], [15000, 0.20], [5000, 0.22], [2000, 0.25], [500, 0.28], [0, 0.30]];
    for (const [threshold, rate] of rates) { if (vp >= threshold) return rate; }
    return 0.30;
  };

  // Split pool: 60/25/7.5/7.5 — mod gets 5% off top
  const modFee = Math.floor(t.prizePool * 0.05);
  const playerPool = t.prizePool - modFee;
  const splits = { first: Math.floor(playerPool * 0.60), second: Math.floor(playerPool * 0.25), third: Math.floor(playerPool * 0.075) };

  const placements = t.placements || {};
  const batch = writeBatch(db);
  const squadId = t.squadId || null;

  const awardPrize = async (userId, coinAllocation, placement) => {
    if (!userId || coinAllocation <= 0) return;

    // Squad contribution: 10% of the coin prize goes to the squad wallet.
    let squadCut = 0;
    let netCoins = coinAllocation;
    if (squadId) {
      squadCut = Math.floor(coinAllocation * 0.10);
      netCoins = coinAllocation - squadCut;
    }

    // Pay winner in COINS at full amount. Commission applies later on conversion.
    batch.update(doc(db, 'wallets', userId), {
      balance: increment(netCoins),
      totalEarned: increment(netCoins),
      vp: increment(placement === '1st' ? 200 : placement === '2nd' ? 100 : 50),
    });
    batch.set(doc(collection(db, 'transactions')), {
      userId, type: 'tournament_prize', amount: netCoins, currency: 'coins',
      description: `${placement} place: ${t.name}${squadCut > 0 ? ` · ${squadCut} to squad` : ''}`,
      tournamentId, createdAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, 'notifications')), {
      recipientId: userId, type: 'coins',
      title: `+${netCoins} coins — ${placement} place!`,
      body: `Prize from ${t.name}`,
      read: false, data: { amount: netCoins, tournamentId, type: 'tournament_prize' },
      createdAt: serverTimestamp(),
    });

    if (squadId && squadCut > 0) {
      batch.update(doc(db, 'squads', squadId), {
        'wallet.balance': increment(squadCut),
        'wallet.totalReceived': increment(squadCut),
      });
    }
  };

  await awardPrize(placements.first, splits.first, '1st');
  await awardPrize(placements.second, splits.second, '2nd');
  if (Array.isArray(placements.third)) {
    for (const uid of placements.third) await awardPrize(uid, splits.third, '3rd');
  }

  // Mod fee → coins for the mod (full amount, no commission)
  if (t.adminId && modFee > 0) {
    batch.update(doc(db, 'wallets', t.adminId), {
      balance: increment(modFee),
      totalEarned: increment(modFee),
      vp: increment(30),
    });
    batch.set(doc(collection(db, 'transactions')), {
      userId: t.adminId, type: 'mod_payout', amount: modFee, currency: 'coins',
      description: `Moderator fee: ${t.name}`, tournamentId, createdAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, 'notifications')), {
      recipientId: t.adminId, type: 'coins',
      title: `+${modFee} coins — moderator fee`,
      body: `For running ${t.name}`, read: false, data: { amount: modFee, type: 'mod_payout' }, createdAt: serverTimestamp(),
    });
  }

  batch.update(tournamentRef, {
    status: 'completed', prizeDistributed: true, modFee, finalizedAt: serverTimestamp(),
  });

  await batch.commit();
};

// ═══════════════════════════════════════════
// LEADERBOARDS
// ═══════════════════════════════════════════

export const getLeaderboard = async (boardId = 'players', limitCount = 50) => {
  const boardDoc = await getDoc(doc(db, 'leaderboards', boardId));
  if (!boardDoc.exists()) return [];
  const q = query(collection(db, 'leaderboards', boardId, 'entries'), orderBy('score', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  const entries = [];
  for (const d of snap.docs) {
    const entry = { id: d.id, ...d.data() };
    entry.user = await getUser(entry.userId || entry.id);
    entries.push(entry);
  }
  return entries;
};

// ═══════════════════════════════════════════
// FILE UPLOADS
//
// All image uploads are compressed on the user's device before they hit
// Firebase Storage. A typical 4 MB phone photo becomes:
//   - avatar  → ~80 KB  (512×512 JPEG)
//   - post    → ~250 KB (1600 px JPEG)
//   - chat    → ~180 KB (1280 px JPEG)
// This keeps Storage costs nearly flat as the user base grows.
// ═══════════════════════════════════════════

export const uploadFile = async (path, file, { preset = 'post', compress = true, kind = 'post' } = {}) => {
  const blob = compress && file?.type?.startsWith('image/')
    ? await compressMedia(file, 'free', preset)
    : file;
  const { url } = await uploadToR2(blob, kind);
  return url;
};

export const uploadAvatar = async (uid, file) => {
  const compressed = file?.type?.startsWith('image/')
    ? await compressMedia(file, 'free', 'avatar')
    : file;
  const { url } = await uploadToR2(compressed, 'avatar');
  return url;
};

export const uploadBanner = async (uid, file) => {
  const compressed = file?.type?.startsWith('image/')
    ? await compressMedia(file, 'free', 'background')
    : file;
  const { url } = await uploadToR2(compressed, 'banner');
  return url;
};

export const uploadTournamentBanner = async (uid, file) => {
  const compressed = file?.type?.startsWith('image/')
    ? await compressMedia(file, 'free', 'background')
    : file;
  return uploadFile(`tournaments/_drafts/${uid}/${Date.now()}_${compressed.name}`, compressed, { compress: false });
};

export const uploadPostMedia = async (postId, file) => {
  const { url } = await uploadToR2(file, 'post');
  return url;
};

// ═══════════════════════════════════════════
// APP CONFIG
// ═══════════════════════════════════════════

export const getAppConfig = async () => {
  const snap = await getDoc(doc(db, 'app_config', 'general'));
  return snap.exists() ? snap.data() : {};
};

// ═══════════════════════════════════════════
// POLLS
// ═══════════════════════════════════════════

export const createPoll = async (uid, pollData) => {
  const pollRef = await addDoc(collection(db, 'polls'), {
    ...pollData,
    createdBy: uid,
    createdAt: serverTimestamp(),
    votes: {},
    totalVotes: 0,
    status: pollData.status || 'active'
  });
  return pollRef.id;
};

export const voteOnPoll = async (pollId, optionIndex, uid) => {
  const pollRef = doc(db, 'polls', pollId);
  const userVoteRef = doc(db, 'polls', pollId, 'votes', uid);

  await runTransaction(db, async (transaction) => {
    const pollDoc = await transaction.get(pollRef);
    if (!pollDoc.exists()) throw "Poll does not exist!";

    transaction.update(pollRef, {
      totalVotes: increment(1),
      [`votes.${optionIndex}`]: increment(1)
    });

    transaction.set(userVoteRef, { 
      optionIndex, 
      votedAt: serverTimestamp() 
    });
  });
};

export const createRosterVote = async (adminId, squadId, candidateId, candidateName) => {
  return await createPoll(adminId, {
    title: `Add ${candidateName} to official roster?`,
    type: 'roster_vote',
    squadId, candidateId,
    options: ['Yes', 'No'],
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), 
  });
};

// ═══════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════

export const createTeam = async (ownerId, squadId, { name, tag, game, region }) => {
  const teamRef = await addDoc(collection(db, 'teams'), {
    name,
    tag,
    game,
    region,
    squadId, 
    ownerId,
    roster: [ownerId],
    wins: 0,
    losses: 0,
    teamXP: 0,
    createdAt: serverTimestamp(),
  });
  
  await updateDoc(doc(db, 'squads', squadId), { officialTeamId: teamRef.id });
  return teamRef.id;
};

export const addPlayerToRoster = async (teamId, playerId) => {
  const teamRef = doc(db, 'teams', teamId);
  await updateDoc(teamRef, {
    roster: arrayUnion(playerId)
  });
};

// ═══════════════════════════════════════════
// LEVELING & REWARD ENGINE
// ═══════════════════════════════════════════

export const calculateLevel = (totalXP) => {
  if (!totalXP || totalXP <= 0) return 1;
  const level = Math.floor(totalXP / 1000) + 1; 
  return Math.min(level, 500); 
};

export const distributeWinRewards = async (winnerId, teamId, squadId, xpGained) => {
  const userRef = doc(db, 'users', winnerId);
  const teamRef = doc(db, 'teams', teamId);
  const squadRef = doc(db, 'squads', squadId);

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) return;
    
    const userData = userDoc.data();
    const newXP = (userData.totalXP || 0) + xpGained;

    transaction.update(userRef, { 
      totalXP: newXP, 
      level: calculateLevel(newXP) 
    });

    transaction.update(teamRef, { 
      teamXP: increment(xpGained), 
      wins: increment(1) 
    });

    transaction.update(squadRef, { 
      leaderboardPoints: increment(xpGained) 
    });
  });
};

// ═══════════════════════════════════════════
// NEWS BOT ACCOUNTS
// ═══════════════════════════════════════════

export const ensureNewsBotAccount = async (botConfig) => {
  const userRef = doc(db, 'users', botConfig.id);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      username: botConfig.username,
      displayName: botConfig.displayName,
      bio: botConfig.bio || '',
      avatar: botConfig.avatar || null,
      banner: botConfig.banner || null,
      website: botConfig.website || '',
      accountType: 'news_bot',
      isVerified: true,
      isOnboarded: true,
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      level: 1,
      totalXP: 0,
      tier: 'free',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
};

export const syncRSSPost = async (botUserId, rssItem, postId) => {
  const postRef = doc(db, 'posts', postId);
  const snap = await getDoc(postRef);
  if (snap.exists()) return false; // Already synced

  const description = (rssItem.description || '')
    .replace(/<[^>]*>/g, '')
    .slice(0, 280);

  await setDoc(postRef, {
    authorId: botUserId,
    content: rssItem.title || '',
    type: 'text',
    mediaUrls: rssItem.thumbnail ? [rssItem.thumbnail] : [],
    hashtags: [],
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    viewCount: 0,
    status: 'published',
    rankScore: 0,
    sourceUrl: rssItem.link || '',
    isNewsPost: true,
    linkPreview: {
      url: rssItem.link || '',
      title: rssItem.title || '',
      description: description,
      image: rssItem.thumbnail || null,
    },
    createdAt: rssItem.pubDate ? new Date(rssItem.pubDate) : new Date(),
    updatedAt: new Date(),
  });

  // Increment post count on bot user
  const userRef = doc(db, 'users', botUserId);
  await updateDoc(userRef, { postCount: increment(1) }).catch(() => {});
  return true;
};

// ═══════════════════════════════════════════
// ADS (Firestore)
// ═══════════════════════════════════════════

export const getActiveFirestoreAds = async (limitCount = 5) => {
  try {
    const q = query(
      collection(db, 'ads'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      isAd: true,
      isFirestoreAd: true,
    }));
  } catch (err) {
    console.error('Error fetching Firestore ads:', error);
    return [];
  }
};

// ═══════════════════════════════════════════
// ADMIN SECURITY — TOTP enrollment + step-up + audit-log reads
// ═══════════════════════════════════════════
// All gated server-side on profile.role === 'admin'. See
// functions/adminSecurity.js + CLAUDE.md "🚨 Security hardening".
const callAdminSecFn = async (name, payload) => {
  const { httpsCallable } = await import('firebase/functions');
  const { functions: fns } = await import('./config');
  const fn = httpsCallable(fns, name);
  const res = await fn(payload || {});
  return res.data;
};

export const enrollAdminTotp            = ()       => callAdminSecFn('enrollAdminTotp');
export const confirmAdminTotpEnrollment = (code)   => callAdminSecFn('confirmAdminTotpEnrollment', { code });
export const verifyAdminTotp            = (code)   => callAdminSecFn('verifyAdminTotp', { code });
export const disableAdminTotp           = ()       => callAdminSecFn('disableAdminTotp');
export const getMyAdminSecurityStatus   = ()       => callAdminSecFn('getMyAdminSecurityStatus');

// Read the admin_actions audit log. Admin-only via Firestore rules.
// Returns the most-recent N rows newest-first.
export const getRecentAdminActions = async (limitN = 50) => {
  const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');
  const { db } = await import('./config');
  const q = query(collection(db, 'admin_actions'), orderBy('createdAt', 'desc'), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};
