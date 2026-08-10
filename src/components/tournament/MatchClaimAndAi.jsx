// MatchClaimAndAi — small UI primitives for tournament match moderation.
//
// Wires the deployed callables that previously had no front-end:
//   - vanguardClaimMatch / vanguardReleaseMatchClaim  (claim button)
//   - aiSuggestion (read-only) stamped by autoSuggestMatchWinners cron
//   - squadBackupChampions[squadId] (read-only) from finalizeSquadChampionVote
//
// All three live in the same file because they share styling + are
// rendered side-by-side on TournamentMatchScreen + ModWallScreen.

import { useEffect, useState } from 'react';
import { doc, onSnapshot, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

const C = {
  surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', violet: '#7B1FFF', violetLt: '#B44FFF',
  gold: '#F0A500', green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
};

const fns = () => getFunctions(undefined, 'europe-west1');

// ─── (a) MatchClaimButton ────────────────────────────────────────────────
// Subscribes to the claim doc so the button reflects live state.
export function MatchClaimButton({ tournamentId, matchId, currentUid, compact = false, onToast }) {
  const [claim, setClaim] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tournamentId || !matchId) return;
    const ref = doc(db, 'tournament_match_claims', `${tournamentId}_${matchId}`);
    return onSnapshot(ref, (snap) => setClaim(snap.exists() ? snap.data() : null));
  }, [tournamentId, matchId]);

  const isClaimed = claim?.status === 'claimed';
  const isMine = isClaimed && claim?.moderatorId === currentUid;

  const doClaim = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'vanguardClaimMatch')({ tournamentId, matchId });
      onToast?.('Match claimed.', 'success');
    } catch (e) {
      onToast?.(e?.message || 'Claim failed', 'error');
    } finally { setBusy(false); }
  };
  const doRelease = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'vanguardReleaseMatchClaim')({ tournamentId, matchId });
      onToast?.('Match released.', 'info');
    } catch (e) {
      onToast?.(e?.message || 'Release failed', 'error');
    } finally { setBusy(false); }
  };

  const base = {
    padding: compact ? '4px 8px' : '8px 12px',
    borderRadius: compact ? 6 : 8,
    fontSize: compact ? 10 : 12,
    fontWeight: 800,
    fontFamily: 'DM Mono, monospace',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
    border: 'none',
  };

  if (!isClaimed) {
    return (
      <button onClick={(e) => { e.stopPropagation(); doClaim(); }} disabled={busy} style={{
        ...base, background: C.violet, color: C.text,
      }}>
        {compact ? 'CLAIM' : 'Claim this match'}
      </button>
    );
  }
  if (isMine) {
    return (
      <button onClick={(e) => { e.stopPropagation(); doRelease(); }} disabled={busy} style={{
        ...base, background: 'transparent', border: `1px solid ${C.cyan}66`, color: C.cyan,
      }}>
        {compact ? 'RELEASE' : 'Release claim'}
      </button>
    );
  }
  return (
    <div style={{
      ...base, background: C.soft, color: C.amber,
      display: 'flex', alignItems: 'center', gap: 4, cursor: 'default', opacity: 1,
    }}>
      <Icon name="lock" size={compact ? 10 : 12} />
      {compact ? 'HELD' : `Held by ${claim.moderatorId.slice(0, 6)}`}
    </div>
  );
}

// ─── (e) AiSuggestionBanner ──────────────────────────────────────────────
// Read-only display of match.aiSuggestion stamped by autoSuggestMatchWinners.
// Mods see this live so they know what OCR thinks before they confirm.
export function AiSuggestionBanner({ suggestion, p1, p2, commanderReviewRequired }) {
  if (!suggestion?.suggestedWinnerId) return null;

  const winnerUid = suggestion.suggestedWinnerId;
  const winner = winnerUid === p1?.id ? p1 : winnerUid === p2?.id ? p2 : null;
  const conf = suggestion.confidence || 'low';
  const confColor = conf === 'high' ? C.green : conf === 'med' ? C.amber : C.mute;
  const confLabel = conf.toUpperCase();

  return (
    <div style={{
      padding: 12, borderRadius: 12,
      background: `linear-gradient(135deg, ${C.violet}15, ${C.violetLt}10)`,
      border: `1px solid ${commanderReviewRequired ? C.amber + '66' : C.violet + '55'}`,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 6, background: C.violet + '33',
      }}>
        <Icon name="auto_awesome" size={14} style={{ color: C.violetLt }} />
        <span style={{
          fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 900,
          color: C.violetLt, letterSpacing: '0.08em',
        }}>AI SUGGESTS</span>
      </div>
      <UserAvatar uid={winnerUid} size="xs" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
          {winner?.username || winnerUid.slice(0, 8)} wins
        </div>
        <div style={{ fontSize: 10, color: C.dim, fontFamily: 'DM Mono, monospace' }}>
          via {(suggestion.sources || []).join(' + ') || 'OCR'}
        </div>
      </div>
      <div style={{
        padding: '4px 8px', borderRadius: 6,
        background: confColor + '22', color: confColor,
        fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 900,
      }}>{confLabel}</div>
      {commanderReviewRequired && (
        <div style={{
          width: '100%', padding: 8, borderRadius: 6,
          background: C.amber + '15', color: C.amber,
          fontSize: 11, fontWeight: 700, textAlign: 'center',
        }}>
          <Icon name="gavel" size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Commander review required — mod called opposite of high-confidence AI.
        </div>
      )}
    </div>
  );
}

// ─── (d) BackupChampionsRow ──────────────────────────────────────────────
// Renders squad champions + backups for a tournament match. Read-only;
// the auto-swap logic lives server-side (no-show detection cron).
export function BackupChampionsRow({ tournament, squadId, label }) {
  const champions = tournament?.squadChampions?.[squadId] || [];
  const backups = tournament?.squadBackupChampions?.[squadId] || [];
  if (champions.length === 0 && backups.length === 0) return null;

  return (
    <div style={{
      padding: 10, borderRadius: 10, background: C.soft,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 9, fontWeight: 800,
        color: C.mute, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6,
      }}>
        {label || 'Squad roster'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {champions.map((uid) => (
          <div key={uid} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px 3px 3px', borderRadius: 999,
            background: C.gold + '15', border: `1px solid ${C.gold}44`,
          }}>
            <UserAvatar uid={uid} size="xs" />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.gold }}>{uid.slice(0, 6)}</span>
          </div>
        ))}
        {backups.length > 0 && (
          <span style={{ fontSize: 10, color: C.mute, marginLeft: 4 }}>· backups:</span>
        )}
        {backups.map((uid) => (
          <div key={uid} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px 3px 3px', borderRadius: 999,
            background: 'transparent', border: `1px dashed ${C.border}`,
          }}>
            <UserAvatar uid={uid} size="xs" />
            <span style={{ fontSize: 11, fontWeight: 600, color: C.dim }}>{uid.slice(0, 6)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: C.mute, marginTop: 6, lineHeight: 1.4 }}>
        Backups auto-swap in if a champion no-shows.
      </div>
    </div>
  );
}
