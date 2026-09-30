// ONE switch for every translation surface in the app.
//
// OFF since 2026-09-16 (founder): the translator (LibreTranslate) runs on the
// second streaming box, which is switched off to save money until the app earns.
// Its endpoint answers 503, so every Translate button, the chat auto-translate
// menu item and the "Auto-translate" line in the Lite/Pro plans are hidden.
//
// To bring translation back: start box 2 (infra/box2-restore/RESTORE.md), check
// https://archive.vergr.app/lt/languages answers 200, set this to true, and
// restore the translate lines in the four help articles listed in
// docs/UPDATE_LOG.md (2026-09-16 entry).
//
// No imports on purpose: Tiersystem.js reads this, and node scripts import that.
export const TRANSLATION_ENABLED = false;
