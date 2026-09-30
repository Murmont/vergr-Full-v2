// "Who tried": purchase attempts that never reached our server.
//
// The server records every failure it sees (functions/paymentRecords.js). This
// covers the ones it cannot see: the buyer closed Google's sheet, the product
// would not load, Google refused to open the flow, a cash payment is pending.
// One document per attempt in payment_attempts, which firestore.rules lets an
// account CREATE for itself only, with a fixed set of fields, and never read or
// change. Shown on Admin → Economy → Payments.
//
// A successful purchase writes nothing here, and neither does a failure the
// server already recorded (code 'redeem_failed').
//
// NEVER throws and never awaits in the buy path's way: a logging failure must
// not become a purchase failure.

import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { APP_VERSION } from './appVersion';
import { IS_HUAWEI_BUILD, IS_STORE_BUILD } from './platform';

// Google Play Billing's BillingResponseCode values, by number.
const PLAY_CODES = {
  '-3': 'SERVICE_TIMEOUT', '-2': 'FEATURE_NOT_SUPPORTED', '-1': 'SERVICE_DISCONNECTED',
  0: 'OK', 1: 'USER_CANCELED', 2: 'SERVICE_UNAVAILABLE', 3: 'BILLING_UNAVAILABLE',
  4: 'ITEM_UNAVAILABLE', 5: 'DEVELOPER_ERROR', 6: 'ERROR', 7: 'ITEM_ALREADY_OWNED',
  8: 'ITEM_NOT_OWNED', 12: 'NETWORK_ERROR',
};

export function playCodeName(n) {
  if (n === null || n === undefined || n === '') return null;
  return PLAY_CODES[String(n)] || `CODE_${n}`;
}

/**
 * @param {object} a
 *   route      'google_play' | 'google_play_sub' | 'appgallery' | 'appgallery_sub' | 'coda'
 *   productId  what they tried to buy
 *   code       our code from the bridge: 'cancelled' | 'pending' | 'failed' | 'no_product' | 'launch_failed' | ...
 *   message    the bridge's / provider's message
 *   playCode   Google's numeric BillingResponseCode, when there is one
 *   stage      where it stopped: 'sheet' | 'launch' | 'load' | 'checkout'
 */
export function recordClientAttempt({ route, productId = null, code = 'failed', message = '', playCode = null, stage = 'sheet' }) {
  try {
    const uid = auth?.currentUser?.uid;
    if (!db || !uid || auth.currentUser.isAnonymous) return;
    if (code === 'redeem_failed') return; // the server recorded it with more detail
    const status = code === 'cancelled' ? 'cancelled' : code === 'pending' ? 'pending' : 'failed';
    const id = `client_${uid}_${Date.now()}`;
    const name = playCodeName(playCode);
    const error = {
      code: String(code).slice(0, 60),
      message: String(message || '').slice(0, 300),
      provider: route.startsWith('appgallery') ? 'huawei' : route.startsWith('google') ? 'google' : 'coda',
      providerCode: name,
    };
    const at = Date.now();
    setDoc(doc(db, 'payment_attempts', id), {
      attemptId: id, source: 'client', route, uid, productId: productId ? String(productId).slice(0, 80) : null,
      status, stage: String(stage).slice(0, 40), needsAttention: false,
      lastError: error,
      events: [{ at, source: 'client', type: stage === 'launch' ? 'sheet_error' : stage === 'load' ? 'product_not_loaded' : status === 'cancelled' ? 'sheet_cancelled' : status === 'pending' ? 'payment_pending' : 'sheet_error', status, error }],
      appVersion: APP_VERSION,
      platform: IS_HUAWEI_BUILD ? 'appgallery' : IS_STORE_BUILD ? 'play' : 'web',
      createdAt: serverTimestamp(), lastEventAt: serverTimestamp(),
    }).catch(() => {});
  } catch { /* never let logging break a purchase */ }
}
