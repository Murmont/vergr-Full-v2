// NativeNewMessageScreen — dedicated phone build of /messages/new.
// Reuses the web screen's Firestore helpers + contact-hash logic; rebuilt
// single-column with safe-area chrome, ≥44px targets, brand violet.
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, documentId, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../../firebase/config';
import { createConversation, getFollowing, getFollowers } from '../../../firebase/firestore';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import AddPhoneModal from '../../../components/AddPhoneModal';
import { getTier } from '../../../utils/helpers';
import { contactsSupported, pickContacts } from '../../../utils/nativeContacts';
import PermissionDisclosure, { DISCLOSURES } from '../../../components/permissions/PermissionDisclosure';

const matchContactHashes = httpsCallable(functions, 'matchContactHashes');

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/[\s\-()]/g, '');
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
}

async function fetchUsersByIds(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 10) chunks.push(unique.slice(i, i + 10));
  const results = await Promise.all(chunks.map(async (chunk) => {
    const q = query(collection(db, 'users'), where(documentId(), 'in', chunk));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  }));
  return results.flat();
}

export default function NativeNewMessageScreen() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [debouncing, setDebouncing] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsAsk, setContactsAsk] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  // VergrContacts Kotlin bridge on native (WebView has no navigator.contacts);
  // Contact Picker API as the web fallback.
  const contactsAvailable = contactsSupported();

  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const hasPhone = !!profile?.phoneHash;

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    (async () => {
      try {
        const [following, followers] = await Promise.all([getFollowing(uid), getFollowers(uid)]);
        const ids = new Set();
        for (const f of following) if (f.followingId) ids.add(f.followingId);
        for (const f of followers) if (f.followerId) ids.add(f.followerId);
        const users = await fetchUsersByIds([...ids]);
        setSuggestions(users
          .filter((u) => u.uid !== uid)
          .sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '')));
      } catch (err) {
        console.error('Failed to load connections:', err);
      } finally {
        setSuggestionsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (search.length < 2) { setResults([]); setDebouncing(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true); setDebouncing(false);
      try {
        const q = query(
          collection(db, 'users'),
          where('username', '>=', search.toLowerCase()),
          where('username', '<=', search.toLowerCase() + ''),
          limit(10)
        );
        const snap = await getDocs(q);
        setResults(snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.uid !== auth.currentUser?.uid));
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

  const visibleSuggestions = useMemo(() => {
    if (!search) return suggestions;
    const s = search.toLowerCase();
    return suggestions.filter((u) =>
      (u.username || '').toLowerCase().includes(s) ||
      (u.displayName || '').toLowerCase().includes(s));
  }, [search, suggestions]);

  const startConversation = async (targetUser) => {
    try {
      setLoading(true);
      const convoId = await createConversation(auth.currentUser.uid, { id: targetUser.uid, ...targetUser }, null);
      navigate(`/messages/${convoId}`);
    } catch (err) {
      console.error('Error starting conversation:', err);
      showToast('Could not start conversation', 'error');
    } finally {
      setLoading(false);
    }
  };

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
    if (!hasPhone) { setPhoneModalOpen(true); return; }
    try {
      setContactsLoading(true);
      const picked = await pickContacts();
      const entries = [];
      for (const c of picked) {
        const name = c.name || 'Unknown';
        const rawTel = c.tel || '';
        const norm = normalizePhone(rawTel);
        if (!norm) { entries.push({ name, tel: rawTel, hash: null, match: null }); continue; }
        entries.push({ name, tel: norm, hash: await sha256Hex(norm), match: null });
      }
      const hashes = entries.map(e => e.hash).filter(Boolean);
      if (hashes.length > 0) {
        try {
          const res = await matchContactHashes({ hashes });
          const byHash = new Map((res.data?.matches || []).map(m => [m.phoneHash, m]));
          for (const e of entries) if (e.hash && byHash.has(e.hash)) e.match = byHash.get(e.hash);
        } catch (err) { console.warn('Contact match lookup failed:', err); }
      }
      entries.sort((a, b) => (b.match ? 1 : 0) - (a.match ? 1 : 0));
      setContacts(entries);
    } catch (err) {
      if (err && err.name !== 'AbortError') console.error('Contact picker failed:', err);
    } finally {
      setContactsLoading(false);
    }
  };

  const inviteContact = (contact) => {
    // Canonical domain + the sender's ref: an invited friend who signs up and
    // verifies a phone pays BOTH sides the referral VP.
    const body = encodeURIComponent(`Hey! Add me on Vergr — the gamer social app. https://vergr.app/reflink?ref=${auth.currentUser?.uid || ''}`);
    window.location.href = `sms:${contact.tel}?body=${body}`;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      className="flex flex-col">
      <header className="flex items-center gap-3 px-4 pb-3 border-b border-white/[0.04] relative"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
        <button onClick={() => navigate(-1)} className="w-11 h-11 -ml-2 flex items-center justify-center text-white active:scale-95 transition-transform">
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className="text-lg font-syne font-black text-white uppercase italic tracking-tighter flex-1">Start New Chat</h1>
        <button onClick={() => setMenuOpen((v) => !v)} className="w-11 h-11 -mr-2 flex items-center justify-center text-white active:scale-95 transition-transform" aria-label="More options">
          <Icon name="more_vert" size={22} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-16 right-3 z-[41] w-60 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden">
              <button onClick={() => { setMenuOpen(false); setPhoneModalOpen(true); }}
                className="w-full px-4 py-3.5 text-left text-sm flex items-start gap-3 active:bg-surface-2 transition-colors">
                <Icon name={hasPhone ? 'edit' : 'phone'} size={16} className="text-brand-violet-light mt-0.5 shrink-0" />
                <div>
                  <p className="text-white font-semibold">{hasPhone ? 'Update phone number' : 'Add phone number'}</p>
                  {!hasPhone && (
                    <p className="text-text-muted text-[11px] mt-0.5 leading-snug">
                      Unlock contact invites and earn <span className="text-brand-violet-light font-bold">+100 VP</span>.
                    </p>
                  )}
                </div>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center bg-surface-2 rounded-2xl px-4 border border-white/[0.06] focus-within:border-brand-violet transition-all">
          <Icon name="search" size={18} className="text-text-muted mr-3" />
          <input value={search}
            onChange={(e) => { setSearch(e.target.value); setDebouncing(e.target.value.length >= 2); }}
            className="flex-1 bg-transparent text-white py-3.5 text-[15px] outline-none placeholder:text-text-muted"
            placeholder="Search username or pick below..." />
          {(loading || debouncing) && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-violet-light" />}
        </div>
      </div>

      {contactsAvailable && (
        <div className="px-4 pb-2">
          <button onClick={askContacts} disabled={contactsLoading}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-1 active:bg-surface-2 border border-white/[0.06] transition-all">
            <div className="w-11 h-11 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center">
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

      {contacts.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2">From your contacts</p>
          <div className="space-y-1.5">
            {contacts.map((c, i) => {
              const onVergr = !!c.match;
              return (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-1 border border-white/[0.04]">
                  {onVergr ? <UserAvatar src={c.match.avatar} size={40} /> : (
                    <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-sm font-bold text-text-secondary">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-white truncate">{onVergr ? (c.match.displayName || c.match.username) : c.name}</p>
                    <p className="text-xs text-text-muted font-dmmono truncate">{onVergr ? `@${c.match.username} · ${c.name}` : c.tel}</p>
                  </div>
                  {onVergr ? (
                    <button onClick={() => startConversation(c.match)}
                      className="px-4 py-2 rounded-full bg-brand-violet text-white text-xs font-bold active:scale-95 transition-all">Chat</button>
                  ) : (
                    <button onClick={() => inviteContact(c)}
                      className="px-4 py-2 rounded-full bg-surface-2 text-brand-violet-light text-xs font-bold border border-brand-violet/30 active:scale-95 transition-all">Invite</button>
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
        <AddPhoneModal onClose={() => setPhoneModalOpen(false)}
          onSaved={() => { setPhoneModalOpen(false); showToast('Phone saved — +100 VP earned!', 'success'); }} />
      )}

      <main className="flex-1 px-4 pb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2 mt-1">
          {search.length >= 2 && results.length > 0 ? 'Search results' : 'Your connections'}
        </p>

        {suggestionsLoading && suggestions.length === 0 && (
          <div className="py-6 text-center text-brand-violet-light text-[10px] font-bold uppercase tracking-[0.3em] animate-pulse">
            Loading connections...
          </div>
        )}

        <div className="space-y-1">
          {(() => {
            const byUid = new Map();
            for (const u of results) byUid.set(u.uid, u);
            for (const u of visibleSuggestions) if (!byUid.has(u.uid)) byUid.set(u.uid, u);
            const merged = [...byUid.values()];
            if (!suggestionsLoading && merged.length === 0) {
              return (
                <div className="py-10 text-center text-text-muted text-sm italic">
                  {search.length >= 2 ? `No one found matching "${search}"` : 'Follow someone to start a chat, or search by username.'}
                </div>
              );
            }
            return merged.map((u) => {
              const tier = getTier(u.coinsSpent || 0);
              return (
                <button key={u.uid} onClick={() => startConversation(u)}
                  className="flex items-center gap-4 w-full p-3 rounded-2xl active:bg-surface-1 transition-all">
                  <UserAvatar src={u.avatar} size={46} tier={tier} />
                  <div className="flex-1 text-left min-w-0">
                    <p className={`font-bold text-[15px] truncate ${tier.holographic ? 'text-brand-violet-light' : 'text-white'}`}>{u.displayName || u.username}</p>
                    <p className="text-text-muted text-xs font-dmmono truncate">@{u.username}</p>
                  </div>
                  <Icon name="chevron_right" size={20} className="text-text-muted" />
                </button>
              );
            });
          })()}
        </div>
      </main>
    </div>
  );
}
