// Maps a raw Firestore tournament doc into the shape the design components
// expect (tag, format label, countdown, dateLabel, etc).
//
// Real Firestore fields:
//   { id, name, game, type, mode, entryFee, prizePool, participants[],
//     maxParticipants, status, visibility, startDate, createdAt, ... }

import { BRACKET_TYPES } from '../../utils/tournamentTypes';
import { gameArt } from './TournamentBits';

const TYPE_LABEL = {
  single_elim:       'Single Elim',
  double_elim:       'Double Elim',
  squad_single_elim: 'Squad · Single Elim',
  squad_round_robin: 'Squad · Round Robin',
  battle_royale:     'Battle Royale',
  swiss:             'Swiss',
  invitational:      'Invitational',
};

const MODE_LABEL = {
  solo:   '1v1',
  squad:  'Squad',
  ffa:    'FFA',
  custom: 'Custom',
};

// Convert a millisecond delta into a short countdown string.
function fmtCountdown(ms) {
  if (ms == null) return null;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}D ${pad(h)}:${pad(m)}`;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function tsMs(v) {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (v.toMillis) return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return null;
}

function fmtDate(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ', ' +
    d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function mapTournament(t) {
  if (!t) return null;
  const bracket = BRACKET_TYPES[t.type];
  const art = gameArt(t.game);
  const startMs = tsMs(t.startDate);
  const isLive = t.status === 'live' || t.status === 'active';
  const countdown = isLive ? 'LIVE' : fmtCountdown(startMs ? startMs - Date.now() : null);
  const regd = t.participants?.length || 0;
  const cap = t.maxParticipants || 0;
  const filling = cap > 0 && regd / cap >= 0.8;
  const free = (t.entryFee || 0) === 0;
  const badges = [];
  if (t.featured) badges.push('Featured');
  if (filling && !isLive) badges.push('Filling Fast');
  if (free && t.status === 'open') badges.push('Free Entry');
  return {
    id: t.id,
    name: t.name || 'Untitled',
    game: t.game || '',
    tag: art.tag,
    format: [
      MODE_LABEL[t.mode] || '',
      bracket?.shortLabel || TYPE_LABEL[t.type] || '',
    ].filter(Boolean).join(' · '),
    type: t.type,
    mode: t.mode,
    region: t.region || 'Global',
    status: t.status || 'open',
    visibility: t.visibility || 'public',
    entry: t.entryFee || 0,
    prize: t.prizePool || 0,
    vp: t.vpBonus || 0,
    regd, cap,
    startMs,
    dateLabel: fmtDate(startMs),
    countdown,
    badges,
    bannerUrl: t.bannerUrl || null,
    adminId: t.adminId,
    hostSquadId: t.hostSquadId || null,
    participants: t.participants || [],
    invitedUserIds: t.invitedUserIds || [],
    featured: !!t.featured,
  };
}

export function mapTournaments(arr) {
  return (arr || []).map(mapTournament).filter(Boolean);
}
