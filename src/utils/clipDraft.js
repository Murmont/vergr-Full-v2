// A video handed from the post composer to /create/clip (founder decision,
// 2026-09-13: a video added in the composer is made in the clip editor).
//
// A File cannot ride in a URL, and does not need to survive a reload: it lives
// for one navigation. Taking it clears it, so going back and forward again can
// never resurrect a video the user already dealt with. The caption typed in the
// composer rides along so switching to the editor loses nothing.
let draft = null;

export const setClipDraft = (file, { caption = '' } = {}) => {
  draft = file ? { file, caption: String(caption || ''), at: Date.now() } : null;
};

export const takeClipDraft = () => {
  const d = draft;
  draft = null;
  return d && Date.now() - d.at < 60_000 ? d : null;
};
