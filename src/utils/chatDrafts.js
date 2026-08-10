// chatDrafts — per-chat composer drafts (Telegram behaviour: typed text
// survives leaving the chat; the inbox row shows "Draft: …" in red).
// localStorage keyed per chat; bounded length; cleared on send.

const KEY = (chatId) => `vergr.draft.${chatId}`;

export function getDraft(chatId) {
  if (!chatId) return '';
  try { return localStorage.getItem(KEY(chatId)) || ''; } catch { return ''; }
}

export function saveDraft(chatId, text) {
  if (!chatId) return;
  try {
    const t = (text || '').slice(0, 4000);
    if (t.trim()) localStorage.setItem(KEY(chatId), t);
    else localStorage.removeItem(KEY(chatId));
  } catch {/* storage full/blocked — drafts are best-effort */}
}

export function clearDraft(chatId) {
  if (!chatId) return;
  try { localStorage.removeItem(KEY(chatId)); } catch {/* ignore */}
}
