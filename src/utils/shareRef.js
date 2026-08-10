// withRef — append the current user's referral code to any shareable link so
// that organic content sharing (a clip, a stream, a profile) doubles as a
// referral link. captureReferral() in AppRouter reads ?ref on ANY route at
// module load, and shareLink/ugcRenderer forward it to the app, so a viewer
// who signs up credits the sharer (referrer +VP, referee +VP). Ties the
// content-virality loop to the referral reward with zero extra UI.
import { auth } from '../firebase/config';

export function withRef(url) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid || !url) return url;
    // Don't double-append.
    if (/[?&]ref=/.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}ref=${uid}`;
  } catch {
    return url;
  }
}
