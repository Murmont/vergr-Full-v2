// Thin wrappers for the account-level TOTP 2FA callables in
// functions/accountSecurity.js (Settings → Security).
import { functions } from './config';
import { httpsCallable } from 'firebase/functions';

const call = (name) => async (payload) => {
  if (!functions) throw new Error('Firebase Functions not configured');
  const fn = httpsCallable(functions, name);
  const res = await fn(payload || {});
  return res.data;
};

export const enrollAccountTotp            = call('enrollAccountTotp');
export const confirmAccountTotpEnrollment = call('confirmAccountTotpEnrollment');
export const verifyAccountTotp            = call('verifyAccountTotp');
export const disableAccountTotp           = call('disableAccountTotp');
export const getMyAccountSecurityStatus   = call('getMyAccountSecurityStatus');
