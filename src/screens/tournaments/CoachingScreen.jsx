// GR6 — Coaching marketplace. Browse pro coaches, book a paid slot (coins,
// 10% platform fee), and manage your own listing. Reached from /coaching and
// surfaced on the tournament loss screen (?game=<label>).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { TOURNAMENT_GAMES } from '../../utils/tournamentGames';

const fns = () => getFunctions(undefined, 'europe-west1');
const GAME_PICKS = TOURNAMENT_GAMES.filter((g) => g.detection !== 'manual').slice(0, 12).map((g) => g.label);

export default function CoachingScreen() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const gameFilter = params.get('game') || '';

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(gameFilter);
  const [mine, setMine] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadListings = async (g) => {
    setLoading(true);
    try {
      const base = collection(db, 'coaching_listings');
      const q = g
        ? query(base, where('active', '==', true), where('game', '==', g), limit(50))
        : query(base, where('active', '==', true), limit(50));
      const snap = await getDocs(q);
      setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
      setListings([]);
    }
    setLoading(false);
  };

  useEffect(() => { loadListings(filter); }, [filter]);
  useEffect(() => {
    if (!currentUser?.uid) return;
    getDoc(doc(db, 'coaching_listings', currentUser.uid))
      .then((s) => { if (s.exists()) setMine({ id: s.id, ...s.data() }); })
      .catch(() => {});
  }, [currentUser?.uid]);

  const book = async (coachUid) => {
    if (busyId) return;
    setBusyId(coachUid);
    try {
      const { data } = await httpsCallable(fns(), 'bookCoaching')({ coachUid });
      showToast(`Booked — ${data.price} coins. Opening chat to schedule…`, 'success');
      navigate(`/messages/${data.threadId}`);
    } catch (err) {
      showToast(err?.message || 'Booking failed', 'error');
    } finally { setBusyId(null); }
  };

  return (
    <div className="min-h-screen pb-20">
      <TopBar showBack title="Coaching" subtitle="Learn from pro players" />
      <div className="px-4 pt-4 max-w-3xl mx-auto space-y-5">

        {/* Become / edit coach */}
        <div className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">{mine ? 'Your coaching listing' : 'Become a coach'}</p>
              <p className="text-text-muted text-xs mt-0.5">
                {mine ? `${mine.active ? 'Active' : 'Hidden'} · ${mine.pricePerSlot}c / ${mine.durationMin}min` : 'List a paid coaching slot. You keep 90% (10% platform fee).'}
              </p>
            </div>
            <button onClick={() => setEditing(true)}
              className="px-3 py-2 rounded-xl bg-brand-cyan/15 border border-brand-cyan/30 text-brand-cyan text-xs font-bold">
              {mine ? 'Edit' : 'Create listing'}
            </button>
          </div>
        </div>

        {/* Game filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <Chip active={!filter} onClick={() => setFilter('')} label="All games" />
          {GAME_PICKS.map((g) => <Chip key={g} active={filter === g} onClick={() => setFilter(g)} label={g} />)}
        </div>

        {/* Listings */}
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-3 border-brand-cyan border-t-transparent rounded-full animate-spin" /></div>
        ) : listings.filter((l) => l.coachUid !== currentUser?.uid).length === 0 ? (
          <div className="text-center py-16">
            <Icon name="school" size={48} className="text-text-muted/20 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No coaches{filter ? ` for ${filter}` : ''} yet.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {listings.filter((l) => l.coachUid !== currentUser?.uid).map((l) => (
              <div key={l.id} className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar src={l.coachAvatar} size={40} championUntilMs={l.championFrameUntil} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{l.coachName}</p>
                    <p className="text-text-muted text-xs">{l.game}</p>
                  </div>
                </div>
                <p className="text-sm font-semibold mt-3">{l.title}</p>
                {l.blurb && <p className="text-text-secondary text-xs mt-1 leading-relaxed">{l.blurb}</p>}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-brand-gold font-dmmono font-bold">{l.pricePerSlot}c <span className="text-text-muted text-[10px]">/ {l.durationMin}min</span></span>
                  <button onClick={() => book(l.coachUid)} disabled={busyId === l.coachUid}
                    className="px-4 py-2 rounded-xl bg-brand-cyan text-bg-dark text-xs font-bold disabled:opacity-50">
                    {busyId === l.coachUid ? 'Booking…' : 'Book'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ListingEditor
          existing={mine}
          onClose={() => setEditing(false)}
          onSaved={(l) => { setMine(l); setEditing(false); loadListings(filter); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
        active ? 'bg-brand-cyan text-bg-dark' : 'bg-surface-2 text-text-secondary hover:text-white'
      }`}>{label}</button>
  );
}

function ListingEditor({ existing, onClose, onSaved, showToast }) {
  const [game, setGame] = useState(existing?.game || GAME_PICKS[0] || 'Counter-Strike 2');
  const [title, setTitle] = useState(existing?.title || '');
  const [price, setPrice] = useState(existing?.pricePerSlot || 500);
  const [duration, setDuration] = useState(existing?.durationMin || 30);
  const [blurb, setBlurb] = useState(existing?.blurb || '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'upsertCoachingListing')({
        game, title: title.trim(), pricePerSlot: Math.floor(price), durationMin: Math.floor(duration), blurb: blurb.trim(), active,
      });
      showToast('Listing saved', 'success');
      onSaved?.({ coachUid: existing?.coachUid, game, title: title.trim(), pricePerSlot: Math.floor(price), durationMin: Math.floor(duration), blurb: blurb.trim(), active });
    } catch (err) { showToast(err?.message || 'Save failed', 'error'); }
    finally { setBusy(false); }
  };

  const input = 'w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-white/[0.08] text-text-primary text-sm outline-none';
  return (
    <div onClick={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-surface-1 border border-white/10 p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <p className="font-bold text-base">{existing ? 'Edit listing' : 'Create coaching listing'}</p>
        <div>
          <label className="text-text-muted text-[10px] uppercase tracking-wider">Game</label>
          <select value={game} onChange={(e) => setGame(e.target.value)} className={input}>
            {GAME_PICKS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-text-muted text-[10px] uppercase tracking-wider">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Radiant VALORANT aim + positioning" className={input} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-text-muted text-[10px] uppercase tracking-wider">Price (coins)</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={1} className={input} />
          </div>
          <div className="flex-1">
            <label className="text-text-muted text-[10px] uppercase tracking-wider">Minutes</label>
            <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min={1} max={480} className={input} />
          </div>
        </div>
        <div>
          <label className="text-text-muted text-[10px] uppercase tracking-wider">About</label>
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={400} rows={3} placeholder="What you coach, rank, what a session covers…" className={`${input} resize-none`} />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Listing active (visible in the marketplace)
        </label>
        <p className="text-text-muted text-[11px]">You receive {Math.floor(price * 0.9)}c per booking (10% platform fee).</p>
        <button onClick={save} disabled={busy} className="w-full py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm disabled:opacity-50">
          {busy ? 'Saving…' : 'Save listing'}
        </button>
      </div>
    </div>
  );
}
