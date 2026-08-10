// Typing-indicator freshness guard.
//
// `typingUsers` rides the conversation doc as [{ uid, name, at }]. The writer
// (useTyping) refreshes it on every keystroke and clears it ~3s after the last
// one. BUT on native the Tauri WebView freezes setTimeout while backgrounded,
// so a user who backgrounds the app mid-keystroke never runs that clear and the
// entry sticks forever → the OTHER account shows "typing…" permanently (founder
// report). Same class of bug as the RTDB-in-WebView presence freeze.
//
// Fix: readers ignore any typing entry older than TYPING_FRESH_MS, so a stale
// ghost clears itself even if the writer's clear never fired. Legacy entries
// with no `at` are treated as stale (clears existing ghosts on deploy).

export const TYPING_FRESH_MS = 6000;

export function freshTypers(list, myUid) {
  if (!Array.isArray(list)) return [];
  const now = Date.now();
  return list.filter((t) =>
    t?.uid
    && t.uid !== myUid
    && typeof t.at === 'number'
    && (now - t.at) < TYPING_FRESH_MS,
  );
}
