import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { freshTypers, TYPING_FRESH_MS } from '../utils/typingFresh';
export default function useTyping(chatId) {
  const [typingUsers, setTypingUsers] = useState([]);
  const timeoutRef = useRef(null);
  const rawRef = useRef([]);            // last-seen typingUsers list (with `at`)
  useEffect(() => {
    if (!chatId || !auth.currentUser) return;
    const me = auth.currentUser.uid;
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
  }, [chatId]);
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
