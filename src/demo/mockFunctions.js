/**
 * DEMO-ONLY firebase/functions shim. No Cloud Functions exist in the demo, so
 * every callable resolves with a benign result. Add per-name shapes to
 * OVERRIDES if a screen needs a specific payload to render.
 */
const OVERRIDES = {
  getTurnCredentials: { iceServers: [] },
  translateContent: { translated: '', text: '' },
  getMyMemberships: { memberships: [] },
  getEventTicketStatus: { owned: false, status: 'none' },
  getLiveDiscoveryFeed: { streams: [] },
  claimQuestReward: { ok: true },
  // Wallet: pretend everything is already set up so the demo never shows the
  // PIN / KYC / 2FA setup gates.
  getMyWalletSecurityStatus: { pinSet: true, totpEnrolled: true, twoFactorEnabled: true, kycLevel: 3, addressWhitelisted: true, frozen: false, onboardingCompleted: true },
  getMyWithdrawals: { withdrawals: [] },
  getEventLoad: { events: [], capacity: 0 },
};

export function getFunctions() { return { _t: 'fns' }; }
export function connectFunctionsEmulator() {}
export function httpsCallable(_fns, name) {
  return async () => ({ data: OVERRIDES[name] !== undefined ? OVERRIDES[name] : { success: true } });
}
export function httpsCallableFromURL() { return async () => ({ data: { success: true } }); }
export default { getFunctions };
