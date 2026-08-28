// The one hook every effect call site uses.
//
// A screen asks "is this on for this person?" and gets a boolean. It never
// compares a level, never reads `cosmetics`, and never learns what an effect
// costs. That is the whole point of the split described in README.md: adding
// or retuning an effect touches its own file and the registry, and no screen.
//
// ⚠ Pass the profile of the person the effect BELONGS TO, not the viewer.
// On a public profile that is the profile owner; on your own it is you. Getting
// this backwards would show your unlocks on somebody else's page, which is the
// most obvious possible bug and also the easiest one to write.

import { useMemo } from 'react';
import { isEffectOn, EFFECTS } from '../../utils/rankUnlocks';

/**
 * @param {string} id       effect id from EFFECTS
 * @param {object} profile  the users/{uid} doc of the effect's OWNER
 * @returns {boolean}
 */
export function useEffectEnabled(id, profile) {
  // `vpLevel`, `role` and the opt-out map are the only inputs, so the memo key
  // is exactly those three. Depending on the whole profile object would
  // recompute on every unrelated snapshot change.
  const level = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  const opt = profile?.cosmetics?.fx?.[id];
  return useMemo(
    () => isEffectOn(id, { vpLevel: level, cosmetics: { fx: { [id]: opt } } }),
    [id, level, opt],
  );
}

/**
 * Every effect and whether it is unlocked / on, for the settings screen where
 * a user turns them off. Returns rows, not a map, so the order is the ladder's.
 */
export function effectsFor(profile) {
  const level = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  return EFFECTS.map((e) => ({
    ...e,
    unlocked: level >= e.level,
    on: isEffectOn(e.id, profile),
  }));
}
