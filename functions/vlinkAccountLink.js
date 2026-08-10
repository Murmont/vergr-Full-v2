// Claim a Shopify store for the signed-in Vergr account.
//
// This used to live in shopifyApp.js, which is retired. It moved here rather
// than being deleted because Vergr Shop depends on it: the shopIntegration doc
// it writes is what functions/shopSync.js reads to sync a merchant's catalog
// into Vergr. Deleting it with the legacy app would have silently killed the
// "connect via the Shopify app" path in Vergr Shop, leaving only paste-a-token.
//
// The one-time code IS the authorisation: it is minted inside the embedded
// admin, which only that store's staff can open, so anyone holding it
// demonstrably had admin access. Codes are single-use and deleted on claim so
// a leaked URL is not a standing key to the store.
//
// Reads BOTH the VLink and legacy collections. VLink mints codes now; the
// legacy pair is only for codes already in flight when the old app retired and
// can be dropped once shopify_connect_codes is confirmed empty.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const CODE_TTL_MS = 30 * 60 * 1000; // long enough to sign in, short enough not to linger

/** Find a connect code in either collection. Returns {ref, shop, shopRef}. */
async function resolveCode(code) {
  const sources = [
    { codes: 'vlink_connect_codes', shops: 'vlink_shops' },
    { codes: 'shopify_connect_codes', shops: 'shopify_shops' },
  ];
  for (const src of sources) {
    const ref = db.collection(src.codes).doc(code);
    const snap = await ref.get();
    if (!snap.exists) continue;
    return {
      ref,
      shop: snap.data().shop,
      createdAt: snap.data().createdAt,
      shopRef: db.collection(src.shops).doc(snap.data().shop),
    };
  }
  return null;
}

exports.linkShopifyStore = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const code = String(req.data?.code || '').trim();
    if (!/^[a-f0-9]{32}$/.test(code)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid link code.');
    }

    const hit = await resolveCode(code);
    if (!hit) {
      throw new functions.https.HttpsError('not-found', 'This link has expired. Open the app in Shopify and try again.');
    }
    if (hit.createdAt?.toMillis && Date.now() - hit.createdAt.toMillis() > CODE_TTL_MS) {
      await hit.ref.delete().catch(() => {});
      throw new functions.https.HttpsError('deadline-exceeded', 'This link has expired. Open the app in Shopify and try again.');
    }

    const shopSnap = await hit.shopRef.get();
    if (!shopSnap.exists || !shopSnap.data().accessToken) {
      throw new functions.https.HttpsError('failed-precondition', 'That store is no longer connected.');
    }
    const shopData = shopSnap.data();

    const userSnap = await db.collection('users').doc(uid).get();
    const username = userSnap.exists ? userSnap.data().username : null;

    await hit.shopRef.set({
      vergrUid: uid,
      vergrUsername: username || null,
      linkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // The integration doc Vergr Shop's sync already understands, so the app
    // reuses the shipped pipeline instead of a parallel one.
    await db.collection('users').doc(uid).collection('private').doc('shopIntegration').set({
      provider: 'shopify',
      shopDomain: hit.shop,
      accessToken: shopData.accessToken,
      connectionType: 'app_oauth',
      shopName: shopData.shopName || hit.shop,
      currency: shopData.currency || 'EUR',
      connectedAt: FieldValue.serverTimestamp(),
      lastSyncError: null,
    }, { merge: true });
    await db.collection('shop_connected').doc(uid).set({
      provider: 'shopify', connectedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection('app_config').doc('general').set({ shopIntegrationsActive: true }, { merge: true });

    await hit.ref.delete().catch(() => {});
    return { ok: true, shop: hit.shop, username: username || null };
  },
);
