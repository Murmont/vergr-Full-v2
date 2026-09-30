// The ONLY import surface for unlockable effects.
//
// Screens import from here and never deep-import a path, so renaming, splitting
// or replacing an effect changes exactly one file and no screen notices.
//
//   import { Ambilight, useEffectEnabled } from '../components/effects';
//
// Adding an effect: create the file under visual/ audio/ triggers/, export it
// here, and add its row to `EFFECTS` in src/utils/rankUnlocks.js. Those are the
// only two edits. If a third is needed, the layout has drifted — see README.md.
//
// The avatar orbit was removed 2026-09-14 (founder): the live ring is the only
// ring on an avatar.

export { default as Ambilight } from './visual/Ambilight';
export { default as TypingGlyph } from './triggers/TypingStyles';
export { default as ChatGradient } from './visual/ChatGradient';
export { default as ProfileAudio } from './audio/ProfileAudio';
export { useEffectEnabled, effectsFor } from './useEffectEnabled';
