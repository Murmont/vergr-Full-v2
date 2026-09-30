// src/hooks/useTier.js
import { useCallback } from 'react';
import { auth } from '../firebase/config';
import { useUser } from '../context/UserContext';
import { getTierConfig, checkFeatureAccess, checkFileSizeAccess, resolveTier } from '../utils/tierSystem';

/**
 * useTier — Returns the current user's tier and helper functions.
 *
 * Reads the plan via resolveTier(profile) (the `subscription` field the
 * purchase flows actually write) from the shared UserContext profile (no extra Firestore
 * listener — UserContext already subscribes to the user doc once for the
 * whole app, so adding our own listener here was doubling read costs on
 * every profile/wallet update).
 */
// Staff bypass every paywall — effective tier is always 'pro'.
//
// ⚠ `staff` is a SERVER-ONLY field (firestore.rules lockedUserFields), which is
// what makes it safe to trust here. It replaced a hardcoded founder email, and
// that email was a backdoor: anyone who took the Gmail inherited it. Admin
// POWER is a Firebase Auth custom claim on an account with no profile at all
// (functions/operator.js); this flag is only perks.
function isAdminProfile(profile) {
  if (!profile) return false;
  return profile.staff === true || profile.role === 'admin';
}

export default function useTier() {
  const { profile } = useUser();
  const admin = isAdminProfile(profile);
  const tier = admin ? 'pro' : resolveTier(profile);

  const tierConfig = getTierConfig(tier);

  const checkFeature = useCallback((feature) => {
    return checkFeatureAccess(tier, feature);
  }, [tier]);

  const checkFileSize = useCallback((bytes) => {
    return checkFileSizeAccess(tier, bytes);
  }, [tier]);

  return {
    tier,
    tierConfig,
    checkFeature,
    checkFileSize,
    isPro: tier === 'pro',
    isLite: tier === 'lite',
    isFree: tier === 'free',
  };
}