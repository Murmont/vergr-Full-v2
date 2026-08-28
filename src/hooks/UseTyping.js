import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { freshTypers, TYPING_FRESH_MS } from '../utils/typingFresh';
export default function useTyping(chatId) {
  const [typingUsers, setTypingUsers] = useState([]);
  const timeoutRef = useRef(null);
  const rawRef = useRef([]);            // last-seen typingUsers list (with `at`)

  // ⚠ AUTH ARRIVES AFTER THE FIRST RENDER, and this hook used to give up on it.
  //
  // The subscription below read `auth.currentUser` directly with `[chatId]` as
  // its only dependency. On a COLD LOAD straight into /messages/:id — a reload,
  // a pasted link, a push notification, the native app's launch route — Firebase
  // has not restored the session yet, so `auth.currentUser` is null, the effect
  // returned early, and nothing ever re-ran it. **The thread's typing listener
  // was dead for that entire session**, while the inbox row (which subscribes
  // elsewhere) kept working, so it looked like a rendering bug rather than a
  // dead listener. Reproduced live: reload a DM, have the other account type,
  // and the row says "typing…" while the thread says "ACTIVE NOW".
  //
  // Same class as [[reference-auth-null-is-not-signed-out]]: a null user at boot
  // means "not known yet", never "signed out".
  const [meUid, setMeUid] = useState(() => auth.currentUser?.uid || null);
  useEffect(() => onAuthStateChanged(auth, (u) => setMeUid(u?.uid || null)), []);

  useEffect(() => {
    if (!chatId || !meUid) return;
    const me = meUid;
    const recompute = () => setTypingUsers(freshTypers(rawRef.current, me));
    const unsub = onSnapshot(doc(db, 'conversations', chatId), (snap) => {
      const data = snap.data();
      let list = data?.typingUsers || [];
      // Back-compat for the old single `typing` uid field (no timestamp → stale
      // after the window, like everything else).
      if (list.length === 0 && data?.typing && data.typing !== me) {
        list = [{ uid: data.typing, name: 'User', at: Date.now() }];
      }
      rawRef.current = list;
      recompute();
    }, () => {});
    // Local ticker — clears a stale "typing…" even when no new snapshot arrives
    // (e.g. the other client backgrounded and never wrote its clear).
    const tick = setInterval(recompute, 1500);
    return () => { unsub(); clearInterval(tick); };
  }, [chatId, meUid]);   // meUid, or a cold load never subscribes — see above
  const setTyping = useCallback(() => {
    if (!chatId || !auth.currentUser) return;
    clearTimeout(timeoutRef.current);
    const entry = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || 'User', at: Date.now() };
    updateDoc(doc(db, 'conversations', chatId), { typingUsers: [entry] }).catch(() => updateDoc(doc(db, 'conversations', chatId), { typing: auth.currentUser.uid }).catch(() => {}));
    timeoutRef.current = setTimeout(() => { updateDoc(doc(db, 'conversations', chatId), { typingUsers: [] }).catch(() => updateDoc(doc(db, 'conversations', chatId), { typing: null }).catch(() => {})); }, 3000);
  }, [chatId]);
  const clearTyping = useCallback(() => {
    if (!chatId) return;
    clearTimeout(timeoutRef.current);
    updateDoc(doc(db, 'conversations', chatId), { typingUsers: [] }).catch(() => updateDoc(doc(db, 'conversations', chatId), { typing: null }).catch(() => {}));
  }, [chatId]);
  return { typingUsers, setTyping, clearTyping };
}
export { TYPING_FRESH_MS };
