// CheatFlagShareList
//
// Drop-in mod component that lists every `cheatFlag.flags[]` entry on a
// match with Watch / Copy-share-link buttons. Used in two places:
//   - TournamentMatchScreen (mod block) — every flag inline
//   - VanguardReviewQueueScreen focused detail — same UI when an AI item
//     is selected
//
// Both render only when `iAmMod && match.cheatFlag?.flags?.length > 0`.

import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';

export default function CheatFlagShareList({ tournamentId, matchId, match }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const flags = match?.cheatFlag?.flags || [];
  if (flags.length === 0) return null;

  const overall = match.cheatFlag?.overall || 'unknown';
  const overallColor = overall === 'likely_cheat' ? '#F04060'
                     : overall === 'suspicious'   ? '#F0A500'
                     : '#22c55e';

  const watch = (i) =>
    navigate(`/clips/cheat-flag/${tournamentId}/${matchId}/${i}`);

  const copyShare = async (i) => {
    try {
      const url = `${window.location.origin}/clips/cheat-flag/${tournamentId}/${matchId}/${i}`;
      await navigator.clipboard.writeText(url);
      showToast('Mod-share link copied', 'success');
    } catch {
      showToast('Could not copy — paste manually', 'error');
    }
  };

  return (
    <div style={{
      borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)',
      background: '#14141F', padding: 14, marginTop: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 800,
          color: overallColor }}>
          ● AI CHEAT FLAGS · {overall.replace(/_/g, ' ').toUpperCase()}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
          {flags.length} moment{flags.length === 1 ? '' : 's'}
        </div>
      </div>

      {flags.map((f, i) => {
        const sev = f.severity || 0;
        const color = sev >= 4 ? '#F04060' : sev >= 3 ? '#F0A500' : '#B44FFF';
        return (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto auto',
            alignItems: 'center', gap: 10,
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 10,
              fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: color + '22', color, border: `1px solid ${color}55`,
              fontFamily: 'DM Mono, monospace',
            }}>
              {f.type} · {sev}/5
            </span>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4, minWidth: 0 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'DM Mono, monospace' }}>
                t={Number(f.tSec || 0).toFixed(1)}s
              </span>
              {f.note && (
                <span style={{ marginLeft: 8 }}>{f.note}</span>
              )}
            </div>
            <button onClick={() => watch(i)} style={btn('#F0A500')} title="Open clip viewer">
              <Icon name="play_circle" size={14} className="" /> Watch
            </button>
            <button onClick={() => copyShare(i)} style={btn('#B44FFF')} title="Copy mod-share link">
              <Icon name="link" size={14} className="" /> Share
            </button>
          </div>
        );
      })}
    </div>
  );
}

const btn = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 10px', borderRadius: 6,
  background: color + '12', color, border: `1px solid ${color}44`,
  fontSize: 11, fontWeight: 800, cursor: 'pointer',
});
