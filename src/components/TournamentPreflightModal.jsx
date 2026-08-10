// TournamentPreflightModal — the checklist + check-in + launch flow.
//
// Opens from TournamentSummonsBanner. Calls getTournamentPreflight to load
// the requirement list, shows each requirement with a green tick or a red
// "fix this" CTA. When all checks pass, the bottom CTA flips from
// "Check in" → "Check in + go to match".

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import { spring } from './primitives/springs';
import { haptic } from '../utils/haptics';

const C = {
  bg: '#12121e',
  bgSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  textMuted: 'rgba(255,255,255,0.45)',
  gold: '#F0A500',
  goldLight: '#F5C842',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
};

export default function TournamentPreflightModal({ tournamentId, onClose, onLaunchMatch }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fns = getFunctions(undefined, 'europe-west1');

  const fetchPreflight = async () => {
    setLoading(true);
    try {
      const { data } = await httpsCallable(fns, 'getTournamentPreflight')({ tournamentId });
      setPreflight(data);
    } catch (err) {
      showToast(err?.message || 'Could not load pre-flight', 'error');
      onClose?.();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPreflight(); }, [tournamentId]);

  const fixRequirement = (req) => {
    if (!req.action) return;
    onClose?.();
    if (req.action.kind === 'link' || req.action.kind === 'gsi-install') {
      navigate('/settings/linked-accounts');
    } else if (req.action.kind === 'profile') {
      navigate('/settings/profile');
    } else if (req.action.kind === 'go-live') {
      navigate('/go-live');
    }
  };

  const handleCheckIn = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns, 'tournamentParticipantCheckIn')({ tournamentId });
      haptic.success();
      // Refresh pre-flight to reflect checked-in state, then attempt to
      // route to the user's current match if the tournament is already active.
      const fresh = await httpsCallable(fns, 'getTournamentPreflight')({ tournamentId });
      setPreflight(fresh.data);
      if (fresh.data.status === 'active' || fresh.data.status === 'in_progress') {
        const matchPath = await findCurrentMatchPath(tournamentId, currentUser?.uid);
        if (matchPath) {
          onLaunchMatch?.(matchPath);
          return;
        }
      }
      showToast("You're checked in. We'll route you to the match the moment it opens.", 'success');
    } catch (err) {
      showToast(err?.message || 'Check-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remainingLabel = (() => {
    const ms = preflight?.timeUntilStartMs;
    if (ms == null) return null;
    if (ms < 1000) return 'starting now';
    if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
    return `${Math.ceil(ms / 60_000)}m`;
  })();

  const allOk = !!preflight && preflight.requirements.every((r) => r.ok);
  const alreadyCheckedIn = !!preflight?.requirements.find((r) => r.key === 'checkin' && r.ok);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      padding: 16,
    }}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.bouncy}
        style={{
          width: 'min(480px, 100%)', background: C.bg, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 18,
          fontFamily: '"Inter", system-ui, sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 18px',
          background: `linear-gradient(135deg, ${C.gold}22, ${C.goldLight}11)`,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name="emoji_events" size={20} className="" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Pre-flight check</div>
            <div style={{ fontSize: 11, color: C.textDim }}>
              {remainingLabel ? `Starts in ${remainingLabel}` : 'Get ready to compete'}
              {preflight?.game && ` · ${preflight.game}`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 4,
          }}>
            <Icon name="close" size={18} className="" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, maxHeight: '60vh', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
              Loading checklist…
            </div>
          ) : preflight ? (
            <>
              {/* Detection-tier card — be honest about which mechanism is in play. */}
              {preflight.detection && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', borderRadius: 10, marginBottom: 12,
                  background: C.bgSoft, border: `1px solid ${detectionAccent(preflight.detection)}55`,
                }}>
                  <span className="material-symbols-outlined" style={{
                    fontSize: 18, color: detectionAccent(preflight.detection), marginTop: 1,
                  }}>{detectionIcon(preflight.detection)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800,
                      color: detectionAccent(preflight.detection),
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {detectionLabel(preflight.detection)}
                    </div>
                    <div style={{ fontSize: 12, color: C.text, marginTop: 3, lineHeight: 1.4 }}>
                      {preflight.detectionLabel}
                    </div>
                  </div>
                </div>
              )}
              {preflight.instructions && (
                <div style={{
                  fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 14,
                  padding: 10, borderRadius: 10,
                  background: C.bgSoft, border: `1px solid ${C.border}`,
                }}>
                  {preflight.instructions}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {preflight.requirements.map((req) => (
                  <CheckItem key={req.key} req={req} onFix={() => fixRequirement(req)} />
                ))}
              </div>

              <div style={{
                fontSize: 10, color: C.textMuted, marginTop: 14, lineHeight: 1.5,
              }}>
                Don't see your match yet? Check in anyway — we'll route you the moment the
                host starts the tournament. If you don't check in before grace ends, you'll
                be refunded and removed.
              </div>
            </>
          ) : null}
        </div>

        {/* Footer CTA */}
        <div style={{
          padding: 14, borderTop: `1px solid ${C.border}`,
          background: C.bgSoft,
        }}>
          {alreadyCheckedIn ? (
            <button onClick={async () => {
              const matchPath = await findCurrentMatchPath(tournamentId, currentUser?.uid);
              if (matchPath) onLaunchMatch?.(matchPath);
              else showToast('Match not assigned yet — sit tight.', 'info');
            }} style={ctaPrimary}>
              Open my match
            </button>
          ) : (
            <button onClick={handleCheckIn} disabled={busy || loading} style={{
              ...ctaPrimary, opacity: busy || loading ? 0.6 : 1,
            }}>
              {busy ? 'Checking you in…' : (allOk ? "I'm ready · check me in" : "Check in anyway")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function detectionAccent(d) {
  return ({
    gsi:     '#B44FFF',   // green-cyan
    wrapper: '#7c3aed',   // violet
    ocr:     '#F0A500',   // gold
    manual:  '#9CA3AF',   // gray
  })[d] || '#9CA3AF';
}
function detectionIcon(d) {
  return ({
    gsi: 'verified', wrapper: 'api', ocr: 'visibility', manual: 'gavel',
  })[d] || 'help';
}
function detectionLabel(d) {
  return ({
    gsi: 'Auto · GSI', wrapper: 'Auto · Stats API', ocr: 'Verified · AI + Mod', manual: 'Manual + Mod',
  })[d] || 'Unknown';
}

function CheckItem({ req, onFix }) {
  const ok = !!req.ok;
  const accent = ok ? C.green : C.amber;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10,
      background: C.bgSoft, border: `1px solid ${ok ? accent + '55' : C.border}`,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: ok ? accent + '33' : 'rgba(245,158,11,0.15)',
        border: `1px solid ${accent}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={ok ? 'check' : 'priority_high'} size={12} className="" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{req.label}</div>
        {req.hint && (
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{req.hint}</div>
        )}
      </div>
      {!ok && req.action && (
        <button onClick={onFix} style={{
          padding: '6px 12px', borderRadius: 8, border: `1px solid ${accent}`,
          background: 'transparent', color: accent,
          fontSize: 11, fontWeight: 800, cursor: 'pointer',
        }}>Fix</button>
      )}
    </div>
  );
}

const ctaPrimary = {
  width: '100%', padding: 12, borderRadius: 10, border: 'none',
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
  color: '#000', fontSize: 14, fontWeight: 900, cursor: 'pointer',
};

// Resolves the path to a participant's currently-active match in the
// tournament. Used after check-in to deep-link them straight to play.
async function findCurrentMatchPath(tournamentId, uid) {
  if (!tournamentId || !uid) return null;
  try {
    const q = query(
      collection(db, 'tournaments', tournamentId, 'matches'),
      where('status', 'in', ['pending', 'in_progress', 'scheduled']),
      orderBy('round', 'asc'),
      limit(20),
    );
    const snap = await getDocs(q);
    const mine = snap.docs.find((d) => {
      const m = d.data();
      return m.player1 === uid || m.player2 === uid ||
             (Array.isArray(m.participantUids) && m.participantUids.includes(uid));
    });
    if (mine) return `/tournaments/${tournamentId}/match/${mine.id}`;
  } catch { /* fall through */ }
  // Fallback to the tournament overview.
  return `/tournaments/${tournamentId}`;
}
