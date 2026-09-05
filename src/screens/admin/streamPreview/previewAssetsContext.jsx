// One place every preview surface asks "what does this person look like?".
//
// ⚠ THREADING AN `avatars` PROP THROUGH EVERY SCREEN DOES NOT WORK, AND THIS IS
// THE SECOND TIME IT FAILED. Uploads were wired into the screens that took a
// prop, and seven surfaces that read `person.avatar` straight off the cast were
// missed: the profile sheet, the top-supporters cluster, the supporters sheet,
// the solo gifters row, the tip row and the squad grid. The founder uploaded
// faces and half the captures still showed identicons.
//
// A prop has to be remembered at every hop; a context cannot be forgotten. Any
// surface added later gets uploaded faces by calling `useFaces()` and nothing
// else, and there is no chain of parents to keep in sync.
//
// ⚠ IT RETURNS A RESOLVER, NOT A VALUE. `useFace(user)` would be a hook call
// inside the `.map()` that every one of these lists is built from, which breaks
// rules-of-hooks. `useFaces()` is called once at the top of a component and the
// function it returns is safe to call in a loop.
import { createContext, useContext, useMemo } from 'react';

const PreviewAssetsContext = createContext({ avatars: {}, videos: {}, sim: {}, role: 'viewer' });

export function PreviewAssetsProvider({ avatars = {}, videos = {}, sim = {}, role = 'viewer', children }) {
  const value = useMemo(() => ({ avatars, videos, sim, role }), [avatars, videos, sim, role]);
  return <PreviewAssetsContext.Provider value={value}>{children}</PreviewAssetsContext.Provider>;
}

// faceOf(user) -> the uploaded face if there is one, else whatever the cast
// carries (the identicon). Takes the whole user so a caller cannot pass the
// wrong id, and tolerates `id` as well as `uid` because PREVIEW_HOST uses `id`.
export function useFaces() {
  const { avatars } = useContext(PreviewAssetsContext);
  return useMemo(() => (user) => {
    if (!user) return null;
    const key = user.uid || user.id;
    return (key && avatars[key]) || user.avatar || null;
  }, [avatars]);
}

// videoFor('guest2') -> the clip for that tile, or null.
// ⚠ A SLOT MAP, NOT TWO NAMED PROPS. The co-host grid needs four different
// publishers and the PiP needs two; naming them individually meant the grid
// reused one clip for every guest.
export function usePreviewVideos() {
  const { videos } = useContext(PreviewAssetsContext);
  return useMemo(() => ({ videos, videoFor: (slot) => videos[slot] || null }), [videos]);
}

// ⚠⚠ THE WHOLE SIMULATOR, NOT A HANDFUL OF PROPS. This is the THIRD time the
// same defect has shipped: a control was wired on one surface, the data it
// needs was never threaded to the others, and nothing failed — it just did
// nothing there. Uploaded avatars, then the PiP video, then reactions: the
// founder found each one himself.
//
//   "why the fuck did i spend tokens getting it working on the solo immersive
//    if you havent done it on the other screens at the same time"
//
// A prop has to be remembered at every hop. A context cannot be forgotten, and
// a surface that calls this gets ALL of it or none of it — there is no state
// where a screen has the chat but not the reactions.
export function usePreviewSim() {
  const { sim } = useContext(PreviewAssetsContext);
  return sim;
}

// Who is watching: viewer | moderator | vanguard | host. Lives here rather than
// as a prop for the same reason avatars do — nine screens render <PreviewSheets>
// and a prop has to be remembered at every one of them.
export function usePreviewRole() {
  return useContext(PreviewAssetsContext).role;
}
