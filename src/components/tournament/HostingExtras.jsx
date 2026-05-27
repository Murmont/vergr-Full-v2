// HostingExtras — host/admin tools for tournaments:
//   <SquadFundingModal />     squad members pool coins into prize pool
//   <SponsorSlotPanel />      admin attaches a sponsor (post-launch)
//   <SponsorBadge />          read-only sponsor display on tournament screens

import { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { getUserSquads } from '../../firebase/firestore';

const C = {
  surface: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)',
  gold: '#F0A500', goldLight: '#F5C842', cyan: '#4DFFD4',
};
const fns = () => getFunctions(undefined, 'europe-west1');

export function SquadFundingModal({ tournamentId, onClose, onFunded }) {
  const { showToast } = useUI();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'contributeToSquadTournament')({ tournamentId, amount });
      showToast(`+${amount} coins to prize pool`, 'success');
      onFunded?.(); onClose?.();
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 14, padding: 18, width: '100%', maxWidth: 380,
      }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: C.gold }}>Fund the prize pool</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
          Squad-only. Refunded if the tournament is cancelled.
        </div>
        <input type="range" min="50" max="5000" step="50" value={amount}
          onChange={(e) => setAmount(+e.target.value)} style={{ width: '100%', marginTop: 14 }} />
        <div style={{ textAlign: 'center', color: C.gold, fontWeight: 900, fontSize: 18 }}>{amount} c</div>
        <button onClick={send} disabled={busy} style={{
          width: '100%', marginTop: 12, padding: 12, borderRadius: 10, border: 'none',
          background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
          color: '#000', fontWeight: 900, fontSize: 13, cursor: 'pointer',
        }}>{busy ? 'Sending…' : `Contribute ${amount} coins`}</button>
      </div>
    </div>
  );
}

export function SponsorSlotPanel({ tournamentId, onClose }) {
  const { showToast } = useUI();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [url, setUrl] = useState('');
  const [contributionCoins, setContributionCoins] = useState(1000);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'attachTournamentSponsor')({
        tournamentId, sponsor: { name, logoUrl, url, contributionCoins },
      });
      showToast('Sponsor attached', 'success');
      onClose?.();
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 14, padding: 18, width: '100%', maxWidth: 420,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: C.cyan }}>Attach Sponsor</div>
        <Field v={name} set={setName} ph="Brand name" />
        <Field v={logoUrl} set={setLogoUrl} ph="Logo URL (https://...)" />
        <Field v={url} set={setUrl} ph="Link URL (https://...)" />
        <Field v={contributionCoins} set={(v) => setContributionCoins(+v || 0)} ph="Contribution coins" type="number" />
        <button onClick={submit} disabled={busy || !name} style={{
          padding: 10, borderRadius: 10, border: 'none', background: C.cyan, color: '#000',
          fontWeight: 900, fontSize: 13, cursor: 'pointer',
        }}>{busy ? 'Attaching…' : 'Attach sponsor'}</button>
      </div>
    </div>
  );
}

// GR7 — a squad owner sponsors this PUBLIC tournament from a squad treasury.
// The amount moves treasury → prize pool and bills the squad as a sponsor.
export function SquadSponsorModal({ tournamentId, onClose, onSponsored }) {
  const { showToast } = useUI();
  const { currentUser } = useAuth();
  const [squads, setSquads] = useState(null); // null=loading
  const [squadId, setSquadId] = useState('');
  const [amount, setAmount] = useState(500);
  const [showBranding, setShowBranding] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) return;
    getUserSquads(currentUser.uid)
      .then((all) => {
        const owned = (all || []).filter((s) => s.ownerId === currentUser.uid);
        setSquads(owned);
        if (owned[0]) setSquadId(owned[0].id);
      })
      .catch(() => setSquads([]));
  }, [currentUser?.uid]);

  const selected = (squads || []).find((s) => s.id === squadId);
  const treasury = selected?.treasury || 0;

  const send = async () => {
    if (!squadId || amount <= 0) return;
    if (amount > treasury) { showToast('Amount exceeds the squad treasury.', 'error'); return; }
    setBusy(true);
    try {
      await httpsCallable(fns(), 'sponsorTournamentFromTreasury')({ tournamentId, squadId, amount, showBranding });
      showToast(`Sponsored — ${amount} coins added to the prize pool`, 'success');
      onSponsored?.(); onClose?.();
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 14, padding: 18, width: '100%', maxWidth: 400,
      }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: C.cyan }}>Sponsor from squad treasury</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
          Adds coins from a squad you own to this tournament's prize pool, and bills your squad as a sponsor.
        </div>

        {squads === null ? (
          <div style={{ color: C.dim, fontSize: 13, padding: '18px 0', textAlign: 'center' }}>Loading…</div>
        ) : squads.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 13, padding: '18px 0', textAlign: 'center' }}>
            You don't own a squad. Only a squad owner can sponsor from the treasury.
          </div>
        ) : (
          <>
            <select value={squadId} onChange={(e) => setSquadId(e.target.value)} style={{
              width: '100%', marginTop: 12, padding: 10, borderRadius: 10,
              background: C.soft, color: C.text, border: `1px solid ${C.border}`, fontSize: 13,
            }}>
              {squads.map((s) => (
                <option key={s.id} value={s.id}>{s.tag ? `${s.tag} · ` : ''}{s.name} ({(s.treasury || 0).toLocaleString()}c)</option>
              ))}
            </select>
            <input type="range" min="50" max={Math.max(50, Math.min(50000, treasury))} step="50" value={Math.min(amount, treasury || 50)}
              onChange={(e) => setAmount(+e.target.value)} style={{ width: '100%', marginTop: 14 }} />
            <div style={{ textAlign: 'center', color: C.cyan, fontWeight: 900, fontSize: 18 }}>{amount} c</div>
            <div style={{ textAlign: 'center', color: C.dim, fontSize: 11 }}>Treasury: {treasury.toLocaleString()}c</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: C.dim, cursor: 'pointer' }}>
              <input type="checkbox" checked={showBranding} onChange={(e) => setShowBranding(e.target.checked)} />
              Show "Sponsored by {selected?.name || 'our squad'}" on the tournament
            </label>
            <button onClick={send} disabled={busy || amount > treasury} style={{
              width: '100%', marginTop: 12, padding: 12, borderRadius: 10, border: 'none',
              background: `linear-gradient(135deg, ${C.cyan}, #7B6FFF)`,
              color: '#000', fontWeight: 900, fontSize: 13, cursor: 'pointer', opacity: busy || amount > treasury ? 0.6 : 1,
            }}>{busy ? 'Sponsoring…' : `Sponsor ${amount} coins`}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function SponsorBadge({ sponsor }) {
  if (!sponsor?.name) return null;
  return (
    <a href={sponsor.url || '#'} target="_blank" rel="noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      borderRadius: 8, background: C.soft, border: `1px solid ${C.cyan}33`,
      color: C.cyan, fontSize: 11, fontWeight: 800, textDecoration: 'none',
    }}>
      {sponsor.logoUrl && <img src={sponsor.logoUrl} alt="" style={{ height: 16 }} />}
      <span>Sponsored by {sponsor.name}</span>
    </a>
  );
}

function Field({ v, set, ph, type = 'text' }) {
  return (
    <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} type={type}
      style={{
        padding: 10, borderRadius: 8, background: C.soft, color: C.text,
        border: `1px solid ${C.border}`, fontSize: 13,
      }} />
  );
}
