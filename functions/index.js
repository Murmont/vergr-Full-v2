const { getFirestore } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const functionsV1 = require('firebase-functions/v1');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
functions.setGlobalOptions({ region: 'europe-west1' });
const db = getFirestore('vgrdb');

// KYC module — exports its own callables and a purge helper.
const kyc = require('./kyc');
exports.reviewKyc = kyc.reviewKyc;
exports.decideKyc = kyc.decideKyc;
exports.scheduledKycRetention = kyc.scheduledKycRetention;

// Economy — server-side coin→gem conversion + shared rate-limit helpers.
const economy = require('./economy');
exports.convertCoinsToGems = economy.convertCoinsToGems;

// R2 media storage — presigned upload URLs + cold storage demotion.
const r2 = require('./r2');
exports.getR2UploadUrl     = r2.getR2UploadUrl;
exports.coldStorageDemotion = r2.coldStorageDemotion;

// NOWPayments — coin purchases (invoices) + gem withdrawals (payouts).
const np = require('./nowpayments');
exports.createPurchaseInvoice  = np.createPurchaseInvoice;
exports.nowpaymentsIpn         = np.nowpaymentsIpn;
exports.getPayoutQuote         = np.getPayoutQuote;
exports.confirmPayout          = np.confirmPayout;
exports.listPayoutCurrencies   = np.listPayoutCurrencies;

// ── PLAN ECONOMY (mirrors src/utils/tierSystem.js + vpSystem.js) ──
const PLAN_VP_MULT = { free: 1, lite: 1.5, pro: 2 };
const MONTHLY_VP_BONUS = { free: 0, lite: 1000, pro: 3000 };
const MONTHLY_COIN_BONUS = { free: 0, lite: 50, pro: 150 };
const applyVPMultiplier = (base, plan) => Math.round(base * (PLAN_VP_MULT[plan] || 1));
const getUserPlan = async (uid) => {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? (snap.data().tier || snap.data().plan || 'free') : 'free';
  } catch { return 'free'; }
};

// ──────────────────────────────────────────────────────────────
// 1. LINK PREVIEW
// ──────────────────────────────────────────────────────────────
exports.getLinkPreviewV2 = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const response = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)' } });
    const $ = cheerio.load(response.data);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || url;
    const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    const image = $('meta[property="og:image"]').attr('content') || '';
    const resolvedImage = image ? new URL(image, url).href : '';
    return res.json({ title: title.trim(), description: description.trim(), image: resolvedImage, url });
  } catch (error) {
    console.error('Link preview error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch preview' });
  }
});

// ──────────────────────────────────────────────────────────────
// 2. RSS PROXY – fetch any RSS/Atom feed and return JSON (improved)
// ──────────────────────────────────────────────────────────────
exports.rssProxy = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const feedUrl = req.query.url;
  if (!feedUrl) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    const decodedUrl = decodeURIComponent(feedUrl);
    console.log(`Fetching RSS: ${decodedUrl}`);
    
    const response = await axios.get(decodedUrl, {
      timeout: 15000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      maxRedirects: 5
    });
    
    const xml = response.data;
    
    // Try to parse as XML
    let $;
    try {
      $ = cheerio.load(xml, { xmlMode: true });
    } catch (parseErr) {
      console.error(`XML parse error for ${decodedUrl}:`, parseErr.message);
      res.json({ items: [] });
      return;
    }

    const items = [];
    // Support both RSS (<item>) and Atom (<entry>)
    const feedItems = $('item').length ? $('item') : $('entry');
    
    if (feedItems.length === 0) {
      console.warn(`No items found in feed: ${decodedUrl}`);
      res.json({ items: [] });
      return;
    }

    feedItems.each((i, elem) => {
      try {
        const $item = $(elem);
        let title = $item.find('title').text();
        let link = $item.find('link').text();
        let pubDate = $item.find('pubDate').text() || $item.find('published').text() || $item.find('updated').text();
        let rawContent = $item.find('description').text() || $item.find('content\\:encoded').text() || $item.find('content').text() || $item.find('summary').text();
        let thumbnail = null;
        let youtubeVideoId = null;

        // For Atom feeds, link might be in href attribute
        if (!link) {
          const linkTag = $item.find('link');
          if (linkTag.attr('href')) link = linkTag.attr('href');
        }

        // --- Extract YouTube video ID from iframes/embeds in content ---
        const ytIframeMatch = rawContent.match(/(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytIframeMatch) {
          youtubeVideoId = ytIframeMatch[1];
        }
        // Also check for youtube.com/watch links in the content
        if (!youtubeVideoId) {
          const ytLinkMatch = rawContent.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (ytLinkMatch) youtubeVideoId = ytLinkMatch[1];
        }
        // Check media:content for video
        const mediaVideo = $item.find('media\\:content[medium="video"], media\\:content[type^="video"]');
        if (!youtubeVideoId && mediaVideo.attr('url')) {
          const mvMatch = mediaVideo.attr('url').match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (mvMatch) youtubeVideoId = mvMatch[1];
        }

        // --- Extract thumbnail (try multiple sources) ---
        const enclosure = $item.find('enclosure');
        if (enclosure.attr('url') && enclosure.attr('type')?.startsWith('image/')) {
          thumbnail = enclosure.attr('url');
        }
        // media:content with medium=image
        if (!thumbnail) {
          const mediaImg = $item.find('media\\:content[medium="image"]');
          if (mediaImg.attr('url')) thumbnail = mediaImg.attr('url');
        }
        // media:content with image type
        if (!thumbnail) {
          const mediaImgType = $item.find('media\\:content[type^="image"]');
          if (mediaImgType.attr('url')) thumbnail = mediaImgType.attr('url');
        }
        // media:content without type qualifier (common in many feeds)
        if (!thumbnail) {
          const mediaAny = $item.find('media\\:content');
          if (mediaAny.attr('url') && !mediaAny.attr('type')?.startsWith('video')) {
            thumbnail = mediaAny.attr('url');
          }
        }
        // media:thumbnail
        const mediaThumb = $item.find('media\\:thumbnail');
        if (!thumbnail && mediaThumb.attr('url')) {
          thumbnail = mediaThumb.attr('url');
        }
        // First <img> in raw content — try both double and single quotes, and data-src
        if (!thumbnail && rawContent) {
          const imgMatch = rawContent.match(/<img[^>]+src=["']([^"'>]+)["']/);
          if (imgMatch) thumbnail = imgMatch[1];
        }
        if (!thumbnail && rawContent) {
          const dataSrcMatch = rawContent.match(/<img[^>]+data-src=["']([^"'>]+)["']/);
          if (dataSrcMatch) thumbnail = dataSrcMatch[1];
        }
        // Try <figure> or <picture> source
        if (!thumbnail && rawContent) {
          const sourceMatch = rawContent.match(/<source[^>]+srcset=["']([^\s"'>]+)/);
          if (sourceMatch) thumbnail = sourceMatch[1];
        }
        // Use YouTube thumbnail if we found a video but no image
        if (!thumbnail && youtubeVideoId) {
          thumbnail = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;
        }

        // --- Extract paragraph text (up to 1000 chars) for preview ---
        let paragraphText = '';
        try {
          const $content = cheerio.load(rawContent);
          // Gather text from <p> tags
          $content('p').each((_, p) => {
            if (paragraphText.length < 1000) {
              const pText = $content(p).text().trim();
              if (pText.length > 15) {
                paragraphText += (paragraphText ? ' ' : '') + pText;
              }
            }
          });
          // Fallback: strip all tags if no paragraphs found
          if (!paragraphText) {
            paragraphText = rawContent.replace(/<[^>]*>/g, '').trim();
          }
        } catch {
          paragraphText = rawContent.replace(/<[^>]*>/g, '').trim();
        }

        title = title.trim();

        if (title || link) {
          items.push({
            title: title || 'Untitled',
            link: link || '#',
            pubDate: pubDate || new Date().toUTCString(),
            description: paragraphText.slice(0, 1000),
            thumbnail: thumbnail || null,
            youtubeVideoId: youtubeVideoId || null,
          });
        }
      } catch (itemErr) {
        console.error(`Error parsing RSS item:`, itemErr.message);
      }
    });

    console.log(`RSS proxy success: ${items.length} items from ${decodedUrl}`);
    res.json({ items });
  } catch (err) {
    console.error(`RSS proxy error for ${feedUrl}:`, err.message);
    // Return empty array on error to avoid breaking frontend
    res.status(200).json({ items: [], error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// 3. DAILY LOGIN — 5 consecutive days to earn 25 coins
// ──────────────────────────────────────────────────────────────
exports.claimDailyReward = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const walletRef = db.collection('wallets').doc(uid);

  return db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const currentBalance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    const currentEarned = walletSnap.exists ? (walletSnap.data().totalEarned || 0) : 0;
    const currentStreak = walletSnap.exists ? (walletSnap.data().dailyStreak || 0) : 0;
    const lastCheckIn = walletSnap.exists ? walletSnap.data().lastDailyCheckIn : null;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (lastCheckIn) {
      const lastDate = lastCheckIn.toDate ? lastCheckIn.toDate() : new Date(lastCheckIn);
      if (lastDate.toISOString().slice(0, 10) === today) {
        throw new functions.https.HttpsError('already-exists', 'Already checked in today');
      }
    }

    let newStreak = 1;
    if (lastCheckIn) {
      const lastDate = lastCheckIn.toDate ? lastCheckIn.toDate() : new Date(lastCheckIn);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastDate.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10)) {
        newStreak = currentStreak + 1;
      }
    }

    const plan = walletSnap.exists ? (walletSnap.data().tier || 'free') : 'free';
    let reward = 0;
    let vpReward = applyVPMultiplier(10, plan);
    let streakToSave = newStreak;
    if (newStreak >= 5) {
      reward = 5;
      vpReward = applyVPMultiplier(50, plan);
      streakToSave = 0;
    }

    const walletData = {
      balance: currentBalance + reward,
      totalEarned: currentEarned + reward,
      vp: (walletSnap.exists ? (walletSnap.data().vp || 0) : 0) + vpReward,
      totalSpent: walletSnap.exists ? (walletSnap.data().totalSpent || 0) : 0,
      gems: walletSnap.exists ? (walletSnap.data().gems || 0) : 0,
      totalGemsEarned: walletSnap.exists ? (walletSnap.data().totalGemsEarned || 0) : 0,
      totalReceived: walletSnap.exists ? (walletSnap.data().totalReceived || 0) : 0,
      totalTipped: walletSnap.exists ? (walletSnap.data().totalTipped || 0) : 0,
      tier: walletSnap.exists ? (walletSnap.data().tier || 'free') : 'free',
      lastDailyCheckIn: now,
      dailyStreak: streakToSave,
      updatedAt: now,
      ...(!walletSnap.exists ? { createdAt: now } : {}),
    };
    tx.set(walletRef, walletData);

    const claimId = `${uid}_daily_login_${today}`;
    tx.set(db.collection('quest_claims').doc(claimId), {
      userId: uid, questId: 'daily_login', amount: reward, claimedAt: now,
    });

    if (reward > 0) {
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'daily_reward', amount: reward, currency: 'coins',
        description: `5-day streak: +${reward} coins + ${vpReward} VP`, createdAt: now,
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'coins',
        title: `+${reward} coins + ${vpReward} VP — 5-day streak!`,
        body: 'Streak reset — start again tomorrow!',
        read: false, data: { amount: reward, vp: vpReward, type: 'daily_reward' }, createdAt: now,
      });
    }

    return { 
      reward, vpReward,
      streak: newStreak >= 5 ? 0 : newStreak, 
      dayOfStreak: newStreak >= 5 ? 5 : newStreak,
      paid: reward > 0,
      message: reward > 0 
        ? `+${reward} coins + ${vpReward} VP! Streak complete!` 
        : `Day ${newStreak}/5 — +${vpReward} VP · ${5 - newStreak} more day${5 - newStreak === 1 ? '' : 's'} for coins`
    };
  });
});

// ──────────────────────────────────────────────────────────────
// 4. QUEST REWARD CLAIM (callable)
// ──────────────────────────────────────────────────────────────
exports.claimQuestReward = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const { questId, title } = request.data || {};
  let reward = request.data?.reward;
  if (!questId || typeof reward !== 'number') throw new functions.https.HttpsError('invalid-argument', 'questId and reward required');
  // Reward cap bumped from 500 → 5000 to accommodate the new referral payouts.
  // The server overrides the value for gated quests (refer_friend, etc.) so
  // the client can't inflate the number by sending a bigger reward claim.
  if (reward <= 0 || reward > 5000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid reward amount');
  }

  if (questId === 'daily_login') {
    throw new functions.https.HttpsError('invalid-argument', 'Use the daily login banner');
  }

  const today = new Date().toISOString().split('T')[0];
  const isOneTime = ['first_squad', 'first_tournament', 'creator_content'].includes(questId);
  // `refer_friend` is special: one claim *per friend*, not one per referrer.
  // We key on both uids so the same referrer can claim multiple invites.
  const claimId = questId === 'refer_friend'
    ? `${uid}_refer_friend_${request.data?.friendId || 'missing'}`
    : isOneTime
      ? `${uid}_${questId}`
      : `${uid}_${questId}_${today}`;
  const claimRef = db.collection('quest_claims').doc(claimId);
  const walletRef = db.collection('wallets').doc(uid);

  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists) throw new functions.https.HttpsError('already-exists', 'Already claimed');

    // Server-side validation for refer_friend
    // ─────────────────────────────────────────
    // Completion criteria (all required):
    //   1. friend's user doc exists and isn't soft-deleted
    //   2. friend has a phoneHash (phone number saved)
    //   3. friend has EITHER joined a squad OR subscribed to Lite/Pro
    //   4. friend's `referredBy` matches the caller (uid). This is set at
    //      signup when the invitee lands via `?ref=<uid>`.
    //
    // Payouts:
    //   • Referrer: +5000 VP (rewards the person who brought the user in)
    //   • Referred friend: +3000 VP (welcome bonus to encourage completion)
    let referralFriendId = null;
    if (questId === 'refer_friend') {
      const { friendId } = request.data;
      if (!friendId || friendId === uid) throw new functions.https.HttpsError('invalid-argument', 'friendId required');
      referralFriendId = friendId;

      const friendSnap = await tx.get(db.collection('users').doc(friendId));
      if (!friendSnap.exists || friendSnap.data().deleted) {
        throw new functions.https.HttpsError('failed-precondition', 'Invited user no longer exists');
      }
      const friend = friendSnap.data();
      if (friend.referredBy !== uid) {
        throw new functions.https.HttpsError('failed-precondition',
          'That user wasn\'t referred by you. They must sign up via your invite link.');
      }
      if (!friend.phoneHash) {
        throw new functions.https.HttpsError('failed-precondition', 'Friend needs to add a phone number first');
      }

      // Either "joined a squad" OR "subscribed to Lite/Pro" unlocks the claim.
      const friendWalletSnap = await tx.get(db.collection('wallets').doc(friendId));
      const friendTier = friendWalletSnap.exists ? (friendWalletSnap.data().tier || 'free') : 'free';
      const hasSub = friendTier === 'lite' || friendTier === 'pro';
      let hasSquad = false;
      if (!hasSub) {
        const squadSnap = await db.collectionGroup('members').where('userId', '==', friendId).limit(1).get();
        hasSquad = !squadSnap.empty;
      }
      if (!hasSub && !hasSquad) {
        throw new functions.https.HttpsError('failed-precondition',
          'Friend needs to join a squad or subscribe to Lite/Pro');
      }

      // Override the reward sent by the client — server is the source of truth.
      reward = 5000;
    }

    if (questId === 'creator_content') {
      const postsSnap = await db.collection('posts')
        .where('authorId', '==', uid)
        .where('status', '==', 'published')
        .orderBy('createdAt', 'desc')
        .limit(50).get();
      const qualifying = postsSnap.docs.filter(d => {
        const data = d.data();
        return (data.likeCount || 0) >= 5 && (data.commentCount || 0) >= 5;
      });
      if (qualifying.length < 10) {
        throw new functions.https.HttpsError('failed-precondition', 
          `Need 10 posts with 5+ likes and 5+ comments. You have ${qualifying.length} qualifying posts.`);
      }
    }

    if (questId === 'first_squad') {
      const squadsSnap = await db.collectionGroup('members')
        .where('userId', '==', uid).limit(1).get();
      if (squadsSnap.empty) throw new functions.https.HttpsError('failed-precondition', 'Join a squad first');
    }

    if (questId === 'first_tournament') {
      const tourneysSnap = await db.collection('tournaments')
        .where('participants', 'array-contains', uid).limit(1).get();
      if (tourneysSnap.empty) throw new functions.https.HttpsError('failed-precondition', 'Enter a tournament first');
    }

    // Pay out — quest rewards are VP ONLY (CLAUDE.md hard rule:
    // "Creator quests award VP only — never coins"). Earlier versions of this
    // function credited `balance` instead of `vp`; that was a bug.
    const walletSnap = await tx.get(walletRef);
    const currentVP = walletSnap.exists ? (walletSnap.data().vp || 0) : 0;

    if (walletSnap.exists) {
      tx.update(walletRef, { vp: currentVP + reward, updatedAt: new Date() });
    } else {
      tx.set(walletRef, {
        balance: 0, gems: 0, vp: reward,
        totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0,
        tier: 'free', dailyStreak: 0, lastDailyCheckIn: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
    }

    tx.set(claimRef, { userId: uid, questId, amount: reward, currency: 'vp', claimedAt: new Date(), ...(referralFriendId && { friendId: referralFriendId }) });
    tx.set(db.collection('transactions').doc(), {
      userId: uid, type: 'quest_reward', amount: reward, currency: 'vp',
      description: title || `Quest: ${questId}`, createdAt: new Date(),
    });
    tx.set(db.collection('notifications').doc(), {
      recipientId: uid, type: 'coins',
      title: `+${reward} VP earned!`,
      body: title || `Quest completed: ${questId}`,
      read: false, data: { amount: reward, currency: 'vp', type: 'quest_reward' }, createdAt: new Date(),
    });

    // refer_friend: also pay the invitee their 3000 VP welcome bonus. Use a
    // distinct claim doc so we don't double-pay if the referrer ever retries.
    if (questId === 'refer_friend' && referralFriendId) {
      const FRIEND_REWARD = 3000; // VP, not coins
      const friendClaimRef = db.collection('quest_claims').doc(`${referralFriendId}_referred_bonus`);
      const friendClaimSnap = await tx.get(friendClaimRef);
      if (!friendClaimSnap.exists) {
        const friendWalletRef = db.collection('wallets').doc(referralFriendId);
        const friendWalletSnap = await tx.get(friendWalletRef);
        const fVP = friendWalletSnap.exists ? (friendWalletSnap.data().vp || 0) : 0;
        if (friendWalletSnap.exists) {
          tx.update(friendWalletRef, { vp: fVP + FRIEND_REWARD, updatedAt: new Date() });
        } else {
          tx.set(friendWalletRef, {
            balance: 0, gems: 0, vp: FRIEND_REWARD,
            totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0,
            tier: 'free', dailyStreak: 0, lastDailyCheckIn: null,
            createdAt: new Date(), updatedAt: new Date(),
          });
        }
        tx.set(friendClaimRef, { userId: referralFriendId, questId: 'referred_bonus', amount: FRIEND_REWARD, currency: 'vp', claimedAt: new Date(), referrerId: uid });
        tx.set(db.collection('transactions').doc(), {
          userId: referralFriendId, type: 'quest_reward', amount: FRIEND_REWARD, currency: 'vp',
          description: 'Referral bonus — thanks for joining!', createdAt: new Date(),
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: referralFriendId, type: 'coins',
          title: `+${FRIEND_REWARD} VP referral bonus!`,
          body: 'You completed your VERGR setup — here\'s your welcome reward.',
          read: false, data: { amount: FRIEND_REWARD, type: 'quest_reward' }, createdAt: new Date(),
        });
      }
    }

    return { reward, questId, friendReward: questId === 'refer_friend' ? 3000 : 0 };
  });
});

// ──────────────────────────────────────────────────────────────
// 4b. PHONE NUMBER — save + award one-time VP, and match contacts
// ──────────────────────────────────────────────────────────────
// The client submits an E.164 phone string. We:
//   • normalize + sha-256 hash it server-side (never trust client-sent hash)
//   • store `phone` (raw, owner-readable) and `phoneHash` (used for lookup)
//   • award 100 VP once via quest-claim `${uid}_add_phone`
//
// `matchContactHashes` takes an array of sha-256 hex hashes (generated in the
// browser from the user's picked phone contacts via SubtleCrypto) and
// returns which of those match registered VERGR users. We require the caller
// to have saved their own phone first — this prevents drive-by enumeration
// of the user base from a logged-in account that never added its number.
const crypto = require('crypto');

function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Accept "+<digits>" (E.164) with 8–15 total digits. We strip spaces,
  // dashes, parens; we do NOT try to infer country codes.
  const cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (!/^\+\d{8,15}$/.test(cleaned)) return null;
  return cleaned;
}

function hashPhone(normalized) {
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

exports.savePhoneNumber = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const normalized = normalizePhone(request.data?.phone);
  if (!normalized) {
    throw new functions.https.HttpsError('invalid-argument',
      'Phone must be in E.164 format (e.g. +441234567890).');
  }
  const phoneHash = hashPhone(normalized);

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('wallets').doc(uid);
  const claimRef = db.collection('quest_claims').doc(`${uid}_add_phone`);

  const PHONE_ADD_REWARD = 1000; // VP awarded once, when the first phone is saved

  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    const alreadyClaimed = claimSnap.exists;

    tx.update(userRef, { phone: normalized, phoneHash, updatedAt: new Date() });

    // One-time VP grant — only on the first ever save. Later edits won't
    // re-award, but they do update the hash so contact matching keeps working.
    if (!alreadyClaimed) {
      const walletSnap = await tx.get(walletRef);
      const bal = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
      const earned = walletSnap.exists ? (walletSnap.data().totalEarned || 0) : 0;
      if (walletSnap.exists) {
        tx.update(walletRef, { balance: bal + PHONE_ADD_REWARD, totalEarned: earned + PHONE_ADD_REWARD, updatedAt: new Date() });
      } else {
        tx.set(walletRef, {
          balance: PHONE_ADD_REWARD, totalEarned: PHONE_ADD_REWARD, totalSpent: 0, totalReceived: 0, totalTipped: 0,
          tier: 'free', dailyStreak: 0, lastDailyCheckIn: null, createdAt: new Date(), updatedAt: new Date(),
        });
      }
      tx.set(claimRef, { userId: uid, questId: 'add_phone', amount: PHONE_ADD_REWARD, claimedAt: new Date() });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'quest_reward', amount: PHONE_ADD_REWARD,
        description: 'Added phone number', createdAt: new Date(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'coins',
        title: `+${PHONE_ADD_REWARD} VP earned!`,
        body: 'Phone number added — invite your contacts to earn more.',
        read: false, data: { amount: PHONE_ADD_REWARD, type: 'quest_reward' }, createdAt: new Date(),
      });
    }

    return { phone: normalized, awarded: !alreadyClaimed ? PHONE_ADD_REWARD : 0 };
  });
});

exports.matchContactHashes = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  // Gate: the caller must have saved their own phone. Prevents a random
  // account from batch-hashing leaked phone lists and enumerating who's on
  // VERGR. This also matches the "add phone → can invite contacts" UX.
  const meSnap = await db.collection('users').doc(uid).get();
  if (!meSnap.exists || !meSnap.data().phoneHash) {
    throw new functions.https.HttpsError('failed-precondition',
      'Add your own phone number before matching contacts.');
  }

  const hashes = Array.isArray(request.data?.hashes) ? request.data.hashes : [];
  // Cap the batch so one call can't scan the whole user base.
  const cleanHashes = hashes
    .filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))
    .slice(0, 300);
  if (cleanHashes.length === 0) return { matches: [] };

  const chunks = [];
  for (let i = 0; i < cleanHashes.length; i += 10) chunks.push(cleanHashes.slice(i, i + 10));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const snap = await db.collection('users').where('phoneHash', 'in', chunk).get();
    return snap.docs.map(d => ({
      uid: d.id,
      data: d.data(),
    }));
  }));
  const rawMatches = results.flat().filter(m => m.uid !== uid);

  // Respect each matched user's phone visibility setting. Values:
  //   'public'    → always visible
  //   'contacts'  → visible only if the caller follows or is followed by them
  //   'selected'  → visible only if caller's uid is in phoneVisibilityAllowList
  //   'hidden'    → never visible via contact match
  // Default to 'public' if the field isn't set (back-compat for early users).
  const filtered = [];
  await Promise.all(rawMatches.map(async (m) => {
    const vis = m.data.phoneVisibility || 'public';
    if (vis === 'hidden') return;
    if (vis === 'selected') {
      const list = Array.isArray(m.data.phoneVisibilityAllowList) ? m.data.phoneVisibilityAllowList : [];
      if (!list.includes(uid)) return;
    }
    if (vis === 'contacts') {
      // Either direction satisfies "is a contact": caller follows them, or
      // they follow caller. One doc check each; parallel.
      const [a, b] = await Promise.all([
        db.collection('follows').doc(`${uid}_${m.uid}`).get(),
        db.collection('follows').doc(`${m.uid}_${uid}`).get(),
      ]);
      if (!a.exists && !b.exists) return;
    }
    filtered.push({
      uid: m.uid,
      phoneHash: m.data.phoneHash,
      username: m.data.username || '',
      displayName: m.data.displayName || '',
      avatar: m.data.avatar || '',
    });
  }));

  return { matches: filtered };
});

// ──────────────────────────────────────────────────────────────
// 5. ENGAGEMENT REWARD — post liked → author gets 2 VP (skip news bots)
// ──────────────────────────────────────────────────────────────
exports.onPostLiked = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}/likes/{userId}', database: 'vgrdb' }, async (event) => {
    const postId = event.params.postId;
    const likerId = event.params.userId;
    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (!postSnap.exists) return;
      const authorId = postSnap.data().authorId;

      // Skip if author is a news bot (starts with "news-") – they don't earn VP
      if (authorId && authorId.startsWith('news-')) return;

      if (authorId === likerId) return;

      const today = new Date().toISOString().slice(0, 10);
      const capRef = db.collection('wallets').doc(authorId).collection('daily_caps').doc(today);
      const capSnap = await capRef.get();
      const authorPlan = await getUserPlan(authorId);
      const likerPlan = await getUserPlan(likerId);
      const authorVP = applyVPMultiplier(2, authorPlan);
      const likerVP = applyVPMultiplier(1, likerPlan);
      if ((capSnap.exists ? (capSnap.data().likeVP || 0) : 0) < 40) {
        await db.collection('wallets').doc(authorId).update({ vp: admin.firestore.FieldValue.increment(authorVP) });
        await capRef.set({ likeVP: admin.firestore.FieldValue.increment(authorVP) }, { merge: true });
      }
      await db.collection('wallets').doc(likerId).update({ vp: admin.firestore.FieldValue.increment(likerVP) }).catch(() => {});

      const liker = await db.collection('users').doc(likerId).get();
      const likerName = liker.exists ? (liker.data().displayName || 'Someone') : 'Someone';
      await db.collection('notifications').add({
        recipientId: authorId, type: 'like', title: 'Post liked', body: `${likerName} liked your post`,
        senderId: likerId, data: { postId }, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await sendPushToUser(authorId, 'Post liked', `${likerName} liked your post`, { type: 'like', postId });
    } catch (error) {
      console.error('onPostLiked error:', error);
    }
  });

// ──────────────────────────────────────────────────────────────
// 6. MONTHLY TIER REWARDS (1st of month)
// ──────────────────────────────────────────────────────────────
// [Removed] monthlyTierRewards — superseded by payMonthlyPlanBonus (see bottom of file).
// The new function pays the updated amounts (50/150 coins + 1,000/3,000 VP) and is idempotent
// via quest_claims/{uid}_plan_bonus_{YYYY-MM}.

// ──────────────────────────────────────────────────────────────
// 7. ADMIN ANNOUNCEMENT
// ──────────────────────────────────────────────────────────────
exports.sendAnnouncement = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { title, body, audience, type, coinReward, actionUrl } = request.data || {};
  if (!title) throw new functions.https.HttpsError('invalid-argument', 'Title required');

  let usersQuery;
  if (audience === 'lite') usersQuery = db.collection('wallets').where('tier', '==', 'lite');
  else if (audience === 'pro') usersQuery = db.collection('wallets').where('tier', '==', 'pro');
  else if (audience === 'paid') usersQuery = db.collection('wallets').where('tier', 'in', ['lite', 'pro']);
  else usersQuery = db.collection('users').select();

  const snap = await usersQuery.get();
  const now = new Date();
  let count = 0;
  let batch = db.batch();

  for (const userDoc of snap.docs) {
    const recipientId = userDoc.id;
    batch.set(db.collection('notifications').doc(), {
      recipientId, type: type || 'system', title, body: body || '',
      read: false, actionUrl: actionUrl || null,
      data: coinReward > 0 ? { amount: coinReward, type: 'admin_reward' } : null, createdAt: now,
    });
    if (coinReward > 0 && type === 'coins') {
      batch.update(db.collection('wallets').doc(recipientId), {
        balance: admin.firestore.FieldValue.increment(coinReward),
        totalEarned: admin.firestore.FieldValue.increment(coinReward),
      });
      batch.set(db.collection('transactions').doc(), {
        userId: recipientId, type: 'admin_reward', amount: coinReward, description: title, createdAt: now,
      });
    }
    count++;
    if (count % 200 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (count % 200 !== 0) await batch.commit();
  sendPushToAll(snap.docs.map(d => d.id), title, body || '', { type: type || 'system' }).catch(() => {});
  return { count, title };
});

// ──────────────────────────────────────────────────────────────
// 8. MONTHLY SQUAD ELECTIONS
// ──────────────────────────────────────────────────────────────
exports.monthlySquadElections = functions.scheduler
  .onSchedule('0 12 1 * *', async () => {
    const squadsSnap = await db.collection('squads').where('memberCount', '>=', 3).get();
    let count = 0;
    for (const squadDoc of squadsSnap.docs) {
      const squad = squadDoc.data();
      try {
        const membersSnap = await db.collection('squads').doc(squadDoc.id).collection('members').get();
        const candidates = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (candidates.length < 3) continue;
        const voteRef = db.collection('squads').doc(squadDoc.id).collection('votes').doc();
        await voteRef.set({
          title: 'Monthly President Election', type: 'election', targetRole: 'president',
          options: candidates.map(c => c.id), voteCounts: {}, voterIds: [], totalVotes: 0,
          status: 'active', isMonthlyElection: true,
          expiresAt: new Date(Date.now() + 72 * 3600000), createdAt: new Date(),
        });
        const batch = db.batch();
        for (const m of candidates) {
          batch.set(db.collection('notifications').doc(), {
            recipientId: m.id, type: 'squad', title: 'Squad Election',
            body: `Monthly president vote is open for ${squad.name}. Cast your vote!`,
            read: false, data: { squadId: squadDoc.id }, createdAt: new Date(),
          });
        }
        await batch.commit();
        count++;
      } catch (err) { console.error(`Election error for ${squadDoc.id}:`, err); }
    }
    console.log(`Created elections for ${count} squads`);
  });

// ──────────────────────────────────────────────────────────────
// 9. RESOLVE EXPIRED VOTES (every 6 hours)
// ──────────────────────────────────────────────────────────────
exports.resolveExpiredVotes = functions.scheduler
  .onSchedule('0 */6 * * *', async () => {
    const now = new Date();
    const squadsSnap = await db.collection('squads').get();
    let resolved = 0;
    for (const squadDoc of squadsSnap.docs) {
      const votesSnap = await db.collection('squads').doc(squadDoc.id).collection('votes')
        .where('status', '==', 'active').get();
      for (const voteDoc of votesSnap.docs) {
        const vote = voteDoc.data();
        const expiresAt = vote.expiresAt?.toDate ? vote.expiresAt.toDate() : new Date(vote.expiresAt);
        if (expiresAt > now) continue;
        try {
          const batch = db.batch();
          const voteCounts = vote.voteCounts || {};
          let winnerIndex = null, maxVotes = 0;
          Object.entries(voteCounts).forEach(([idx, cnt]) => { if (cnt > maxVotes) { maxVotes = cnt; winnerIndex = idx; } });

          batch.update(voteDoc.ref, { status: 'resolved', winnerIndex, resolvedAt: now });

          // --- Handle elect_role (yes/no) votes ---
          if (vote.type === 'elect_role' && winnerIndex !== null && vote.options?.[winnerIndex] === 'Yes' && vote.targetUserId && vote.targetRole) {
            // Remove current holder of this role (if any)
            const currentHolders = await db.collection('squads').doc(squadDoc.id).collection('members')
              .where('role', '==', vote.targetRole).get();
            for (const holder of currentHolders.docs) {
              if (holder.id !== vote.targetUserId) {
                batch.update(holder.ref, { role: 'member' });
              }
            }
            // Assign new role
            const targetMemberRef = db.collection('squads').doc(squadDoc.id).collection('members').doc(vote.targetUserId);
            batch.update(targetMemberRef, { role: vote.targetRole });
            // ✅ Update squad owner if the role is president
            if (vote.targetRole === 'president') {
              batch.update(squadDoc.ref, { ownerId: vote.targetUserId });
            }
            batch.set(db.collection('notifications').doc(), {
              recipientId: vote.targetUserId, type: 'squad',
              title: `You are now ${vote.targetRole.replace('_', ' ')}!`,
              body: `Elected by your squad`,
              read: false, data: { squadId: squadDoc.id }, createdAt: now,
            });
          }

          // --- Handle election (candidate list) votes ---
          if (vote.type === 'election' && vote.targetRole && winnerIndex !== null && vote.options?.[winnerIndex]) {
            const winnerId = vote.options[winnerIndex];
            const holders = await db.collection('squads').doc(squadDoc.id).collection('members')
              .where('role', '==', vote.targetRole).get();
            for (const h of holders.docs) { if (h.id !== winnerId) batch.update(h.ref, { role: 'member' }); }
            batch.update(db.collection('squads').doc(squadDoc.id).collection('members').doc(winnerId), { role: vote.targetRole });
            // ✅ Update squad owner if the role is president
            if (vote.targetRole === 'president') {
              batch.update(squadDoc.ref, { ownerId: winnerId });
            }
            batch.set(db.collection('notifications').doc(), {
              recipientId: winnerId, type: 'squad',
              title: `You are now ${vote.targetRole.replace('_', ' ')}!`,
              body: `Elected by your squad`, read: false, data: { squadId: squadDoc.id }, createdAt: now,
            });
          }

          // --- Handle kick votes ---
          if (vote.type === 'kick' && winnerIndex === '0' && maxVotes > 0 && vote.targetUserId) {
            batch.delete(db.collection('squads').doc(squadDoc.id).collection('members').doc(vote.targetUserId));
            batch.update(squadDoc.ref, {
              memberCount: admin.firestore.FieldValue.increment(-1),
              memberIds: admin.firestore.FieldValue.arrayRemove(vote.targetUserId),
            });
          }

          await batch.commit();
          resolved++;
        } catch (err) { console.error(`Vote resolve error:`, err); }
      }
    }
    if (resolved > 0) console.log(`Resolved ${resolved} expired votes`);
  });

// ──────────────────────────────────────────────────────────────
// PUSH HELPERS
// ──────────────────────────────────────────────────────────────
async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const fcmDoc = await db.collection('users').doc(userId).collection('private').doc('fcm').get();
    if (!fcmDoc.exists) return;
    const tokens = fcmDoc.data()?.tokens || [];
    if (tokens.length === 0) return;
    const user = await db.collection('users').doc(userId).get();
    if (user.exists && user.data()?.settings?.pushNotifications === false) return;
    // Data-only payload — the service worker builds the visible notification
    // from data.title / data.body so we have full control over display + click routing.
    const payload = { ...data, title, body };
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
    });
    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' || r.error?.code === 'messaging/registration-token-not-registered')) invalid.push(tokens[i]);
    });
    if (invalid.length > 0) await db.collection('users').doc(userId).collection('private').doc('fcm').update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) });
  } catch (err) {}
}
async function sendPushToAll(userIds, title, body, data = {}) {
  for (let i = 0; i < userIds.length; i += 10) {
    await Promise.allSettled(userIds.slice(i, i + 10).map(uid => sendPushToUser(uid, title, body, data)));
  }
}

// ──────────────────────────────────────────────────────────────
// NEWS BOT ACCOUNTS — RSS SYNC (runs once per day, max 2 posts/bot)
// ──────────────────────────────────────────────────────────────
// Cost note: each bot is capped at 2 new posts per 24h. Images are
// stored as remote URLs (no Storage usage), so the only cost is the
// Firestore writes for the post documents themselves.

const NEWS_BOT_ACCOUNTS = [
  // Major Gaming News Outlets
  { id: 'news-ign', username: 'ign', displayName: 'IGN', bio: 'IGN is the leading site for PC games, with expert reviews, news, previews, game trailers, cheat codes, wiki guides & walkthroughs.', website: 'https://www.ign.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://feeds.feedburner.com/ign/all' },
  { id: 'news-gamespot', username: 'gamespot', displayName: 'GameSpot', bio: 'GameSpot delivers the best and most comprehensive video game and entertainment coverage.', website: 'https://www.gamespot.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gamespot.com/feeds/mashup/' },
  { id: 'news-kotaku', username: 'kotaku', displayName: 'Kotaku', bio: 'Kotaku is a video game website and blog that covers the gaming industry, gaming culture, and the community surrounding them.', website: 'https://www.kotaku.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://kotaku.com/rss' },
  { id: 'news-polygon', username: 'polygon', displayName: 'Polygon', bio: 'Polygon is a gaming website that covers news, reviews, features, and video content.', website: 'https://www.polygon.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.polygon.com/rss/index.xml' },
  { id: 'news-eurogamer', username: 'eurogamer', displayName: 'Eurogamer', bio: 'Eurogamer is the leading video game website in Europe, covering news, reviews, and features.', website: 'https://www.eurogamer.net', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.eurogamer.net/?format=rss' },
  { id: 'news-destructoid', username: 'destructoid', displayName: 'Destructoid', bio: 'Destructoid is a video game blog that covers gaming news, reviews, and culture.', website: 'https://www.destructoid.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.destructoid.com/feed/' },
  { id: 'news-pcgamer', username: 'pcgamer', displayName: 'PC Gamer', bio: 'PC Gamer is the world\'s best-selling PC gaming magazine, covering news, reviews, and hardware.', website: 'https://www.pcgamer.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.pcgamer.com/rss' },
  { id: 'news-rockpapershotgun', username: 'rockpapershotgun', displayName: 'Rock Paper Shotgun', bio: 'Rock Paper Shotgun is a PC gaming website covering news, reviews, and features.', website: 'https://www.rockpapershotgun.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.rockpapershotgun.com/feed' },
  { id: 'news-vg247', username: 'vg247', displayName: 'VG247', bio: 'VG247 is a video game news website covering all major platforms.', website: 'https://www.vg247.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.vg247.com/feed' },
  { id: 'news-nintendolife', username: 'nintendolife', displayName: 'Nintendo Life', bio: 'Nintendo Life covers all things Nintendo: news, reviews, and features for Switch, 3DS, and more.', website: 'https://www.nintendolife.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.nintendolife.com/feed' },
  { id: 'news-pushsquare', username: 'pushsquare', displayName: 'Push Square', bio: 'Push Square is dedicated to PlayStation news, reviews, and community.', website: 'https://www.pushsquare.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.pushsquare.com/feed' },
  { id: 'news-purexbox', username: 'purexbox', displayName: 'Pure Xbox', bio: 'Pure Xbox covers Xbox news, reviews, and community content.', website: 'https://www.purexbox.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.purexbox.com/feed' },
  // Developer & Publisher Blogs (Official)
  { id: 'news-blizzard', username: 'blizzard', displayName: 'Blizzard News', bio: 'Official news from Blizzard Entertainment: Warcraft, Overwatch, Diablo, and more.', website: 'https://news.blizzard.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.blizzard.com/en-us/news?feed=rss' },
  { id: 'news-xboxwire', username: 'xboxwire', displayName: 'Xbox Wire', bio: 'Official Xbox news, game announcements, and updates.', website: 'https://news.xbox.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.xbox.com/en-us/feed/' },
  { id: 'news-playstation', username: 'playstation', displayName: 'PlayStation Blog', bio: 'Official PlayStation news, game releases, and community updates.', website: 'https://blog.playstation.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://blog.playstation.com/feed/' },
  { id: 'news-ubisoft', username: 'ubisoft', displayName: 'Ubisoft News', bio: 'Official Ubisoft news: game updates, events, and announcements.', website: 'https://news.ubisoft.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.ubisoft.com/en-us/rss' },
  { id: 'news-epicgames', username: 'epicgames', displayName: 'Epic Games News', bio: 'Official Epic Games news: Fortnite, Unreal Engine, and store updates.', website: 'https://www.epicgames.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.epicgames.com/site/en-US/news?lang=en-US&feed=rss' },
  { id: 'news-bethesda', username: 'bethesda', displayName: 'Bethesda Blog', bio: 'Official Bethesda Softworks news: Elder Scrolls, Fallout, Starfield.', website: 'https://bethesda.net', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://bethesda.net/en/dashboard?rss=news' },
  { id: 'news-squareenix', username: 'squareenix', displayName: 'Square Enix News', bio: 'Official Square Enix news: Final Fantasy, Kingdom Hearts, and more.', website: 'https://square-enix-games.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://square-enix-games.com/en-us/news.rss' },
  { id: 'news-cdprojekt', username: 'cdprojekt', displayName: 'CD Projekt Red', bio: 'Official CD Projekt Red news: Cyberpunk 2077, The Witcher.', website: 'https://www.cdprojektred.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.cdprojektred.com/en/news/feed' },
  { id: 'news-valve', username: 'valve', displayName: 'Valve News', bio: 'Official Steam and Valve news.', website: 'https://store.steampowered.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://store.steampowered.com/news/rss/' },
  // Industry & Indie (removed GamesIndustry.biz and Siliconera)
  { id: 'news-gamedeveloper', username: 'gamedeveloper', displayName: 'Game Developer', bio: 'Game Developer (formerly Gamasutra) covers game development, design, and industry trends.', website: 'https://www.gamedeveloper.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gamedeveloper.com/feed' },
  { id: 'news-gematsu', username: 'gematsu', displayName: 'Gematsu', bio: 'Gematsu covers Japanese games, news, and updates.', website: 'https://www.gematsu.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gematsu.com/feed' },
  { id: 'news-bluesnews', username: 'bluesnews', displayName: 'Blue\'s News', bio: 'Blue\'s News: long-standing source for game updates, patches, and industry news.', website: 'https://www.bluesnews.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.bluesnews.com/rss.xml' },
  { id: 'news-itchio', username: 'itchio', displayName: 'itch.io News', bio: 'New indie game releases and updates from itch.io.', website: 'https://itch.io', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://itch.io/games/feed' },
];

// YouTube gaming channels — synced as Shorts (embed-only, zero storage).
const YOUTUBE_SHORTS_BOTS = [
  { id: 'yt-ign', username: 'ign_shorts', displayName: 'IGN Shorts', bio: 'Quick gaming clips from IGN', website: 'https://youtube.com/@IGN', channelId: 'UCKy1dAqELo0zrOtPkf0eTMw' },
  { id: 'yt-gamespot', username: 'gamespot_shorts', displayName: 'GameSpot Shorts', bio: 'Bite-sized gaming highlights from GameSpot', website: 'https://youtube.com/@GameSpot', channelId: 'UCbu2SsF1frCRhGXlSv85E_c' },
  { id: 'yt-nintendo', username: 'nintendo_shorts', displayName: 'Nintendo Shorts', bio: 'Official Nintendo clips and trailers', website: 'https://youtube.com/@NintendoAmerica', channelId: 'UCGIY_O-8vW4rfx98KlMkvRg' },
  { id: 'yt-playstation', username: 'playstation_shorts', displayName: 'PlayStation Shorts', bio: 'Official PlayStation clips', website: 'https://youtube.com/@PlayStation', channelId: 'UC-2Y8dQb0S6DtpxNgAKoJKA' },
  { id: 'yt-xbox', username: 'xbox_shorts', displayName: 'Xbox Shorts', bio: 'Official Xbox clips and highlights', website: 'https://youtube.com/@Xbox', channelId: 'UCXGgrKt94gR6lmN4aN3mYTg' },
  { id: 'yt-riotgames', username: 'riotgames_shorts', displayName: 'Riot Games Shorts', bio: 'LoL, Valorant, and TFT clips from Riot', website: 'https://youtube.com/@riotgames', channelId: 'UC0VmEGa2AAIMKL2HStZMCzA' },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

exports.syncNewsBotFeeds = functions.scheduler
  .onSchedule('0 6 * * *', async () => {
    // STEP 1: Create ALL bot accounts (ignores RSS failures)
    for (const bot of NEWS_BOT_ACCOUNTS) {
      const userRef = db.collection('users').doc(bot.id);
      const snap = await userRef.get();
      if (!snap.exists) {
        await userRef.set({
          username: bot.username,
          displayName: bot.displayName,
          bio: bot.bio,
          avatar: null,
          banner: null,
          website: bot.website,
          accountType: 'news_bot',
          isVerified: true,
          isOnboarded: true,
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
          level: 0,
          totalXP: 0,
          tier: null,
          vp: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ Created bot account: ${bot.id}`);
      }
    }

    // STEP 2: Fetch RSS and sync posts (hard cap: 2 NEW posts per bot per day)
    const PER_BOT_DAILY_LIMIT = 2;
    let totalCreated = 0;
    for (const bot of NEWS_BOT_ACCOUNTS) {
      try {
        const response = await axios.get(bot.rssUrl, { timeout: 10000 });
        // Pull a small candidate window — we only need enough headroom to
        // skip already-ingested items and still find ~2 fresh ones.
        const items = (response.data?.items || []).slice(0, 6);
        let createdForThisBot = 0;
        for (const item of items) {
          if (createdForThisBot >= PER_BOT_DAILY_LIMIT) break;
          if (!item.link) continue;
          const postId = `${bot.id}-${hashString(item.link)}`;
          const postRef = db.collection('posts').doc(postId);
          const postSnap = await postRef.get();
          if (postSnap.exists) continue;

          // Extract image (enclosure, description, thumbnail)
          let imageUrl = null;
          if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image/')) {
            imageUrl = item.enclosure.url;
          } else if (item.description) {
            const imgMatch = item.description.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) imageUrl = imgMatch[1];
          } else if (item.thumbnail) {
            imageUrl = item.thumbnail;
          }
          if (imageUrl && !imageUrl.startsWith('http')) imageUrl = null;

          // Clean preview (first 300 chars of description)
          let cleanPreview = (item.description || '')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
          if (cleanPreview.length === 0) cleanPreview = item.title || '';

          await postRef.set({
            authorId: bot.id,
            content: item.title || '',
            type: 'text',
            mediaUrls: imageUrl ? [imageUrl] : [],
            hashtags: [],
            likeCount: 0,
            commentCount: 0,
            shareCount: 0,
            saveCount: 0,
            viewCount: 0,
            status: 'published',
            rankScore: 0,
            sourceUrl: item.link,
            isNewsPost: true,
            previewText: cleanPreview,
            needsEnrichment: true,
            linkPreview: {
              url: item.link,
              title: item.title || '',
              description: cleanPreview,
              image: imageUrl,
            },
            createdAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            updatedAt: new Date(),
          });

          await db.collection('users').doc(bot.id).update({
            postCount: admin.firestore.FieldValue.increment(1),
          });
          totalCreated++;
          createdForThisBot++;
        }
      } catch (err) {
        console.error(`RSS sync failed for ${bot.id}:`, err.message);
      }
    }
    console.log(`RSS sync complete. Created ${totalCreated} new posts.`);

    // STEP 3: Sync YouTube Shorts (embed-only, zero storage cost)
    let shortsCreated = 0;
    for (const bot of YOUTUBE_SHORTS_BOTS) {
      try {
        // Ensure bot account exists
        const userRef = db.collection('users').doc(bot.id);
        const snap = await userRef.get();
        if (!snap.exists) {
          await userRef.set({
            username: bot.username, displayName: bot.displayName, bio: bot.bio,
            avatar: null, banner: null, website: bot.website,
            accountType: 'shorts_bot', isVerified: true, isOnboarded: true,
            followerCount: 0, followingCount: 0, postCount: 0,
            level: 0, totalXP: 0, tier: null, vp: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=https://www.youtube.com/feeds/videos.xml?channel_id=${bot.channelId}`;
        const response = await axios.get(rssUrl, { timeout: 10000 });
        const items = (response.data?.items || []).slice(0, 6);
        let createdForBot = 0;

        for (const item of items) {
          if (createdForBot >= 2) break;
          if (!item.link) continue;

          // Extract YouTube video ID
          const vidMatch = item.link.match(/[?&]v=([\w-]+)/);
          const videoId = vidMatch ? vidMatch[1] : null;
          if (!videoId) continue;

          const postId = `${bot.id}-${hashString(item.link)}`;
          const postRef = db.collection('posts').doc(postId);
          const postSnap = await postRef.get();
          if (postSnap.exists) continue;

          await postRef.set({
            authorId: bot.id,
            content: item.title || '',
            type: 'short',
            mediaUrls: [],
            hashtags: [],
            embedVideoUrl: item.link,
            youtubeVideoId: videoId,
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, viewCount: 0,
            status: 'published',
            rankScore: 0,
            sourceUrl: item.link,
            isNewsPost: true,
            createdAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            updatedAt: new Date(),
          });
          await userRef.update({ postCount: admin.firestore.FieldValue.increment(1) });
          shortsCreated++;
          createdForBot++;
        }
      } catch (err) {
        console.error(`YouTube shorts sync failed for ${bot.id}:`, err.message);
      }
    }
    console.log(`YouTube shorts sync complete. Created ${shortsCreated} shorts.`);
  });

// ──────────────────────────────────────────────────────────────
// HELPER: Extract YouTube ID from URL
// ──────────────────────────────────────────────────────────────
function getYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]+)/,
    /(?:youtu\.be\/)([\w-]+)/,
    /(?:youtube\.com\/embed\/)([\w-]+)/,
    /(?:youtube\.com\/v\/)([\w-]+)/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// HELPER: Extract first paragraph or YouTube video from article
// ──────────────────────────────────────────────────────────────
async function extractFirstParagraphOrVideo(url) {
  try {
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentBot/1.0)' } });
    const $ = cheerio.load(response.data);

    // Look for YouTube video
    let youtubeId = null;
    const ogVideo = $('meta[property="og:video"]').attr('content');
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content');
    const twitterPlayer = $('meta[name="twitter:player"]').attr('content');
    if (ogVideo) youtubeId = getYouTubeId(ogVideo);
    if (!youtubeId && ogVideoUrl) youtubeId = getYouTubeId(ogVideoUrl);
    if (!youtubeId && twitterPlayer) youtubeId = getYouTubeId(twitterPlayer);
    if (!youtubeId) {
      $('iframe[src*="youtube.com"]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !youtubeId) youtubeId = getYouTubeId(src);
      });
    }
    if (!youtubeId) {
      $('a[href*="youtube.com/watch"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !youtubeId) youtubeId = getYouTubeId(href);
      });
    }
    if (youtubeId) {
      return { type: 'video', youtubeId };
    }

    // No video – extract first TWO paragraphs so the client always needs a "Read more".
    let paragraphs = [];
    const selectors = ['article p', '.post-content p', '.entry-content p', '.content p', 'main p', 'p'];
    for (const sel of selectors) {
      const found = $(sel);
      if (found.length) {
        found.each((i, el) => {
          if (paragraphs.length >= 2) return;
          const txt = $(el).text().replace(/\s+/g, ' ').trim();
          // Skip short fragments, bylines, image captions
          if (txt.length > 60) paragraphs.push(txt);
        });
        if (paragraphs.length >= 2) break;
      }
    }
    let combined = paragraphs.join('\n\n');
    if (!combined) {
      combined = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1600);
    }
    // Cap at ~1600 chars so the UI always has enough to require a "Read more"
    combined = combined.slice(0, 1600);
    return { type: 'text', text: combined || null };
  } catch (err) {
    console.error(`Error processing ${url}:`, err.message);
    return { type: 'text', text: null };
  }
}

// ──────────────────────────────────────────────────────────────
// ENRICHMENT FUNCTION (runs once per day, right after RSS sync)
// With the per-bot daily cap of 2 posts, ~54 docs/day max — one
// run with a larger batch easily clears the queue.
// ──────────────────────────────────────────────────────────────
exports.enrichNewsPosts = functions.scheduler
  .onSchedule('30 6 * * *', async () => {
    const postsRef = db.collection('posts');
    const batchSize = 25;
    let processed = 0;
    let snapshot = await postsRef.where('needsEnrichment', '==', true).where('sourceUrl', '!=', null).limit(batchSize).get();
    while (!snapshot.empty) {
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        const post = doc.data();
        const url = post.sourceUrl;
        if (!url) continue;
        const result = await extractFirstParagraphOrVideo(url);
        const updateData = { needsEnrichment: false, enrichedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (result.type === 'video') {
          updateData.youtubeVideoId = result.youtubeId;
          updateData.type = 'clip';
          // CRITICAL: clear any stale mediaUrls/mediaUrl left over from the
          // initial ingest (they contained the article hero image and would
          // make PostCard render a broken <video> element on top of the embed).
          updateData.mediaUrls = [];
          updateData.mediaUrl = null;
          // Keep previewText so we still show article text above the video.
        } else if (result.text && result.text.length > 50) {
          updateData.previewText = result.text;
        }
        batch.update(doc.ref, updateData);
        processed++;
      }
      await batch.commit();
      snapshot = await postsRef.where('needsEnrichment', '==', true).where('sourceUrl', '!=', null).limit(batchSize).get();
    }
    console.log(`Enriched ${processed} news posts (videos or paragraphs).`);
  });

// ──────────────────────────────────────────────────────────────
// ONE-TIME BACKFILL: clean up existing news posts that have both
// a youtubeVideoId AND stale mediaUrls causing a ghost video player.
// Also re-enrich any posts whose previewText is still just the title.
// ──────────────────────────────────────────────────────────────
exports.backfillNewsPosts = functions.https.onRequest(async (req, res) => {
  const postsRef = db.collection('posts');
  const snap = await postsRef.where('isNewsPost', '==', true).limit(500).get();
  let cleaned = 0;
  let requeued = 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    const p = d.data();
    const updates = {};
    // 1) Embed posts with stale mediaUrls
    if ((p.youtubeVideoId || p.embedVideoUrl) && (Array.isArray(p.mediaUrls) ? p.mediaUrls.length > 0 : !!p.mediaUrl)) {
      updates.mediaUrls = [];
      updates.mediaUrl = null;
      cleaned++;
    }
    // 2) Posts whose previewText is still just the title or missing —
    //    re-queue for enrichment so they get the 2-paragraph version.
    const pt = (p.previewText || '').trim();
    const title = (p.content || '').trim();
    if (p.sourceUrl && (!pt || pt === title || pt.length < 120)) {
      updates.needsEnrichment = true;
      requeued++;
    }
    if (Object.keys(updates).length > 0) batch.update(d.ref, updates);
  }
  await batch.commit();
  res.status(200).json({ scanned: snap.size, cleaned, requeued });
});

// ──────────────────────────────────────────────────────────────
// MANUAL TRIGGER TO CREATE ALL BOT ACCOUNTS IMMEDIATELY
// ──────────────────────────────────────────────────────────────
exports.createNewsBots = functions.https.onRequest(async (req, res) => {
  let created = 0;
  let existing = 0;

  for (const bot of NEWS_BOT_ACCOUNTS) {
    const userRef = db.collection('users').doc(bot.id);
    const snap = await userRef.get();
    if (!snap.exists) {
      await userRef.set({
        username: bot.username,
        displayName: bot.displayName,
        bio: bot.bio,
        avatar: null,
        banner: null,
        website: bot.website,
        accountType: 'news_bot',
        isVerified: true,
        isOnboarded: true,
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        level: 0,
        totalXP: 0,
        tier: null,
        vp: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    } else {
      existing++;
    }
  }

  res.status(200).send(`✅ Created ${created} new bot accounts. ${existing} already existed.`);
});

// ──────────────────────────────────────────────────────────────
// AUTH TRIGGERS (v1 API — no v2 equivalent for onCreate/onDelete)
// ──────────────────────────────────────────────────────────────

exports.onUserCreated = functionsV1.region('europe-west1').auth.user().onCreate(async (user) => {
  const batch = db.batch();
  batch.set(db.collection('users').doc(user.uid), {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    username: null,
    avatar: user.photoURL || null,
    banner: null,
    bio: '',
    role: 'user',
    verificationTier: null,
    isOnboarded: false,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    coinBalance: 0,
    gameTags: [],
    linkedAccounts: {},
    settings: {
      pushNotifications: true,
      emailNotifications: true,
      dmPrivacy: 'everyone',
      profileVisibility: 'public',
      activityStatus: true,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('wallets').doc(user.uid), {
    userId: user.uid,
    balance: 0,
    gems: 0,
    vp: 0,
    totalEarned: 0,
    totalSpent: 0,
    totalTipped: 0,
    totalReceived: 0,
    totalGemsEarned: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('notifications').doc(), {
    recipientId: user.uid,
    type: 'system',
    title: 'Welcome to VERGR! 🎮',
    body: 'Where Gamers Converge. Complete your profile to get started.',
    read: false,
    actionUrl: '/onboarding',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`New user created: ${user.uid}`);
});

exports.onUserDeleted = functionsV1.region('europe-west1').auth.user().onDelete(async (user) => {
  await db.collection('users').doc(user.uid).update({
    deleted: true,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    displayName: 'Deleted User',
    username: null,
    avatar: null,
    banner: null,
    bio: '',
    email: null,
  });
  // GDPR Article 17 — erase KYC data + encrypted documents
  await kyc.purgeKycForUser(user.uid);
  console.log(`User deleted (soft) + KYC purged: ${user.uid}`);
});

// ──────────────────────────────────────────────────────────────
// FIRESTORE TRIGGERS — NOTIFICATIONS
// ──────────────────────────────────────────────────────────────

exports.onNewFollower = functions.firestore
  .onDocumentCreated({ document: 'follows/{followId}', database: 'vgrdb' }, async (event) => {
    const data = event.data.data();
    const { followerId, followingId } = data;
    try {
      const follower = await db.collection('users').doc(followerId).get();
      const followerName = follower.exists ? (follower.data().displayName || 'Someone') : 'Someone';

      const batch = db.batch();
      batch.update(db.collection('users').doc(followerId), { followingCount: admin.firestore.FieldValue.increment(1) });
      batch.update(db.collection('users').doc(followingId), { followerCount: admin.firestore.FieldValue.increment(1) });
      batch.set(db.collection('notifications').doc(), {
        recipientId: followingId,
        type: 'follow',
        title: 'New follower',
        body: `${followerName} started following you`,
        senderId: followerId,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await sendPushToUser(followingId, 'New follower', `${followerName} started following you`, { type: 'follow', senderId: followerId });
    } catch (err) { console.error('onNewFollower error:', err); }
  });

exports.onNewComment = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}/comments/{commentId}', database: 'vgrdb' }, async (event) => {
    const postId = event.params.postId;
    const comment = event.data.data();
    try {
      const post = await db.collection('posts').doc(postId).get();
      if (!post.exists) return;
      const authorId = post.data().authorId;

      await db.collection('posts').doc(postId).update({ commentCount: admin.firestore.FieldValue.increment(1) });

      if (authorId === comment.authorId) return;

      const commenter = await db.collection('users').doc(comment.authorId).get();
      const commenterName = commenter.exists ? (commenter.data().displayName || 'Someone') : 'Someone';

      await db.collection('notifications').add({
        recipientId: authorId,
        type: 'comment',
        title: 'New comment',
        body: `${commenterName} commented on your post`,
        senderId: comment.authorId,
        data: { postId, commentId: event.params.commentId },
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await sendPushToUser(authorId, 'New comment', `${commenterName}: ${(comment.content || '').substring(0, 100)}`, { type: 'comment', postId });
    } catch (err) { console.error('onNewComment error:', err); }
  });

const MESSAGE_TYPE_LABELS = {
  image: 'a photo', video: 'a video', voice: 'a voice message',
  audio: 'an audio file', giphy: 'a GIF', file: 'a file',
  sticker: 'a sticker', clip: 'a clip', meme: 'a meme',
  location: 'a location', contact: 'a contact', wallet: 'coins',
};

function buildPreview(message) {
  const text = (message.text || message.content || '').substring(0, 100);
  if (text) return text;
  return `Sent ${MESSAGE_TYPE_LABELS[message.type] || 'a message'}`;
}

exports.onNewMessage = functions.firestore
  .onDocumentCreated({ document: 'conversations/{convoId}/messages/{messageId}', database: 'vgrdb' }, async (event) => {
    const convoId = event.params.convoId;
    const message = event.data.data();
    // Skip — relayMessage already handled push + metadata
    if (message._relayed) return;
    try {
      const preview = buildPreview(message);
      await db.collection('conversations').doc(convoId).update({
        lastMessageText: preview,
        lastMessage: preview, // keep old field for backward compat
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageBy: message.senderId,
        lastMessageSenderId: message.senderId,
      });

      const convo = await db.collection('conversations').doc(convoId).get();
      if (!convo.exists) return;

      const participants = convo.data().participants || [];
      const sender = await db.collection('users').doc(message.senderId).get();
      const senderData = sender.exists ? sender.data() : {};
      const senderName = senderData.displayName || 'Someone';
      const senderAvatar = senderData.photoURL || senderData.avatar || senderData.profilePicture || null;

      for (const pid of participants) {
        if (pid === message.senderId) continue;
        await sendPushToUser(pid, senderName, preview, {
          type: 'message',
          conversationId: convoId,
          senderId: message.senderId,
          senderAvatar: senderAvatar || '',
        });
      }
    } catch (err) { console.error('onNewMessage error:', err); }
  });

// ──────────────────────────────────────────────────────────────
// RELAY MESSAGE — single callable that writes message + metadata + push
// Replaces the trigger-based flow for the primary send path. The trigger
// remains as a fallback for direct Firestore writes (e.g. the offline
// outbox falling back when the callable is unreachable).
// ──────────────────────────────────────────────────────────────
exports.relayMessage = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const { chatId, text = '', type = 'text', contentUrl = null, videoUrl = null,
          fileName = null, fileSize = null, fileMime = null, duration = null,
          replyTo = null, contact = null, location = null, wallet = null,
          forwarded = null, thumbnailBase64 = null, stickerUrl = null,
          width = null, height = null, clientId = null } = request.data || {};

  if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'chatId required');

  // 1. Verify participant
  const convoRef = db.collection('conversations').doc(chatId);
  const convo = await convoRef.get();
  if (!convo.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found');
  const participants = convo.data().participants || [];
  if (!participants.includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant');
  }

  // 2. Build message doc (strip nulls to keep Firestore tidy)
  const msgData = {
    senderId: uid,
    text: (text || '').substring(0, 4000),
    type,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _relayed: true,
  };
  if (contentUrl) msgData.contentUrl = contentUrl;
  if (videoUrl) msgData.videoUrl = videoUrl;
  if (fileName) msgData.fileName = fileName;
  if (fileSize) msgData.fileSize = fileSize;
  if (fileMime) msgData.fileMime = fileMime;
  if (duration) msgData.duration = duration;
  if (replyTo) msgData.replyTo = replyTo;
  if (contact) msgData.contact = contact;
  if (location) msgData.location = location;
  if (wallet) msgData.wallet = wallet;
  if (forwarded) msgData.forwarded = forwarded;
  if (thumbnailBase64) msgData.thumbnailBase64 = String(thumbnailBase64).substring(0, 2000);
  if (stickerUrl) msgData.stickerUrl = stickerUrl;
  if (width) msgData.width = width;
  if (height) msgData.height = height;
  if (clientId) msgData.clientId = clientId;

  // 3. Write message
  const msgRef = await convoRef.collection('messages').add(msgData);

  // 4. Update conversation metadata (correct field names the inbox reads)
  const preview = buildPreview(msgData);
  const unreadUpdates = {};
  for (const pid of participants) {
    if (pid !== uid) unreadUpdates[`unreadCount.${pid}`] = admin.firestore.FieldValue.increment(1);
  }
  await convoRef.update({
    lastMessageText: preview,
    lastMessage: preview,
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageSenderId: uid,
    lastMessageBy: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...unreadUpdates,
  });

  // 5. Push to other participants — batched multicast for group efficiency
  try {
    const sender = await db.collection('users').doc(uid).get();
    const senderData = sender.exists ? sender.data() : {};
    const senderName = senderData.displayName || 'Someone';
    const senderAvatar = senderData.photoURL || senderData.avatar || senderData.profilePicture || '';

    // Collect all tokens in parallel
    const otherPids = participants.filter(p => p !== uid);
    const fcmDocs = await Promise.all(
      otherPids.map(pid => db.collection('users').doc(pid).collection('private').doc('fcm').get())
    );
    const userDocs = await Promise.all(
      otherPids.map(pid => db.collection('users').doc(pid).get())
    );

    const allTokens = [];
    const tokenToUser = new Map();
    fcmDocs.forEach((fcmDoc, i) => {
      const pid = otherPids[i];
      const userDoc = userDocs[i];
      if (userDoc.exists && userDoc.data()?.settings?.pushNotifications === false) return;
      const tokens = fcmDoc.exists ? (fcmDoc.data()?.tokens || []) : [];
      for (const t of tokens) {
        allTokens.push(t);
        tokenToUser.set(t, pid);
      }
    });

    if (allTokens.length > 0) {
      const payload = {
        title: senderName,
        body: preview,
        type: 'message',
        conversationId: chatId,
        senderId: uid,
        senderAvatar,
      };
      const response = await admin.messaging().sendEachForMulticast({
        tokens: allTokens,
        data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
      });
      // Clean up invalid tokens in bulk
      const invalidByUser = new Map();
      response.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' ||
                           r.error?.code === 'messaging/registration-token-not-registered')) {
          const pid = tokenToUser.get(allTokens[i]);
          if (!pid) return;
          const arr = invalidByUser.get(pid) || [];
          arr.push(allTokens[i]);
          invalidByUser.set(pid, arr);
        }
      });
      for (const [pid, invalid] of invalidByUser) {
        await db.collection('users').doc(pid).collection('private').doc('fcm')
          .update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) }).catch(() => {});
      }
    }
  } catch (err) { console.error('relayMessage push error:', err); }

  return { messageId: msgRef.id, clientId: clientId || null };
});

/**
 * Hard-delete a message and fan out a 'message_deleted' FCM so every
 * participant's device can purge the message from its Dexie cache. This is
 * critical because onSnapshot listeners scoped to createdAt > lastSync do not
 * fire 'removed' events for older cached-only messages.
 */
exports.deleteMessage = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { chatId, messageId } = request.data || {};
  if (!chatId || !messageId) throw new functions.https.HttpsError('invalid-argument', 'chatId and messageId required');

  const convoRef = db.collection('conversations').doc(chatId);
  const convo = await convoRef.get();
  if (!convo.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found');
  const participants = convo.data().participants || [];
  if (!participants.includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant');
  }

  // Only the sender can delete their own message
  const msgRef = convoRef.collection('messages').doc(messageId);
  const msgSnap = await msgRef.get();
  if (msgSnap.exists) {
    const msgData = msgSnap.data();
    if (msgData.senderId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Only the sender can delete');
    }
    await msgRef.delete();
  }

  // Fan out a silent FCM to every other participant's devices so they can
  // scrub the message from their local cache.
  try {
    const otherPids = participants.filter(p => p !== uid);
    if (otherPids.length > 0) {
      const fcmDocs = await Promise.all(
        otherPids.map(pid => db.collection('users').doc(pid).collection('private').doc('fcm').get())
      );
      const allTokens = [];
      const tokenToUser = new Map();
      fcmDocs.forEach((fcmDoc, i) => {
        const pid = otherPids[i];
        const tokens = fcmDoc.exists ? (fcmDoc.data()?.tokens || []) : [];
        for (const t of tokens) { allTokens.push(t); tokenToUser.set(t, pid); }
      });
      if (allTokens.length > 0) {
        const response = await admin.messaging().sendEachForMulticast({
          tokens: allTokens,
          data: {
            type: 'message_deleted',
            conversationId: String(chatId),
            messageId: String(messageId),
            senderId: String(uid),
          },
        });
        // Clean up invalid tokens
        const invalidByUser = new Map();
        response.responses.forEach((r, i) => {
          if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' ||
                             r.error?.code === 'messaging/registration-token-not-registered')) {
            const pid = tokenToUser.get(allTokens[i]);
            if (!pid) return;
            const arr = invalidByUser.get(pid) || [];
            arr.push(allTokens[i]);
            invalidByUser.set(pid, arr);
          }
        });
        for (const [pid, invalid] of invalidByUser) {
          await db.collection('users').doc(pid).collection('private').doc('fcm')
            .update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) }).catch(() => {});
        }
      }
    }
  } catch (err) { console.error('deleteMessage push error:', err); }

  return { ok: true };
});

exports.autoModCheck = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}', database: 'vgrdb' }, async (event) => {
    const post = event.data.data();
    try {
      const config = await db.collection('app_config').doc('general').get();
      if (!config.exists || !config.data().autoModEnabled) return;

      const bannedDoc = await db.collection('banned_words').doc('list').get();
      const bannedWords = bannedDoc.exists ? (bannedDoc.data().words || []) : [];
      if (bannedWords.length === 0) return;

      const content = (post.content || '').toLowerCase();
      const foundWords = bannedWords.filter(w => content.includes(w.toLowerCase()));

      if (foundWords.length > 0) {
        await event.data.ref.update({
          status: 'flagged',
          flaggedReason: 'banned_words',
          flaggedWords: foundWords,
          flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('mod_actions').add({
          action: 'auto_flag',
          targetType: 'post',
          targetId: event.params.postId,
          reason: `Banned words detected: ${foundWords.join(', ')}`,
          automated: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (err) { console.error('autoModCheck error:', err); }
  });

// ──────────────────────────────────────────────────────────────
// SCHEDULED — RANKING, TRENDING, STORIES CLEANUP
// ──────────────────────────────────────────────────────────────

// Ranking runs every 6 hours. With the feed ordering by createdAt first
// and rankScore only used as a tiebreaker in the top slice, 6h stale ranks
// are indistinguishable to users on a small app but cut reads by 6×.
// Author boost is read ONCE per author per run via in-memory cache instead
// of N+1 lookups, and we batch-fetch authors with `where(__name__, in, [...])`.
exports.calculateRankScores = functions.scheduler
  .onSchedule('0 */6 * * *', async () => {
    const now = Date.now();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    const posts = await db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', twentyFourHoursAgo).get();

    // 1. Collect unique authorIds we still need to look up
    const authorBoosts = new Map();
    const uniqueAuthorIds = [...new Set(posts.docs.map(d => d.data().authorId).filter(Boolean))];

    // 2. Batch-fetch authors in chunks of 30 (Firestore "in" query limit)
    for (let i = 0; i < uniqueAuthorIds.length; i += 30) {
      const chunk = uniqueAuthorIds.slice(i, i + 30);
      const authorRefs = chunk.map(id => db.collection('users').doc(id));
      const authorSnaps = await db.getAll(...authorRefs);
      for (const snap of authorSnaps) {
        if (!snap.exists) { authorBoosts.set(snap.id, 1.0); continue; }
        const vt = snap.data().verificationTier;
        let boost = 1.0;
        if (vt === 'pro') boost = 2.0;
        else if (vt === 'legend') boost = 2.5;
        else if (vt === 'verified') boost = 1.5;
        authorBoosts.set(snap.id, boost);
      }
    }

    let batch = db.batch();
    let count = 0;
    for (const doc of posts.docs) {
      const post = doc.data();
      const likes = post.likeCount || 0;
      const comments = post.commentCount || 0;
      const shares = post.shareCount || 0;
      const saves = post.saveCount || 0;
      const engagementScore = (likes * 1) + (comments * 3) + (shares * 5) + (saves * 2);
      const postAge = (now - (post.createdAt?.toMillis ? post.createdAt.toMillis() : new Date(post.createdAt).getTime())) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 100 - (postAge * 4));

      let boostMultiplier = authorBoosts.get(post.authorId) ?? 1.0;
      if (post.isNewsPost) boostMultiplier *= 0.8;

      batch.update(doc.ref, { rankScore: (engagementScore + recencyScore) * boostMultiplier, lastRankedAt: admin.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`Ranked ${count} posts using ${uniqueAuthorIds.length} unique authors`);
  });

// Trending hashtags refreshed every 3 hours (was hourly). A trending tag
// list does not need minute-level freshness, and this query reads every
// published post from the last 24h on each run.
exports.updateTrending = functions.scheduler
  .onSchedule('0 */3 * * *', async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const posts = await db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', twentyFourHoursAgo).get();

    const tagCounts = {};
    for (const doc of posts.docs) {
      const post = doc.data();
      const hashtags = post.hashtags || [];
      const engagement = (post.likeCount || 0) + (post.commentCount || 0) * 3;
      for (const tag of hashtags) {
        if (!tagCounts[tag]) tagCounts[tag] = { count: 0, engagement: 0 };
        tagCounts[tag].count++;
        tagCounts[tag].engagement += engagement;
      }
    }

    const sorted = Object.entries(tagCounts)
      .map(([tag, data]) => ({ tag, score: data.count * 10 + data.engagement, ...data }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    await db.collection('trending').doc('hashtags').set({
      tags: sorted,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const batch = db.batch();
    for (const item of sorted) {
      batch.set(db.collection('hashtags').doc(item.tag), {
        tag: item.tag,
        postCount24h: item.count,
        engagement24h: item.engagement,
        trendScore: item.score,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    console.log(`Updated ${sorted.length} trending hashtags`);
  });

// Stories cleanup every 6 hours. A story expiring up to 6 hours late is
// irrelevant (the client already hides stories older than 24h on read).
exports.cleanupExpiredStories = functions.scheduler
  .onSchedule('0 */6 * * *', async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await db.collection('stories').where('active', '==', true).where('createdAt', '<=', twentyFourHoursAgo).get();
    if (expired.empty) return;
    const batch = db.batch();
    let count = 0;
    for (const doc of expired.docs) {
      batch.update(doc.ref, { active: false, expiredAt: admin.firestore.FieldValue.serverTimestamp() });
      count++;
    }
    await batch.commit();
    if (count > 0) console.log(`Expired ${count} stories`);
  });

// ──────────────────────────────────────────────────────────────
// CALLABLE — TIPS, PURCHASES, REPORTS, COMMERCE, MEMBERSHIPS
// ──────────────────────────────────────────────────────────────

exports.sendTip = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { recipientId, amount, message, postId, streamId } = request.data;
  if (!recipientId || typeof recipientId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'recipientId required');
  if (!amount || typeof amount !== 'number' || amount < 1 || !Number.isInteger(amount)) throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive integer');
  if (uid === recipientId) throw new functions.https.HttpsError('invalid-argument', 'Cannot tip yourself');
  if (amount > 50000) throw new functions.https.HttpsError('invalid-argument', 'Maximum tip is 50,000 coins');

  return db.runTransaction(async (tx) => {
    const senderWalletRef = db.collection('wallets').doc(uid);
    const recipientWalletRef = db.collection('wallets').doc(recipientId);
    const senderWallet = await tx.get(senderWalletRef);
    const recipientWallet = await tx.get(recipientWalletRef);
    if (!senderWallet.exists) throw new functions.https.HttpsError('not-found', 'Sender wallet not found');
    if (!recipientWallet.exists) throw new functions.https.HttpsError('not-found', 'Recipient wallet not found');
    const senderBalance = senderWallet.data().balance || 0;
    if (senderBalance < amount) throw new functions.https.HttpsError('failed-precondition', 'Insufficient coin balance');

    const platformFee = Math.floor(amount * 0.10);
    const recipientAmount = amount - platformFee;

    tx.update(senderWalletRef, { balance: admin.firestore.FieldValue.increment(-amount), totalSpent: admin.firestore.FieldValue.increment(amount), totalTipped: admin.firestore.FieldValue.increment(amount), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(recipientWalletRef, { balance: admin.firestore.FieldValue.increment(recipientAmount), totalEarned: admin.firestore.FieldValue.increment(recipientAmount), totalReceived: admin.firestore.FieldValue.increment(recipientAmount), updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    const tipRef = db.collection('tips').doc();
    tx.set(tipRef, { senderId: uid, recipientId, amount, recipientAmount, platformFee, message: message || null, postId: postId || null, streamId: streamId || null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('transactions').doc(), { userId: uid, type: 'tip_sent', amount: -amount, balance: senderBalance - amount, recipientId, tipId: tipRef.id, description: `Tipped ${amount} coins`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('transactions').doc(), { userId: recipientId, type: 'tip_received', amount: recipientAmount, balance: (recipientWallet.data().balance || 0) + recipientAmount, senderId: uid, tipId: tipRef.id, description: `Received ${recipientAmount} coins (${amount} - ${platformFee} fee)`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('notifications').doc(), { recipientId, type: 'tip', title: 'You received a tip!', body: `Someone tipped you ${recipientAmount} coins${message ? ': "' + message + '"' : ''}`, senderId: uid, read: false, data: { tipId: tipRef.id, amount: recipientAmount }, createdAt: admin.firestore.FieldValue.serverTimestamp() });

    return { tipId: tipRef.id, recipientAmount, platformFee };
  });
});

exports.purchaseCoins = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { packageId, paymentIntentId } = request.data;
  if (!packageId || !paymentIntentId) throw new functions.https.HttpsError('invalid-argument', 'packageId and paymentIntentId required');

  const packageDoc = await db.collection('coin_packages').doc(packageId).get();
  if (!packageDoc.exists || !packageDoc.data().active) throw new functions.https.HttpsError('not-found', 'Coin package not found or inactive');

  const pkg = packageDoc.data();
  const bonusCoins = Math.floor(pkg.coins * ((pkg.priceBonusPercent || 0) / 100));
  const totalCoins = pkg.coins + bonusCoins;

  await db.runTransaction(async (tx) => {
    const walletRef = db.collection('wallets').doc(uid);
    const wallet = await tx.get(walletRef);
    if (!wallet.exists) throw new functions.https.HttpsError('not-found', 'Wallet not found');
    const currentBalance = wallet.data().balance || 0;
    tx.update(walletRef, { balance: admin.firestore.FieldValue.increment(totalCoins), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(db.collection('users').doc(uid), { coinBalance: admin.firestore.FieldValue.increment(totalCoins) });
    tx.set(db.collection('transactions').doc(), { userId: uid, type: 'purchase', amount: totalCoins, balance: currentBalance + totalCoins, packageId, packageName: pkg.name, priceEUR: pkg.priceEUR, baseCoins: pkg.coins, bonusCoins, paymentIntentId, description: `Purchased ${pkg.name}: ${totalCoins} coins (${pkg.coins} + ${bonusCoins} bonus)`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  return { totalCoins, baseCoins: pkg.coins, bonusCoins };
});

exports.getWalletBalance = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const wallet = await db.collection('wallets').doc(uid).get();
  if (!wallet.exists) return { balance: 0, totalEarned: 0, totalSpent: 0 };
  const w = wallet.data();
  return { balance: w.balance || 0, totalEarned: w.totalEarned || 0, totalSpent: w.totalSpent || 0, totalTipped: w.totalTipped || 0, totalReceived: w.totalReceived || 0 };
});

exports.submitReport = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { targetType, targetId, reason, details } = request.data;
  const validTypes = ['post', 'comment', 'user', 'squad', 'message', 'stream', 'review'];
  if (!validTypes.includes(targetType)) throw new functions.https.HttpsError('invalid-argument', 'Invalid target type');
  if (!targetId) throw new functions.https.HttpsError('invalid-argument', 'targetId required');
  if (!reason) throw new functions.https.HttpsError('invalid-argument', 'reason required');

  const existing = await db.collection('reports').where('reporterId', '==', uid).where('targetId', '==', targetId).where('targetType', '==', targetType).limit(1).get();
  if (!existing.empty) throw new functions.https.HttpsError('already-exists', 'You already reported this');

  const report = await db.collection('reports').add({
    reporterId: uid, targetType, targetId, reason, details: details?.substring(0, 1000) || null, status: 'pending',
    priority: reason === 'underage' ? 'critical' : 'normal', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const reportCount = await db.collection('reports').where('targetId', '==', targetId).where('status', 'in', ['pending', 'reviewing']).get();
  const config = await db.collection('app_config').doc('general').get();
  const threshold = config.exists ? (config.data().reportThreshold || 5) : 5;

  if (reportCount.size >= threshold && targetType === 'post') {
    await db.collection('posts').doc(targetId).update({ status: 'hidden', hiddenReason: 'auto_mod_reports', hiddenAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection('mod_actions').add({ action: 'auto_hide', targetType, targetId, reason: `Reached ${threshold} reports`, automated: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  return { reportId: report.id };
});

exports.createOrder = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { shippingAddress, paymentMethod, useCoins, coinAmount } = request.data;
  if (!shippingAddress) throw new functions.https.HttpsError('invalid-argument', 'Shipping address required');

  const cartItems = await db.collection('carts').doc(uid).collection('items').get();
  if (cartItems.empty) throw new functions.https.HttpsError('failed-precondition', 'Cart is empty');

  return db.runTransaction(async (tx) => {
    let subtotalEUR = 0;
    const orderItems = [];
    for (const cartDoc of cartItems.docs) {
      const ci = cartDoc.data();
      const productRef = db.collection('products').doc(ci.productId);
      const product = await tx.get(productRef);
      if (!product.exists || !product.data().active) throw new functions.https.HttpsError('not-found', `Product ${ci.productId} unavailable`);
      const p = product.data();
      if (p.stock < ci.quantity) throw new functions.https.HttpsError('failed-precondition', `Insufficient stock for ${p.name}`);
      const itemTotal = p.priceEUR * ci.quantity;
      subtotalEUR += itemTotal;
      orderItems.push({ productId: ci.productId, name: p.name, priceEUR: p.priceEUR, quantity: ci.quantity, totalEUR: itemTotal, image: p.images?.[0] || null });
      tx.update(productRef, { stock: admin.firestore.FieldValue.increment(-ci.quantity), soldCount: admin.firestore.FieldValue.increment(ci.quantity) });
    }
    const shippingEUR = subtotalEUR >= 500 ? 0 : 4.99;
    const vatRate = 0.15;
    const vatEUR = Math.round(subtotalEUR * vatRate * 100) / 100;
    let coinDiscount = 0;
    if (useCoins && coinAmount > 0) {
      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      const balance = wallet.data()?.balance || 0;
      const maxCoinsUsable = Math.min(coinAmount, balance, subtotalEUR * 10);
      coinDiscount = maxCoinsUsable / 10;
      tx.update(walletRef, { balance: admin.firestore.FieldValue.increment(-maxCoinsUsable), totalSpent: admin.firestore.FieldValue.increment(maxCoinsUsable), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    const totalEUR = subtotalEUR + shippingEUR + vatEUR - coinDiscount;
    const orderRef = db.collection('orders').doc();
    tx.set(orderRef, { userId: uid, status: 'pending_payment', items: orderItems, itemCount: orderItems.length, subtotalEUR, shippingEUR, vatEUR, coinDiscount, totalEUR: Math.max(0, totalEUR), shippingAddress, paymentMethod, trackingNumber: null, trackingUrl: null, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    for (const cartDoc of cartItems.docs) tx.delete(cartDoc.ref);
    return { orderId: orderRef.id, totalEUR: Math.max(0, totalEUR), itemCount: orderItems.length };
  });
});

exports.handleStripeWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  const event = req.body;
  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await db.collection('orders').doc(orderId).update({ status: 'paid', paymentIntentId: intent.id, paidAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        const order = await db.collection('orders').doc(orderId).get();
        if (order.exists) {
          await db.collection('notifications').add({ recipientId: order.data().userId, type: 'order', title: 'Payment confirmed!', body: `Your order #${orderId.substring(0, 8)} is being processed`, data: { orderId }, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const orderId = charge.metadata?.orderId;
      if (orderId) await db.collection('orders').doc(orderId).update({ status: 'refunded', refundedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

exports.requestPayout = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const creator = await db.collection('creators').doc(uid).get();
  if (!creator.exists) throw new functions.https.HttpsError('failed-precondition', 'Not a registered creator');
  const wallet = await db.collection('wallets').doc(uid).get();
  const balance = wallet.data()?.balance || 0;
  if (balance < 1000) throw new functions.https.HttpsError('failed-precondition', 'Minimum payout is 1000 coins');
  const payoutCoins = request.data.amount || balance;
  const payoutEUR = payoutCoins / 10;
  const payout = await db.collection('creators').doc(uid).collection('payouts').add({ amount: payoutCoins, amountEUR: payoutEUR, status: 'pending', requestedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { payoutId: payout.id, amountEUR: payoutEUR };
});

exports.subscribeMembership = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { membershipId, paymentType } = request.data;
  if (!membershipId) throw new functions.https.HttpsError('invalid-argument', 'membershipId required');
  const membership = await db.collection('memberships').doc(membershipId).get();
  if (!membership.exists) throw new functions.https.HttpsError('not-found', 'Membership tier not found');
  const tier = membership.data();

  const existingSub = await db.collection('member_subscriptions').where('userId', '==', uid).where('membershipId', '==', membershipId).where('status', '==', 'active').limit(1).get();
  if (!existingSub.empty) throw new functions.https.HttpsError('already-exists', 'Already subscribed');

  if (paymentType !== 'coins') throw new functions.https.HttpsError('unimplemented', 'Stripe subscriptions coming soon');

  return db.runTransaction(async (tx) => {
    const walletRef = db.collection('wallets').doc(uid);
    const wallet = await tx.get(walletRef);
    const balance = wallet.data()?.balance || 0;
    if (balance < tier.priceCoins) throw new functions.https.HttpsError('failed-precondition', 'Insufficient coin balance');

    const platformFee = Math.floor(tier.priceCoins * 0.10);
    const creatorAmount = tier.priceCoins - platformFee;

    tx.update(walletRef, { balance: admin.firestore.FieldValue.increment(-tier.priceCoins), totalSpent: admin.firestore.FieldValue.increment(tier.priceCoins), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(db.collection('wallets').doc(tier.creatorId), { balance: admin.firestore.FieldValue.increment(creatorAmount), totalEarned: admin.firestore.FieldValue.increment(creatorAmount), updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    const subRef = db.collection('member_subscriptions').doc();
    tx.set(subRef, { userId: uid, creatorId: tier.creatorId, membershipId, tierName: tier.name, priceCoins: tier.priceCoins, paymentType: 'coins', status: 'active', startedAt: admin.firestore.FieldValue.serverTimestamp(), renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('transactions').doc(), { userId: uid, type: 'membership', amount: -tier.priceCoins, balance: balance - tier.priceCoins, description: `Subscribed to ${tier.name} membership`, membershipId, creatorId: tier.creatorId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('notifications').doc(), { recipientId: tier.creatorId, type: 'membership', title: 'New subscriber!', body: `Someone subscribed to your ${tier.name} tier`, senderId: uid, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });

    return { subscriptionId: subRef.id };
  });
});

exports.cancelMembership = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { subscriptionId } = request.data;
  if (!subscriptionId) throw new functions.https.HttpsError('invalid-argument', 'subscriptionId required');
  const subRef = db.collection('member_subscriptions').doc(subscriptionId);
  const sub = await subRef.get();
  if (!sub.exists) throw new functions.https.HttpsError('not-found', 'Subscription not found');
  if (sub.data().userId !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your subscription');
  await subRef.update({ status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp() });
  return { cancelled: true };
});

// ──────────────────────────────────────────────────────────────
// STORAGE LIFECYCLE: delete chat media past its TTL.
// We tag uploads with customMetadata.ttlExpiry (ISO date). This sweeper
// runs nightly, walks the chat folders, and deletes any object that's
// expired. Profile/post media (no TTL set) are left alone.
// ──────────────────────────────────────────────────────────────
const TTL_FOLDERS = [
  'chat_media/', 'chat_images/', 'chat_videos/', 'chat_files/',
  'voice_notes/', 'squad_voice/', 'squad_images/', 'squad_videos/',
  'comment_media/',
];

async function deleteExpiredFiles(folderPrefix) {
  const bucket = admin.storage().bucket();
  let pageToken;
  let deleted = 0;
  let scanned = 0;
  const now = Date.now();
  do {
    const [files, _, apiResp] = await bucket.getFiles({ prefix: folderPrefix, maxResults: 1000, pageToken });
    pageToken = apiResp?.nextPageToken;
    for (const file of files) {
      scanned++;
      try {
        const [metadata] = await file.getMetadata();
        const ttlIso = metadata?.metadata?.ttlExpiry;
        // Fallback: if no TTL set, treat anything older than 30 days as expired
        const created = metadata?.timeCreated ? new Date(metadata.timeCreated).getTime() : 0;
        const ttlMs = ttlIso ? new Date(ttlIso).getTime() : (created + 30 * 86400000);
        if (ttlMs && ttlMs < now) {
          await file.delete().catch(() => {});
          deleted++;
        }
      } catch (err) {
        // Skip individual file errors
      }
    }
  } while (pageToken);
  return { folderPrefix, scanned, deleted };
}

exports.cleanupExpiredMedia = functions.scheduler
  .onSchedule({ schedule: '0 3 * * *', timeZone: 'Etc/UTC' }, async () => {
    const results = [];
    for (const folder of TTL_FOLDERS) {
      try {
        results.push(await deleteExpiredFiles(folder));
      } catch (err) {
        console.error(`Cleanup failed for ${folder}:`, err.message);
      }
    }
    console.log('Storage cleanup complete:', JSON.stringify(results));
  });

// Manual trigger for the same sweep — call once to clean out a stuffed bucket.
exports.cleanupExpiredMediaNow = functions.https.onRequest(async (req, res) => {
  const results = [];
  for (const folder of TTL_FOLDERS) {
    try { results.push(await deleteExpiredFiles(folder)); }
    catch (err) { results.push({ folderPrefix: folder, error: err.message }); }
  }
  res.status(200).json(results);
});

// ──────────────────────────────────────────────────────────────
// SHARE LINK PREVIEWS
// Returns server-rendered HTML with the right Open Graph tags so when a
// VERGR post/clip URL is pasted into WhatsApp/Discord/Slack/Twitter the
// crawler sees a proper title/description/image instead of our SPA's
// default tags. Real users get a meta refresh into the SPA route.
// Hosting rewrite: /share/post/:id and /share/clip/:id → this function.
// ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

exports.shareLink = functions.https.onRequest(async (req, res) => {
  // Path looks like /share/post/abc123 or /share/clip/abc123
  const parts = (req.path || '').split('/').filter(Boolean);
  // Function rewrite strips the /share prefix and we get [kind, id]
  const [kind, id] = parts.length === 2 ? parts : [parts[parts.length - 2], parts[parts.length - 1]];
  if (!id || !['post', 'clip'].includes(kind)) {
    return res.status(404).send('Not found');
  }

  const APP_BASE = 'https://vergr-44494.web.app';
  const APP_ROUTE = kind === 'clip' ? `/clip/${id}` : `/post/${id}`;
  const canonicalUrl = `${APP_BASE}/share/${kind}/${id}`;
  const fallbackImage = `${APP_BASE}/icons/icon-512.png`;

  let title = 'VERGR — Where Gamers Converge';
  let description = 'Compete, create, earn and shop with the gaming community.';
  let image = fallbackImage;
  let videoEmbed = null;

  try {
    const postSnap = await db.collection('posts').doc(id).get();
    if (postSnap.exists) {
      const post = postSnap.data();
      const author = post.authorId ? (await db.collection('users').doc(post.authorId).get()).data() : null;
      const authorName = author?.displayName || author?.username || 'A gamer';
      title = post.content
        ? `${authorName}: ${post.content.slice(0, 60)}${post.content.length > 60 ? '…' : ''}`
        : `${authorName} on VERGR`;
      description = (post.previewText || post.content || description).slice(0, 200);
      const firstMedia = Array.isArray(post.mediaUrls) ? post.mediaUrls[0] : post.mediaUrl;
      if (firstMedia) image = firstMedia;
      else if (post.youtubeVideoId) {
        image = `https://img.youtube.com/vi/${post.youtubeVideoId}/hqdefault.jpg`;
        videoEmbed = `https://www.youtube.com/embed/${post.youtubeVideoId}`;
      }
    }
  } catch (err) {
    console.error('shareLink lookup failed:', err.message);
  }

  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="${videoEmbed ? 'video.other' : 'article'}" />
  <meta property="og:site_name" content="VERGR" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${videoEmbed ? `<meta property="og:video" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:url" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:secure_url" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:type" content="text/html" />` : ''}
  <meta name="twitter:card" content="${videoEmbed ? 'player' : 'summary_large_image'}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(APP_BASE + '/#' + APP_ROUTE)}" />
  <style>body{margin:0;background:#07080D;color:#ECEFFE;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px}</style>
</head>
<body>
  <div>
    <h1 style="margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="margin:0 0 24px;opacity:0.7">${escapeHtml(description)}</p>
    <a href="${escapeHtml(APP_BASE + '/#' + APP_ROUTE)}" style="color:#4DFFD4">Open in VERGR →</a>
  </div>
</body>
</html>`);
});

// One-shot audit: report storage usage by folder so we can see what's
// actually eating quota. Hit GET to read the breakdown.
exports.storageAudit = functions.https.onRequest(async (req, res) => {
  const bucket = admin.storage().bucket();
  const totals = {};
  let pageToken;
  do {
    const [files, _, apiResp] = await bucket.getFiles({ maxResults: 1000, pageToken });
    pageToken = apiResp?.nextPageToken;
    for (const f of files) {
      const folder = f.name.includes('/') ? f.name.split('/')[0] : '(root)';
      const size = parseInt(f.metadata?.size || '0', 10);
      const slot = totals[folder] || (totals[folder] = { count: 0, bytes: 0 });
      slot.count += 1;
      slot.bytes += size;
    }
  } while (pageToken);
  const formatted = Object.entries(totals)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([folder, v]) => ({ folder, count: v.count, mb: +(v.bytes / 1048576).toFixed(2) }));
  const totalMb = +(formatted.reduce((sum, x) => sum + x.mb, 0)).toFixed(2);
  res.status(200).json({ totalMb, byFolder: formatted });
});

// ──────────────────────────────────────────────────────────────
// MEDIA PROXY — CDN-FRIENDLY STORAGE STREAMING
// ──────────────────────────────────────────────────────────────
// Streams files from Firebase Storage with long cache headers so Cloudflare
// caches them at the edge. First request pays Storage egress; every subsequent
// one is served by Cloudflare for $0.
//
// URL pattern: /media/{storagePath}
// e.g. /media/posts/abc123/clip.mp4
//
// The Firebase Hosting rewrite forwards /media/** → this function.
exports.serveMedia = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('GET only');

  // Strip leading /media/ to get the storage object path
  const pathMatch = req.path.replace(/^\/media\//, '');
  if (!pathMatch || pathMatch === '/') return res.status(400).send('Missing path');

  const bucket = admin.storage().bucket();
  const file = bucket.file(decodeURIComponent(pathMatch));

  try {
    const [exists] = await file.exists();
    if (!exists) return res.status(404).send('Not found');

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';
    const size = parseInt(metadata.size, 10);

    // Long cache: 30 days edge (s-maxage), 7 days browser (max-age).
    // Cloudflare respects s-maxage for edge caching.
    res.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
    res.set('Content-Type', contentType);
    if (size) res.set('Content-Length', String(size));
    // Allow range requests for video seeking
    res.set('Accept-Ranges', 'bytes');

    // Handle range requests (video scrubbing)
    const rangeHeader = req.headers.range;
    if (rangeHeader && size) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
      res.set('Content-Length', String(end - start + 1));
      file.createReadStream({ start, end: end + 1 }).pipe(res);
    } else {
      file.createReadStream().pipe(res);
    }
  } catch (err) {
    console.error('serveMedia error:', err.message);
    if (!res.headersSent) res.status(500).send('Internal error');
  }
});

// ──────────────────────────────────────────────────────────────
// MONTHLY PLAN BONUS — Lite/Pro subscribers get VP + coins on the 1st
// ──────────────────────────────────────────────────────────────
exports.payMonthlyPlanBonus = functions.scheduler.onSchedule(
  { schedule: '0 6 1 * *', timeZone: 'UTC', region: 'europe-west1' },
  async () => {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const plans = ['lite', 'pro'];
    let paid = 0;

    for (const plan of plans) {
      const vpBonus = MONTHLY_VP_BONUS[plan];
      const coinBonus = MONTHLY_COIN_BONUS[plan];
      if (!vpBonus && !coinBonus) continue;

      let lastDoc = null;
      while (true) {
        let q = db.collection('users').where('tier', '==', plan).limit(400);
        if (lastDoc) q = q.startAfter(lastDoc);
        const batch = await q.get();
        if (batch.empty) break;
        lastDoc = batch.docs[batch.docs.length - 1];

        await Promise.all(batch.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const claimId = `${uid}_plan_bonus_${monthKey}`;
          const claimRef = db.collection('quest_claims').doc(claimId);
          const claimSnap = await claimRef.get();
          if (claimSnap.exists) return;

          const walletRef = db.collection('wallets').doc(uid);
          const now = new Date();
          try {
            await db.runTransaction(async (tx) => {
              const ws = await tx.get(walletRef);
              const cur = ws.exists ? ws.data() : {};
              tx.set(walletRef, {
                balance: (cur.balance || 0) + coinBonus,
                totalEarned: (cur.totalEarned || 0) + coinBonus,
                vp: (cur.vp || 0) + vpBonus,
                tier: plan,
                updatedAt: now,
                ...(!ws.exists ? { createdAt: now, gems: 0, totalSpent: 0 } : {}),
              }, { merge: true });
              tx.set(claimRef, { userId: uid, questId: 'plan_bonus', month: monthKey, plan, coins: coinBonus, vp: vpBonus, claimedAt: now });
              tx.set(db.collection('transactions').doc(), {
                userId: uid, type: 'plan_bonus', amount: coinBonus,
                description: `${plan.toUpperCase()} monthly: +${coinBonus} coins + ${vpBonus} VP`,
                createdAt: now,
              });
              tx.set(db.collection('notifications').doc(), {
                recipientId: uid, type: 'coins',
                title: `+${coinBonus} coins + ${vpBonus} VP`,
                body: `Your ${plan.toUpperCase()} monthly bonus has landed!`,
                read: false, data: { type: 'plan_bonus', plan, coins: coinBonus, vp: vpBonus }, createdAt: now,
              });
            });
            paid++;
          } catch (e) {
            console.error(`plan_bonus failed for ${uid}:`, e.message);
          }
        }));

        if (batch.docs.length < 400) break;
      }
    }

    console.log(`payMonthlyPlanBonus ${monthKey}: paid ${paid} users`);
    return null;
  }
);

// ──────────────────────────────────────────────────────────────
// GEMINI-BACKED MODERATION
// Uses Gemini 1.5 Flash via REST (no SDK dep) with safety settings
// to classify content. Free tier: 15 RPM / 1M TPM — more than enough
// for chat + periodic stream frame checks at our current scale.
// Set the API key with: firebase functions:secrets:set GEMINI_API_KEY
// ──────────────────────────────────────────────────────────────
const GEMINI_SECRET = functions.params.defineSecret('GEMINI_API_KEY');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];

async function callGemini(apiKey, parts) {
  try {
    const res = await axios.post(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      contents: [{ role: 'user', parts }],
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    }, { timeout: 8000 });
    const data = res.data;
    // If the prompt was blocked by safety, promptFeedback carries the reason.
    if (data.promptFeedback?.blockReason) {
      return { flagged: true, reason: data.promptFeedback.blockReason.toLowerCase(), raw: data };
    }
    // If a candidate came back with a safety block, candidates[].finishReason === 'SAFETY'
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      const worst = (candidate.safetyRatings || []).find(r => r.probability && r.probability !== 'NEGLIGIBLE');
      return { flagged: true, reason: worst?.category?.toLowerCase() || 'safety', raw: data };
    }
    // Otherwise parse the model's Yes/No answer
    const text = (candidate?.content?.parts?.[0]?.text || '').trim().toLowerCase();
    return { flagged: text.startsWith('yes'), reason: text.startsWith('yes') ? 'flagged_by_model' : null, raw: data };
  } catch (err) {
    console.error('Gemini call failed:', err.response?.data || err.message);
    // Fail-open: if Gemini is down we don't want to drop every message.
    // The client-side rules already caught obvious violations.
    return { flagged: false, reason: 'gemini_unavailable', error: true };
  }
}

// Public callable — viewers call this before a message goes into Firestore.
// Returns { ok, reason? }. Caller should block send if ok===false.
exports.moderateMessage = functions.https.onCall(
  { secrets: [GEMINI_SECRET], region: 'europe-west1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { text, chatId } = request.data || {};
    if (typeof text !== 'string' || !text.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'text required');
    }
    // Short-circuit very short messages — Gemini is overkill for "gg"
    if (text.length < 12) return { ok: true, skipped: 'too_short' };

    const apiKey = GEMINI_SECRET.value();
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set — moderation pass-through');
      return { ok: true, skipped: 'no_api_key' };
    }

    const prompt = `Act as a content moderator for a gaming community chat. Is the following message toxic, hateful, harassing, or sexually explicit? Reply with only "Yes" or "No".\n\nMessage: ${text}`;
    const result = await callGemini(apiKey, [{ text: prompt }]);

    if (result.flagged) {
      // Log to mod_actions for the streamer to review
      await db.collection('mod_actions').add({
        action: 'auto_block_chat',
        targetType: 'chat_message',
        targetUserId: uid,
        chatId: chatId || null,
        messageText: text.slice(0, 500),
        reason: result.reason,
        automated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      return { ok: false, reason: result.reason || 'flagged' };
    }
    return { ok: true };
  }
);

// Stream frame check — broadcaster client grabs a canvas frame every N seconds,
// converts to base64 JPEG, and sends it here. Returns { ok, reason? }.
// Repeated flags on the same streamId bump the offender's strike counter.
exports.moderateStreamFrame = functions.https.onCall(
  { secrets: [GEMINI_SECRET], region: 'europe-west1', timeoutSeconds: 30 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { streamId, imageBase64, mimeType = 'image/jpeg' } = request.data || {};
    if (!imageBase64) throw new functions.https.HttpsError('invalid-argument', 'imageBase64 required');

    const apiKey = GEMINI_SECRET.value();
    if (!apiKey) return { ok: true, skipped: 'no_api_key' };

    // Strip data URL prefix if caller included it
    const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const prompt = 'Act as a content moderator. Does this image contain sexually explicit content, nudity, or graphic violence? Reply with only "Yes" or "No".';
    const result = await callGemini(apiKey, [
      { text: prompt },
      { inlineData: { mimeType, data: b64 } },
    ]);

    if (result.flagged) {
      // Increment the broadcaster's strike counter; auto-kill at 3.
      const strikeRef = db.collection('stream_strikes').doc(uid);
      let strikes = 1;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(strikeRef);
        strikes = (snap.data()?.count || 0) + 1;
        tx.set(strikeRef, {
          count: strikes,
          lastStreamId: streamId || null,
          lastReason: result.reason || 'flagged',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      await db.collection('mod_actions').add({
        action: strikes >= 3 ? 'auto_kill_stream' : 'warn_stream',
        targetType: 'live_stream',
        targetUserId: uid,
        streamId: streamId || null,
        reason: result.reason || 'flagged',
        strikeCount: strikes,
        automated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (streamId) {
        await db.collection('streams').doc(streamId).set({
          moderationStatus: strikes >= 3 ? 'killed' : 'warned',
          moderationReason: result.reason || 'flagged',
          moderationAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }

      return { ok: false, reason: result.reason || 'flagged', strikes, shouldKill: strikes >= 3 };
    }
    return { ok: true };
  }
);

// Viewer-submitted report → creates a doc that mods can triage.
exports.reportStream = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { streamId, reason, detail } = request.data || {};
    if (!streamId || !reason) throw new functions.https.HttpsError('invalid-argument', 'streamId and reason required');
    await db.collection('stream_reports').add({
      streamId, reason, detail: detail || null, reporterId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });
    return { ok: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────
// AUDIENCE DEMOGRAPHICS — GDPR-lawful passive signals + creator aggregates
// ─────────────────────────────────────────────────────────────────────────

/**
 * getClientSignals
 * Callable. Returns approximate country (and region/city when available)
 * derived from the request IP using headers set by upstream CDNs/load
 * balancers. Best-effort — returns null fields when not determinable.
 *
 * The client is responsible for gating calls to this function behind the
 * user's `audienceAnalytics` consent (see src/utils/captureSignals.js).
 */
exports.getClientSignals = functions.https.onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }
  // Firebase Hosting + Google Cloud Functions v2 may set various geo headers
  // depending on how the request is routed. Read whichever is populated.
  const h = request.rawRequest?.headers || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = h[k] || h[k.toLowerCase()];
      if (v && typeof v === 'string') return v.trim();
    }
    return null;
  };
  const country = pick(
    'x-appengine-country',          // App Engine / Firebase Hosting
    'cf-ipcountry',                 // Cloudflare
    'fastly-geo-country-code',      // Fastly
    'x-country-code',               // Common proxy header
    'x-vercel-ip-country',
  );
  const region = pick(
    'x-appengine-region',
    'cf-region-code',
    'x-vercel-ip-country-region',
  );
  const city = pick(
    'x-appengine-city',
    'cf-ipcity',
    'x-vercel-ip-city',
  );
  return {
    country: country && country !== 'ZZ' ? country.toUpperCase() : null,
    region:  region  || null,
    city:    city    ? decodeURIComponent(city) : null,
  };
});

/**
 * aggregateCreatorAudience
 * Callable. Reads the caller's followers, joins their `users/{uid}/meta/signals`
 * + DOB/gender, and writes anonymized aggregates to
 * `creators/{uid}/aggregates/audience`.
 *
 * Only includes followers whose `audienceAnalytics` consent is granted —
 * others are counted only in a "consent-withheld" bucket (for UI transparency).
 * Cached server-side for 1 hour.
 */
exports.aggregateCreatorAudience = functions.https.onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

    const aggRef = db.collection('creators').doc(uid).collection('aggregates').doc('audience');
    const existing = await aggRef.get();
    const now = Date.now();
    if (existing.exists) {
      const d = existing.data();
      const last = d.updatedAtMs || 0;
      if (now - last < 60 * 60 * 1000) {
        return { cached: true, ...d };
      }
    }

    // Fetch followers (flat collection: users/{creatorId}/followers/{followerId})
    const followersSnap = await db.collection('users').doc(uid).collection('followers').limit(5000).get();
    const followerIds = followersSnap.docs.map(d => d.id);
    const totalFollowers = followerIds.length;

    const ageBuckets   = { '13-17': 0, '18-24': 0, '25-34': 0, '35-44': 0, '45+': 0, unknown: 0 };
    const genderCounts = { male: 0, female: 0, nyb: 0, unknown: 0 };
    const countryCounts = {};
    const languageCounts = {};
    const gameCounts     = {};
    const tagCounts      = {};
    const contentTypeCounts = {};
    const activeHours    = new Array(24).fill(0);
    let consentWithheld = 0;
    let affinityContributors = 0;

    // Batch reads in chunks of 10 (Firestore getAll limit is higher, but keeps memory low)
    const chunkSize = 30;
    for (let i = 0; i < followerIds.length; i += chunkSize) {
      const chunk = followerIds.slice(i, i + chunkSize);
      const userRefs   = chunk.map(id => db.collection('users').doc(id));
      const signalRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('signals'));
      const consentRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('consents'));
      const affinityRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('affinity'));
      const [users, signals, consents, affinities] = await Promise.all([
        db.getAll(...userRefs),
        db.getAll(...signalRefs),
        db.getAll(...consentRefs),
        db.getAll(...affinityRefs),
      ]);
      for (let j = 0; j < chunk.length; j++) {
        const u = users[j].exists   ? users[j].data()   : null;
        const s = signals[j].exists ? signals[j].data() : null;
        const c = consents[j].exists ? consents[j].data() : null;
        const ok = c?.audienceAnalytics?.granted === true;
        if (!ok) { consentWithheld++; continue; }

        const bucket = u?.ageBucket;
        if (bucket && ageBuckets[bucket] != null) ageBuckets[bucket]++;
        else ageBuckets.unknown++;

        const g = u?.gender;
        if (g && genderCounts[g] != null) genderCounts[g]++;
        else genderCounts.unknown++;

        const country = u?.country || s?.country;
        if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;

        const lang = s?.language;
        if (lang) {
          const primary = String(lang).split('-')[0];
          languageCounts[primary] = (languageCounts[primary] || 0) + 1;
        }

        // Merge affinity rollups (only present for users with personalizedAds consent)
        const aff = affinities[j].exists ? affinities[j].data() : null;
        if (aff) {
          affinityContributors++;
          (aff.topGames || []).forEach(({ name, value }) => {
            if (name) gameCounts[name] = (gameCounts[name] || 0) + (value || 1);
          });
          (aff.topTags || []).forEach(({ name, value }) => {
            if (name) tagCounts[name] = (tagCounts[name] || 0) + (value || 1);
          });
          (aff.topContentTypes || []).forEach(({ name, value }) => {
            if (name) contentTypeCounts[name] = (contentTypeCounts[name] || 0) + (value || 1);
          });
          if (Array.isArray(aff.activeHours) && aff.activeHours.length === 24) {
            for (let h = 0; h < 24; h++) activeHours[h] += aff.activeHours[h] || 0;
          }
        }
      }
    }

    // Rank top countries/languages/games/tags/contentTypes
    const rank = (obj, n = 10) => Object.entries(obj)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([name, value]) => ({ name, value }));
    const topCountries    = rank(countryCounts);
    const topLanguages    = rank(languageCounts);
    const topGames        = rank(gameCounts);
    const topTags         = rank(tagCounts, 15);
    const topContentTypes = rank(contentTypeCounts);

    const payload = {
      totalFollowers,
      consentedFollowers: totalFollowers - consentWithheld,
      consentWithheld,
      ageBuckets,
      genderCounts,
      topCountries,
      topLanguages,
      topGames,
      topTags,
      topContentTypes,
      activeHours,
      affinityContributors,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: now,
    };
    await aggRef.set(payload, { merge: true });
    return { cached: false, ...payload };
  }
);

// ─────────────────────────────────────────────────────────────────────────
// USER AFFINITY — rolls raw users/{uid}/events → users/{uid}/meta/affinity
// ─────────────────────────────────────────────────────────────────────────

/**
 * Core rollup: reads last 30 days of events for a uid and writes a
 * compact affinity doc: topGames, topTags, topCreators, topContentTypes,
 * activeHours (0-23 histogram), totalEvents, lastRollupAt.
 *
 * Event-type weights reflect intent strength (a share is worth more than a view).
 */
async function rollupAffinityFor(uid) {
  if (!uid) return null;
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const snap = await db.collection('users').doc(uid).collection('events')
    .where('tsMs', '>=', cutoff)
    .limit(5000)
    .get();

  if (snap.empty) {
    await db.collection('users').doc(uid).collection('meta').doc('affinity')
      .set({ topGames: [], topTags: [], topCreators: [], topContentTypes: [],
             activeHours: new Array(24).fill(0), totalEvents: 0,
             lastRollupAt: admin.firestore.FieldValue.serverTimestamp(),
             lastRollupAtMs: Date.now() }, { merge: true });
    return { totalEvents: 0 };
  }

  const W = {
    view: 1, dwell: 2, short_watched: 3,
    like: 5, comment: 6, save: 6, repost: 8, share: 8,
    profile_visit: 4, creator_follow: 10,
    tag_click: 4, game_click: 5, search: 2,
    ad_click: 6, ad_impression: 1, ad_dismiss: -1,
    unlike: -3, hide: -5, report: -10,
  };

  const games = {}, tags = {}, creators = {}, types = {};
  const hours = new Array(24).fill(0);
  let total = 0;

  snap.docs.forEach(d => {
    const e = d.data();
    const w = W[e.type] != null ? W[e.type] : 1;
    total++;
    if (e.gameId)      games[e.gameId] = (games[e.gameId] || 0) + w;
    if (e.contentType) types[e.contentType] = (types[e.contentType] || 0) + w;
    if (e.authorId)    creators[e.authorId] = (creators[e.authorId] || 0) + w;
    if (Array.isArray(e.tags)) e.tags.forEach(t => { if (t) tags[t] = (tags[t] || 0) + w; });
    if (e.tsMs) {
      const h = new Date(e.tsMs).getUTCHours();
      if (h >= 0 && h < 24) hours[h]++;
    }
  });

  const rank = (obj, n = 10) => Object.entries(obj)
    .filter(([,v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, value]) => ({ name, value }));

  const affinity = {
    topGames: rank(games),
    topTags:  rank(tags, 15),
    topCreators: rank(creators, 25),
    topContentTypes: rank(types),
    activeHours: hours,
    totalEvents: total,
    lastRollupAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRollupAtMs: Date.now(),
  };

  await db.collection('users').doc(uid).collection('meta').doc('affinity')
    .set(affinity, { merge: true });
  return affinity;
}

/** Callable — lets the client force-refresh its own affinity (used by ad targeting). */
exports.rollupUserAffinity = functions.https.onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    // Respect consent: only roll up if personalizedAds is granted
    const c = await db.collection('users').doc(uid).collection('meta').doc('consents').get();
    if (c.data()?.personalizedAds?.granted !== true) {
      return { skipped: true, reason: 'consent-not-granted' };
    }
    const res = await rollupAffinityFor(uid);
    return { ok: true, ...res };
  }
);

/**
 * Scheduled — rolls up affinity for users who have recent events.
 * Runs daily at 03:30 UTC. Scans users with new events in the last 36h.
 */
exports.scheduledRollupAffinity = functions.scheduler
  .onSchedule('30 3 * * *', async () => {
    // Walk the collectionGroup of recent events to find active uids
    const since = Date.now() - 36 * 3600 * 1000;
    const recent = await db.collectionGroup('events')
      .where('tsMs', '>=', since)
      .select() // minimize reads — we only need paths
      .limit(20000)
      .get();

    const uids = new Set();
    recent.docs.forEach(d => {
      // path: users/{uid}/events/{eventId}
      const parts = d.ref.path.split('/');
      const uidIdx = parts.indexOf('users');
      if (uidIdx >= 0 && parts[uidIdx + 1]) uids.add(parts[uidIdx + 1]);
    });

    let count = 0;
    for (const uid of uids) {
      try { await rollupAffinityFor(uid); count++; } catch (e) { console.warn('rollup fail', uid, e.message); }
    }
    console.log(`rollupAffinity: rolled up ${count}/${uids.size} users`);
  });

/**
 * Scheduled — deletes raw events older than 90 days.
 * Affinity rollups survive; raw logs are GDPR-minimised.
 * Runs daily at 04:00 UTC.
 */
exports.scheduledPruneEvents = functions.scheduler
  .onSchedule('0 4 * * *', async () => {
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const old = await db.collectionGroup('events')
      .where('tsMs', '<', cutoff)
      .limit(5000)
      .get();
    if (old.empty) return;
    const batchSize = 400;
    let deleted = 0;
    for (let i = 0; i < old.docs.length; i += batchSize) {
      const b = db.batch();
      old.docs.slice(i, i + batchSize).forEach(d => b.delete(d.ref));
      await b.commit();
      deleted += Math.min(batchSize, old.docs.length - i);
    }
    console.log(`prunedEvents: deleted ${deleted}`);
  });
