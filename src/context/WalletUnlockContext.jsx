// WalletUnlockContext — holds the short-lived HMAC unlock token returned by
// verifyWalletPin (5-min freshness window enforced server-side). Sensitive
// wallet callables (enrollWalletTotp, addWhitelistedAddress, verifyWalletTotp,
// future requestWithdrawal) require this token in their payload.
//
// API:
//   const { isUnlocked, unlockToken, requirePin, clearUnlock } = useWalletUnlock();
//   requirePin((tok) => { ... })  // if fresh, runs immediately; else opens modal
//
// We DO NOT persist the token across reloads — it lives in memory only. PIN
// re-entry on hard refresh is intentional (matches industry practice for
// withdrawal-capable wallets).

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useUser } from './UserContext';
import { adminMintWalletUnlockToken } from '../firebase/walletCallables';

const Ctx = createContext(null);

// Freshness window: 5 minutes matches the server-side TTL on the token.
const UNLOCK_TTL_MS = 5 * 60 * 1000;

export function WalletUnlockProvider({ children }) {
  const [unlockToken, setUnlockToken] = useState(null);
  const [unlockedAt, setUnlockedAt] = useState(0);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  // Stash the success callback while the PIN modal is open. Ref instead of
  // state so quick re-prompts don't clobber it.
  const pendingCb = useRef(null);
  const adminMintInFlight = useRef(null);

  const { profile } = useUser() || {};
  const isAdmin = profile?.role === 'admin';

  const isFresh = () => unlockToken && (Date.now() - unlockedAt) < UNLOCK_TTL_MS;

  const setUnlock = useCallback((token) => {
    setUnlockToken(token);
    setUnlockedAt(Date.now());
  }, []);

  const clearUnlock = useCallback(() => {
    setUnlockToken(null);
    setUnlockedAt(0);
  }, []);

  // Sensitive action gate. If a fresh token is in memory, run immediately
  // with it. Otherwise:
  //   - admin → server-side mint via adminMintWalletUnlockToken (no PIN prompt)
  //   - everyone else → open PinUnlockModal and run on success
  const requirePin = useCallback((onSuccess) => {
    if (isFresh()) {
      onSuccess?.(unlockToken);
      return;
    }
    if (isAdmin) {
      // Dedupe concurrent calls so we don't burn rate-limit quota.
      if (!adminMintInFlight.current) {
        adminMintInFlight.current = adminMintWalletUnlockToken({})
          .then((res) => {
            if (res?.unlockToken) setUnlock(res.unlockToken);
            return res?.unlockToken || null;
          })
          .catch((err) => {
            console.warn('[wallet] admin unlock mint failed, falling back to PIN', err?.message);
            return null;
          })
          .finally(() => { adminMintInFlight.current = null; });
      }
      adminMintInFlight.current.then((tok) => {
        if (tok) {
          onSuccess?.(tok);
        } else {
          // Mint failed — fall back to regular PIN prompt so the user isn't blocked.
          pendingCb.current = onSuccess || null;
          setPinPromptOpen(true);
        }
      });
      return;
    }
    pendingCb.current = onSuccess || null;
    setPinPromptOpen(true);
  }, [unlockToken, unlockedAt, isAdmin, setUnlock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by PinUnlockModal on successful verify.
  const _resolveUnlock = useCallback((token) => {
    setUnlock(token);
    setPinPromptOpen(false);
    const cb = pendingCb.current;
    pendingCb.current = null;
    if (cb) cb(token);
  }, [setUnlock]);

  const _cancelUnlock = useCallback(() => {
    setPinPromptOpen(false);
    pendingCb.current = null;
  }, []);

  const value = {
    unlockToken,
    unlockedAt,
    isUnlocked: !!isFresh(),
    requirePin,
    clearUnlock,
    // Modal-internal API (don't use from screens directly):
    _pinPromptOpen: pinPromptOpen,
    _resolveUnlock,
    _cancelUnlock,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWalletUnlock() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWalletUnlock must be used inside <WalletUnlockProvider>');
  return v;
}
