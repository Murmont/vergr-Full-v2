import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { BLOCK_REGISTRY } from '../utils/vergrMeThemes';

const REF = (uid) => doc(db, 'users', uid, 'vergrMe', 'page');

export function useVergrMe(uid) {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      // No uid yet (auth still resolving). Keep loading until it arrives;
      // if auth never lands the caller already shows a skeleton.
      return;
    }
    let cancelled = false;
    getDoc(REF(uid))
      .then((snap) => {
        if (cancelled) return;
        setPage(snap.exists() ? snap.data() : null);
      })
      .catch((err) => {
        // Never hang the editor on a read error — fall through to init.
        console.error('useVergrMe load failed', err);
        if (!cancelled) setPage(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return { page, loading };
}

export function useMyVergrMe() {
  return useVergrMe(auth.currentUser?.uid);
}

// ---- Block helpers --------------------------------------------
let blockSeq = 0;
export function newBlock(type, fields = {}) {
  const reg = BLOCK_REGISTRY[type];
  return {
    id: `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`,
    type,
    enabled: true,
    clicks: 0,
    ...(reg ? reg.make() : {}),
    ...fields,
  };
}

// Build a blocks[] array from a legacy (link-list) page so existing
// pages keep working after the 2.0 upgrade. Non-destructive: callers
// keep links[] until the user saves blocks for the first time.
export function buildBlocksFromLegacy(page) {
  if (!page) return [];
  const blocks = [];
  if (page.showMessageBtn) blocks.push(newBlock('message', { label: 'Message on Vergr' }));
  if (page.showEmail && page.contactEmail)
    blocks.push(newBlock('email', { email: page.contactEmail, label: 'Connect with me' }));
  if (page.showSocials && page.socials && Object.values(page.socials).some(Boolean))
    blocks.push(newBlock('socials', { socials: page.socials }));
  (page.links || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((l) =>
      blocks.push(
        newBlock('link', {
          id: l.id,
          title: l.title,
          url: l.url,
          icon: l.icon || '🔗',
          subtitle: l.subtitle || '',
          enabled: l.enabled !== false,
          clicks: l.clicks || 0,
        })
      )
    );
  if (page.tipJarEnabled)
    blocks.push(newBlock('tip', { label: page.tipJarLabel || 'Buy me a coffee' }));
  return blocks.map((b, i) => ({ ...b, order: i }));
}

// Returns the page's blocks, migrating from legacy on the fly if needed.
export function getBlocks(page) {
  if (page?.blocks?.length) return page.blocks;
  return buildBlocksFromLegacy(page);
}

export function defaultPage(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName || profile.username,
    bio: profile.bio || '',
    useProfileAvatar: true,
    customAvatarUrl: null,
    theme: 'dark',
    accentColor: '#B44FFF',
    background: { type: 'gradient', overlayOpacity: 0.35 },
    colors: {},
    font: 'vergr',
    blockStyle: { shape: 'rounded', shadow: false, outline: false },
    linkStyle: 'classic',
    headerStyle: { layout: 'centered', variant: 'banner' },
    blocks: [
      newBlock('message', { label: 'Message on Vergr', order: 0 }),
      newBlock('socials', { socials: {}, order: 1 }),
    ],
    // legacy mirror (kept so older readers still render)
    showMessageBtn: true,
    showFollowers: true,
    showSocials: true,
    showEmail: false,
    contactEmail: null,
    socials: {},
    links: [],
    tipJarEnabled: false,
    tipJarLabel: 'Buy me a coffee',
    showShare: true,
    showSubscribe: true,
    hideBranding: false,
    isPublic: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

// Draft/publish model (single doc). The top-level flat fields ARE the live
// (published) content — every public reader keeps reading them unchanged.
// `draft` holds the in-progress edits; `published` is a snapshot equal to the
// flat fields; `hasUnpublishedChanges` flags a draft that differs from live.
// Infra/identity keys stay at the top level, never inside a content snapshot.
const INFRA_KEYS = new Set(['draft', 'published', 'hasUnpublishedChanges', 'createdAt', 'updatedAt', 'username']);
export function pageContent(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (!INFRA_KEYS.has(k)) out[k] = obj[k];
  return out;
}

export async function initVergrMePage(uid, profile) {
  const ref = REF(uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    // Edit the DRAFT when one exists; otherwise the live (flat) content, which
    // is promoted to a draft the first time the user saves. Hydrate blocks for
    // legacy docs without persisting yet.
    const editing = data.draft ? { ...data, ...data.draft } : data;
    return {
      ...editing,
      blocks: getBlocks(data.draft || data),
      hasUnpublishedChanges: !!data.hasUnpublishedChanges,
    };
  }
  const defaults = defaultPage(profile);
  const content = pageContent(defaults);
  await setDoc(ref, { ...defaults, draft: content, published: content, hasUnpublishedChanges: false });
  return { ...defaults, hasUnpublishedChanges: false };
}

// We use updateDoc (NOT setDoc merge:true) for both writes below: setDoc merge
// deep-merges nested maps, so a key the user REMOVES from a map (a cleared
// custom colour, a disabled redirect/pixel, etc.) would never be deleted
// server-side and would resurrect on reload. updateDoc replaces each named
// field wholesale. Falls back to a full setDoc if the doc doesn't exist yet
// (it normally does — initVergrMePage creates it before any edit).
async function writeVergrMe(uid, fields) {
  try {
    await updateDoc(REF(uid), fields);
  } catch (e) {
    if (e?.code === 'not-found') await setDoc(REF(uid), { ...fields, createdAt: serverTimestamp() });
    else throw e;
  }
}

// Save the working draft. Does NOT touch the live (published) page.
export async function saveVergrMeDraft(form) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await writeVergrMe(uid, { draft: pageContent(form), hasUnpublishedChanges: true, updatedAt: serverTimestamp() });
}

// Promote the draft to live. Mirrors content to the top-level flat fields so
// every existing reader (public page, SSR, enrich) sees the published snapshot.
export async function publishVergrMePage(form) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const content = pageContent(form);
  await writeVergrMe(uid, { ...content, draft: content, published: content, hasUnpublishedChanges: false, updatedAt: serverTimestamp() });
}

// ---- Legacy link helpers (kept for back-compat) ----------------
export async function addVergrMeLink(link) {
  const uid = auth.currentUser?.uid;
  const snap = await getDoc(REF(uid));
  const links = snap.data()?.links || [];
  links.push({ ...link, id: `l${Date.now()}`, clicks: 0, enabled: true, order: links.length });
  await updateDoc(REF(uid), { links, updatedAt: serverTimestamp() });
}

export async function removeVergrMeLink(linkId) {
  const uid = auth.currentUser?.uid;
  const snap = await getDoc(REF(uid));
  const links = (snap.data()?.links || []).filter((l) => l.id !== linkId);
  await updateDoc(REF(uid), { links, updatedAt: serverTimestamp() });
}
