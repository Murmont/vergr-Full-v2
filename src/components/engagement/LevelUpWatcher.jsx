// Fires the level-up celebration when the signed-in user's VP level increases.
//
// ## Why this exists (audit A111)
//
// `LevelUpCelebration` was built and imported by NOTHING. Levelling up was
// completely silent: no modal, no toast, no push, no haptic. The single most
// important beat in a progression system existed as dead code.
//
// The level is derived from `wallet.vp` (the same source the profile screens
// use), and the last level seen is remembered per user in localStorage so the
// celebration fires exactly once per level, survives a reload, and does not
// re-fire on every mount.
//
// Deliberately does NOT fire on first sight of an account (no stored value):
// a brand new device would otherwise pop a "Level 12" modal at you for a level
// you earned months ago.

import { useEffect, useRef, useState } from 'react';
import { useUser } from '../../context/UserContext';
import { getVPLevel } from '../../utils/vpSystem';
import { getRankBanner } from '../../utils/rankBanners';
import { haptic } from '../../utils/haptics';
import LevelUpCelebration from './LevelUpCelebration';

const KEY = (uid) => `vergr.lastVpLevel.${uid}`;

export default function LevelUpWatcher() {
  const { profile, wallet } = useUser();
  const [shown, setShown] = useState(null);
  const busyRef = useRef(false);

  const uid = profile?.uid || profile?.id || null;
  const vp = wallet?.vp;

  useEffect(() => {
    if (!uid || vp == null) return;
    const level = getVPLevel(vp)?.level || 1;
    let previous = null;
    try { previous = Number(localStorage.getItem(KEY(uid))) || null; } catch { /* private mode */ }

    // First sight of this account on this device: record, never celebrate.
    if (!previous) {
      try { localStorage.setItem(KEY(uid), String(level)); } catch {}
      return;
    }
    if (level <= previous || busyRef.current) return;

    busyRef.current = true;
    try { localStorage.setItem(KEY(uid), String(level)); } catch {}
    try { haptic.heavy?.() || haptic.medium?.(); } catch {}
    setShown(level);
  }, [uid, vp]);

  if (!shown) return null;
  const rank = getRankBanner(shown);
  return (
    <LevelUpCelebration
      show
      level={shown}
      tierName={rank.name}
      onClose={() => { setShown(null); busyRef.current = false; }}
    />
  );
}
