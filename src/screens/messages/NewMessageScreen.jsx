import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  documentId,
  limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../firebase/config';
import { createConversation, getFollowing, getFollowers } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AddPhoneModal from '../../components/AddPhoneModal';
import { getTier } from '../../utils/helpers';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { contactsSupported, pickContacts } from '../../utils/nativeContacts';
import PermissionDisclosure, { DISCLOSURES } from '../../components/permissions/PermissionDisclosure';
import UserName from '../../components/UserName';

const matchContactHashes = httpsCallable(functions, 'matchContactHashes');

// SHA-256 a string via SubtleCrypto (browser-native). Returned as lowercase
// hex so the server can compare directly against stored `phoneHash`.
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Normalize a phone to E.164-ish. Returns null if we can't make one.
// We only accept numbers that already start with `+` — inferring country
// codes is a minefield and the Contact Picker usually returns them formatted.
function normalizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/[\s\-()]/g, '');
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
}

// Batch-fetch user docs by id in chunks of 10 (Firestore `in` limit).
async function fetchUsersByIds(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 10) chunks.push(unique.slice(i, i + 10));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(collection(db, 'users'), where(documentId(), 'in', chunk));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    })
  );
  return results.flat();
}

export default function NewMessageScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]); // followers + following merged
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [debouncing, setDebouncing] = useState(false);

  // Phone contacts — Contact Picker API on Chrome/Edge Android, the
  // VergrContacts Kotlin bridge on native (the WebView has no picker API).
  const [contacts, setContacts] = useState([]);
  const [contactsAsk, setContactsAsk] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactsAvailable = contactsSupported();

  // 3-dot menu + phone prompt state
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const hasPhone = !!profile?.phoneHash;

  // Load followers + following immediately so the user can pick a recent
  // connection without typing anything. We show the union, deduped and sorted
  // by name. Falls back silently on error — the search field still works.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    (async () => {
      try {
        const [following, followers] = await Promise.all([
          getFollowing(uid),
          getFollowers(uid),
        ]);
        const ids = new Set();
        for (const f of following) if (f.followingId) ids.add(f.followingId);
        for (const f of followers) if (f.followerId) ids.add(f.followerId);
        const users = await fetchUsersByIds([...ids]);
        const filtered = users
          .filter((u) => u.uid !== uid)
          .sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || ''));
        setSuggestions(filtered);
      } catch (err) {
        console.error('Failed to load connections:', err);
      } finally {
        setSuggestionsLoading(false);
      }
    })();
  }, []);

  // Username search (only runs when the user actually types something)
  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      setDebouncing(false);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setDebouncing(false);
      try {
        const q = query(
          collection(db, 'users'),
          where('username', '>=', search.toLowerCase()),
          where('username', '<=', search.toLowerCase() + '\uf8ff'),
          limit(10)
        );
        const snap = await getDocs(q);
        const users = snap.docs
          .map((d) => ({ uid: d.id, ...d.data() }))
          .filter((u) => u.uid !== auth.currentUser?.uid);
        setResults(users);
      } catch (err) {
        console.error('Search error:', err);
        showToast('Failed to search users', 'error');
      } finally {
        setLoading(false);
      }
    }, 400);
    setDebouncing(true);
    return () => clearTimeout(timer);
  }, [search, showToast]);

  // Filter the suggestions list locally as the user types — no extra reads.
  const visibleSuggestions = useMemo(() => {
    if (!search) return suggestions;
    const s = search.toLowerCase();
    return suggestions.filter((u) =>
      (u.username || '').toLowerCase().includes(s) ||
      (u.displayName || '').toLowerCase().includes(s)
    );
  }, [search, suggestions]);

  const startConversation = async (targetUser) => {
    try {
      setLoading(true);
      const convoId = await createConversation(
        auth.currentUser.uid,
        { id: targetUser.uid, ...targetUser },
        null
      );
      navigate(`/messages/${convoId}`);
    } catch (err) {
      console.error('Error starting conversation:', err);
      showToast('Could not start conversation', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Pull phone contacts via the Contact Picker API. Chrome Android / Edge
  // Android only — desktop browsers and iOS Safari do NOT expose this API,
  // so the button is hidden when unsupported.
  //
  // After the user picks, we SHA-256 each normalized phone in the browser
  // and send the hashes (never raw numbers) to `matchContactHashes` so we
  // can split the list into "on VERGR already" vs "needs an invite". The
  // match call requires the caller to have saved their own phone — if they
  // haven't, we prompt with the AddPhoneModal instead of failing silently.
  // Play requires a prominent disclosure BEFORE the contacts permission
  // prompt, so the button opens the disclosure and only its Continue runs
  // this. The phone check stays first: asking for contacts and then telling
  // someone they need a phone number on file is the wrong order.
  const askContacts = () => {
    if (!hasPhone) { setPhoneModalOpen(true); return; }
    setContactsAsk(true);
  };

  // NOTE: named runContactSync, NOT pickContacts. A local `pickContacts`
  // shadows the imported one and recurses into itself.
  const runContactSync = async () => {
    if (!hasPhone) {
      setPhoneModalOpen(true);
      return;
    }
    try {
      setContactsLoading(true);
      const picked = await pickContacts();

      // Normalize + hash each picked contact. We keep the raw phone only in
      // local state (never sent to the server) so the Invite button still
      // has a working `sms:` target.
      const entries = [];
      for (const c of picked) {
        const name = c.name || 'Unknown';
        const rawTel = c.tel || '';
        const norm = normalizePhone(rawTel);
        if (!norm) {
          // Couldn't normalize (no country code, etc.) — still surface it
          // as an invite-only row so the user can send an SMS manually.
          entries.push({ name, tel: rawTel, hash: null, match: null });
          continue;
        }
        const hash = await sha256Hex(norm);
        entries.push({ name, tel: norm, hash, match: null });
      }

      // Ask the server which of these hashes belong to registered users.
      const hashes = entries.map(e => e.hash).filter(Boolean);
      if (hashes.length > 0) {
        try {
          const res = await matchContactHashes({ hashes });
          const byHash = new Map((res.data?.matches || []).map(m => [m.phoneHash, m]));
          for (const e of entries) {
            if (e.hash && byHash.has(e.hash)) e.match = byHash.get(e.hash);
          }
        } catch (err) {
          console.warn('Contact match lookup failed:', err);
          // Non-fatal — fall through with everyone as invite-only.
        }
      }

      // Stable sort: VERGR matches first, then invite-only.
      entries.sort((a, b) => (b.match ? 1 : 0) - (a.match ? 1 : 0));
      setContacts(entries);
    } catch (err) {
      // User cancelled the native picker — no toast, no fuss.
      if (err && err.name !== 'AbortError') {
        console.error('Contact picker failed:', err);
      }
    } finally {
      setContactsLoading(false);
    }
  };

  const inviteContact = (contact) => {
    // Canonical domain + the sender's ref: an invited friend who signs up and
    // verifies a phone pays BOTH sides the referral VP.
    const body = encodeURIComponent(
      `Hey! Add me on Vergr. https://vergr.app/reflink?ref=${auth.currentUser?.uid || ''}`
    );
    // `sms:` with a `body` param opens the native SMS composer on iOS &
    // Android. Desktop falls back to the OS's default handler (usually
    // iMessage on macOS), or does nothing gracefully.
    window.location.href = `sms:${contact.tel}?body=${body}`;
  };

  return (
    <div className={isDesktop ? 'min-h-screen bg-bg-dark flex flex-col' : 'screen-container min-h-screen bg-bg-dark flex flex-col'}>
      {/* Header */}
      <header className="flex items-center gap-4 px-5 pt-12 pb-4 border-b border-white/[0.03] relative" style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' } : undefined}>
        <button
          onClick={() => navigate(-1)}
          className="text-white hover:text-brand-violet-light transition-colors"
        >
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className="text-xl font-syne font-black text-white uppercase italic tracking-tighter flex-1">
          Start New Chat
        </h1>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="text-white hover:text-brand-violet-light transition-colors p-1 -mr-1"
          aria-label="More options"
        >
          <Icon name="more_vert" size={22} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-14 right-3 z-[41] w-60 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden">
              <button
                onClick={() => { setMenuOpen(false); setPhoneModalOpen(true); }}
                className="w-full px-4 py-3 text-left text-sm flex items-start gap-3 hover:bg-surface-2 transition-colors"
              >
                <Icon name={hasPhone ? 'edit' : 'phone'} size={16} className="text-brand-violet-light mt-0.5 shrink-0" />
                <div>
                  <p className="text-white font-semibold">
                    {hasPhone ? 'Update phone number' : 'Add phone number'}
                  </p>
                  {!hasPhone && (
                    <p className="text-text-muted text-[11px] mt-0.5 leading-snug">
                      Unlock contact invites and earn <span className="text-brand-violet-light font-bold">+1000 VP</span>.
                    </p>
                  )}
                </div>
              </button>
            </div>
          </>
        )}
      </header>

      {/* Search Bar */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center bg-surface-2 rounded-2xl px-4 py-1 border border-white/[0.06] focus-within:border-brand-violet transition-all">
          <Icon name="search" size={18} className="text-text-muted mr-3" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDebouncing(e.target.value.length >= 2);
            }}
            className="flex-1 bg-transparent text-white py-3 text-sm outline-none placeholder:text-text-muted"
            placeholder="Search username or pick below..."
          />
          {(loading || debouncing) && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-violet" />
          )}
        </div>
      </div>

      {/* Contacts import (mobile only, supported browsers only) */}
      {contactsAvailable && !isDesktop && (
        <div className="px-5 pb-2">
          <button
            onClick={askContacts}
            disabled={contactsLoading}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-1 hover:bg-surface-2 border border-white/[0.06] transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center">
              <Icon name="contacts" size={20} />
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-sm text-white">Invite from contacts</p>
              <p className="text-xs text-text-muted">Pick people from your phone</p>
            </div>
            <Icon name="chevron_right" size={20} className="text-text-muted" />
          </button>
        </div>
      )}

      {/* Contacts list */}
      {contacts.length > 0 && (
        <div className="px-5 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2">From your contacts</p>
          <div className="space-y-1.5">
            {contacts.map((c, i) => {
              const onVergr = !!c.match;
              return (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-1 border border-white/[0.04]">
                  {onVergr ? (
                    <UserAvatar src={c.match.avatar} size={40} />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-sm font-bold text-text-secondary">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-white truncate">
                      {onVergr ? (c.match.displayName || c.match.username) : c.name}
                    </p>
                    <p className="text-xs text-text-muted font-dmmono truncate">
                      {onVergr ? `@${c.match.username} · ${c.name}` : c.tel}
                    </p>
                  </div>
                  {onVergr ? (
                    <button
                      onClick={() => startConversation(c.match)}
                      className="px-3 py-1.5 rounded-full bg-brand-violet text-white text-xs font-bold hover:brightness-110 transition-all"
                    >
                      Chat
                    </button>
                  ) : (
                    <button
                      onClick={() => inviteContact(c)}
                      className="px-3 py-1.5 rounded-full bg-surface-2 text-brand-violet-light text-xs font-bold border border-brand-violet/30 hover:bg-brand-violet/10 transition-all"
                    >
                      Invite
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {contactsAsk && (
        <PermissionDisclosure
          {...DISCLOSURES.contacts}
          onCancel={() => setContactsAsk(false)}
          onAllow={() => { setContactsAsk(false); runContactSync(); }}
        />
      )}

      {phoneModalOpen && (
        <AddPhoneModal
          onClose={() => setPhoneModalOpen(false)}
          onSaved={() => {
            setPhoneModalOpen(false);
            showToast('Phone saved — +1000 VP earned!', 'success');
            // profile.phoneHash will sync in via UserContext's live snapshot;
            // no manual refetch needed.
          }}
        />
      )}

      {/* Suggestions + search results */}
      <main className="flex-1 px-5 pb-10">
        {/* Section label */}
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2 mt-1">
          {search.length >= 2 && results.length > 0 ? 'Search results' : 'Your connections'}
        </p>

        {/* Loading shimmer for suggestions on first paint */}
        {suggestionsLoading && suggestions.length === 0 && (
          <div className="py-6 text-center text-brand-violet-light text-[10px] font-bold uppercase tracking-[0.3em] animate-pulse">
            Loading connections...
          </div>
        )}

        {/* Merged list: search results first (by username match), then connections */}
        <div className="space-y-1">
          {(() => {
            // De-dupe results & suggestions by uid; search results take priority.
            const byUid = new Map();
            for (const u of results) byUid.set(u.uid, u);
            for (const u of visibleSuggestions) if (!byUid.has(u.uid)) byUid.set(u.uid, u);
            const merged = [...byUid.values()];

            if (!suggestionsLoading && merged.length === 0) {
              return (
                <div className="py-10 text-center text-text-muted text-sm italic">
                  {search.length >= 2
                    ? `No one found matching "${search}"`
                    : 'Follow someone to start a chat, or search by username.'}
                </div>
              );
            }
            return merged.map((u) => {
              const tier = getTier(u.coinsSpent || 0);
              return (
                <button
                  key={u.uid}
                  onClick={() => startConversation(u)}
                  className="flex items-center gap-4 w-full p-3 rounded-2xl hover:bg-surface-1 active:bg-surface-2 transition-all group"
                >
                  <UserAvatar src={u.avatar} size={44} tier={tier} />
                  <div className="flex-1 text-left min-w-0">
                    <p className={`font-bold text-sm truncate ${tier.holographic ? 'text-brand-violet-light' : 'text-white'}`}>
                      <UserName user={u} masked />
                    </p>
                    <p className="text-text-muted text-xs font-dmmono truncate"><UserName user={u} masked handle /></p>
                  </div>
                  <Icon
                    name="chevron_right"
                    size={20}
                    className="text-text-muted group-hover:text-brand-violet-light transition-colors"
                  />
                </button>
              );
            });
          })()}
        </div>
      </main>
    </div>
  );
}
