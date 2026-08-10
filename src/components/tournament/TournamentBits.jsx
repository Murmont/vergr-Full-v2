// Shared atoms + cards for the tournament list/detail screens.
// Mirrors the Claude Design handoff but uses our existing Icon, tokens, and
// real Firestore-shaped data via the mapper in `tournamentMappers.js`.

import Icon from '../Icon';

// ─── Game art / tag ────────────────────────────────────────────────
const GAME_ART = {
  'Valorant':            { bg: 'linear-gradient(135deg,#FF4655 0%,#5A0712 100%)', tag: 'VAL'  },
  'Warzone':             { bg: 'linear-gradient(135deg,#3B5C2D 0%,#0E1808 100%)', tag: 'WZ'   },
  'Call of Duty':        { bg: 'linear-gradient(135deg,#3B5C2D 0%,#0E1808 100%)', tag: 'COD'  },
  'Apex Legends':        { bg: 'linear-gradient(135deg,#D24B26 0%,#3A0E04 100%)', tag: 'APX'  },
  'Fortnite':            { bg: 'linear-gradient(135deg,#9747FF 0%,#1E0F3A 100%)', tag: 'FN'   },
  'Tekken 8':            { bg: 'linear-gradient(135deg,#6E4ACF 0%,#150A2D 100%)', tag: 'TK8'  },
  'Counter-Strike 2':    { bg: 'linear-gradient(135deg,#E89F2B 0%,#3A2304 100%)', tag: 'CS2'  },
  'CS2':                 { bg: 'linear-gradient(135deg,#E89F2B 0%,#3A2304 100%)', tag: 'CS2'  },
  'League of Legends':   { bg: 'linear-gradient(135deg,#1E90FF 0%,#0A1F3A 100%)', tag: 'LoL'  },
  'Dota 2':              { bg: 'linear-gradient(135deg,#A53A1F 0%,#1F0A04 100%)', tag: 'DOTA' },
  'Overwatch 2':         { bg: 'linear-gradient(135deg,#F89C20 0%,#3A1F00 100%)', tag: 'OW2'  },
  'Rocket League':       { bg: 'linear-gradient(135deg,#0072F2 0%,#001A3A 100%)', tag: 'RL'   },
  'Street Fighter 6':    { bg: 'linear-gradient(135deg,#FFB400 0%,#3A2700 100%)', tag: 'SF6'  },
  'Marvel Rivals':       { bg: 'linear-gradient(135deg,#E11D48 0%,#1F0411 100%)', tag: 'MR'   },
  'PUBG':                { bg: 'linear-gradient(135deg,#FCB823 0%,#3A2700 100%)', tag: 'PUBG' },
  'Halo Infinite':       { bg: 'linear-gradient(135deg,#3A8FFF 0%,#0A1F3A 100%)', tag: 'HALO' },
  'The Finals':          { bg: 'linear-gradient(135deg,#D9FF1E 0%,#1A3A00 100%)', tag: 'FIN'  },
};
const DEFAULT_ART = { bg: 'linear-gradient(135deg,#7B1FFF 0%,#1E0F3A 100%)', tag: 'GAME' };

export function gameArt(game) {
  return GAME_ART[game] || DEFAULT_ART;
}

const STRIPES_OVERLAY = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0 14px, transparent 14px 28px)',
};

// ─── Pill ──────────────────────────────────────────────────────────
export function Pill({ children, color = 'cyan', size = 'sm' }) {
  const colors = {
    cyan:    'bg-brand-violet/10 text-brand-violet-light border-brand-violet/25',
    violet:  'bg-brand-violet/15 text-brand-pink border-brand-violet/30',
    pink:    'bg-brand-pink/12 text-brand-pink border-brand-pink/25',
    gold:    'bg-brand-gold/12 text-brand-gold border-brand-gold/25',
    ember:   'bg-brand-ember/15 text-brand-ember border-brand-ember/30',
    neutral: 'bg-white/[0.05] text-text-secondary border-white/10',
  };
  const sz = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-dmmono uppercase tracking-[0.1em] font-bold ${colors[color]} ${sz}`}>
      {children}
    </span>
  );
}

// ─── Status / Prize / Countdown / Capacity ────────────────────────
export function StatusBadge({ status }) {
  if (status === 'live' || status === 'active') return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-ember text-white text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
    </span>
  );
  if (status === 'invite' || status === 'invitational') return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-gold/90 text-black text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">
      <Icon name="mark_email_unread" size={10} /> INVITE
    </span>
  );
  if (status === 'completed' || status === 'ended') return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.08] text-text-secondary text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">
      ENDED
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-violet/90 text-black text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">
      OPEN
    </span>
  );
}

export function PrizeBlock({ prize = 0, vp = 0, size = 'md' }) {
  const big = size === 'lg';
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        <span className="w-4 h-4 rounded-full bg-gradient-to-br from-[#FFCB52] to-[#B87400] shadow-[0_0_8px_rgba(240,165,0,0.45)] shrink-0" />
        <span className={`font-dmmono font-bold tabular-nums text-brand-gold ${big ? 'text-lg' : 'text-sm'}`}>
          {prize.toLocaleString()}
        </span>
      </div>
      {vp > 0 && (
        <>
          <span className="text-text-muted/40">·</span>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rotate-45 bg-gradient-to-br from-[#D8A0FF] to-[#5C18B8] shadow-[0_0_6px_rgba(123,31,255,0.4)] shrink-0" />
            <span className="font-dmmono font-bold tabular-nums text-brand-pink text-xs">{vp}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Countdown({ value, label = 'Starts in' }) {
  if (value === 'LIVE') return (
    <div>
      <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">Status</div>
      <div className="font-dmmono text-sm font-black text-brand-ember tabular-nums flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-ember animate-pulse" /> LIVE NOW
      </div>
    </div>
  );
  return (
    <div>
      <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">{label}</div>
      <div className="font-dmmono text-sm font-bold text-brand-violet-light tabular-nums">{value || '—'}</div>
    </div>
  );
}

export function CapacityBar({ regd = 0, cap = 0 }) {
  if (!cap) return null;
  const pct = Math.min(100, Math.round((regd / cap) * 100));
  const hot = pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="font-dmmono text-text-muted flex items-center gap-1">
          <Icon name="group" size={11} /> {regd}/{cap}
        </span>
        <span className={`font-dmmono font-bold ${hot ? 'text-brand-ember' : 'text-text-muted'}`}>{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className={`h-full rounded-full ${hot ? 'bg-brand-ember' : 'bg-gradient-to-r from-brand-violet to-brand-pink'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Art block (replaces .art-valorant etc.) ──────────────────────
export function GameArtBlock({ game, tag, className = '', children }) {
  const art = gameArt(game);
  const finalTag = tag || art.tag;
  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: art.bg }}
    >
      <div className="absolute inset-0" style={STRIPES_OVERLAY} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      {children !== undefined ? children : (
        <span className="relative font-syne text-xs font-extrabold text-white/90 drop-shadow">{finalTag}</span>
      )}
    </div>
  );
}

// ─── Cards (grid / row / compact) ─────────────────────────────────
export function TournamentCard({ t, onClick }) {
  const featured = t.badges?.includes('Featured');
  return (
    <button onClick={onClick} className="group rounded-2xl bg-[#12132099] border border-white/[0.06] backdrop-blur-sm overflow-hidden hover:border-white/[0.14] hover:bg-[#15162088] transition-all cursor-pointer flex flex-col text-left">
      <GameArtBlock game={t.game} tag={t.tag} className="h-32">
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <StatusBadge status={t.status} />
          {featured && (
            <span className="px-1.5 py-0.5 rounded bg-brand-violet/90 text-white text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">
              ★ FEATURED
            </span>
          )}
        </div>
        <div className="absolute top-2.5 right-2.5">
          {t.entry === 0 ? (
            <span className="px-1.5 py-0.5 rounded bg-brand-violet/15 border border-brand-violet/40 text-brand-violet-light text-[9px] font-dmmono font-black uppercase tracking-[0.08em]">FREE</span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/40 backdrop-blur border border-white/10 text-[10px] font-dmmono font-bold text-brand-pink">
              <span className="w-2.5 h-2.5 rotate-45 bg-gradient-to-br from-[#D8A0FF] to-[#5C18B8]" />
              {t.entry}
            </span>
          )}
        </div>
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="font-syne text-[11px] font-extrabold text-white/85 uppercase tracking-wider drop-shadow">{t.tag}</div>
            <div className="text-[10px] text-white/70 truncate font-medium">{t.game}</div>
          </div>
        </div>
      </GameArtBlock>

      <div className="p-4 flex flex-col flex-1 gap-3">
        <div>
          <h3 className="font-syne text-[15px] font-extrabold text-text-primary leading-tight truncate">{t.name}</h3>
          <div className="text-[11px] text-text-muted mt-1 font-dmmono">{t.format}</div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
            {t.dateLabel && <span className="flex items-center gap-1"><Icon name="event" size={11} /> {t.dateLabel}</span>}
            {t.region && <span className="flex items-center gap-1"><Icon name="public" size={11} /> {t.region}</span>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 py-2.5 border-y border-white/[0.05]">
          <div>
            <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">Prize Pool</div>
            <PrizeBlock prize={t.prize} vp={t.vp} />
          </div>
          <Countdown value={t.countdown} label="Reg. ends" />
        </div>

        <CapacityBar regd={t.regd} cap={t.cap} />

        <div className="flex items-center gap-2 mt-1">
          {t.status === 'live' || t.status === 'active' ? (
            <span className="flex-1 py-2 rounded-xl bg-brand-ember/15 border border-brand-ember/40 text-brand-ember text-[12px] font-bold flex items-center justify-center gap-1.5">
              <Icon name="play_circle" size={14} /> Watch Live
            </span>
          ) : t.status === 'completed' || t.status === 'ended' ? (
            <span className="flex-1 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-muted text-[12px] font-bold flex items-center justify-center">
              View Results
            </span>
          ) : t.visibility === 'private' ? (
            <span className="flex-1 py-2 rounded-xl bg-brand-gold/15 border border-brand-gold/40 text-brand-gold text-[12px] font-bold flex items-center justify-center gap-1.5">
              <Icon name="lock" size={14} /> Invite Only
            </span>
          ) : (
            <span className="flex-1 py-2 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[12px] font-bold text-center shadow-lg shadow-brand-violet/25">
              View Tournament
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function TournamentRow({ t, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all text-left">
      <GameArtBlock game={t.game} tag={t.tag} className="w-20 h-20 rounded-xl shrink-0">
        <span className="relative font-syne text-sm font-extrabold text-white/90 drop-shadow">{t.tag}</span>
        <div className="absolute bottom-1 left-1"><StatusBadge status={t.status} /></div>
      </GameArtBlock>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-syne text-sm font-extrabold text-text-primary truncate">{t.name}</h3>
          {t.badges?.includes('Featured') && <Pill color="violet" size="xs">★ Featured</Pill>}
          {t.entry === 0 && <Pill color="cyan" size="xs">Free</Pill>}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1"><Icon name="sports_esports" size={11} /> {t.game}</span>
          <span className="flex items-center gap-1"><Icon name="schema" size={11} /> {t.format}</span>
          {t.dateLabel && <span className="flex items-center gap-1"><Icon name="event" size={11} /> {t.dateLabel}</span>}
          {t.region && <span className="flex items-center gap-1"><Icon name="public" size={11} /> {t.region}</span>}
        </div>
        <div className="mt-2 max-w-[260px]"><CapacityBar regd={t.regd} cap={t.cap} /></div>
      </div>

      <div className="hidden xl:block text-right shrink-0">
        <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">Prize Pool</div>
        <PrizeBlock prize={t.prize} vp={t.vp} size="lg" />
      </div>

      <div className="hidden xl:block text-right shrink-0 min-w-[110px]">
        <Countdown value={t.countdown} label="Reg. ends" />
      </div>

      <div className="shrink-0">
        {t.status === 'live' || t.status === 'active' ? (
          <span className="px-4 py-2 rounded-lg bg-brand-ember/15 border border-brand-ember/40 text-brand-ember text-xs font-bold flex items-center gap-1">
            <Icon name="play_circle" size={14} /> Watch
          </span>
        ) : t.status === 'completed' || t.status === 'ended' ? (
          <span className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-text-muted text-xs font-bold">Results</span>
        ) : t.visibility === 'private' ? (
          <span className="px-4 py-2 rounded-lg bg-brand-gold/15 border border-brand-gold/40 text-brand-gold text-xs font-bold">Invite Only</span>
        ) : (
          <span className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold shadow-lg shadow-brand-violet/25">View</span>
        )}
      </div>
    </button>
  );
}

export function TournamentCompact({ t, onClick }) {
  return (
    <button onClick={onClick} className="w-full grid grid-cols-[28px_1fr_120px_130px_100px_110px_120px] items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] border border-transparent hover:border-white/[0.06] cursor-pointer transition-colors text-left">
      <GameArtBlock game={t.game} tag={t.tag} className="w-7 h-7 rounded-md">
        <span className="relative font-syne text-[9px] font-extrabold text-white/90">{(t.tag || '').slice(0,3)}</span>
      </GameArtBlock>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-text-primary truncate">{t.name}</span>
          {(t.status === 'live' || t.status === 'active') && <Pill color="ember" size="xs">Live</Pill>}
          {t.badges?.includes('Featured') && <Pill color="violet" size="xs">★</Pill>}
          {t.entry === 0 && <Pill color="cyan" size="xs">Free</Pill>}
        </div>
        <div className="text-[10px] text-text-muted">{t.game}{t.region ? ` · ${t.region}` : ''}</div>
      </div>
      <div className="text-[11px] font-dmmono text-text-secondary truncate">{t.format}</div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-gradient-to-br from-[#FFCB52] to-[#B87400]" />
        <span className="font-dmmono text-[12px] font-bold text-brand-gold tabular-nums">{(t.prize || 0).toLocaleString()}</span>
      </div>
      <div className="font-dmmono text-[12px] text-text-primary tabular-nums">{t.regd}/{t.cap}</div>
      <div className={`font-dmmono text-[12px] font-bold tabular-nums ${t.status === 'live' || t.status === 'active' ? 'text-brand-ember' : 'text-brand-violet-light'}`}>{t.countdown || '—'}</div>
      <span className={`px-3 py-1.5 rounded-md text-[11px] font-bold text-center ${
        t.status === 'live' || t.status === 'active' ? 'bg-brand-ember/15 border border-brand-ember/40 text-brand-ember'
        : t.status === 'completed' || t.status === 'ended' ? 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
        : t.visibility === 'private' ? 'bg-brand-gold/15 border border-brand-gold/40 text-brand-gold'
        : 'bg-gradient-to-r from-brand-violet to-brand-pink text-white'
      }`}>
        {t.status === 'live' || t.status === 'active' ? 'Watch' : t.status === 'completed' || t.status === 'ended' ? 'Results' : t.visibility === 'private' ? 'Invite' : 'View'}
      </span>
    </button>
  );
}

// ─── Toolbar (Dropdown / ViewToggle) ──────────────────────────────
import { useState } from 'react';

export function Dropdown({ label, options, value, onChange, icon }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] text-xs font-medium text-text-secondary"
      >
        {icon && <Icon name={icon} size={14} className="text-text-muted" />}
        <span className="text-[11px] font-dmmono uppercase tracking-[0.1em] text-text-muted">{label}:</span>
        <span className="text-text-primary font-semibold">{value}</span>
        <Icon name="expand_more" size={14} className="text-text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 min-w-[180px] bg-[#15162c] border border-white/[0.08] rounded-xl p-1 shadow-2xl shadow-black/60">
            {options.map(o => (
              <button
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 rounded-md text-[12px] hover:bg-brand-violet/15 ${
                  o === value ? 'text-brand-violet-light font-bold' : 'text-text-secondary'
                }`}
              >{o}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ViewToggle({ view, setView }) {
  return (
    <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] p-0.5">
      {[
        { k: 'grid',    icon: 'grid_view'  },
        { k: 'list',    icon: 'view_agenda' },
        { k: 'compact', icon: 'reorder'    },
      ].map(o => (
        <button
          key={o.k}
          onClick={() => setView(o.k)}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
            view === o.k ? 'bg-brand-violet/25 text-brand-violet-light' : 'text-text-muted hover:text-text-primary'
          }`}
          title={o.k}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
