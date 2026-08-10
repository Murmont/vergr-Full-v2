import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

// vergr.me analytics routes through a public Cloud Function so LOGGED-OUT
// visitors (the majority of vergr.me traffic) are counted — `vergrMeViews` is
// server-write-only in the rules. Best-effort: never throw into the UI.
const track = functions ? httpsCallable(functions, 'trackVergrMeEvent') : null;

const today = () => new Date().toISOString().slice(0, 10);
const seen = new Set();

async function send(payload) {
  if (!track) return;
  try { await track(payload); } catch (e) { /* analytics is best-effort */ }
}

export async function trackPageView(uid) {
  const key = `${uid}-${today()}`;
  if (seen.has(key)) return;
  seen.add(key);
  const device = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  // Referrer source (hostname only, never the full URL). Own hosts = direct.
  let ref = '';
  try {
    const h = document.referrer ? new URL(document.referrer).hostname : '';
    if (h && !/(^|\.)vergr\.(app|me)$/.test(h)) ref = h;
  } catch { /* opaque referrer */ }
  await send({ uid, event: 'view', device, ref });
}

export async function trackBlockClick(uid, blockId) {
  await send({ uid, event: 'block_click', blockId });
}

// Back-compat alias.
export async function trackLinkClick(uid, linkId) {
  await trackBlockClick(uid, linkId);
}

export async function trackMessageTap(uid) {
  await send({ uid, event: 'message' });
}

export async function trackEmailTap(uid) {
  await send({ uid, event: 'email' });
}

export async function trackTipTap(uid) {
  await send({ uid, event: 'tip' });
}
