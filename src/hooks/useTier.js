// src/hooks/useTier.js
import { useCallback } from 'react';
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
// Admins (founder + ops) bypass every paywall — effective tier is always 'pro'.
const ADMIN_EMAILS = ['vergenerd@gmail.com'];
function isAdminProfile(profile) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const email = (profile.email || '').toLowerCase();
  return ADMIN_EMAILS.includes(email);
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