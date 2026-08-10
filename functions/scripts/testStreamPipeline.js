// End-to-end live-stream pipeline smoke test against PRODUCTION.
// Creates a real stream session via the createStreamSession callable (the
// exact path the Go Live screen uses), prints the ingest endpoint + key so
// a synthetic ffmpeg broadcast can be pushed, then (with --status / --end)
// inspects the stream doc and CDN playlist and cleans up.
//
// Usage (from functions/):
//   GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/testStreamPipeline.js create
//   GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/testStreamPipeline.js status <streamId>
//   GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/testStreamPipeline.js end <streamId>

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'vergr-44494' });
const db = getFirestore('vgrdb');

const WEB_API_KEY = 'AIzaSyCuwlEMPFzhmXx_FqdWiYWlshuRT_EIkoI';
const FN_BASE = 'https://europe-west1-vergr-44494.cloudfunctions.net';
const UID = 'test_stream_pub';

async function idToken() {
  const custom = await admin.auth().createCustomToken(UID);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const out = await res.json();
  if (!out.idToken) throw new Error(`token exchange failed: ${JSON.stringify(out)}`);
  return out.idToken;
}

async function call(fn, data, token) {
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const out = await res.json().catch(() => ({}));
  return { status: res.status, out };
}

(async () => {
  const cmd = process.argv[2] || 'create';
  const streamId = process.argv[3];

  if (cmd === 'create') {
    // Pro-tier test publisher (paid tiers stream day-1, no follower gate).
    await db.collection('users').doc(UID).set({
      displayName: 'PIPELINE TEST', username: 'pipeline_test_bot',
      subscription: 'pro', isOnboarded: true, followerCount: 0,
    }, { merge: true });
    const token = await idToken();
    const r = await call('createStreamSession', {
      kind: 'public', mode: 'rtmp', title: 'PIPELINE SMOKE TEST (auto-delete)', game: 'cs2',
    }, token);
    console.log(JSON.stringify(r, null, 2));
    return process.exit(r.status === 200 ? 0 : 1);
  }

  if (cmd === 'status') {
    const d = await db.collection('streams').doc(streamId).get();
    const s = d.data() || {};
    console.log(JSON.stringify({
      exists: d.exists, status: s.status, nodeId: s.nodeId, ingestType: s.ingestType,
      streamKey: s.streamKey, viewerCount: s.viewerCount, startedAt: s.startedAt?.toMillis?.() || s.startedAt || null,
      orientation: s.orientation, hostPlan: s.hostPlan || s.plan,
    }, null, 2));
    return process.exit(0);
  }

  if (cmd === 'end') {
    const token = await idToken();
    const r = await call('endStreamSession', { streamId }, token);
    console.log('endStreamSession:', r.status, JSON.stringify(r.out).slice(0, 200));
    // Cleanup test docs.
    await db.collection('streams').doc(streamId).delete().catch(() => {});
    await db.collection('users').doc(UID).delete().catch(() => {});
    await admin.auth().deleteUser(UID).catch(() => {});
    console.log('cleaned up');
    return process.exit(0);
  }

  console.error('unknown cmd');
  process.exit(1);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
