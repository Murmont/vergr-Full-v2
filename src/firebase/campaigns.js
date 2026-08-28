// Campaigns, client side.
//
// A campaign is ONE shared document. Every user reads the same doc, so a
// campaign to the whole platform costs the same as a campaign to one person.
// Per-user state (seen, dismissed, clicked) is written only when the user
// actually engages, which is also where the metrics come from.
//
// The segment is applied HERE, on the client, and that is deliberate: campaign
// docs are world-readable, so a segment is curation, not secrecy. Anything
// genuinely private belongs in a restricted channel, which is gated by security
// rules, not in a campaign.

import {
  collection, doc, query, where, orderBy, limit as fbLimit,
  onSnapshot, getDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './config';

const COL = 'announcements';
const READS = 'announcement_reads';

// Anti-flicker cache. Per reference-first-frame-needs-sync-data, localStorage is
// the only read available at render time, so a dismissed popup must be
// suppressed from it BEFORE the Firestore read resolves or it flashes on screen
// every cold start. The Firestore doc remains the cross-device source of truth.
const seenKey = (campaignId) => `vergr.camp.${campaignId}`;

export function markSeenLocally(campaignId) {
  try { localStorage.setItem(seenKey(campaignId), '1'); } catch { /* private mode */ }
}
export function seenLocally(campaignId) {
  try { return localStorage.getItem(seenKey(campaignId)) === '1'; } catch { return false; }
}

/** Facts about the viewer that a segment can test. Mirrors segmentMatches on the server. */
export function viewerFacts(profile) {
  const createdMs = profile?.createdAt?.toMillis?.() || (profile?.createdAt ? Number(profile.createdAt) : 0);
  return {
    isGuest: profile?.isGuest === true,
    isBot: typeof profile?.accountType === 'string' && profile.accountType.includes('bot'),
    banned: profile?.banned === true,
    tier: profile?.subscription?.tier || profile?.subscription || 'free',
    role: profile?.role || 'user',
    creatorEnrolled: !!(profile?.creator?.enrolled || profile?.payoutEnrolled),
    accountAgeDays: createdMs ? Math.floor((Date.now() - createdMs) / 86400000) : 0,
  };
}

/** Byte-for-byte the same rule the server applies. Keep the two in step. */
export function segmentMatches(segment, facts) {
  if (!segment) return true;
  if (facts.isGuest || facts.isBot || facts.banned) return false;
  const inc = segment.include || {};
  if (inc.tiers?.length && !inc.tiers.includes(facts.tier || 'free')) return false;
  if (inc.roles?.length && !inc.roles.includes(facts.role || 'user')) return false;
  if (inc.creatorEnrolled && !facts.creatorEnrolled) return false;
  if (inc.minAccountAgeDays > 0) {
    if (!facts.accountAgeDays || facts.accountAgeDays < inc.minAccountAgeDays) return false;
  }
  return true;
}

/**
 * Live campaigns for a given surface.
 *
 * One listener, a handful of documents, cached by the SDK between app opens.
 * `status == 'sent'` is the equality that keeps this cheap and also means a
 * recalled campaign disappears from every device the moment it is recalled,
 * with no per-user cleanup.
 */
export function subscribeCampaigns(surface, profile, cb, max = 20) {
  const q = query(
    collection(db, COL),
    where('status', '==', 'sent'),
    orderBy('createdAt', 'desc'),
    fbLimit(max),
  );
  return onSnapshot(
    q,
    (snap) => {
      const facts = viewerFacts(profile);
      cb(snap.docs
        .map((d) => ({ campaignId: d.id, ...d.data() }))
        .filter((c) => c.surfaces?.[surface])
        .filter((c) => segmentMatches(c.segment, facts))
        .map((c) => ({
          campaignId: c.campaignId,
          ...(c.content?.en || {}),
          createdAtMs: c.createdAt?.toMillis?.() || 0,
          threadChannelId: c.surfaces?.thread?.channelId || null,
        })));
    },
    (err) => {
      if (err?.code !== 'permission-denied') console.warn('campaigns subscribe:', err);
      cb([]);
    },
  );
}

/** Has this user already engaged with this campaign, on ANY device? */
export async function alreadySeen(campaignId, uid) {
  if (!campaignId || !uid) return true;
  if (seenLocally(campaignId)) return true;
  try {
    const snap = await getDoc(doc(db, READS, `${campaignId}__${uid}`));
    return snap.exists();
  } catch {
    // Unreadable: treat as seen. Showing a popup twice is worse than not
    // showing it, and this path only happens offline or mid-token-refresh.
    return true;
  }
}

/**
 * Record an impression, open, click or dismiss.
 *
 * Writes the local suppression key FIRST so the UI reacts instantly and a
 * dismissed popup cannot reappear while the network call is still in flight.
 */
export function recordCampaignEvent(campaignId, event) {
  if (event === 'dismiss' || event === 'click') markSeenLocally(campaignId);
  return httpsCallable(getFunctions(undefined, 'europe-west1'), 'recordCampaignEvent')({ campaignId, event })
    .catch(() => {});
}
