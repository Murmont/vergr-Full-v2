// CreateTournamentV2 — redesigned Create Tournament flow (Claude Design port).
// Landing chooser + 4-step builder (Event / Format / Tickets / Review) with a
// persistent live preview. Fully wired to createTournamentSecure.
//
// This is a NEW file living alongside the original CreateTournamentScreen.jsx —
// the old screen is left intact so we can revert by pointing the route back.
//
// Founder-requested additions over the design:
//   - real game box-art (TOURNAMENT_GAMES.coverArt) + real banner art
//   - live BRACKET TREE under "What this produces"
//   - slider pickers for ticket price, capacity (with Unlimited), host top-up
//   - "Purse share" renamed to "Revenue share"
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import {
  createTournamentSecure, getUserSquads, getEligibleSquadCount,
  updateLinkedAccount, linkSteam, getUsersWithLinkedAccount, searchUsers,
  uploadTournamentBanner, requestGame,
} from '../../firebase/firestore';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import {
  BRACKET_TYPE_LIST, getBracketType, isBracketTypeAllowed,
  recommendedSwissRounds, validateTournamentLimits,
  MAX_ENTRY_FEE_COINS, MAX_PRIZE_POOL_COINS,
} from '../../utils/tournamentTypes';
import { TOURNAMENT_GAMES, GAMES_BY_CATEGORY } from '../../utils/tournamentGames';
import { resolveTier } from '../../utils/tierSystem';
import { requiresManualMod, MIN_SCHEDULING_BUFFER_MIN } from '../../utils/tournamentModeration';

// ── datetime helpers (local-time, no library) ───────────────────────────
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const startInputFromOffset = (offsetMin) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
};

const DRAFT_KEY = 'vergr_tournament_draft_v2';
// "Unlimited" capacity = the server's hard ceiling (capacity is clamped to
// [1, 100000] in createTournamentSecure / purchaseEventTicket).
const MAX_CAPACITY = 100000;
const TEMPLATE_BANNER = '/brand/tournament-banners/upload-bg.webp';

const TITLE_COLORS = ['#B44FFF', '#C87FFF', '#F5C842', '#F04060', '#3D7FFF'];

const TOURNAMENT_CATEGORIES = [
  { id: 'competitive', label: 'Competitive', sub: 'Ranked, serious play', icon: 'emoji_events' },
  { id: 'casual',      label: 'Casual Cup',  sub: 'Relaxed, for fun',    icon: 'sports_esports' },
  { id: 'community',   label: 'Community',    sub: 'Bring people together', icon: 'diversity_3' },
];

const TICKET_AUDIENCES = [
  { id: 'public',      label: 'Everyone',   sub: 'Anyone can buy',         icon: 'public' },
  { id: 'followers',   label: 'Followers',  sub: 'Only your followers',    icon: 'group' },
  { id: 'subscribers', label: 'Members',    sub: 'Only your paid members', icon: 'workspace_premium' },
  { id: 'invite',      label: 'Invite only',sub: 'Only guests you invite', icon: 'lock' },
];

// Cover art per game label (Steam/Twitch official box art from the registry).
const GAME_COVER = TOURNAMENT_GAMES.reduce((acc, g) => {
  if (g.coverArt) acc[g.label] = g.coverArt; return acc;
}, {});

// Genre tabs → which registry categories each surfaces.
const GENRES = [
  { label: 'All',            cats: null },
  { label: 'Tactical / FPS', cats: ['FPS'] },
  { label: 'Battle Royale',  cats: ['BR'] },
  { label: 'MOBA / Auto',    cats: ['MOBA', 'AutoBattler'] },
  { label: 'Fighting',       cats: ['Fighting'] },
  { label: 'Sports / Racing',cats: ['Sports', 'Racing'] },
  { label: 'Strategy',       cats: ['RTS', 'MMO'] },
  { label: 'Card / Other',   cats: ['Card', 'Other'] },
];
const gamesForGenre = (g) => {
  const cats = GENRES.find(x => x.label === g)?.cats;
  const list = cats
    ? cats.flatMap(c => GAMES_BY_CATEGORY[c] || [])
    : TOURNAMENT_GAMES;
  return list.filter(x => x.id !== 'other');
};

// Quick-start templates (prefill structural choices, then everything's editable).
const QUICK_TEMPLATES = [
  { id: 'quick_cup', label: 'Quick Cup', icon: 'bolt', tint: 'linear-gradient(135deg,#7B1FFF,#C87FFF)',
    meta: '8 players · single elimination · starts in ~90 min',
    apply: { type: 'single_elim', maxParticipants: 8, seriesFormat: 'bo1', ticketPrice: 100, purseSlicePct: 50, startOffsetMin: 90 } },
  { id: 'weekend_bracket', label: 'Weekend Bracket', icon: 'emoji_events', tint: 'linear-gradient(135deg,#F0A500,#F5C842)',
    meta: '16 players · best of 3 · starts in 2 days',
    apply: { type: 'single_elim', maxParticipants: 16, seriesFormat: 'bo3', ticketPrice: 100, purseSlicePct: 50, startOffsetMin: 2 * 24 * 60 } },
  { id: 'free_practice', label: 'Practice Match', icon: 'sports_esports', tint: 'linear-gradient(135deg,#3D7FFF,#7B1FFF)',
    meta: '8 players · just for fun · no prize',
    apply: { type: 'single_elim', maxParticipants: 8, seriesFormat: 'bo1', ticketPrice: 0, purseSlicePct: 0, startOffsetMin: 90 } },
];

// Multi-stage presets (mirror of functions/tournamentStages.js). single_stage = legacy.
const STAGE_PRESETS = [
  { id: 'single_stage', label: 'One bracket', sub: 'Straight through, start to finish', stages: null },
  { id: 'swiss_to_se', label: 'Swiss, then knockout', sub: 'A few fair rounds, then top players play off',
    stages: [
      { id: 'stage_1', name: 'Swiss Qualifier', type: 'swiss',       seriesFormat: 'bo1', seedingMode: 'random', advanceCount: 8, swissRounds: 5 },
      { id: 'stage_2', name: 'Playoffs',        type: 'single_elim', seriesFormat: 'bo3', seedingMode: 'inherit' },
    ] },
  { id: 'groups_to_se', label: 'Groups, then knockout', sub: 'Group stage first, top teams advance to a knockout',
    stages: [
      { id: 'stage_1', name: 'Group Stage', type: 'round_robin', seriesFormat: 'bo1', seedingMode: 'random', advanceCount: 8 },
      { id: 'stage_2', name: 'Playoffs',    type: 'single_elim', seriesFormat: 'bo3', seedingMode: 'inherit' },
    ] },
];
function stagesForPreset(presetId, fallback) {
  const p = STAGE_PRESETS.find((x) => x.id === presetId);
  if (!p || !p.stages) return null;
  return p.stages.map((s, i) => i === 0 ? {
    ...s, type: fallback.type, seriesFormat: fallback.seriesFormat, seedingMode: fallback.seedingMode,
  } : s);
}

const SERIES_OPTS = [
  { id: 'bo1', label: 'Best of 1', sub: 'One game decides each match' },
  { id: 'bo3', label: 'Best of 3', sub: 'First to 2 wins' },
  { id: 'bo5', label: 'Best of 5', sub: 'First to 3 wins' },
];
const SEED_OPTS = [
  { id: 'random', label: 'Random', sub: 'Shuffle the bracket' },
  { id: 'manual', label: 'Manual', sub: 'You place players yourself' },
  { id: 'rating', label: 'By rating', sub: 'Keep the strongest apart early' },
];

// ── platform connect maps (copied from the original screen) ──────────────
const PLATFORM_TO_LINKED_KEY = {
  riot: 'riotgames', steam: 'steam', battlenet: 'battlenet', activision: 'activision',
  origin: 'origin', ea: 'origin', epic: 'epicgames', ubisoft: 'ubisoft',
  xbox: 'xbox', psn: 'psn', nintendo: 'nintendo', wizards: 'wizards',
};
const GAME_REQUIRED_ACCOUNT = TOURNAMENT_GAMES.reduce((acc, g) => {
  const key = PLATFORM_TO_LINKED_KEY[g.linkedPlatform];
  if (key) acc[g.label] = key; return acc;
}, {});
const PLATFORM_META = {
  riotgames: { name: 'Riot Games',  color: '#c6362f', letter: 'R', placeholder: 'Name#TAG' },
  steam:     { name: 'Steam',       color: '#1b2838', letter: 'S', placeholder: '7656119xxxxxxxxxx (17-digit Steam64 ID)' },
  battlenet: { name: 'Battle.net',  color: '#00aeff', letter: 'B', placeholder: 'YourTag#1234' },
  activision:{ name: 'Activision',  color: '#2b2b2b', letter: 'A', placeholder: 'Your Activision ID, e.g. Player#1234567' },
  origin:    { name: 'EA / Origin', color: '#ff5252', letter: 'O', placeholder: 'Your Origin or EA handle' },
  epicgames: { name: 'Epic Games',  color: '#2a2a2a', letter: 'E', placeholder: 'Your Epic display name' },
  ubisoft:   { name: 'Ubisoft',     color: '#0083be', letter: 'U', placeholder: 'Your Ubisoft Connect handle' },
  xbox:      { name: 'Xbox',        color: '#107c10', letter: 'X', placeholder: 'Your Xbox gamertag' },
  psn:       { name: 'PlayStation', color: '#003791', letter: 'P', placeholder: 'Your PSN ID' },
  nintendo:  { name: 'Nintendo',    color: '#e60012', letter: 'N', placeholder: 'Your Nintendo friend code' },
  wizards:   { name: 'Wizards',     color: '#d3273e', letter: 'W', placeholder: 'Your Wizards Account ID' },
};
const PLATFORM_GUIDES = {
  steam:     { text: 'In Steam, click your name (top right) → Account details. Your 17-digit Steam ID shows at the top, or paste your profile URL into the finder.', url: 'https://steamid.io', urlLabel: 'Find my Steam64 ID' },
  riotgames: { text: 'Your Riot ID is your name + tag, e.g. Player#EUW. It shows in the game client next to your profile, or on your Riot account page.', url: 'https://account.riotgames.com', urlLabel: 'Open Riot account' },
  battlenet: { text: 'Your BattleTag shows in the Battle.net app next to your avatar, in the form Name#1234.', url: 'https://account.battle.net', urlLabel: 'Open Battle.net account' },
  activision:{ text: 'Your Activision ID is your Call of Duty account name + number, e.g. Player#1234567. In-game: Account → Account Info, or on the Activision site under Basic Info.', url: 'https://www.activision.com/profile', urlLabel: 'Open Activision profile' },
  origin:    { text: 'Your EA ID is your public account name. Find it on the EA site under Account Settings → EA ID.', url: 'https://myaccount.ea.com', urlLabel: 'Open EA account' },
  epicgames: { text: 'Your Epic display name is at the top right of the Epic Games Launcher, or on your Epic account page.', url: 'https://www.epicgames.com/account/personal', urlLabel: 'Open Epic account' },
  ubisoft:   { text: 'Your Ubisoft username shows in Ubisoft Connect under your profile, or on your Ubisoft account page.', url: 'https://account.ubisoft.com', urlLabel: 'Open Ubisoft account' },
  xbox:      { text: 'Your gamertag shows on your Xbox profile (console or app), or on the Xbox account site.', url: 'https://account.xbox.com/profile', urlLabel: 'Open Xbox profile' },
  psn:       { text: 'Your PSN Online ID shows on your PlayStation profile, or under Account on playstation.com.', url: 'https://www.playstation.com', urlLabel: 'Open PlayStation' },
  nintendo:  { text: 'Your friend code looks like SW-0000-0000-0000. On your Switch: profile icon → Friend Suggestions / Add Friend.' },
  wizards:   { text: 'Your Wizards Account ID is on your Wizards account page under account settings.', url: 'https://myaccounts.wizards.com', urlLabel: 'Open Wizards account' },
};
// Simple Icons brand-logo path data (24×24).
const PLATFORM_LOGOS = {
  steam: 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z',
  riotgames: 'M13.458.86 0 7.093l3.353 12.761 2.552-.313-.701-8.024.838-.373 1.447 8.202 4.361-.535-.775-8.857.83-.37 1.591 9.025 4.412-.542-.849-9.708.84-.374 1.74 9.87L24 17.318V3.5Zm.316 19.356.222 1.256L24 23.14v-4.18l-10.22 1.256Z',
  battlenet: 'M18.94 8.296C15.9 6.892 11.534 6 7.426 6.332c.206-1.36.714-2.308 1.548-2.508 1.148-.275 2.4.48 3.594 1.854.782.102 1.71.28 2.355.429C12.747 2.013 9.828-.282 7.607.565c-1.688.644-2.553 2.97-2.448 6.094-2.2.468-3.915 1.3-5.013 2.495-.056.065-.181.227-.137.305.034.058.146-.008.194-.04 1.274-.89 2.904-1.373 5.027-1.676.303 3.333 1.713 7.56 4.055 10.952-1.28.502-2.356.536-2.946-.087-.812-.856-.784-2.318-.19-4.04a26.764 26.764 0 0 1-.807-2.254c-2.459 3.934-2.986 7.61-1.143 9.11 1.402 1.14 3.847.725 6.502-.926 1.505 1.672 3.083 2.74 4.667 3.094.084.015.287.043.332-.034.034-.06-.08-.124-.131-.149-1.408-.657-2.64-1.828-3.964-3.515 2.735-1.929 5.691-5.263 7.457-8.988 1.076.86 1.64 1.773 1.398 2.595-.336 1.131-1.615 1.84-3.403 2.185a27.697 27.697 0 0 1-1.548 1.826c4.634.16 8.08-1.22 8.458-3.565.286-1.786-1.295-3.696-4.053-5.17.696-2.139.832-4.04.346-5.588-.029-.08-.106-.27-.196-.27-.068 0-.067.13-.063.187.135 1.547-.263 3.2-1.062 5.19zm-8.533 9.869c-1.96-3.145-3.09-6.849-3.082-10.594 3.702-.124 7.474.748 10.714 2.627-1.743 3.269-4.385 6.1-7.633 7.966h.001z',
  activision: 'M1.88 8.91L0 14.284h.985l.27-.718h1.252l.269.718h.985zm3.224.359l-.537.984h2.15v4.03H7.7v-4.03h1.522l1.882 4.837 1.791-4.837h4.567l-.537-.984H12.18l-1.074 2.865L9.94 9.269zm16.21 1.163v3.762h.986v-1.523l1.7 1.702v-3.76h-.896v1.342zm-15.94.09c-1.075 0-1.881.807-1.881 1.881 0 1.075.806 1.88 1.88 1.88.448 0 .895-.179 1.164-.447L6 12.94c-.18.18-.358.27-.627.27a.897.897 0 0 1-.895-.896c0-.448.358-.896.895-.896.18 0 .448.089.537.268l.627-.715c-.27-.269-.716-.448-1.164-.448zm7.522 0v3.672h.985v-3.671zm2.148 0c-.358 0-.804.18-.804.896 0 .896 1.074 1.433.985 1.792-.09.179-.27.178-.359.178h-.626v.806h1.074c.448 0 .895-.269.895-.806 0-.985-1.253-1.611-.984-1.97 0-.09.178-.09.178-.09h.628v-.805zm1.255 0v3.672h.984v-3.671zm3.045 0c-1.075 0-1.88.807-1.88 1.881 0 .985.805 1.88 1.88 1.88 1.074 0 1.88-.805 1.88-1.88 0-1.074-.806-1.88-1.88-1.88zm-11.016.09v3.672h.986v-3.672zm11.016.896c.448 0 .895.358.895.895a.897.897 0 0 1-.895.896c-.538 0-.985-.358-.896-.896 0-.448.358-.895.896-.895zm-17.464.178l.27.896h-.54z',
};

// ── small UI atoms ───────────────────────────────────────────────────────
function InfoDot({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="More info"
        className="w-[19px] h-[19px] rounded-full border border-white/15 bg-white/[0.04] text-text-muted hover:text-text-primary flex items-center justify-center">
        <Icon name="info" size={13} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-[18]" onClick={() => setOpen(false)} />
          <span className="absolute z-20 top-7 left-0 w-[290px] p-3.5 rounded-xl bg-surface-2 border border-white/12 shadow-2xl text-left">
            {title && <span className="block font-bold text-[13px] text-text-primary mb-1">{title}</span>}
            <span className="block text-[12.5px] text-text-muted leading-relaxed">{children}</span>
          </span>
        </>
      )}
    </span>
  );
}

const SectionLabel = ({ children, info }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="font-syne font-bold text-[15px] text-text-primary">{children}</span>
    {info && <InfoDot title={info.title}>{info.body}</InfoDot>}
  </div>
);

// Slider + number input that stay in sync. Optional Unlimited toggle.
function SliderField({ value, onChange, min = 0, max, step = 1, suffix = 'VC', accent = '#B44FFF',
  unlimited, isUnlimited, onToggleUnlimited, hint }) {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2.5 flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-[#0f0f1a]">
          <input type="number" min={min} max={max} disabled={isUnlimited}
            value={isUnlimited ? '' : value}
            placeholder={isUnlimited ? 'Unlimited' : undefined}
            onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || 0)))}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-text-primary text-[20px] font-bold tabular-nums" />
          <span className="text-[13px] text-text-muted shrink-0">{suffix}</span>
        </div>
        {unlimited && (
          <button type="button" onClick={onToggleUnlimited}
            className={`px-3 py-2.5 rounded-xl border text-[12px] font-bold transition-colors ${
              isUnlimited ? 'border-brand-violet bg-brand-violet/15 text-brand-violet-light' : 'border-white/10 bg-white/[0.03] text-text-muted hover:text-text-primary'
            }`}>
            Unlimited
          </button>
        )}
      </div>
      <input type="range" min={min} max={max} step={step} value={isUnlimited ? max : value}
        disabled={isUnlimited}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="vgr-range w-full"
        style={{ background: `linear-gradient(90deg, ${accent} ${pct}%, rgba(255,255,255,0.1) ${pct}%)`, opacity: isUnlimited ? 0.5 : 1 }} />
      {hint && <div className="text-[11.5px] text-text-muted mt-2 leading-snug">{hint}</div>}
    </div>
  );
}

// ── custom date + time picker (native datetime-local looks terrible) ─────
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function DateTimePicker({ value, onChange, minMs = 0 }) {
  const [open, setOpen] = useState(false);
  const sel = value ? new Date(value) : null;
  const [viewMonth, setViewMonth] = useState(() => { const d = sel || new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const minDate = new Date(minMs);
  const minDayStart = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()).getTime();

  const commit = (d) => onChange(toLocalInput(d));
  const pickDay = (day) => {
    const base = sel || new Date(Math.max(Date.now(), minMs));
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day, base.getHours(), base.getMinutes());
    // if the chosen day+time is before the minimum, bump the time up to the floor
    commit(d.getTime() < minMs ? new Date(Math.ceil(minMs / 60000) * 60000) : d);
  };
  const setTime = (h, m) => {
    const base = sel || new Date(Math.max(Date.now(), minMs));
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
    commit(d.getTime() < minMs ? new Date(Math.ceil(minMs / 60000) * 60000) : d);
  };
  const quick = (mins) => { const d = new Date(Date.now() + mins * 60000); d.setSeconds(0, 0); commit(d); setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1)); };

  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const daysIn = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const hour = sel ? sel.getHours() : 20;
  const minute = sel ? sel.getMinutes() : 0;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 bg-[#0f0f1a] text-left hover:border-white/20">
        <span className="flex items-center gap-2.5">
          <Icon name="calendar_month" size={19} className="text-brand-violet-light" />
          <span className={`text-[15px] ${sel ? 'text-text-primary font-semibold' : 'text-text-muted'}`}>
            {sel ? sel.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Choose a date and time'}
          </span>
        </span>
        <Icon name="expand_more" size={20} className="text-text-muted transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[44]" onClick={() => setOpen(false)} />
          <div className="absolute z-[46] mt-2 w-[330px] max-w-full p-4 rounded-2xl border border-white/12 bg-surface-2 shadow-2xl">
            <div className="flex gap-2 mb-3">
              {[{ l: 'In 90 min', m: 90 }, { l: 'Tomorrow 8pm', m: null }, { l: 'In 2 days', m: 2 * 24 * 60 }].map((q, i) => (
                <button key={i} type="button" onClick={() => {
                  if (q.m != null) return quick(q.m);
                  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); commit(d); setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                }} className="flex-1 px-2 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:border-brand-violet/40">{q.l}</button>
              ))}
            </div>
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} className="w-8 h-8 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-text-muted"><Icon name="chevron_left" size={20} /></button>
              <span className="font-syne font-bold text-[14px]">{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</span>
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} className="w-8 h-8 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-text-muted"><Icon name="chevron_right" size={20} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((d, i) => <div key={i} className="text-center text-[10px] font-bold text-text-muted py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: first }, (_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysIn }, (_, i) => {
                const day = i + 1;
                const dms = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day).getTime();
                const disabled = dms < minDayStart;
                const isSel = sel && sel.getFullYear() === viewMonth.getFullYear() && sel.getMonth() === viewMonth.getMonth() && sel.getDate() === day;
                const isToday = dms === today.getTime();
                return (
                  <button key={day} type="button" disabled={disabled} onClick={() => pickDay(day)}
                    className={`h-9 rounded-lg text-[13px] font-semibold tabular-nums transition-colors ${
                      isSel ? 'bg-gradient-to-br from-brand-violet to-brand-pink text-white shadow-lg shadow-brand-violet/40'
                      : disabled ? 'text-text-muted/30 cursor-not-allowed'
                      : 'text-text-secondary hover:bg-white/[0.07] hover:text-text-primary'}`}>
                    {day}{isToday && !isSel && <span className="block w-1 h-1 rounded-full bg-brand-violet-light mx-auto -mt-0.5" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.07]">
              <Icon name="schedule" size={18} className="text-text-muted" />
              <span className="text-[12px] text-text-muted">Time</span>
              <select value={hour} onChange={e => setTime(parseInt(e.target.value), minute)}
                className="flex-1 px-2.5 py-2 rounded-lg border border-white/10 bg-[#0f0f1a] text-text-primary text-[14px] font-semibold outline-none tabular-nums [&>option]:bg-surface-2">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
              </select>
              <span className="text-text-muted font-bold">:</span>
              <select value={minute} onChange={e => setTime(hour, parseInt(e.target.value))}
                className="flex-1 px-2.5 py-2 rounded-lg border border-white/10 bg-[#0f0f1a] text-text-primary text-[14px] font-semibold outline-none tabular-nums [&>option]:bg-surface-2">
                {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="w-full mt-3 py-2.5 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-bold text-[13px]">Done</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── banner picker (real upload + template art) ───────────────────────────
function BannerPicker({ bannerUrl, setBannerUrl, uploading, onFile }) {
  const inputRef = useRef(null);
  const pick = () => inputRef.current?.click();
  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div className="relative rounded-2xl overflow-hidden border border-white/10" style={{ aspectRatio: '3 / 1', maxHeight: 300 }}>
        <img src={bannerUrl || TEMPLATE_BANNER} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/35" />
        {bannerUrl ? (
          <div className="absolute top-2.5 right-2.5 flex gap-2">
            <button type="button" onClick={pick}
              className="px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur border border-white/15 text-white text-[11px] font-bold hover:bg-black/70">{uploading ? 'Uploading…' : 'Replace'}</button>
            <button type="button" onClick={() => setBannerUrl('')}
              className="px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur border border-white/15 text-white text-[11px] font-bold hover:bg-black/70">Clear</button>
          </div>
        ) : (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="flex gap-3">
                <button type="button" onClick={pick} disabled={uploading}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl border border-white/20 bg-white/10 backdrop-blur text-white font-semibold text-[13.5px]">
                  <Icon name="upload" size={19} />{uploading ? 'Uploading…' : 'Upload banner'}
                </button>
                <button type="button" onClick={() => setBannerUrl(TEMPLATE_BANNER)}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl border-none bg-gradient-to-br from-brand-violet to-brand-pink text-white font-semibold text-[13.5px] shadow-lg shadow-brand-violet/40">
                  <Icon name="auto_awesome" size={19} />Use template art
                </button>
              </div>
              <div className="text-[11.5px] text-white/55">3:1 recommended</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── game carousel with real cover art ────────────────────────────────────
function GameCard({ g, selected, auto, plat, onClick }) {
  const cover = GAME_COVER[g.label];
  const [coverOk, setCoverOk] = useState(!!cover);
  return (
    <button type="button" onClick={onClick}
      className="scroll-snap-start shrink-0 w-[142px] rounded-2xl p-0 border-2 transition-transform"
      style={{ borderColor: selected ? '#B44FFF' : 'transparent', transform: selected ? 'scale(1.03)' : 'scale(1)', background: 'none' }}>
      <div className="relative h-[176px] rounded-[13px] overflow-hidden" style={{ background: 'linear-gradient(170deg,#2a1147,#3a1840)' }}>
        {coverOk
          ? <img src={cover} alt={g.label} className="absolute inset-0 w-full h-full object-cover" onError={() => setCoverOk(false)} />
          : <div className="absolute inset-0 flex items-end p-3"><span className="font-syne font-bold text-[13.5px] leading-tight text-left">{g.label}</span></div>}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {auto && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide bg-gem-blue/85 text-white">AUTO</span>}
          {plat && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-black/55 text-white flex items-center gap-0.5"><Icon name="link" size={11} />{plat}</span>}
        </div>
        {selected && <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-brand-violet-light flex items-center justify-center shadow-lg"><Icon name="check" size={16} className="text-white" /></div>}
      </div>
    </button>
  );
}

function GameCarousel({ games, selected, onPick, onRequest }) {
  const ref = useRef(null);
  const scroll = (d) => ref.current?.scrollBy({ left: d * 280, behavior: 'smooth' });
  return (
    <div className="relative group">
      <div ref={ref} className="flex gap-3 overflow-x-auto pb-3 no-scrollbar" style={{ scrollSnapType: 'x mandatory' }}>
        {games.map(g => {
          const auto = !requiresManualMod({ game: g.label });
          const platKey = GAME_REQUIRED_ACCOUNT[g.label];
          const platName = platKey ? PLATFORM_META[platKey]?.name?.split(' ')[0] : null;
          return <GameCard key={g.id} g={g} selected={selected === g.label} auto={auto} plat={platName} onClick={() => onPick(g.label)} />;
        })}
        <button type="button" onClick={onRequest}
          className="shrink-0 w-[142px] h-[180px] rounded-2xl border-2 border-dashed border-white/20 hover:border-brand-violet/50 bg-white/[0.02] flex flex-col items-center justify-center gap-2.5 text-text-muted hover:text-text-primary">
          <Icon name="add" size={30} /><span className="text-[12.5px] font-semibold">Request a game</span>
        </button>
      </div>
      <button type="button" onClick={() => scroll(-1)} aria-label="Scroll left"
        className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface-2/95 border border-white/10 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
        <Icon name="chevron_left" size={20} /></button>
      <button type="button" onClick={() => scroll(1)} aria-label="Scroll right"
        className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface-2/95 border border-white/10 backdrop-blur flex items-center justify-center shadow-lg">
        <Icon name="chevron_right" size={20} /></button>
    </div>
  );
}

// ── live bracket tree (changes with type + size + series) ────────────────
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
function BracketTree({ type, count, seriesFormat }) {
  const series = seriesFormat === 'bo5' ? 'Bo5' : seriesFormat === 'bo3' ? 'Bo3' : 'Bo1';
  const elim = ['single_elim', 'squad_single_elim', 'double_elim', 'invitational'].includes(type);

  if (elim) {
    const size = nextPow2(Math.max(2, count));
    const roundCount = Math.round(Math.log2(size));
    const rounds = Array.from({ length: roundCount }, (_, r) => size / Math.pow(2, r + 1));
    const labelFor = (i) => i === roundCount - 1 ? 'Final' : i === roundCount - 2 ? 'Semis' : i === roundCount - 3 ? 'Quarters' : `Round ${i + 1}`;
    const condensed = size > 16;
    return (
      <div>
        {!condensed ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {rounds.map((m, i) => (
              <div key={i} className="flex flex-col justify-around min-w-[60px]" style={{ gap: `${6 + i * 10}px` }}>
                <div className="text-[9.5px] uppercase tracking-wider text-text-muted font-bold mb-1 text-center">{labelFor(i)}</div>
                {Array.from({ length: m }, (_, k) => (
                  <div key={k} className={`rounded-md border ${i === roundCount - 1 ? 'border-brand-gold/50 bg-brand-gold/10' : 'border-brand-violet/30 bg-brand-violet/10'}`}>
                    <div className="px-2 py-1 text-[10px] text-text-secondary border-b border-white/5 tabular-nums">·</div>
                    <div className="px-2 py-1 text-[10px] text-text-secondary tabular-nums">·</div>
                  </div>
                ))}
              </div>
            ))}
            {type !== 'single_elim' && type !== 'squad_single_elim' && (
              <div className="flex flex-col justify-center min-w-[80px] pl-2 border-l border-white/8">
                <Icon name="emoji_events" size={20} className="text-brand-gold mx-auto" />
                <div className="text-[10px] text-text-muted text-center mt-1">Grand Final</div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {rounds.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="text-[12px] text-text-secondary">{labelFor(i)}</span>
                <span className="text-[12px] font-bold tabular-nums">{m} {m === 1 ? 'match' : 'matches'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-3 text-[11.5px] text-text-muted">
          <Icon name="account_tree" size={15} className="text-brand-violet-light" />
          {count} entrants · {roundCount} rounds · {series} · {type === 'double_elim' ? 'winners + losers brackets' : 'winner takes all'}
        </div>
      </div>
    );
  }

  if (type === 'round_robin' || type === 'squad_round_robin') {
    const matches = (count * (count - 1)) / 2;
    return (
      <div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(count, 8)}, minmax(0,1fr))` }}>
          {Array.from({ length: Math.min(count * count, 64) }, (_, i) => {
            const diag = Math.floor(i / Math.min(count, 8)) === i % Math.min(count, 8);
            return <div key={i} className={`h-5 rounded ${diag ? 'bg-white/[0.04]' : 'bg-brand-violet/15 border border-brand-violet/25'}`} />;
          })}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[11.5px] text-text-muted">
          <Icon name="grid_on" size={15} className="text-brand-violet-light" />
          {count} teams · everyone plays everyone · {matches} matches · standings decide it
        </div>
      </div>
    );
  }

  if (type === 'swiss') {
    const rounds = recommendedSwissRounds(count);
    return (
      <div>
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: rounds }, (_, i) => (
            <div key={i} className="flex-1 min-w-[54px] px-2 py-2.5 rounded-lg bg-brand-violet/10 border border-brand-violet/25 text-center">
              <div className="text-[9.5px] uppercase tracking-wide text-text-muted">Round</div>
              <div className="text-[15px] font-bold tabular-nums">{i + 1}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[11.5px] text-text-muted">
          <Icon name="hub" size={15} className="text-brand-violet-light" />
          {count} players · {rounds} rounds · nobody eliminated · top record wins
        </div>
      </div>
    );
  }

  // battle royale / ffa
  return (
    <div>
      <div className="relative h-24 rounded-xl border border-brand-ember/30 bg-brand-ember/5 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {Array.from({ length: Math.min(count, 24) }, (_, i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-brand-ember/50 m-1" />
          ))}
        </div>
        <Icon name="local_fire_department" size={26} className="text-brand-ember relative" />
      </div>
      <div className="flex items-center gap-2 mt-3 text-[11.5px] text-text-muted">
        <Icon name="local_fire_department" size={15} className="text-brand-ember" />
        {count} in one lobby · placement scored across games · 1st = 15 pts down to 1 pt for 10th
      </div>
    </div>
  );
}

// ── modals (copied/adapted from the original screen) ─────────────────────
function PlatformLogo({ platform, size = 52 }) {
  const meta = PLATFORM_META[platform]; const path = PLATFORM_LOGOS[platform];
  if (!meta) return null;
  return (
    <div style={{ width: size, height: size, borderRadius: 14, background: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {path ? <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="#fff"><path d={path} /></svg>
        : <span style={{ color: '#fff', fontWeight: 800, fontSize: size * 0.4 }}>{meta.letter}</span>}
    </div>
  );
}

function ModalShell({ onClose, accent, children }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'rgba(5,5,10,0.72)', backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} className="w-[440px] max-w-full rounded-[22px] border border-white/10 bg-surface-1 overflow-hidden shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function ConnectAccountModal({ platform, game, onClose, uid, showToast }) {
  const meta = PLATFORM_META[platform];
  const [val, setVal] = useState(''); const [saving, setSaving] = useState(false);
  if (!meta) return null;
  const guide = PLATFORM_GUIDES[platform];
  const submit = async () => {
    const v = val.trim(); if (!v || saving) return; setSaving(true);
    try {
      if (platform === 'steam') {
        if (!/^7656119\d{10}$/.test(v)) { showToast('Steam ID must be a 17-digit Steam64 (starts with 7656119)', 'error'); setSaving(false); return; }
        await linkSteam({ steamId64: v });
      } else { await updateLinkedAccount(uid, platform, v); }
      showToast(`${meta.name} connected!`, 'success'); onClose();
    } catch (err) { showToast(err?.message || 'Failed to connect', 'error'); setSaving(false); }
  };
  return (
    <ModalShell onClose={onClose}>
      <div className="relative px-6 pt-6 pb-5" style={{ background: 'linear-gradient(150deg,rgba(240,64,96,0.16),rgba(20,20,31,0.4))' }}>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg border border-white/10 bg-white/[0.04] text-text-muted"><Icon name="close" size={18} /></button>
        <div className="mb-3.5"><PlatformLogo platform={platform} /></div>
        <div className="font-syne font-extrabold text-[22px]">Connect your {meta.name} account</div>
        <div className="text-[13px] text-text-muted mt-1.5 leading-relaxed">We verify match results through {meta.name}, so we need your in-game ID to host {game || 'this game'}.</div>
      </div>
      <div className="px-6 pt-5 pb-6">
        {guide && (
          <div className="flex gap-2.5 px-3.5 py-3 rounded-xl bg-gem-blue/[0.08] border border-gem-blue/25 mb-4">
            <Icon name="help" size={20} className="text-gem-blue shrink-0" />
            <div className="text-[12.5px] text-text-muted leading-relaxed">
              {guide.text}
              {guide.url && <a href={guide.url} target="_blank" rel="noopener noreferrer" className="block mt-1.5 text-gem-blue font-bold inline-flex items-center gap-1">{guide.urlLabel} <Icon name="open_in_new" size={13} /></a>}
            </div>
          </div>
        )}
        <input type="text" value={val} onChange={e => setVal(e.target.value)} placeholder={meta.placeholder} autoFocus
          className="w-full px-3.5 py-3 rounded-xl border border-white/12 bg-[#0f0f1a] text-text-primary text-[15px] outline-none mb-4" />
        <button onClick={submit} disabled={saving || !val.trim()}
          className="w-full py-3 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-bold text-sm disabled:opacity-50">{saving ? 'Connecting…' : 'Connect account'}</button>
      </div>
    </ModalShell>
  );
}

function RequestGameModal({ onClose, showToast }) {
  const [g, setG] = useState(''); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving || g.trim().length < 2) return; setSaving(true);
    try { await requestGame({ game: g, note }); showToast("Request sent — we'll review adding this game.", 'success'); onClose(); }
    catch (e) { showToast(e?.message || 'Could not send request', 'error'); setSaving(false); }
  };
  return (
    <ModalShell onClose={onClose}>
      <div className="relative px-6 pt-6 pb-5" style={{ background: 'linear-gradient(150deg,rgba(123,31,255,0.16),rgba(20,20,31,0.4))' }}>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg border border-white/10 bg-white/[0.04] text-text-muted"><Icon name="close" size={18} /></button>
        <div className="w-[52px] h-[52px] rounded-[14px] bg-brand-violet/16 flex items-center justify-center mb-3.5"><Icon name="add" size={28} className="text-brand-pink" /></div>
        <div className="font-syne font-extrabold text-[22px]">Request a game</div>
        <div className="text-[13px] text-text-muted mt-1.5">Don't see your game? Tell us and we'll look at adding it.</div>
      </div>
      <div className="px-6 pt-5 pb-6">
        <input type="text" value={g} onChange={e => setG(e.target.value)} placeholder="Game name (e.g. Rocket League)" autoFocus
          className="w-full px-3.5 py-3 rounded-xl border border-white/12 bg-[#0f0f1a] text-text-primary text-[15px] outline-none mb-2.5" />
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Anything we should know? Platform, why you want it… (optional)"
          className="w-full px-3.5 py-3 rounded-xl border border-white/12 bg-[#0f0f1a] text-text-primary text-[14px] outline-none resize-none mb-4" />
        <button onClick={submit} disabled={saving || g.trim().length < 2}
          className="w-full py-3 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-bold text-sm disabled:opacity-50">{saving ? 'Sending…' : 'Send request'}</button>
      </div>
    </ModalShell>
  );
}

function InvitePlayersModal({ platform, gameName, spectator, invitedUsers, setInvitedUsers, onClose }) {
  const [term, setTerm] = useState(''); const [users, setUsers] = useState([]); const [loading, setLoading] = useState(false);
  // Spectator (ticket-buyer) invites can be anyone on VERGR — they're watching,
  // not competing, so they don't need a linked game account. Player invites for
  // a game with a required account narrow to people who have it linked.
  const usePlatformFilter = !spectator && !!platform;
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      const run = usePlatformFilter
        ? getUsersWithLinkedAccount(platform, { term, limitCount: 60 })
        : (term.trim() ? searchUsers(term, 40) : Promise.resolve([]));
      run.then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [usePlatformFilter, platform, term]);
  const isInvited = (id) => invitedUsers.some(u => u.id === id);
  const toggle = (u) => setInvitedUsers(isInvited(u.id) ? invitedUsers.filter(x => x.id !== u.id) : [...invitedUsers, { id: u.id, username: u.username, avatar: u.avatar || u.photoURL, vpLevel: u.vpLevel }]);
  const title = spectator ? 'Invite guests' : 'Invite players';
  const sub = spectator
    ? 'Anyone you invite can buy a ticket and watch. Search by username.'
    : usePlatformFilter ? `Players with ${PLATFORM_META[platform]?.name || platform} linked${gameName ? ` for ${gameName}` : ''}.` : 'Search players by username.';
  return (
    <div onClick={onClose} className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'rgba(5,5,10,0.72)', backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} className="w-[520px] max-w-full max-h-[85vh] rounded-[22px] border border-white/10 bg-surface-1 overflow-hidden flex flex-col">
        <div className="p-[18px] border-b border-white/[0.06]">
          <div className="font-syne font-bold text-base">{title}</div>
          <div className="text-[12px] text-text-muted mt-0.5">{sub}</div>
          <input type="text" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by username…" autoFocus
            className="w-full mt-3 px-3.5 py-2.5 rounded-lg border border-white/12 bg-[#0f0f1a] text-text-primary text-sm outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <div className="p-4 text-text-muted text-sm">Loading…</div>}
          {!loading && users.length === 0 && <div className="p-6 text-center text-text-muted text-sm">{term.trim() ? `No players found${usePlatformFilter ? ` with ${PLATFORM_META[platform]?.name} linked` : ''}.` : 'Start typing a username to search.'}</div>}
          {!loading && users.map(u => {
            const invited = isInvited(u.id);
            return (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1" style={{ background: invited ? 'rgba(124,58,237,0.08)' : 'transparent' }}>
                <img src={u.avatar || u.photoURL || '/brand/logo.png'} alt="" className="w-9 h-9 rounded-full object-cover bg-surface-2" />
                <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{u.username || 'Unknown'}</div><div className="text-[11px] text-text-muted">VP Lvl {u.vpLevel || 1}</div></div>
                <button onClick={() => toggle(u)} className={`px-3.5 py-1.5 rounded-lg text-xs font-bold ${invited ? 'border border-white/15 text-text-secondary' : 'bg-gradient-to-br from-brand-violet to-brand-pink text-white'}`}>{invited ? 'Invited' : 'Invite'}</button>
              </div>
            );
          })}
        </div>
        <div className="p-3.5 border-t border-white/[0.06] flex justify-between items-center">
          <span className="text-[12px] text-text-muted">{invitedUsers.length} invited</span>
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-gradient-to-br from-brand-violet to-brand-pink text-white text-sm font-bold">Done</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
export default function CreateTournamentV2() {
  const [phase, setPhase] = useState('landing'); // 'landing' | 'builder'
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [game, setGame] = useState('');
  const [genre, setGenre] = useState('All');
  const [type, setType] = useState('single_elim');
  const [maxParticipants, setMaxParticipants] = useState(16);
  const [category, setCategory] = useState('competitive');
  const [titleColor, setTitleColor] = useState('#B44FFF');
  const [accentWords, setAccentWords] = useState([]);
  const [visibility, setVisibility] = useState('public');
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [seriesFormat, setSeriesFormat] = useState('bo3');
  const [seedingMode, setSeedingMode] = useState('random');
  const [structurePreset, setStructurePreset] = useState('single_stage');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [brGameCount, setBrGameCount] = useState(3);
  const [scheduledStart, setScheduledStart] = useState('');
  const [streamRequired, setStreamRequired] = useState(false);
  // funding (ticketed default; prize_pool legacy is admin-gated)
  const [fundingModel, setFundingModel] = useState('ticketed');
  const [ticketPrice, setTicketPrice] = useState(100);
  const [ticketCapacity, setTicketCapacity] = useState(200);
  const [capacityUnlimited, setCapacityUnlimited] = useState(false);
  const [purseSlicePct, setPurseSlicePct] = useState(50);
  const [hostTopUp, setHostTopUp] = useState(0);
  const [ticketAudience, setTicketAudience] = useState('public');
  const [seasonPassEnabled, setSeasonPassEnabled] = useState(false);
  const [squadId, setSquadId] = useState('');
  const [squads, setSquads] = useState([]);
  const [eligibleSquadCount, setEligibleSquadCount] = useState(null);
  const [hostSquadId, setHostSquadId] = useState('');
  const [agreedToSkillTerms, setAgreedToSkillTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState(null);
  const [showRequestGame, setShowRequestGame] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMode, setInviteMode] = useState('player'); // 'player' | 'spectator'
  const [invitedUsers, setInvitedUsers] = useState([]);
  const [splitVisual, setSplitVisual] = useState('A');

  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const { showToast } = useUI();
  const { setContentAlign, setRightPanel } = useLayout();
  const navigate = useNavigate();

  // This screen owns its own full-bleed layout (custom header + right rail), so
  // break out of the layout's centered 680px column → full-width main.
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setContentAlign('center'); setRightPanel(null); };
  }, [setContentAlign, setRightPanel]);

  const plan = resolveTier(profile);
  const bracketCfg = getBracketType(type);
  const isAdmin = profile?.staff === true || profile?.role === 'admin';
  const isTicketed = fundingModel === 'ticketed';
  const needsSquad = bracketCfg?.mode === 'squad';
  const finalGame = game;
  const linkedAccounts = profile?.linkedAccounts || {};
  const requiredAccount = GAME_REQUIRED_ACCOUNT[game] || null;
  const walletBalance = wallet?.balance ?? 0;

  const titleWords = name.trim() ? name.trim().split(/\s+/) : [];
  const toggleAccentWord = (i) => setAccentWords(a => a.includes(i) ? a.filter(x => x !== i) : [...a, i]);

  const hasRequiredAccount = (() => {
    if (!requiredAccount) return true;
    const linked = linkedAccounts[requiredAccount];
    if (!linked) return false;
    if (requiredAccount === 'steam') return !!linked.steamId64;
    return typeof linked === 'string' ? !!linked : !!linked.username;
  })();

  useEffect(() => {
    if (!currentUser) return;
    getUserSquads(currentUser.uid).then(setSquads).catch(() => {});
    getEligibleSquadCount(4).then(setEligibleSquadCount).catch(() => setEligibleSquadCount(null));
  }, [currentUser]);

  // keep maxParticipants valid for the chosen bracket
  useEffect(() => {
    if (!bracketCfg) return;
    if (!bracketCfg.allowedPlayers.includes(maxParticipants)) setMaxParticipants(bracketCfg.allowedPlayers[0]);
    if (bracketCfg.streamRequired) setStreamRequired(true);
  }, [type]); // eslint-disable-line

  // ── derived money (exact mirror of backend floor math) ──
  const ticketPriceNum = Math.max(0, Math.min(MAX_ENTRY_FEE_COINS, parseInt(ticketPrice) || 0));
  const ticketCapacityNum = capacityUnlimited ? MAX_CAPACITY : Math.max(0, parseInt(ticketCapacity) || 0);
  const hostTopUpNum = Math.max(0, parseInt(hostTopUp) || 0);
  const purseSliceNum = Math.max(0, Math.min(100, Number(purseSlicePct) || 0));
  const platformFee = Math.floor(ticketPriceNum * 0.10);
  const purseContribution = Math.floor(ticketPriceNum * (purseSliceNum / 100));
  const hostNet = ticketPriceNum - platformFee - purseContribution;
  const purseSoldOut = purseContribution * ticketCapacityNum + hostTopUpNum;
  const hostEarnings = hostNet * ticketCapacityNum;

  const needsSchedule = !!finalGame && requiresManualMod({ game: finalGame });
  const scheduleMs = scheduledStart ? new Date(scheduledStart).getTime() : null;
  const earliestMs = Date.now() + MIN_SCHEDULING_BUFFER_MIN * 60_000;
  const scheduleTooSoon = scheduleMs != null && Number.isFinite(scheduleMs) && scheduleMs < earliestMs;
  const scheduleValid = !needsSchedule || (scheduleMs != null && Number.isFinite(scheduleMs) && scheduleMs >= earliestMs);

  const limitCheck = useMemo(() => validateTournamentLimits({ entryFee: 0, maxParticipants }), [maxParticipants]);

  const step1Valid = name.trim().length >= 3 && !!finalGame;
  const step2Valid = !!bracketCfg && isBracketTypeAllowed(type, plan) && scheduleValid;
  const step3Valid = (!needsSquad || !!squadId) && (
    isTicketed ? (ticketCapacityNum >= 1 && ticketPriceNum <= MAX_ENTRY_FEE_COINS && hostTopUpNum <= walletBalance) : limitCheck.ok
  );
  const canSubmit = step1Valid && step2Valid && step3Valid && agreedToSkillTerms;

  // ── persistence ──
  const buildDraft = () => ({
    phase: 'builder', step, name, description, game, genre, category, titleColor, accentWords, type, maxParticipants,
    seriesFormat, seedingMode, structurePreset, brGameCount, scheduledStart, streamRequired, visibility, bannerUrl,
    fundingModel, ticketPrice, ticketCapacity, capacityUnlimited, purseSlicePct, hostTopUp, ticketAudience, seasonPassEnabled,
    hostSquadId, savedAt: Date.now(),
  });
  const didRestore = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY); if (!raw) { didRestore.current = true; return; }
      const d = JSON.parse(raw);
      if (Number.isInteger(d.step) && d.step >= 1 && d.step <= 4) setStep(d.step);
      if (d.name) { setName(d.name); setPhase('builder'); }
      if (d.description) setDescription(d.description);
      if (d.game) setGame(d.game); if (d.genre) setGenre(d.genre);
      if (d.category) setCategory(d.category); if (d.titleColor) setTitleColor(d.titleColor);
      if (Array.isArray(d.accentWords)) setAccentWords(d.accentWords);
      if (d.type) setType(d.type); if (d.maxParticipants) setMaxParticipants(d.maxParticipants);
      if (d.seriesFormat) setSeriesFormat(d.seriesFormat); if (d.seedingMode) setSeedingMode(d.seedingMode);
      if (d.structurePreset) setStructurePreset(d.structurePreset);
      if (d.brGameCount) setBrGameCount(d.brGameCount);
      if (d.scheduledStart) setScheduledStart(d.scheduledStart);
      if (typeof d.streamRequired === 'boolean') setStreamRequired(d.streamRequired);
      if (d.visibility) setVisibility(d.visibility); if (d.bannerUrl) setBannerUrl(d.bannerUrl);
      if (d.fundingModel) setFundingModel(d.fundingModel);
      if (d.ticketPrice != null) setTicketPrice(d.ticketPrice);
      if (d.ticketCapacity != null) setTicketCapacity(d.ticketCapacity);
      if (typeof d.capacityUnlimited === 'boolean') setCapacityUnlimited(d.capacityUnlimited);
      if (d.purseSlicePct != null) setPurseSlicePct(d.purseSlicePct);
      if (d.hostTopUp != null) setHostTopUp(d.hostTopUp);
      if (d.ticketAudience) setTicketAudience(d.ticketAudience);
      if (typeof d.seasonPassEnabled === 'boolean') setSeasonPassEnabled(d.seasonPassEnabled);
      if (d.hostSquadId) setHostSquadId(d.hostSquadId);
    } catch { /* corrupt draft */ }
    finally { didRestore.current = true; }
  }, []); // eslint-disable-line
  useEffect(() => {
    if (!didRestore.current || phase !== 'builder') return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(buildDraft())); } catch { /* quota */ } }, 400);
    return () => clearTimeout(t);
  }); // eslint-disable-line

  // ── actions ──
  const pickGame = (label) => {
    setGame(label);
    const reqAcct = GAME_REQUIRED_ACCOUNT[label];
    if (!reqAcct) return;
    const linked = linkedAccounts[reqAcct];
    const has = reqAcct === 'steam' ? !!linked?.steamId64 : (typeof linked === 'string' ? !!linked : !!linked?.username);
    if (!has) setConnectPlatform(reqAcct);
  };

  const applyTemplate = (t) => {
    const a = t.apply;
    setType(a.type); setStructurePreset('single_stage'); setMaxParticipants(a.maxParticipants);
    setSeriesFormat(a.seriesFormat); setFundingModel('ticketed'); setTicketPrice(a.ticketPrice);
    setPurseSlicePct(a.purseSlicePct); setScheduledStart(startInputFromOffset(a.startOffsetMin));
    if (!name.trim()) setName(t.label);
    setPhase('builder'); setStep(1);
  };

  const handleNext = () => {
    if (step === 1 && !step1Valid) { showToast('Add a name and pick a game', 'error'); return; }
    if (step === 2 && !isBracketTypeAllowed(type, plan)) { showToast('Your plan cannot use this format', 'error'); return; }
    if (step === 2 && needsSchedule && !scheduledStart) { showToast('Pick a start time — a referee confirms results for this game', 'error'); return; }
    if (step === 2 && needsSchedule && scheduleTooSoon) { showToast(`Start time is too soon — pick at least ${MIN_SCHEDULING_BUFFER_MIN} minutes from now`, 'error'); return; }
    if (step === 3 && isTicketed && ticketCapacityNum < 1) { showToast('Set how many tickets are available (at least 1)', 'error'); return; }
    if (step === 3 && isTicketed && hostTopUpNum > walletBalance) { showToast('Prize top-up exceeds your coin balance', 'error'); return; }
    if (step === 3 && !step3Valid) { showToast('Check your ticket settings', 'error'); return; }
    setStep(s => Math.min(4, s + 1));
  };
  const handleBack = () => { if (step === 1) { setPhase('landing'); return; } setStep(s => Math.max(1, s - 1)); };

  const handleCreate = async () => {
    if (!canSubmit || loading) return;
    if (!isBracketTypeAllowed(type, plan)) { showToast(`${bracketCfg.label} requires a ${bracketCfg.minPlan} plan`, 'error'); return; }
    setLoading(true);
    try {
      const result = await createTournamentSecure({
        squadId: squadId || null,
        name: name.trim(), description: description.trim(), game: finalGame,
        entryFee: 0, fundingModel,
        ticket: isTicketed ? {
          priceCoins: ticketPriceNum, capacity: ticketCapacityNum, purseSlicePct: purseSliceNum,
          audience: ticketAudience, seasonPassEnabled,
        } : null,
        hostTopUpCoins: isTicketed ? hostTopUpNum : 0,
        maxParticipants, type, mode: bracketCfg.mode, streamRequired,
        scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        brGameCount: type === 'battle_royale' ? brGameCount : null,
        swissRounds: type === 'swiss' ? recommendedSwissRounds(maxParticipants) : null,
        visibility, category,
        titleColor: accentWords.length ? titleColor : null,
        accentWords: accentWords.filter(i => i < titleWords.length),
        bannerUrl: bannerUrl || null,
        hostSquadId: hostSquadId || null,
        // Send the guest list for private events OR invite-only ticket sales
        // (the backend gates 'invite' ticket buyers against invitedUserIds).
        invitedUserIds: (visibility === 'private' || ticketAudience === 'invite') ? invitedUsers.map(u => u.id) : [],
        seriesFormat, seedingMode,
        stages: stagesForPreset(structurePreset, { type, seriesFormat, seedingMode }),
      });
      const tournamentId = result?.tournamentId || result?.id;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      showToast('Tournament created!', 'success');
      navigate(`/match/${tournamentId}`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to create tournament', 'error');
    }
    setLoading(false);
  };

  const handleBannerFile = async (file) => {
    if (!file || !currentUser) return;
    setBannerUploading(true);
    try { setBannerUrl(await uploadTournamentBanner(currentUser.uid, file)); }
    catch (err) { showToast(err?.message || 'Banner upload failed', 'error'); }
    finally { setBannerUploading(false); }
  };

  // highlighted-title renderer (preview + review)
  const renderTitleWords = (size) => titleWords.length === 0
    ? <span style={{ color: '#fff' }}>Your tournament</span>
    : titleWords.map((w, i) => <span key={i} style={{ color: accentWords.includes(i) ? titleColor : '#fff', textShadow: accentWords.includes(i) ? `0 0 18px ${titleColor}66` : 'none' }}>{w} </span>);

  const games = gamesForGenre(genre);
  const isBR = type === 'battle_royale';
  const STEPS = [
    { n: 1, label: 'Event' }, { n: 2, label: 'Format' }, { n: 3, label: 'Tickets' }, { n: 4, label: 'Review' },
  ];

  return (
    <div className="relative min-h-screen bg-bg-dark text-text-primary overflow-x-hidden">
      <style>{`
        .vgr-range{-webkit-appearance:none;appearance:none;height:8px;border-radius:8px;outline:none;cursor:pointer}
        .vgr-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:24px;height:24px;border-radius:50%;background:#fff;border:5px solid #B44FFF;box-shadow:0 4px 16px rgba(123,31,255,0.6);cursor:pointer}
        .no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
        @keyframes vgrAuroraA{0%{transform:translate(0,0) scale(1)}50%{transform:translate(50px,-30px) scale(1.12)}100%{transform:translate(0,0) scale(1)}}
        @keyframes vgrGlow{0%,100%{opacity:.55}50%{opacity:1}}
      `}</style>

      {/* aurora wash */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-52 -left-28 w-[720px] h-[720px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(123,31,255,0.28),transparent 62%)', filter: 'blur(40px)', animation: 'vgrAuroraA 18s ease-in-out infinite' }} />
        <div className="absolute top-32 -right-48 w-[640px] h-[640px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(200,127,255,0.18),transparent 62%)', filter: 'blur(50px)' }} />
      </div>

      {/* top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 lg:px-8 py-4 bg-bg-dark/70 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center gap-3.5">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center shadow-lg shadow-brand-violet/40"><Icon name="bolt" size={21} className="text-white" /></div>
          <span className="font-syne font-extrabold text-[19px] tracking-[0.14em]">VERGR</span>
          <span className="w-px h-5 bg-white/12" />
          <span className="text-[13px] text-text-muted font-medium">Create a Tournament</span>
        </div>
        <div className="flex items-center gap-4">
          {phase === 'builder' && <span className="flex items-center gap-1.5 text-[12.5px] text-text-muted"><Icon name="cloud_done" size={16} className="text-green-500" />Draft saved</span>}
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-text-muted flex items-center justify-center"><Icon name="close" size={20} /></button>
        </div>
      </header>

      {/* ───────── LANDING ───────── */}
      {phase === 'landing' && (
        <main className="relative z-1 max-w-[1200px] mx-auto px-6 lg:px-8 pt-14 pb-24">
          <div className="flex items-center gap-2 mb-4 text-[12px] font-semibold tracking-[0.16em] text-brand-violet-light uppercase"><span className="w-6 h-px bg-brand-violet-light" />New event</div>
          <h1 className="font-syne font-extrabold text-[clamp(44px,7vw,74px)] leading-[0.98] tracking-tight max-w-[880px]">
            Build your stage.<br /><span className="bg-gradient-to-r from-brand-violet-light to-brand-pink bg-clip-text text-transparent">Claim the crown.</span>
          </h1>
          <p className="text-[18px] text-text-muted mt-5 max-w-[560px] leading-relaxed">Host a cup. Set the stakes. Turn your community into a live, money-making event in four steps.</p>

          <div className="grid lg:grid-cols-[1.55fr_1fr] gap-9 mt-14 items-start">
            <div>
              <div className="font-syne font-bold text-sm mb-4 flex items-center gap-2.5"><span className="text-text-muted text-[13px]">01</span>What are you hosting?</div>
              <div className="grid grid-cols-3 gap-3.5">
                {TOURNAMENT_CATEGORIES.map(c => (
                  <button key={c.id} onClick={() => { setCategory(c.id); setPhase('builder'); setStep(1); }}
                    className="text-left rounded-2xl p-5 border border-white/[0.08] bg-gradient-to-b from-white/[0.045] to-white/[0.01] flex flex-col gap-3 min-h-[158px] hover:-translate-y-1 hover:border-brand-violet-light/55 transition-all">
                    <span className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center bg-brand-violet/15"><Icon name={c.icon} size={23} className="text-brand-violet-light" /></span>
                    <div><div className="font-syne font-bold text-base leading-tight">{c.label}</div><div className="text-[12.5px] text-text-muted mt-1 leading-snug">{c.sub}</div></div>
                  </button>
                ))}
              </div>

              <div className="font-syne font-bold text-sm mt-9 mb-4 flex items-center gap-2.5"><span className="text-text-muted text-[13px]">02</span>Start from a template</div>
              <div className="flex flex-col gap-3">
                {QUICK_TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="flex items-center gap-4.5 text-left rounded-2xl p-4 border border-white/[0.08] bg-surface-1/60 hover:-translate-y-0.5 hover:border-brand-violet-light/50 transition-all">
                    <span className="w-[52px] h-[52px] shrink-0 rounded-[13px] flex items-center justify-center shadow-lg" style={{ background: t.tint }}><Icon name={t.icon} size={26} className="text-white" /></span>
                    <div className="flex-1"><div className="font-syne font-bold text-base">{t.label}</div><div className="text-[12.5px] text-text-muted mt-0.5">{t.meta}</div></div>
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-pink">Use template <Icon name="arrow_forward" size={18} /></span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setPhase('builder'); setStep(1); }} className="mt-5 inline-flex items-center gap-2 text-text-muted text-sm font-medium"><Icon name="add_circle" size={19} />Start from scratch instead</button>
            </div>

            <aside className="rounded-[20px] border border-white/[0.07] bg-gradient-to-b from-surface-2/70 to-surface-1/50 p-6 relative overflow-hidden">
              <div className="absolute -top-16 -right-16 w-52 h-52 rounded-full" style={{ background: 'radial-gradient(circle,rgba(123,31,255,0.35),transparent 65%)', filter: 'blur(20px)' }} />
              <div className="font-syne font-bold text-[17px] mb-1 relative">Why host on VERGR</div>
              <div className="text-[12.5px] text-text-muted mb-5 relative">You produce the show. We run the bracket.</div>
              <div className="flex flex-col gap-4 relative">
                {[
                  { icon: 'diversity_3', title: 'Grow your community', line: 'Turn followers into competitors and fans.' },
                  { icon: 'payments', title: 'Earn from tickets', line: 'Fans buy tickets, you keep the lion\'s share.' },
                  { icon: 'emoji_events', title: 'Crown a champion', line: 'We build the bracket and verify results.' },
                ].map((w, i) => (
                  <div key={i} className="flex gap-3.5 items-start">
                    <span className="w-[34px] h-[34px] shrink-0 rounded-[10px] bg-brand-violet/14 flex items-center justify-center"><Icon name={w.icon} size={19} className="text-brand-pink" /></span>
                    <div><div className="font-semibold text-[13.5px]">{w.title}</div><div className="text-[12px] text-text-muted mt-0.5 leading-snug">{w.line}</div></div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/platform/learn/tournaments')} className="mt-6 w-full py-3 rounded-[11px] border border-white/12 bg-white/[0.04] text-white font-semibold text-[13.5px] flex items-center justify-center gap-2"><Icon name="menu_book" size={18} />Open host guide</button>
            </aside>
          </div>
        </main>
      )}

      {/* ───────── BUILDER ───────── */}
      {phase === 'builder' && (
        <main className="relative z-1 max-w-[1400px] mx-auto px-6 lg:px-8 pt-7 pb-32">
          {/* stepper */}
          <div className="flex items-center gap-2 mb-7">
            {STEPS.map(s => {
              const active = step === s.n, done = step > s.n;
              return (
                <button key={s.n} onClick={() => s.n < step && setStep(s.n)} className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <span className={`w-[30px] h-[30px] shrink-0 rounded-[9px] flex items-center justify-center font-bold text-[13px] border ${active ? 'border-brand-violet bg-brand-violet text-white' : done ? 'border-brand-violet/40 bg-brand-violet/15 text-brand-violet-light' : 'border-white/10 bg-white/[0.03] text-text-muted'}`}>{done ? <Icon name="check" size={15} /> : s.n}</span>
                    <div><div className="text-[10px] tracking-[0.14em] uppercase text-text-muted font-semibold">Step {s.n}</div><div className={`font-syne font-bold text-sm ${active || done ? 'text-text-primary' : 'text-text-muted'}`}>{s.label}</div></div>
                  </div>
                  <div className="h-[3px] rounded-full mt-2.5 bg-white/[0.07] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand-violet to-brand-pink transition-all" style={{ width: done ? '100%' : active ? '50%' : '0%' }} /></div>
                </button>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-[1fr_384px] gap-9 items-start">
            <div className="min-w-0">

              {/* ===== STEP 1 EVENT ===== */}
              {step === 1 && (
                <section className="space-y-6">
                  <div><div className="font-syne font-extrabold text-[34px] tracking-tight">The identity of your event</div><div className="text-text-muted text-[14.5px] mt-1">This is what the world sees first. Make it unmistakable.</div></div>

                  <div>
                    <SectionLabel info={{ title: 'Your event poster', body: 'A bold 3:1 image fans see everywhere this tournament appears. No image yet? Tap Use template for a ready-made one.' }}>Banner</SectionLabel>
                    <BannerPicker bannerUrl={bannerUrl} setBannerUrl={setBannerUrl} uploading={bannerUploading} onFile={handleBannerFile} />
                  </div>

                  <div className="p-5 rounded-2xl border border-white/[0.07] bg-surface-1/55">
                    <SectionLabel info={{ title: 'Make your name pop', body: "Pick a colour, then tap the words you want to glow. The rest stay white. Great for drawing the eye to your game or 'FINALS'." }}>Tournament name</SectionLabel>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Friday Night Valorant Cup"
                      className="w-full px-4 py-3.5 rounded-xl border border-white/10 bg-[#0f0f1a] text-text-primary text-[17px] font-semibold outline-none" />
                    {titleWords.length > 0 && (
                      <div className="flex items-center justify-between mt-3.5 flex-wrap gap-3">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-[12px] text-text-muted mr-0.5">Tap a word to glow:</span>
                          {titleWords.map((w, i) => {
                            const on = accentWords.includes(i);
                            return <button key={i} onClick={() => toggleAccentWord(i)} className="px-2.5 py-1.5 rounded-lg border text-[13.5px] font-semibold" style={{ color: on ? titleColor : '#fff', borderColor: on ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)', background: on ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)' }}>{w}</button>;
                          })}
                        </div>
                        <div className="flex items-center gap-1.5"><span className="text-[12px] text-text-muted">Glow:</span>
                          {TITLE_COLORS.map(c => <button key={c} onClick={() => setTitleColor(c)} className="w-6 h-6 rounded-full" style={{ background: c, border: titleColor === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)', boxShadow: `0 0 10px ${c}66` }} />)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <SectionLabel info={{ title: 'The game you play in', body: "Some games need you to connect that game's account (so we can verify results). Don't see your game? Tap Request a game." }}>Game</SectionLabel>
                      <div className="flex gap-1.5 flex-wrap justify-end max-w-[60%]">
                        {GENRES.map(g => (
                          <button key={g.label} onClick={() => setGenre(g.label)} className={`px-3 py-1.5 rounded-full border text-[12px] font-semibold whitespace-nowrap ${genre === g.label ? 'border-brand-violet bg-brand-violet/15 text-brand-violet-light' : 'border-white/10 bg-white/[0.03] text-text-muted'}`}>{g.label}</button>
                        ))}
                      </div>
                    </div>
                    <GameCarousel games={games} selected={game} onPick={pickGame} onRequest={() => setShowRequestGame(true)} />
                    {requiredAccount && !hasRequiredAccount && (
                      <div className="flex items-center justify-between gap-4 mt-1.5 px-4 py-3 rounded-xl border border-brand-ember/35 bg-brand-ember/[0.08]">
                        <div className="flex items-center gap-3"><Icon name="link" size={20} className="text-brand-ember" /><div className="text-[13px]"><b>Connect your {PLATFORM_META[requiredAccount]?.name} account</b> to host {finalGame}. <span className="text-text-muted">We use it only to verify match results.</span></div></div>
                        <button onClick={() => setConnectPlatform(requiredAccount)} className="shrink-0 px-4 py-2 rounded-lg bg-brand-ember text-white font-bold text-[12.5px]">Connect</button>
                      </div>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4.5">
                    <div>
                      <SectionLabel info={{ title: 'A label for the vibe', body: "Competitive, Casual, or Community. Cosmetic only, it doesn't change how anything works." }}>Tournament type</SectionLabel>
                      <div className="flex flex-col gap-2">
                        {TOURNAMENT_CATEGORIES.map(o => (
                          <button key={o.id} onClick={() => setCategory(o.id)} className={`flex items-center gap-3 text-left px-3.5 py-3 rounded-xl border ${category === o.id ? 'border-brand-violet bg-brand-violet/5' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                            <Icon name={o.icon} size={20} className={category === o.id ? 'text-brand-violet-light' : 'text-text-muted'} /><div><div className="font-semibold text-[13.5px]">{o.label}</div><div className="text-[11.5px] text-text-muted">{o.sub}</div></div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <SectionLabel info={{ title: 'Who can find it', body: 'Public events show up in browse and anyone can join. Private events are invite-only and hidden.' }}>Visibility</SectionLabel>
                      <div className="flex flex-col gap-2">
                        {[{ id: 'public', label: 'Public', sub: 'Anyone can find and join', icon: 'public' }, { id: 'private', label: 'Private', sub: 'Invite-only, hidden', icon: 'lock' }].map(o => (
                          <button key={o.id} onClick={() => setVisibility(o.id)} className={`flex items-center gap-3 text-left px-3.5 py-3 rounded-xl border ${visibility === o.id ? 'border-brand-violet bg-brand-violet/5' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                            <Icon name={o.icon} size={20} className={visibility === o.id ? 'text-brand-violet-light' : 'text-text-muted'} /><div><div className="font-semibold text-[13.5px]">{o.label}</div><div className="text-[11.5px] text-text-muted">{o.sub}</div></div>
                          </button>
                        ))}
                      </div>
                      {visibility === 'private' && (
                        <button onClick={() => { setInviteMode('player'); setShowInviteModal(true); }} className="mt-2 w-full py-2.5 rounded-xl border border-dashed border-brand-violet/50 bg-brand-violet/[0.08] text-brand-pink font-semibold text-[12.5px] flex items-center justify-center gap-2"><Icon name="person_add" size={17} />{invitedUsers.length ? `${invitedUsers.length} invited` : 'Invite players'}</button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="font-syne font-bold text-[15px] mb-3">Description <span className="font-medium text-[12px] text-text-muted">(optional)</span></div>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={240} rows={3} placeholder="Tell fans what makes this event worth watching."
                      className="w-full px-4 py-3 rounded-xl border border-white/10 bg-[#0f0f1a] text-text-primary text-sm outline-none resize-none" />
                  </div>
                </section>
              )}

              {/* ===== STEP 2 FORMAT ===== */}
              {step === 2 && (
                <section className="space-y-6">
                  <div><div className="font-syne font-extrabold text-[34px] tracking-tight">How it's played</div><div className="text-text-muted text-[14.5px] mt-1">Pick the bracket. We build the matches, rounds and rules for you.</div></div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    {BRACKET_TYPE_LIST.map(f => {
                      const allowed = isBracketTypeAllowed(f.id, plan);
                      const isSquadFormat = f.mode === 'squad';
                      const minSquads = (f.allowedPlayers?.[0]) || 4;
                      const supplyOk = !isSquadFormat || eligibleSquadCount === null || eligibleSquadCount >= minSquads;
                      const locked = !allowed || !supplyOk;
                      const selected = type === f.id;
                      return (
                        <button key={f.id} onClick={() => { if (!supplyOk) return; allowed ? setType(f.id) : navigate('/settings/subscription'); }}
                          className="relative text-left rounded-2xl p-4.5 border overflow-hidden" style={{ borderColor: selected ? 'rgba(180,79,255,0.6)' : 'rgba(255,255,255,0.08)', background: selected ? 'rgba(123,31,255,0.08)' : 'rgba(20,20,31,0.5)', opacity: locked ? 0.6 : 1, padding: 18 }}>
                          {selected && <div className="absolute top-0 right-0 w-28 h-28" style={{ background: 'radial-gradient(circle at top right,rgba(180,79,255,0.3),transparent 65%)' }} />}
                          <div className="flex items-start justify-between gap-3 relative">
                            <div className="flex items-center gap-3"><span className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center" style={{ background: selected ? 'rgba(180,79,255,0.18)' : 'rgba(255,255,255,0.05)' }}><Icon name={f.icon} size={21} className={selected ? 'text-brand-violet-light' : 'text-text-muted'} /></span><span className="font-syne font-bold text-[15.5px] max-w-[170px] leading-tight">{f.label}</span></div>
                            {!allowed && <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide bg-brand-gold/15 text-brand-gold uppercase">{f.minPlan}</span>}
                          </div>
                          <div className="text-[12.5px] text-text-muted mt-3 leading-snug relative">{f.description}</div>
                          {!supplyOk && <div className="flex items-center gap-1.5 mt-3 text-[11.5px] text-brand-violet-light font-semibold relative"><Icon name="lock" size={14} />Unlocks at {minSquads} squads</div>}
                          {!allowed && supplyOk && <div className="flex items-center gap-1.5 mt-3 text-[11.5px] text-brand-gold font-semibold relative"><Icon name="lock" size={14} />Upgrade to {f.minPlan}</div>}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4.5">
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 18 }}>
                      <SectionLabel info={{ title: 'How many compete', body: 'Bigger fields mean more rounds. We only show sizes your chosen format supports.' }}>{needsSquad ? 'Max squads' : 'Max players'}</SectionLabel>
                      <div className="flex gap-2 flex-wrap">
                        {(bracketCfg?.allowedPlayers || []).map(n => (
                          <button key={n} onClick={() => setMaxParticipants(n)} className={`min-w-[52px] py-2.5 rounded-xl border font-bold text-[15px] tabular-nums ${maxParticipants === n ? 'border-brand-gold/40 bg-brand-gold/15 text-brand-gold' : 'border-white/[0.08] bg-white/[0.03] text-text-muted'}`}>{n}</button>
                        ))}
                      </div>
                      {isBR && (
                        <>
                          <div className="font-syne font-bold text-[15px] mt-4.5 mb-3" style={{ marginTop: 18 }}>Games per event</div>
                          <div className="flex gap-2">{[1, 3, 5, 7].map(n => <button key={n} onClick={() => setBrGameCount(n)} className={`min-w-[52px] py-2.5 rounded-xl border font-bold text-[15px] ${brGameCount === n ? 'border-brand-ember/40 bg-brand-ember/15 text-brand-ember' : 'border-white/[0.08] bg-white/[0.03] text-text-muted'}`}>{n}</button>)}</div>
                        </>
                      )}
                    </div>
                    <div className="p-4.5 rounded-2xl border border-brand-violet/20" style={{ background: 'linear-gradient(160deg,rgba(123,31,255,0.12),rgba(20,20,31,0.5))', padding: 18 }}>
                      <div className="text-[11px] tracking-[0.16em] uppercase text-brand-pink font-bold mb-3">What this produces</div>
                      <BracketTree type={type} count={maxParticipants} seriesFormat={seriesFormat} />
                    </div>
                  </div>

                  {/* start time */}
                  <div className="p-4.5 rounded-2xl border bg-surface-1/55" style={{ padding: 18, borderColor: needsSchedule && scheduleTooSoon ? 'rgba(240,165,0,0.4)' : 'rgba(255,255,255,0.07)' }}>
                    <SectionLabel info={{ title: 'When it begins', body: 'For referee-verified games pick a time at least 60 minutes from now so a referee can take the match. Auto-verified games skip this.' }}>Start time</SectionLabel>
                    <DateTimePicker value={scheduledStart} onChange={setScheduledStart} minMs={needsSchedule ? earliestMs : Date.now()} />
                    {needsSchedule
                      ? <div className="flex items-start gap-2 mt-3 text-[12.5px] text-brand-gold leading-snug"><Icon name="schedule" size={17} className="mt-px" /><span>A referee confirms results for {finalGame}, so pick a start time at least 60 minutes from now. <span className="text-text-muted">Auto-verified games (CS2, Dota 2, Overwatch 2, Apex) skip this.</span></span></div>
                      : finalGame ? <div className="flex items-center gap-2 mt-3 text-[12.5px] text-green-500"><Icon name="verified" size={17} />{finalGame} verifies results automatically, so a start time is optional.</div> : null}
                  </div>

                  {/* live stream */}
                  <button onClick={() => !bracketCfg?.streamRequired && setStreamRequired(v => !v)} className="w-full flex items-center justify-between px-4.5 py-4 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 16 }}>
                    <div className="flex items-center gap-3"><Icon name="live_tv" size={22} className={streamRequired ? 'text-brand-ember' : 'text-text-muted'} /><div className="text-left"><div className="font-semibold text-[14px]">Live stream on VERGR</div><div className="text-[12px] text-text-muted">{bracketCfg?.streamRequired ? 'Required for invitationals' : 'Let fans watch your matches live'}</div></div></div>
                    <div className={`w-[50px] h-7 rounded-full relative transition-colors ${streamRequired ? 'bg-brand-ember' : 'bg-white/10'}`}><span className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white transition-all" style={{ left: streamRequired ? 25 : 3 }} /></div>
                  </button>

                  {/* advanced */}
                  <button onClick={() => setAdvancedOpen(o => !o)} className="w-full flex items-center justify-between px-4.5 py-4 rounded-2xl border border-white/[0.07] bg-surface-1/40" style={{ padding: 16 }}>
                    <span className="flex items-center gap-3"><Icon name="tune" size={21} className="text-text-muted" /><span className="text-left"><span className="block font-semibold text-[14px]">Advanced options <span className="font-medium text-[12px] text-text-muted">optional</span></span><span className="block text-[12px] text-text-muted">Fine-tune the shape of the bracket. Most hosts can skip this.</span></span></span>
                    <Icon name="expand_more" size={22} className="text-text-muted transition-transform" style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  {advancedOpen && (
                    <div className="grid sm:grid-cols-3 gap-4.5 p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/40" style={{ padding: 18 }}>
                      <div>
                        <div className="flex items-center gap-1.5 mb-2.5"><span className="text-[12.5px] text-text-primary font-semibold">Bracket shape</span><InfoDot title="How the event is staged">Most events run as one bracket. Pick a two-stage shape if you want fair qualifying rounds (Swiss) or group play before a knockout finish.</InfoDot></div>
                        <div className="flex flex-col gap-1.5">{STAGE_PRESETS.map(o => <button key={o.id} onClick={() => setStructurePreset(o.id)} className={`text-left px-3 py-2 rounded-lg border ${structurePreset === o.id ? 'border-brand-violet bg-brand-violet/10' : 'border-white/[0.08] bg-white/[0.02]'}`}><span className="block text-[12.5px] font-semibold">{o.label}</span><span className="block text-[11px] text-text-muted leading-snug">{o.sub}</span></button>)}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-2.5"><span className="text-[12.5px] text-text-primary font-semibold">Games per match</span><InfoDot title="How many games per match">A match can be a single game, or a longer series. Best of 3 means first to 2 wins, Best of 5 means first to 3. Longer series reward consistency but take more time.</InfoDot></div>
                        <div className="flex flex-col gap-1.5">{SERIES_OPTS.map(o => <button key={o.id} onClick={() => setSeriesFormat(o.id)} className={`text-left px-3 py-2 rounded-lg border ${seriesFormat === o.id ? 'border-brand-violet bg-brand-violet/10' : 'border-white/[0.08] bg-white/[0.02]'}`}><span className="block text-[12.5px] font-semibold">{o.label}</span><span className="block text-[11px] text-text-muted leading-snug">{o.sub}</span></button>)}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-2.5"><span className="text-[12.5px] text-text-primary font-semibold">Who plays who first</span><InfoDot title="How players are placed">Seeding decides the opening matchups. Random shuffles everyone, Manual lets you place players yourself, and By rating keeps the strongest players apart until later rounds.</InfoDot></div>
                        <div className="flex flex-col gap-1.5">{SEED_OPTS.map(o => <button key={o.id} onClick={() => setSeedingMode(o.id)} className={`text-left px-3 py-2 rounded-lg border ${seedingMode === o.id ? 'border-brand-violet bg-brand-violet/10' : 'border-white/[0.08] bg-white/[0.02]'}`}><span className="block text-[12.5px] font-semibold">{o.label}</span><span className="block text-[11px] text-text-muted leading-snug">{o.sub}</span></button>)}</div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ===== STEP 3 TICKETS ===== */}
              {step === 3 && (
                <section className="space-y-5">
                  <div><div className="font-syne font-extrabold text-[34px] tracking-tight">Set the stakes</div><div className="text-text-muted text-[14.5px] mt-1">Competitors play for free. Fans buy tickets. You build the prize pool.</div></div>

                  {/* funding flow explainer */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { icon: 'sports_esports', title: 'Competitors join free', line: 'They never pay and are the only ones who can win.', tint: 'rgba(123,31,255,0.12)', ic: '#C87FFF' },
                      { icon: 'confirmation_number', title: 'Fans buy tickets', line: 'Spectators pay to watch and support.', tint: 'rgba(61,127,255,0.1)', ic: '#3D7FFF' },
                      { icon: 'savings', title: 'Prize pool grows', line: 'Your chosen slice of each ticket funds the prize.', tint: 'rgba(240,165,0,0.1)', ic: '#F5C842' },
                      { icon: 'emoji_events', title: 'Winner takes all', line: 'The champion takes the whole prize pool.', tint: 'rgba(240,165,0,0.12)', ic: '#F5C842' },
                    ].map((x, i) => (
                      <div key={i} className="p-3.5 rounded-2xl border border-white/[0.07]" style={{ background: x.tint }}>
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center mb-2.5" style={{ background: 'rgba(0,0,0,0.25)' }}><Icon name={x.icon} size={18} style={{ color: x.ic }} /></span>
                        <div className="font-bold text-[13px] mb-1">{x.title}</div><div className="text-[11.5px] text-text-muted leading-snug">{x.line}</div>
                      </div>
                    ))}
                  </div>

                  {/* price + capacity (sliders) */}
                  <div className="grid sm:grid-cols-2 gap-4.5">
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 18 }}>
                      <SectionLabel info={{ title: 'What fans pay to watch', body: 'Competitors never pay. Set 0 for a free-to-watch event. Up to 10,000 VC.' }}>Ticket price</SectionLabel>
                      <SliderField value={ticketPriceNum} onChange={setTicketPrice} min={0} max={MAX_ENTRY_FEE_COINS} step={10} suffix="VC" accent="#F5C842" hint={`≈ €${(ticketPriceNum * 0.01).toFixed(2)} per ticket (est, ex tax) · up to 10,000 VC`} />
                    </div>
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 18 }}>
                      <SectionLabel info={{ title: 'How many tickets', body: 'Set how many tickets you want to sell. Turn on Unlimited if you do not want to cap it.' }}>Capacity</SectionLabel>
                      <SliderField value={Math.min(ticketCapacity, 5000)} onChange={setTicketCapacity} min={0} max={5000} step={50} suffix="tickets" accent="#B44FFF"
                        unlimited isUnlimited={capacityUnlimited} onToggleUnlimited={() => setCapacityUnlimited(v => !v)}
                        hint={capacityUnlimited ? 'No cap on how many tickets fans can buy.' : 'Drag to set how many tickets you will sell.'} />
                    </div>
                  </div>

                  {/* audience */}
                  <div>
                    <SectionLabel info={{ title: 'Who can buy tickets', body: 'Everyone, only your followers, only your paid members, or only guests you invite. Competitors never buy tickets — they play for free.' }}>Ticket audience</SectionLabel>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {TICKET_AUDIENCES.map(o => (
                        <button key={o.id} onClick={() => setTicketAudience(o.id)} className={`flex items-center gap-2.5 text-left px-3.5 py-3 rounded-xl border ${ticketAudience === o.id ? 'border-brand-violet bg-brand-violet/5' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                          <Icon name={o.icon} size={21} className={ticketAudience === o.id ? 'text-brand-violet-light' : 'text-text-muted'} /><div><div className="font-semibold text-[13.5px]">{o.label}</div><div className="text-[11px] text-text-muted">{o.sub}</div></div>
                        </button>
                      ))}
                    </div>
                    {ticketAudience === 'invite' && (
                      <button onClick={() => { setInviteMode('spectator'); setShowInviteModal(true); }} className="mt-2.5 w-full py-2.5 rounded-xl border border-dashed border-brand-violet/50 bg-brand-violet/[0.08] text-brand-pink font-semibold text-[12.5px] flex items-center justify-center gap-2">
                        <Icon name="person_add" size={17} />{invitedUsers.length ? `${invitedUsers.length} guest${invitedUsers.length === 1 ? '' : 's'} invited` : 'Invite guests who can buy tickets'}
                      </button>
                    )}
                  </div>

                  {/* REVENUE SHARE (centerpiece) */}
                  <div className="p-5.5 rounded-[18px] border border-brand-gold/25" style={{ background: 'linear-gradient(165deg,rgba(240,165,0,0.07),rgba(20,20,31,0.6))', padding: 22 }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <SectionLabel info={{ title: 'Your revenue split', body: "The slice of each ticket that goes into the prize pool for your winner. The rest (after VERGR's 10%) is yours. Drag to see it update live." }}>Revenue share</SectionLabel>
                      <div className="flex items-center gap-1 p-0.5 rounded-[10px] bg-black/30 border border-white/[0.08]">
                        <span className="text-[10px] text-text-muted px-1.5">Visual</span>
                        <button onClick={() => setSplitVisual('A')} className={`px-2.5 py-1 rounded-lg font-bold text-[12px] ${splitVisual === 'A' ? 'bg-brand-gold text-[#1a1300]' : 'text-text-muted'}`}>Ledger</button>
                        <button onClick={() => setSplitVisual('B')} className={`px-2.5 py-1 rounded-lg font-bold text-[12px] ${splitVisual === 'B' ? 'bg-brand-gold text-[#1a1300]' : 'text-text-muted'}`}>Coin flow</button>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-3 my-3.5"><span className="font-syne font-extrabold text-[40px] text-brand-gold-light tabular-nums">{purseSliceNum}%</span><span className="text-[13px] text-text-muted">of every ticket goes to the winner's prize pool</span></div>
                    <input type="range" min={0} max={100} value={purseSliceNum} onChange={e => setPurseSlicePct(parseInt(e.target.value))} className="vgr-range w-full" style={{ background: `linear-gradient(90deg,#F0A500 ${purseSliceNum}%,rgba(255,255,255,0.1) ${purseSliceNum}%)` }} />

                    {splitVisual === 'A' ? (
                      <div className="mt-5">
                        <div className="h-[46px] rounded-xl overflow-hidden flex border border-white/[0.08]">
                          <div className="flex items-center justify-center font-bold text-[13px] tabular-nums overflow-hidden whitespace-nowrap transition-all" style={{ width: `${ticketPriceNum ? (hostNet / ticketPriceNum) * 100 : 0}%`, background: 'linear-gradient(180deg,#7B1FFF,#5a13c0)' }}>{hostNet}</div>
                          <div className="flex items-center justify-center font-bold text-[13px] tabular-nums overflow-hidden whitespace-nowrap text-[#1a1300] transition-all" style={{ width: `${ticketPriceNum ? (purseContribution / ticketPriceNum) * 100 : 0}%`, background: 'linear-gradient(180deg,#F0A500,#c98700)' }}>{purseContribution}</div>
                          <div className="flex items-center justify-center font-bold text-[13px] tabular-nums overflow-hidden whitespace-nowrap transition-all" style={{ width: `${ticketPriceNum ? (platformFee / ticketPriceNum) * 100 : 0}%`, background: 'rgba(255,255,255,0.12)' }}>{platformFee}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mt-4">
                          <div className="p-3.5 rounded-xl bg-brand-violet/10 border border-brand-violet/30"><div className="flex items-center gap-1.5 text-[11.5px] text-brand-pink font-semibold"><span className="w-2.5 h-2.5 rounded-sm bg-brand-violet" />You keep</div><div className="font-syne font-extrabold text-[23px] mt-1.5 flex items-center gap-1.5"><CoinIcon size={18} /><span className="tabular-nums">{hostNet}</span><span className="text-[12px] text-text-muted font-medium">VC /ticket</span></div></div>
                          <div className="p-3.5 rounded-xl bg-brand-gold/10 border border-brand-gold/30"><div className="flex items-center gap-1.5 text-[11.5px] text-brand-gold-light font-semibold"><span className="w-2.5 h-2.5 rounded-sm bg-brand-gold" />Prize pool</div><div className="font-syne font-extrabold text-[23px] mt-1.5 text-brand-gold-light flex items-center gap-1.5"><CoinIcon size={18} /><span className="tabular-nums">{purseContribution}</span><span className="text-[12px] text-text-muted font-medium">VC /ticket</span></div></div>
                          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10"><div className="flex items-center gap-1.5 text-[11.5px] text-text-muted font-semibold"><span className="w-2.5 h-2.5 rounded-sm bg-white/40" />VERGR fee (10%)</div><div className="font-syne font-extrabold text-[23px] mt-1.5 text-text-muted flex items-center gap-1.5"><CoinIcon size={18} /><span className="tabular-nums">{platformFee}</span><span className="text-[12px] font-medium">VC /ticket</span></div></div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 grid grid-cols-[170px_1fr] gap-6 items-center">
                        <div className="relative w-[170px] h-[170px]">
                          <div className="absolute inset-0 rounded-full transition-all" style={{ background: `conic-gradient(#7B1FFF 0 ${ticketPriceNum ? (hostNet / ticketPriceNum) * 360 : 0}deg,#F0A500 ${ticketPriceNum ? (hostNet / ticketPriceNum) * 360 : 0}deg ${ticketPriceNum ? ((hostNet + purseContribution) / ticketPriceNum) * 360 : 0}deg,rgba(255,255,255,0.18) ${ticketPriceNum ? ((hostNet + purseContribution) / ticketPriceNum) * 360 : 0}deg 360deg)` }} />
                          <div className="absolute inset-[18px] rounded-full bg-[#100f1b] flex flex-col items-center justify-center"><div className="font-syne font-extrabold text-[28px] text-brand-gold-light flex items-center gap-1"><CoinIcon size={20} /><span className="tabular-nums">{ticketPriceNum}</span></div><div className="text-[10.5px] text-text-muted tracking-wider">VC / TICKET</div></div>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-center gap-3"><span className="w-3 h-3 rounded bg-brand-violet shrink-0" /><span className="text-[13.5px] flex-1">You keep</span><span className="font-syne font-bold text-[17px] tabular-nums">{hostNet}</span></div>
                          <div className="flex items-center gap-3"><span className="w-3 h-3 rounded bg-brand-gold shrink-0" /><span className="text-[13.5px] flex-1">Into the prize pool</span><span className="font-syne font-bold text-[17px] text-brand-gold-light tabular-nums">{purseContribution}</span></div>
                          <div className="flex items-center gap-3"><span className="w-3 h-3 rounded bg-white/35 shrink-0" /><span className="text-[13.5px] text-text-muted flex-1">VERGR fee (flat 10%)</span><span className="font-syne font-bold text-[17px] text-text-muted tabular-nums">{platformFee}</span></div>
                          <div className="h-px bg-white/[0.08] my-0.5" /><div className="text-[12px] text-text-muted leading-snug">Every ticket splits the moment a fan buys. The prize pool grows with every sale.</div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 mt-4.5 pt-4.5 border-t border-white/[0.08]" style={{ marginTop: 18, paddingTop: 18 }}>
                      <div className="flex items-center gap-3 px-4 py-3.5 rounded-[13px] border border-brand-gold/35" style={{ background: 'linear-gradient(120deg,rgba(240,165,0,0.16),rgba(240,165,0,0.04))' }}><Icon name="emoji_events" size={28} className="text-brand-gold-light" /><div><div className="text-[11.5px] text-brand-gold-light font-semibold">Winner takes (if sold out)</div><div className="font-syne font-extrabold text-[24px] text-brand-gold-light flex items-center gap-1.5"><CoinIcon size={20} /><span className="tabular-nums">{purseSoldOut.toLocaleString()}</span><span className="text-[13px] font-semibold text-text-muted">VC</span></div></div></div>
                      <div className="flex items-center gap-3 px-4 py-3.5 rounded-[13px] bg-brand-violet/10 border border-brand-violet/30"><Icon name="account_balance_wallet" size={28} className="text-brand-pink" /><div><div className="text-[11.5px] text-brand-pink font-semibold">You earn (if sold out)</div><div className="font-syne font-extrabold text-[24px] flex items-center gap-1.5"><CoinIcon size={20} /><span className="tabular-nums">{hostEarnings.toLocaleString()}</span><span className="text-[13px] font-semibold text-text-muted">VC</span></div></div></div>
                    </div>
                  </div>

                  {/* host top-up (slider) + season pass */}
                  <div className="grid sm:grid-cols-2 gap-4.5">
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 18 }}>
                      <SectionLabel info={{ title: 'Boost the prize pool', body: 'Add your own VC straight to the prize pool. Optional. Held safely until the event finishes.' }}>Host top-up <span className="text-[11px] text-text-muted font-medium">optional</span></SectionLabel>
                      <SliderField value={hostTopUpNum} onChange={setHostTopUp} min={0} max={Math.max(1000, Math.min(walletBalance, MAX_PRIZE_POOL_COINS))} step={50} suffix="VC" accent="#F5C842"
                        hint={`Added straight to the prize pool. Your balance: ${walletBalance.toLocaleString()} VC.`} />
                    </div>
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55 flex items-center" style={{ padding: 18 }}>
                      <div className="flex items-center justify-between w-full"><div className="flex items-center gap-3"><Icon name="card_membership" size={22} className="text-gem-blue" /><div><div className="font-semibold text-[14px]">Season pass</div><div className="text-[11.5px] text-text-muted">One pass covers all your ticketed events.</div></div></div>
                        <button onClick={() => setSeasonPassEnabled(v => !v)} className={`w-[50px] h-7 rounded-full relative transition-colors shrink-0 ${seasonPassEnabled ? 'bg-gem-blue' : 'bg-white/10'}`}><span className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white transition-all" style={{ left: seasonPassEnabled ? 25 : 3 }} /></button>
                      </div>
                    </div>
                  </div>

                  {needsSquad && (
                    <div className="p-4.5 rounded-2xl border border-white/[0.07] bg-surface-1/55" style={{ padding: 18 }}>
                      <SectionLabel info={{ title: 'Who runs this event', body: 'Squad tournaments are hosted by one of your squads. Required for squad formats.' }}>Host squad</SectionLabel>
                      {squads.length === 0 ? (
                        <div className="text-center py-3"><p className="text-text-muted text-sm mb-2">You need to be in a squad to host a squad tournament</p><button onClick={() => navigate('/squads')} className="text-brand-violet-light text-sm font-bold">Browse squads</button></div>
                      ) : (
                        <div className="space-y-2">{squads.map(s => (
                          <button key={s.id} onClick={() => setSquadId(s.id)} className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left ${squadId === s.id ? 'border-brand-violet bg-brand-violet/5' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                            <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-muted"><Icon name="shield" size={18} /></div>
                            <div className="flex-1"><div className="font-bold text-sm">{s.name}</div><div className="text-[10px] text-text-muted">{s.memberCount || 0} members</div></div>
                            {squadId === s.id && <Icon name="check_circle" size={20} className="text-brand-violet-light" />}
                          </button>
                        ))}</div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* ===== STEP 4 REVIEW ===== */}
              {step === 4 && (
                <section className="space-y-5">
                  <div><div className="font-syne font-extrabold text-[34px] tracking-tight">Review and launch</div><div className="text-text-muted text-[14.5px] mt-1">One last look at the show you built. Then we go live.</div></div>

                  <div className="rounded-[20px] overflow-hidden border border-white/[0.09] bg-surface-1/60">
                    <div className="relative flex items-end p-6" style={{ aspectRatio: '3.4/1', background: bannerUrl ? undefined : 'linear-gradient(115deg,#1a1430,#2a1147 55%,#3a1840)' }}>
                      {bannerUrl && <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.6),transparent)' }} />
                      <div className="relative">
                        <div className="flex gap-2 mb-3"><span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-black/40 backdrop-blur">{finalGame || 'Game'}</span><span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-black/40 backdrop-blur capitalize">{category}</span></div>
                        <div className="font-syne font-extrabold text-[38px] leading-[1.02] tracking-tight">{renderTitleWords()}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.06]">
                      {[
                        { k: 'Game', v: finalGame || '—', icon: 'sports_esports', ic: '#C87FFF' },
                        { k: 'Format', v: bracketCfg?.shortLabel || '—', icon: 'account_tree', ic: '#B44FFF' },
                        { k: needsSquad ? 'Squads' : 'Players', v: String(maxParticipants), icon: 'group', ic: '#3D7FFF' },
                        { k: 'Starts', v: scheduledStart ? new Date(scheduledStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'When you launch', icon: 'schedule', ic: '#F5C842' },
                        { k: 'Ticket', v: ticketPriceNum ? `${ticketPriceNum.toLocaleString()} VC` : 'Free', icon: 'confirmation_number', ic: '#F5C842' },
                        { k: 'Revenue share', v: `${purseSliceNum}%`, icon: 'savings', ic: '#F5C842' },
                        { k: 'Audience', v: TICKET_AUDIENCES.find(a => a.id === ticketAudience)?.label || 'Everyone', icon: 'visibility', ic: '#3D7FFF' },
                        { k: 'Winner takes', v: `${purseSoldOut.toLocaleString()} VC`, icon: 'emoji_events', ic: '#F5C842' },
                      ].map((r, i) => (
                        <div key={i} className="p-4 bg-surface-1"><div className="flex items-center gap-1.5 text-[11px] text-text-muted font-semibold"><Icon name={r.icon} size={15} style={{ color: r.ic }} />{r.k}</div><div className="font-syne font-bold text-[16px] mt-1.5 tabular-nums">{r.v}</div></div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4.5 px-5 py-4.5 rounded-2xl border border-brand-gold/28" style={{ background: 'linear-gradient(120deg,rgba(240,165,0,0.08),rgba(20,20,31,0.5))', padding: 18 }}>
                    <Icon name="emoji_events" size={30} className="text-brand-gold-light shrink-0" />
                    <div className="text-[13.5px] leading-relaxed">Fans buy <b>{ticketPriceNum.toLocaleString()} VC</b> tickets. <b className="text-brand-gold-light">{purseSliceNum}%</b> builds the prize pool, you keep <b className="text-brand-pink">{hostNet} VC</b>, VERGR takes <b>{platformFee} VC</b>. Sold out, the winner takes <b className="text-brand-gold-light tabular-nums">{purseSoldOut.toLocaleString()} VC</b> and you earn <b className="text-brand-pink tabular-nums">{hostEarnings.toLocaleString()} VC</b>.</div>
                  </div>

                  <button onClick={() => setAgreedToSkillTerms(v => !v)} className="w-full flex items-start gap-3.5 text-left p-4.5 rounded-2xl border" style={{ padding: 18, borderColor: agreedToSkillTerms ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)', background: agreedToSkillTerms ? 'rgba(34,197,94,0.06)' : 'rgba(20,20,31,0.5)' }}>
                    <span className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center mt-px" style={{ border: `2px solid ${agreedToSkillTerms ? '#22c55e' : 'rgba(255,255,255,0.2)'}`, background: agreedToSkillTerms ? '#22c55e' : 'transparent' }}>{agreedToSkillTerms && <Icon name="check" size={16} className="text-white" />}</span>
                    <div><div className="font-semibold text-[13.5px] mb-1">I confirm this is a skill-based competition</div><div className="text-[12.5px] text-text-muted leading-relaxed">Outcomes come from player skill, with no random prize draws, betting, or chance mechanics. Entry is always free for competitors. <a href="/platform/learn/tournament-rules" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-gem-blue font-semibold">Read the Tournament Rules.</a></div></div>
                  </button>
                </section>
              )}

              {/* footer nav */}
              <div className="flex items-center justify-between mt-8 pt-5.5 border-t border-white/[0.07]" style={{ paddingTop: 22 }}>
                <span className="flex items-center gap-2 text-text-muted text-[13px]"><Icon name="cloud_done" size={18} />Draft saves automatically</span>
                <div className="flex items-center gap-3">
                  <button onClick={handleBack} className="px-5 py-3 rounded-xl border border-white/12 bg-white/[0.04] text-white font-semibold text-sm flex items-center gap-2"><Icon name="arrow_back" size={18} />Back</button>
                  {step < 4
                    ? <button onClick={handleNext} className="px-7 py-3 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-brand-violet/40">Continue<Icon name="arrow_forward" size={18} /></button>
                    : <button onClick={handleCreate} disabled={!canSubmit || loading} className="px-8 py-3 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-extrabold text-[15px] font-syne flex items-center gap-2.5 shadow-lg shadow-brand-violet/40 disabled:opacity-40"><Icon name="rocket_launch" size={20} />{loading ? 'Launching…' : 'Launch tournament'}</button>}
                </div>
              </div>
            </div>

            {/* RIGHT RAIL — live preview */}
            <aside className="hidden lg:block sticky top-[90px]">
              <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" style={{ animation: 'vgrGlow 1.6s infinite' }} /><span className="text-[12px] tracking-[0.16em] uppercase text-text-muted font-semibold">Live preview</span></div><span className="text-[11px] text-text-muted">as fans see it</span></div>
              <div className="rounded-[20px] overflow-hidden border border-white/10 bg-surface-1 shadow-2xl">
                <div className="relative flex items-end p-4" style={{ aspectRatio: '3/1.55', background: bannerUrl ? undefined : 'linear-gradient(120deg,#1a1430,#2a1147 50%,#3a1840)' }}>
                  {bannerUrl && <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.55),transparent)' }} />
                  <div className="absolute top-3 left-3 flex gap-1.5"><span className="px-2 py-1 rounded-md text-[10px] font-bold bg-black/45 backdrop-blur">{finalGame || 'Game'}</span>{streamRequired && <span className="px-2 py-1 rounded-md text-[10px] font-bold bg-brand-ember flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white" />LIVE</span>}</div>
                  <div className="relative font-syne font-extrabold text-[24px] leading-[1.04] tracking-tight">{renderTitleWords()}</div>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-3.5">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-brand-violet/15 text-brand-pink">{bracketCfg?.shortLabel || 'Format'}</span>
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/[0.06] text-text-muted tabular-nums">{maxParticipants} {needsSquad ? 'squads' : 'players'}</span>
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/[0.06] text-text-muted uppercase">{seriesFormat}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px] text-text-muted mb-3.5"><Icon name="calendar_month" size={16} className="text-brand-violet-light" />{scheduledStart ? new Date(scheduledStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Starts when you launch'}</div>
                  <div className="flex items-center gap-3 px-3.5 py-3 rounded-[13px] border border-brand-gold/30 mb-3" style={{ background: 'linear-gradient(120deg,rgba(240,165,0,0.14),rgba(240,165,0,0.03))' }}>
                    <Icon name="emoji_events" size={26} className="text-brand-gold-light" /><div className="flex-1"><div className="text-[10.5px] text-brand-gold-light font-semibold tracking-wide">WINNER TAKES ALL</div><div className="font-syne font-extrabold text-[20px] text-brand-gold-light flex items-center gap-1.5"><CoinIcon size={17} /><span className="tabular-nums">{purseSoldOut.toLocaleString()}</span><span className="text-[13px] font-semibold text-text-muted">VC</span></div></div>
                  </div>
                  <div className="mb-3.5">
                    <div className="flex items-center justify-between text-[11.5px] mb-1.5"><span className="text-text-muted">Tickets</span><span className="font-bold tabular-nums">0 / {capacityUnlimited ? '∞' : ticketCapacityNum.toLocaleString()}</span></div>
                    <div className="h-[7px] rounded bg-white/[0.08] overflow-hidden"><div className="h-full rounded bg-gradient-to-r from-brand-violet to-brand-pink" style={{ width: '2%' }} /></div>
                  </div>
                  <button className="w-full py-3 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-violet/40"><Icon name="confirmation_number" size={19} className="text-brand-gold-light" />{ticketPriceNum ? `Buy ticket · ${ticketPriceNum.toLocaleString()} VC` : 'Free to watch'}</button>
                  <div className="text-center text-[11px] text-text-muted mt-2.5">Competitors join free · {TICKET_AUDIENCES.find(a => a.id === ticketAudience)?.label || 'Everyone'} can buy tickets</div>
                </div>
              </div>
              <div className="text-center text-[11px] text-text-muted mt-3 flex items-center justify-center gap-1.5"><Icon name="bolt" size={14} />Updates live as you build</div>

              {/* why host */}
              <div className="mt-5 rounded-2xl border border-white/[0.07] bg-surface-1/50 p-4">
                <div className="font-syne font-bold text-[13.5px] mb-3">Why host on VERGR</div>
                <div className="flex flex-col gap-3">
                  {[
                    { icon: 'diversity_3', title: 'Grow your community', line: 'Turn followers into competitors and fans.' },
                    { icon: 'payments', title: 'Earn from tickets', line: 'Keep your share of every ticket sold.' },
                    { icon: 'emoji_events', title: 'Crown a champion', line: 'We build the bracket and verify results.' },
                  ].map((b, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-violet/14 flex items-center justify-center"><Icon name={b.icon} size={15} className="text-brand-pink" /></span>
                      <div><div className="font-semibold text-[12.5px] leading-tight">{b.title}</div><div className="text-[11px] text-text-muted leading-snug mt-0.5">{b.line}</div></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* need help */}
              <div className="mt-3 rounded-2xl border border-white/[0.07] bg-surface-1/50 p-4">
                <div className="flex items-center gap-2 mb-2"><Icon name="help" size={16} className="text-brand-violet-light" /><div className="font-bold text-[13px]">Need help?</div></div>
                <p className="text-text-muted text-[11.5px] leading-snug mb-3">New to hosting? The host guide walks through every step, the ticketed prize pool, and how results get verified.</p>
                <button onClick={() => navigate('/platform/learn/tournaments')} className="w-full py-2.5 rounded-xl border border-white/12 bg-white/[0.04] text-text-primary text-[12px] font-semibold flex items-center justify-center gap-1.5 hover:bg-white/[0.07]">Open host guide <Icon name="open_in_new" size={14} /></button>
              </div>
            </aside>
          </div>
        </main>
      )}

      {/* modals */}
      {connectPlatform && <ConnectAccountModal platform={connectPlatform} game={finalGame} onClose={() => setConnectPlatform(null)} uid={currentUser?.uid} showToast={showToast} />}
      {showRequestGame && <RequestGameModal onClose={() => setShowRequestGame(false)} showToast={showToast} />}
      {showInviteModal && <InvitePlayersModal platform={requiredAccount} gameName={finalGame} spectator={inviteMode === 'spectator'} invitedUsers={invitedUsers} setInvitedUsers={setInvitedUsers} onClose={() => setShowInviteModal(false)} />}
    </div>
  );
}
