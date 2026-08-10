// Thin wrappers for the wallet Cloud Function callables in functions/wallet.js.
// Source of truth for what each callable expects + returns lives in that file.
// This module just adapts the `httpsCallable` API to a clean promise-returning
// fn used by the React layer.

import { functions } from './config';
import { httpsCallable } from 'firebase/functions';

const call = (name) => async (payload) => {
  if (!functions) throw new Error('Firebase Functions not configured');
  const fn = httpsCallable(functions, name);
  const res = await fn(payload || {});
  return res.data;
};

// PIN lifecycle
export const setupWalletPin              = call('setupWalletPin');
export const verifyWalletPin             = call('verifyWalletPin');
export const changeWalletPin             = call('changeWalletPin');

// TOTP lifecycle
export const enrollWalletTotp            = call('enrollWalletTotp');
export const confirmWalletTotpEnrollment = call('confirmWalletTotpEnrollment');
export const verifyWalletTotp            = call('verifyWalletTotp');
export const useTotpRecoveryCode         = call('useTotpRecoveryCode');
export const disableWalletTotp           = call('disableWalletTotp');

// Address whitelist
export const addWhitelistedAddress       = call('addWhitelistedAddress');
export const removeWhitelistedAddress    = call('removeWhitelistedAddress');

// Read-only status
export const getMyWalletSecurityStatus   = call('getMyWalletSecurityStatus');

// Admin bypass — mints an unlock token without PIN. Server rejects non-admins.
export const adminMintWalletUnlockToken  = call('adminMintWalletUnlockToken');

// Phase 4 — withdrawals
export const requestWithdrawal           = call('requestWithdrawal');
export const cancelWithdrawal            = call('cancelWithdrawal');
export const getMyWithdrawals            = call('getMyWithdrawals');
