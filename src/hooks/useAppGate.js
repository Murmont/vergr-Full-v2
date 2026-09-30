// useAppGate: the three platform switches on Admin → App Config that the APP
// has to obey: maintenance mode, new registrations, direct messages.
//
// ⚠ Until 2026-09-21 all three were saved by the admin screen and read by
// NOTHING. "Maintenance Mode" never showed anyone the maintenance page.
//
// ⚠ IT COSTS NO EXTRA READS. It listens to app_config/general, the same doc
// useChatRelayFlag, useAdsTestMode and useNsfwPlatformFlag already listen to,
// and the Firestore SDK shares one watch target per document, so every hook on
// that doc rides one listener and one read per change.
//
// The FIRST render comes from localStorage (last known value), not from a
// snapshot that has not fired yet, so a user is not shown the app for a frame
// before the maintenance screen replaces it. Missing fields mean the switch is
// in its normal state (open / not in maintenance): an unset flag must never lock
// the platform.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const LS_KEY = 'vergr.appGate';
const DEFAULTS = { maintenance: false, registrationsOpen: true, dmsOpen: true, coda: 'on', codaLive: false };

function readLS() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return v && typeof v === 'object' ? { ...DEFAULTS, ...v } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

let cached = readLS();
const listeners = new Set();
let unsub = null;

function fromDoc(d) {
  return {
    maintenance: d?.maintenanceMode === true,
    registrationsOpen: d?.allowNewRegistrations !== false,
    dmsOpen: d?.allowDirectMessages !== false,
    // Codapay browser checkout: 'on' (unset) | 'staff' | 'off', plus whether Coda
    // is in production (written by the server). The server enforces the same gate
    // in startCodaOrder; this only decides whether the row is drawn.
    coda: ['staff', 'off'].includes(d?.codaCheckout) ? d.codaCheckout : 'on',
    codaLive: d?.codaEnv === 'production',
    // Google Play user choice billing has no availability call, so the app only
    // asks for it once this is switched on (after Google approves the program).
    playUserChoice: d?.playUserChoiceBilling === true,
    // Watch 3 ads, get boost coins (utils/adReward.js); raw fields, defaults applied there.
    adReward: {
      adAdsPerReward: d?.adAdsPerReward ?? null,
      adRewardBoostCoins: d?.adRewardBoostCoins ?? null,
      adRewardsPerDay: d?.adRewardsPerDay ?? null,
      adRewardCountries: Array.isArray(d?.adRewardCountries) ? d.adRewardCountries : null,
    },
  };
}

/** Whether this viewer is offered Codapay. Staff only while Coda is in sandbox. */
export function codaOfferedTo(gate, profile) {
  const staff = profile?.staff === true;
  if (!gate || gate.coda === 'off') return false;
  if (gate.coda === 'staff' || !gate.codaLive) return staff;
  return true;
}

function ensureSubscription() {
  if (unsub) return;
  try {
    unsub = onSnapshot(
      doc(db, 'app_config', 'general'),
      (snap) => {
        const next = fromDoc(snap.exists() ? snap.data() : null);
        if (JSON.stringify(next) === JSON.stringify(cached)) return;
        cached = next;
        try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
        for (const cb of listeners) try { cb(next); } catch { /* ignore */ }
      },
      () => { /* keep the last known value on error */ },
    );
  } catch { /* ignore */ }
}

export default function useAppGate() {
  const [gate, setGate] = useState(cached);
  useEffect(() => {
    ensureSubscription();
    setGate(cached);
    listeners.add(setGate);
    return () => { listeners.delete(setGate); };
  }, []);
  return gate;
}

// For event handlers that run outside React (e.g. a sign-in helper): the last
// known value, with the subscription started if it was not already.
export function currentAppGate() {
  ensureSubscription();
  return cached;
}
