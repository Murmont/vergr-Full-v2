// 4-step Create Tournament wizard — matches the mock.
//   Step 1 — Basic Info (name + game + short description)
//   Step 2 — Format & Rules (format, max players, stream, BR games)
//   Step 3 — Prizes & Entry (entry fee + optional host squad + breakdown)
//   Step 4 — Review & Create (summary + confirm)
//
// Right rail carries a live Tournament Summary, a Need Help card, and a
// Tournament Rules checklist using graphic-tournament-rules.png.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  createTournamentSecure, getUserSquads, getEligibleSquadCount,
  updateLinkedAccount, linkSteam,
  getUsersWithLinkedAccount, uploadTournamentBanner,
} from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import AppHeader from '../../components/brand/AppHeader';
import AppRightRail from '../../components/brand/AppRightRail';
import { SectionCard } from '../../components/brand/SectionCard';
import {
  BRACKET_TYPE_LIST,
  getBracketType,
  isBracketTypeAllowed,
  computePrizeBreakdown,
  recommendedSwissRounds,
  validateTournamentLimits,
  MAX_ENTRY_FEE_COINS,
  MAX_PRIZE_POOL_COINS,
} from '../../utils/tournamentTypes';
import { TOURNAMENT_GAMES } from '../../utils/tournamentGames';

// Tournament games registry is the single source of truth — see
// src/utils/tournamentGames.js. Non-mobile competitive games only (mobile
// devices view tournaments but cannot participate, per founder mandate).
const GAMES = TOURNAMENT_GAMES.map(g => g.label);

// Maps registry platform IDs → linkedAccount keys used in the user profile.
const PLATFORM_TO_LINKED_KEY = {
  riot: 'riotgames',
  steam: 'steam',
  battlenet: 'battlenet',
  origin: 'origin',
  ea: 'origin',
  epic: 'epicgames',
  ubisoft: 'ubisoft',
  xbox: 'xbox',
  psn: 'psn',
  nintendo: 'nintendo',
  wizards: 'wizards',
};

// Coming-soon set: games whose required integration isn't approved yet.
// Currently none — Riot prod-key review tracked separately; remove a game
// from here once its detection path is live.
const COMING_SOON_GAMES = new Set();

// Derived from registry: label → linkedAccount key (or null = manual / no link).
const GAME_REQUIRED_ACCOUNT = TOURNAMENT_GAMES.reduce((acc, g) => {
  const key = PLATFORM_TO_LINKED_KEY[g.linkedPlatform];
  if (key) acc[g.label] = key;
  return acc;
}, {});

// Display metadata for the per-platform connect modal that pops up when the
// host picks a game whose required account isn't linked yet.
const PLATFORM_META = {
  riotgames: { name: 'Riot Games',  color: '#c6362f', letter: 'R', placeholder: 'Name#TAG' },
  steam:     { name: 'Steam',       color: '#1b2838', letter: 'S', placeholder: '7656119xxxxxxxxxx (17-digit Steam64 ID)' },
  battlenet: { name: 'Battle.net',  color: '#00aeff', letter: 'B', placeholder: 'YourTag#1234' },
  origin:    { name: 'EA / Origin', color: '#ff5252', letter: 'O', placeholder: 'Your Origin or EA handle' },
  epicgames: { name: 'Epic Games',  color: '#2a2a2a', letter: 'E', placeholder: 'Your Epic display name' },
  ubisoft:   { name: 'Ubisoft',     color: '#0083be', letter: 'U', placeholder: 'Your Ubisoft Connect handle' },
  xbox:      { name: 'Xbox',        color: '#107c10', letter: 'X', placeholder: 'Your Xbox gamertag' },
  psn:       { name: 'PlayStation', color: '#003791', letter: 'P', placeholder: 'Your PSN ID' },
  nintendo:  { name: 'Nintendo',    color: '#e60012', letter: 'N', placeholder: 'Your Nintendo friend code' },
  wizards:   { name: 'Wizards',     color: '#d3273e', letter: 'W', placeholder: 'Your Wizards Account ID' },
};

// Preset banner art per game lives in public/brand/tournament-banners/.
// File-naming convention: <slug>-1.png ... <slug>-3.png, where slug is the
// game name lowercased with non-alphanumerics → '-'. Missing files render as
// gradient fallbacks via the BannerPicker's onError handler.
const GAME_BANNER_BASE = '/brand/tournament-banners';
const slugifyGame = (g) => (g || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const presetBannersForGame = (g) => {
  if (!g) return [];
  const s = slugifyGame(g);
  return [1, 2, 3].map(i => `${GAME_BANNER_BASE}/${s}-${i}.png`);
};

const STEPS = [
  { id: 1, label: 'Basic Info',      icon: 'edit_note' },
  { id: 2, label: 'Format & Rules',  icon: 'rule' },
  { id: 3, label: 'Prizes & Entry',  icon: 'payments' },
  { id: 4, label: 'Review & Create', icon: 'check_circle' },
];

// Phase 2 — stage presets. Mirror of functions/tournamentStages.js
// STAGE_PRESETS. If you change one side, change both.
const STAGE_PRESETS = [
  { id: 'single_stage', label: 'Single Stage', sub: 'One format, traditional bracket (legacy).', stages: null,
    forcesType: null, forcesSeriesFormat: null },
  { id: 'swiss_to_se', label: 'Swiss → SE Playoffs', sub: 'Swiss qualifier, top 8 → single-elim Bo3.',
    forcesType: 'swiss', forcesSeriesFormat: 'bo1',
    stages: [
      { id: 'stage_1', name: 'Swiss Qualifier', type: 'swiss',       seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8, swissRounds: 5 },
      { id: 'stage_2', name: 'Playoffs',        type: 'single_elim', seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  { id: 'swiss_to_de', label: 'Swiss → DE Playoffs', sub: 'Swiss qualifier, top 8 → double-elim Bo3.',
    forcesType: 'swiss', forcesSeriesFormat: 'bo1',
    stages: [
      { id: 'stage_1', name: 'Swiss Qualifier', type: 'swiss',        seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8, swissRounds: 5 },
      { id: 'stage_2', name: 'Double-Elim',     type: 'double_elim',  seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  { id: 'groups_to_se', label: 'RR Groups → SE Playoffs', sub: 'Round-robin pool, top 8 → single-elim Bo3.',
    forcesType: 'round_robin', forcesSeriesFormat: 'bo1',
    stages: [
      { id: 'stage_1', name: 'Group Stage', type: 'round_robin', seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8 },
      { id: 'stage_2', name: 'Playoffs',    type: 'single_elim', seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  { id: 'de_only', label: 'Double-Elim (Bo3 / Bo5 GF)', sub: 'Pure double-elim with proper Bo3 series.',
    forcesType: 'double_elim', forcesSeriesFormat: 'bo3',
    stages: [
      { id: 'stage_1', name: 'Double-Elim', type: 'double_elim', seriesFormat: 'bo3', seedingMode: 'random' },
    ],
  },
];
function stagesForPreset(presetId, fallback) {
  const p = STAGE_PRESETS.find((x) => x.id === presetId);
  if (!p) return null;
  if (!p.stages) return null;
  // Override stage 1's format/seedingMode to match top-level fallback so
  // backend validation passes (stages[0] must equal top-level type/sf).
  const stages = p.stages.map((s, i) => i === 0 ? {
    ...s, type: fallback.type, seriesFormat: fallback.seriesFormat, seedingMode: fallback.seedingMode,
  } : s);
  return stages;
}

const RULES_CHECKLIST = [
  'All participants must register before start time',
  'Fair play — cheating is an instant ban',
  'Entry fees are non-refundable once play begins',
  'Disputes go to the tournament host',
  'Mod cut (5%) is taken from the gross prize pool',
  `Entry fee capped at ${MAX_ENTRY_FEE_COINS.toLocaleString()} coins per player`,
  `Prize pool capped at ${MAX_PRIZE_POOL_COINS.toLocaleString()} coins per tournament`,
];

export default function CreateTournamentScreen() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [game, setGame] = useState('');
  const [customGame, setCustomGame] = useState('');
  const [type, setType] = useState('single_elim');
  const [maxParticipants, setMaxParticipants] = useState(8);
  const [entryFee, setEntryFee] = useState('');
  const [squadId, setSquadId] = useState('');
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [brGameCount, setBrGameCount] = useState(3);
  // Phase 1 — series + seeding. Defaults keep behaviour identical to pre-Phase-1.
  const [seriesFormat, setSeriesFormat] = useState('bo1');   // 'bo1' | 'bo3' | 'bo5'
  const [seedingMode, setSeedingMode] = useState('random');  // 'random' | 'manual' | 'rating'
  // Phase 2 — multi-stage preset. 'single_stage' = legacy single-format tournament.
  // Any other id maps to a STAGE_PRESETS entry with a stages[] array.
  const [structurePreset, setStructurePreset] = useState('single_stage');
  // Phase 3 — supply gating. eligibleSquadCount = how many squads have
  // enough members to fit the squad sizes most formats want (≥4).
  // Fetched once on mount; ungated if the query fails (optimistic).
  const [eligibleSquadCount, setEligibleSquadCount] = useState(null);
  const [streamRequired, setStreamRequired] = useState(false);
  const [visibility, setVisibility] = useState('public'); // 'public' | 'private'
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerUploading, setBannerUploading] = useState(false);
  // DS2 — optional "hosted by squad" attribution. '' = host as yourself.
  const [hostSquadId, setHostSquadId] = useState('');
  const [connectPlatform, setConnectPlatform] = useState(null); // platform id or null
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState([]);    // [{id, username, avatar, vpLevel}]
  // Compliance: host must affirm skill-based, no-chance classification.
  // Stored on the tournament doc + audit trail. See CLAUDE.md compliance
  // section and /learn/tournament-rules.
  const [agreedToSkillTerms, setAgreedToSkillTerms] = useState(false);

  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const plan = profile?.tier || 'free';
  const bracketCfg = getBracketType(type);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    if (!currentUser) return;
    getUserSquads(currentUser.uid).then(setSquads).catch(() => {});
    // Phase 3 — supply check. Count squads with ≥4 members (smallest squad
    // tournament size) so we know which formats to gate.
    getEligibleSquadCount(4).then(setEligibleSquadCount).catch(() => setEligibleSquadCount(null));
  }, [currentUser]);

  useEffect(() => {
    if (!bracketCfg) return;
    if (!bracketCfg.allowedPlayers.includes(maxParticipants)) {
      setMaxParticipants(bracketCfg.allowedPlayers[0]);
    }
    if (bracketCfg.streamRequired) setStreamRequired(true);
  }, [type, bracketCfg]); // eslint-disable-line

  const finalGame = game === 'Other' ? customGame.trim() : game;
  const requiredAccount = GAME_REQUIRED_ACCOUNT[game] || null;
  const linkedAccounts = profile?.linkedAccounts || {};
  const hasRequiredAccount = (() => {
    if (!requiredAccount) return true;
    const linked = linkedAccounts[requiredAccount];
    if (!linked) return false;
    if (requiredAccount === 'steam') return !!linked.steamId64;
    return typeof linked === 'string' ? !!linked : !!linked.username;
  })();

  // Picking a game that requires a linked account the user doesn't have yet
  // pops the inline Connect modal instead of jumping the user to settings.
  const pickGame = (g) => {
    if (COMING_SOON_GAMES.has(g)) {
      showToast(`${g} is coming soon — Riot API approval pending`, 'info');
      return;
    }
    setGame(g);
    const reqAcct = GAME_REQUIRED_ACCOUNT[g];
    if (!reqAcct) return;
    const linked = linkedAccounts[reqAcct];
    const has = reqAcct === 'steam'
      ? !!linked?.steamId64
      : (typeof linked === 'string' ? !!linked : !!linked?.username);
    if (!has) setConnectPlatform(reqAcct);
  };

  const handleBannerFile = async (file) => {
    if (!file || !currentUser) return;
    setBannerUploading(true);
    try {
      const url = await uploadTournamentBanner(currentUser.uid, file);
      setBannerUrl(url);
    } catch (err) {
      showToast(err?.message || 'Banner upload failed', 'error');
    } finally {
      setBannerUploading(false);
    }
  };
  const fee = parseInt(entryFee) || 0;
  const estimatedPrize = fee * maxParticipants;
  const needsSquad = bracketCfg?.mode === 'squad';
  const prizeBreakdown = useMemo(
    () => computePrizeBreakdown(estimatedPrize, type, { squadTreasury: needsSquad }),
    [estimatedPrize, type, needsSquad]
  );
  const swissRounds = type === 'swiss' ? recommendedSwissRounds(maxParticipants) : 0;

  const limitCheck = useMemo(
    () => validateTournamentLimits({ entryFee: fee, maxParticipants }),
    [fee, maxParticipants]
  );

  const step1Valid = name.trim().length >= 3 && finalGame;
  const step2Valid = !!bracketCfg && isBracketTypeAllowed(type, plan);
  const step3Valid = (!needsSquad || !!squadId) && limitCheck.ok;
  const canSubmit = step1Valid && step2Valid && step3Valid && agreedToSkillTerms;

  const handleNext = () => {
    if (step === 1 && !step1Valid) { showToast('Add a name and pick a game', 'error'); return; }
    if (step === 2 && !step2Valid) { showToast('Your plan cannot use this format', 'error'); return; }
    if (step === 3 && !limitCheck.ok) { showToast(limitCheck.error, 'error'); return; }
    if (step === 3 && !step3Valid) { showToast('Pick a host squad for squad tournaments', 'error'); return; }
    setStep(s => Math.min(4, s + 1));
  };
  const handleBack = () => setStep(s => Math.max(1, s - 1));

  const handleCreate = async () => {
    if (!canSubmit || loading) return;
    if (!isBracketTypeAllowed(type, plan)) {
      showToast(`${bracketCfg.label} requires a ${bracketCfg.minPlan} plan`, 'error');
      return;
    }
    setLoading(true);
    try {
      // Server callable — validates Riot caps, plan tier, escrow setup, and
      // re-stamps the compliance classification so the client can't tamper with it.
      const result = await createTournamentSecure({
        squadId: squadId || null,
        name: name.trim(),
        description: description.trim(),
        game: finalGame,
        entryFee: fee,
        maxParticipants,
        type,
        mode: bracketCfg.mode,
        streamRequired,
        brGameCount: type === 'battle_royale' ? brGameCount : null,
        swissRounds: type === 'swiss' ? swissRounds : null,
        visibility,
        bannerUrl: bannerUrl || null,
        hostSquadId: hostSquadId || null,
        invitedUserIds: visibility === 'private' ? invitedUsers.map(u => u.id) : [],
        // Phase 1 — series + seeding.
        seriesFormat,
        seedingMode,
        // Phase 2 — multi-stage (null for single_stage preset).
        stages: stagesForPreset(structurePreset, { type, seriesFormat, seedingMode }),
      });
      const tournamentId = result?.tournamentId || result?.id;
      showToast('Tournament created!', 'success');
      navigate(`/match/${tournamentId}`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to create tournament', 'error');
    }
    setLoading(false);
  };

  // Mobile: legacy stacked layout
  if (!isDesktop) {
    return (
      <div className="min-h-screen pb-24">
        <TopBar showBack title="Create Tournament" />
        <div className="px-4 py-5">
          <MobileWizard
            step={step} setStep={setStep}
            name={name} setName={setName}
            description={description} setDescription={setDescription}
            game={game} setGame={setGame} pickGame={pickGame}
            customGame={customGame} setCustomGame={setCustomGame}
            type={type} setType={setType} plan={plan}
            bracketCfg={bracketCfg}
            maxParticipants={maxParticipants} setMaxParticipants={setMaxParticipants}
            entryFee={entryFee} setEntryFee={setEntryFee}
            squadId={squadId} setSquadId={setSquadId} squads={squads} needsSquad={needsSquad}
            brGameCount={brGameCount} setBrGameCount={setBrGameCount}
            streamRequired={streamRequired} setStreamRequired={setStreamRequired}
            swissRounds={swissRounds} prizeBreakdown={prizeBreakdown} fee={fee}
            limitCheck={limitCheck}
            finalGame={finalGame}
            visibility={visibility} setVisibility={setVisibility}
            bannerUrl={bannerUrl} setBannerUrl={setBannerUrl}
            bannerUploading={bannerUploading} handleBannerFile={handleBannerFile}
            squads={squads} hostSquadId={hostSquadId} setHostSquadId={setHostSquadId}
            requiredAccount={requiredAccount} hasRequiredAccount={hasRequiredAccount}
            setConnectPlatform={setConnectPlatform}
            invitedUsers={invitedUsers} setShowInviteModal={setShowInviteModal}
            seriesFormat={seriesFormat} setSeriesFormat={setSeriesFormat}
            seedingMode={seedingMode} setSeedingMode={setSeedingMode}
            structurePreset={structurePreset} setStructurePreset={setStructurePreset}
            eligibleSquadCount={eligibleSquadCount}
            onBack={handleBack} onNext={handleNext} onCreate={handleCreate}
            canSubmit={canSubmit} loading={loading}
          />
          {connectPlatform && (
            <ConnectAccountModal
              platform={connectPlatform}
              onClose={() => setConnectPlatform(null)}
              uid={currentUser?.uid}
              showToast={showToast}
            />
          )}
          {showInviteModal && (
            <InvitePlayersModal
              platform={requiredAccount}
              gameName={finalGame}
              invitedUsers={invitedUsers}
              setInvitedUsers={setInvitedUsers}
              onClose={() => setShowInviteModal(false)}
            />
          )}
        </div>
      </div>
    );
  }

  // Desktop: 2-col (wizard + right rail)
  return (
    <div className="min-h-screen bg-bg-dark">
      <AppHeader title="Create Tournament" subtitle="Host a cup. Set the rules. Claim the crown." />

      <div className="flex gap-6 px-6 py-6">
        <main className="flex-1 min-w-0 max-w-3xl space-y-6">
          {/* Stepper */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <div key={s.id} className="flex-1 flex items-center gap-2">
                  <button
                    onClick={() => s.id < step && setStep(s.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl flex-1 border transition-colors ${
                      active ? 'border-brand-violet bg-brand-violet/10' :
                      done   ? 'border-brand-cyan/30 bg-brand-cyan/5 hover:bg-brand-cyan/10' :
                               'border-white/[0.06] bg-white/[0.03] opacity-60'
                    }`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-dmmono font-bold ${
                      active ? 'bg-brand-violet text-white' :
                      done   ? 'bg-brand-cyan text-bg-dark' :
                               'bg-white/[0.06] text-text-muted'
                    }`}>
                      {done ? <Icon name="check" size={14}/> : s.id}
                    </span>
                    <span className={`text-[11px] font-dmmono uppercase tracking-[0.12em] truncate ${
                      active ? 'text-text-primary' : 'text-text-muted'
                    }`}>{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && <div className="h-px w-3 bg-white/[0.08]" />}
                </div>
              );
            })}
          </div>

          {/* Step content */}
          {step === 1 && (
            <SectionCard title="Basic Info">
              <div className="space-y-5">
                <Field label="Tournament Name *">
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g. Friday Night Valorant Cup" maxLength={60}
                    className="input" />
                </Field>
                <Field label="Short Description">
                  <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="Tell players what makes this cup special…"
                    className="input resize-none" maxLength={240} />
                </Field>
                <Field label="Game *">
                  <div className="flex flex-wrap gap-2">
                    {GAMES.map(g => {
                      const soon = COMING_SOON_GAMES.has(g);
                      const selected = game === g;
                      return (
                        <button key={g} onClick={() => pickGame(g)}
                          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            soon
                              ? 'bg-brand-ember/5 border border-brand-ember/50 text-brand-ember/80 cursor-not-allowed'
                              : selected
                                ? 'bg-brand-cyan/15 border border-brand-cyan/40 text-brand-cyan'
                                : 'bg-white/[0.04] border border-white/[0.06] text-text-muted hover:text-text-secondary'
                          }`}>
                          <span>{g}</span>
                          {soon && <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-brand-ember/20 text-brand-ember">Soon</span>}
                        </button>
                      );
                    })}
                  </div>
                  {game === 'Other' && (
                    <input type="text" value={customGame} onChange={e => setCustomGame(e.target.value)}
                      placeholder="Enter game name…" className="input mt-3" />
                  )}
                  {requiredAccount && !hasRequiredAccount && (
                    <button onClick={() => setConnectPlatform(requiredAccount)}
                      className="mt-3 w-full p-3 rounded-xl border border-brand-gold/40 bg-brand-gold/5 text-left flex items-center gap-3">
                      <Icon name="link_off" size={18} className="text-brand-gold" />
                      <div className="flex-1">
                        <p className="text-text-primary text-sm font-bold">Connect your {PLATFORM_META[requiredAccount].name} account</p>
                        <p className="text-text-muted text-[11px]">Required to host {finalGame || 'this game'} tournaments.</p>
                      </div>
                      <span className="text-brand-gold text-xs font-bold">Connect</span>
                    </button>
                  )}
                </Field>

                <Field label="Banner Image">
                  <BannerPicker
                    game={finalGame}
                    bannerUrl={bannerUrl}
                    setBannerUrl={setBannerUrl}
                    uploading={bannerUploading}
                    onFile={handleBannerFile}
                  />
                </Field>

                {squads.length > 0 && (
                  <Field label="Hosted By (optional)">
                    <select
                      value={hostSquadId}
                      onChange={(e) => setHostSquadId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-text-primary"
                    >
                      <option value="">Myself</option>
                      {squads.map((s) => (
                        <option key={s.id} value={s.id}>{s.name || s.tag || 'My squad'}</option>
                      ))}
                    </select>
                    <p className="text-text-muted text-[11px] mt-1">
                      Attribute this event to one of your squads so it shows in that squad's "My squads' events" filter.
                    </p>
                  </Field>
                )}

                <Field label="Visibility *">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'public',  label: 'Public',  icon: 'public',     desc: 'Anyone can find and join' },
                      { id: 'private', label: 'Private', icon: 'lock',       desc: 'Invite-only, hidden from browse' },
                    ].map(v => (
                      <button key={v.id} onClick={() => setVisibility(v.id)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          visibility === v.id
                            ? 'border-brand-violet bg-brand-violet/5'
                            : 'border-white/[0.06] bg-white/[0.03] hover:border-white/10'
                        }`}>
                        <div className="flex items-center gap-2">
                          <Icon name={v.icon} size={16} className={visibility === v.id ? 'text-brand-violet' : 'text-text-muted'} />
                          <p className="text-text-primary text-sm font-bold">{v.label}</p>
                        </div>
                        <p className="text-text-muted text-[11px] mt-1">{v.desc}</p>
                      </button>
                    ))}
                  </div>
                  {visibility === 'private' && (
                    <button onClick={() => setShowInviteModal(true)}
                      className="mt-3 w-full p-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 flex items-center gap-3">
                      <Icon name="group_add" size={18} className="text-brand-cyan" />
                      <div className="flex-1 text-left">
                        <p className="text-text-primary text-sm font-bold">Invite Players</p>
                        <p className="text-text-muted text-[11px]">
                          {invitedUsers.length === 0 ? 'No invites yet — open to add' : `${invitedUsers.length} invited`}
                        </p>
                      </div>
                      <span className="text-brand-cyan text-xs font-bold">{invitedUsers.length === 0 ? 'Open' : 'Edit'}</span>
                    </button>
                  )}
                </Field>
              </div>
            </SectionCard>
          )}

          {step === 2 && (
            <SectionCard title="Format & Rules">
              <div className="space-y-5">
                <Field label="Format *">
                  <div className="space-y-2">
                    {BRACKET_TYPE_LIST.map(t => {
                      const allowed = isBracketTypeAllowed(t.id, plan);
                      const selected = type === t.id;
                      // Phase 3 — supply gate. Squad formats need at least
                      // 4 eligible squads platform-wide. Open until the
                      // count query resolves; null = unknown.
                      const isSquadFormat = t.mode === 'squad';
                      const minSquadsNeeded = (t.allowedPlayers?.[0]) || 4;
                      const supplyOk = !isSquadFormat || eligibleSquadCount === null
                        || eligibleSquadCount >= minSquadsNeeded;
                      const locked = !allowed || !supplyOk;
                      return (
                        <button key={t.id}
                          onClick={() => {
                            if (!supplyOk) return;
                            allowed ? setType(t.id) : navigate('/settings/subscription');
                          }}
                          className={`w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                            selected ? 'border-brand-violet bg-brand-violet/5'
                            : !locked ? 'border-white/[0.06] bg-white/[0.03] hover:border-white/10'
                                      : 'border-white/[0.04] bg-white/[0.02] opacity-60'
                          }`}>
                          <Icon name={t.icon} size={22} className={selected ? 'text-brand-violet' : 'text-text-muted'} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-text-primary text-sm font-bold">{t.label}</p>
                              {!allowed && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-gold/15 text-brand-gold">{t.minPlan}</span>
                              )}
                              {!supplyOk && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan">
                                  Unlocks at {minSquadsNeeded} squads
                                </span>
                              )}
                              {t.streamRequired && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-ember/15 text-brand-ember">Stream</span>
                              )}
                            </div>
                            <p className="text-text-muted text-[11px] mt-0.5">
                              {t.description}
                              {!supplyOk && (
                                <span className="block mt-1 text-brand-cyan/80">
                                  Only {eligibleSquadCount ?? 0} eligible squads on the platform — needs {minSquadsNeeded}+.
                                </span>
                              )}
                            </p>
                          </div>
                          {selected && <Icon name="check_circle" size={18} className="text-brand-violet" />}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Tournament Structure">
                  <div className="flex flex-col gap-2">
                    {STAGE_PRESETS.map((p) => {
                      const selected = structurePreset === p.id;
                      // Greyed out if preset wants a type that doesn't match
                      // current selection (we don't auto-rewrite to avoid
                      // wiping the user's other choices).
                      const mismatch = p.forcesType && p.forcesType !== type;
                      return (
                        <button key={p.id}
                          onClick={() => {
                            if (mismatch) {
                              setType(p.forcesType);
                              setSeriesFormat(p.forcesSeriesFormat || 'bo1');
                            }
                            setStructurePreset(p.id);
                          }}
                          className={`text-left p-3 rounded-lg border transition-all ${
                            selected
                              ? 'bg-brand-violet/15 border-brand-violet/40'
                              : 'bg-white/[0.04] border-white/[0.06]'
                          }`}>
                          <div className="flex items-center gap-2">
                            <Icon name={p.id === 'single_stage' ? 'view_module' : 'route'}
                              size={16} className={selected ? 'text-brand-violet-light' : 'text-text-muted'} />
                            <div className={`text-sm font-bold ${selected ? 'text-brand-violet-light' : 'text-text-primary'}`}>{p.label}</div>
                            {mismatch && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-gold/15 text-brand-gold ml-auto">
                                Tap to switch type
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-text-muted mt-1">{p.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-text-muted text-[11px] mt-2">
                    Single Stage = legacy bracket (one format). Multi-stage = real esports shape (qualifier + playoffs). Phase 2 ships with 4 presets; custom stage builders come later.
                  </p>
                </Field>

                <Field label={needsSquad ? 'Max Squads' : 'Max Players'}>
                  <div className="flex gap-2 flex-wrap">
                    {(bracketCfg?.allowedPlayers || []).map(n => (
                      <button key={n} onClick={() => setMaxParticipants(n)}
                        className={`min-w-[64px] py-2.5 px-3 rounded-lg text-sm font-bold transition-all ${
                          maxParticipants === n
                            ? 'bg-brand-gold/15 border border-brand-gold/40 text-brand-gold'
                            : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                        }`}>{n}</button>
                    ))}
                  </div>
                  {type === 'swiss' && (
                    <p className="text-text-muted text-[11px] mt-2">Recommended: {swissRounds} rounds (log₂ of players)</p>
                  )}
                </Field>

                {type === 'battle_royale' && (
                  <Field label="Games per Event">
                    <div className="flex gap-2">
                      {[1, 3, 5, 7].map(n => (
                        <button key={n} onClick={() => setBrGameCount(n)}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                            brGameCount === n
                              ? 'bg-brand-ember/15 border border-brand-ember/40 text-brand-ember'
                              : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                          }`}>{n}</button>
                      ))}
                    </div>
                    <p className="text-text-muted text-[11px] mt-2">Placement points aggregate across games. 1st = 15, 2nd = 12, …, 10th = 1.</p>
                  </Field>
                )}

                {/* Phase 3 — Series Format. Hidden only for BR (Bo1 by definition). */}
                {!['battle_royale'].includes(type) && (
                  <Field label="Series Format">
                    <div className="flex gap-2">
                      {[
                        { id: 'bo1', label: 'Bo1', desc: '1 game' },
                        { id: 'bo3', label: 'Bo3', desc: 'first to 2' },
                        { id: 'bo5', label: 'Bo5', desc: 'first to 3' },
                      ].map(opt => (
                        <button key={opt.id} onClick={() => setSeriesFormat(opt.id)}
                          className={`flex-1 py-2.5 px-2 rounded-lg text-left transition-all ${
                            seriesFormat === opt.id
                              ? 'bg-brand-violet/15 border border-brand-violet/40 text-brand-violet-light'
                              : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                          }`}>
                          <div className="text-sm font-bold">{opt.label}</div>
                          <div className="text-[10px] opacity-80">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    <p className="text-text-muted text-[11px] mt-2">
                      Every match in the bracket is a {seriesFormat === 'bo1' ? 'single game' : seriesFormat === 'bo3' ? 'best-of-3 (first to 2 wins)' : 'best-of-5 (first to 3 wins)'}.
                      Phase 2 multi-stage will let you set different formats per round.
                    </p>
                  </Field>
                )}

                {/* Phase 1 — Seeding mode. Hidden for BR/FFA (no bracket pairing). */}
                {!['battle_royale'].includes(type) && (
                  <Field label="Seeding">
                    <div className="flex gap-2">
                      {[
                        { id: 'random', label: 'Random', desc: 'shuffle on start' },
                        { id: 'manual', label: 'Manual', desc: 'join-order = seed' },
                        { id: 'rating', label: 'Rating', desc: 'by TP desc' },
                      ].map(opt => (
                        <button key={opt.id} onClick={() => setSeedingMode(opt.id)}
                          className={`flex-1 py-2.5 px-2 rounded-lg text-left transition-all ${
                            seedingMode === opt.id
                              ? 'bg-brand-cyan/15 border border-brand-cyan/40 text-brand-cyan'
                              : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                          }`}>
                          <div className="text-sm font-bold">{opt.label}</div>
                          <div className="text-[10px] opacity-80">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    <p className="text-text-muted text-[11px] mt-2">
                      {seedingMode === 'random' && 'Bracket pairings randomised on start. Standard 1v16/8v9 spacing still applies.'}
                      {seedingMode === 'manual' && 'First to join = seed 1, second = seed 2, etc. Top seeds protected from early meetings.'}
                      {seedingMode === 'rating' && 'Highest Tournament Points = seed 1. New players join near the bottom.'}
                    </p>
                  </Field>
                )}

                <button onClick={() => !bracketCfg?.streamRequired && setStreamRequired(!streamRequired)}
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    streamRequired ? 'border-brand-ember/40 bg-brand-ember/5' : 'border-white/[0.06] bg-white/[0.03]'
                  }`}>
                  <Icon name="live_tv" size={20} className={streamRequired ? 'text-brand-ember' : 'text-text-muted'} />
                  <div className="flex-1">
                    <p className="text-text-primary text-sm font-bold">Live Stream</p>
                    <p className="text-text-muted text-[11px]">
                      {bracketCfg?.streamRequired ? 'Required for invitationals' : 'Optional — stream matches on VERGR'}
                    </p>
                  </div>
                  <div className={`w-10 h-6 rounded-full relative transition-all ${streamRequired ? 'bg-brand-ember' : 'bg-white/[0.08]'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${streamRequired ? 'right-0.5' : 'left-0.5'}`} />
                  </div>
                </button>
              </div>
            </SectionCard>
          )}

          {step === 3 && (
            <SectionCard title="Prizes & Entry">
              <div className="space-y-5">
                <Field label={`Entry Fee (coins) — 0 for free, max ${MAX_ENTRY_FEE_COINS.toLocaleString()}`}>
                  <input type="number" min="0" max={MAX_ENTRY_FEE_COINS} value={entryFee} onChange={e => setEntryFee(e.target.value)}
                    placeholder="0" className="input font-dmmono" />
                  <p className="text-text-muted text-[11px] mt-1.5">
                    Pool cap: {MAX_PRIZE_POOL_COINS.toLocaleString()} coins per tournament.
                  </p>
                </Field>

                {!limitCheck.ok && (
                  <div className="p-3 rounded-xl bg-brand-ember/10 border border-brand-ember/30 text-brand-ember text-xs">
                    {limitCheck.error}
                  </div>
                )}

                {fee > 0 && (
                  <div className="p-3 rounded-xl bg-brand-gold/5 border border-brand-gold/20 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Gross pool</span>
                      <span className="text-brand-gold font-dmmono font-bold">{prizeBreakdown.gross.toLocaleString()} coins</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Mod cut (5%)</span>
                      <span className="text-text-muted font-dmmono">−{prizeBreakdown.modCut.toLocaleString()}</span>
                    </div>
                    <div className="h-px bg-white/[0.06]" />
                    {prizeBreakdown.payouts.map(p => (
                      <div key={p.place} className="flex justify-between text-xs">
                        <span className="text-text-secondary">{p.label} ({p.pct}%)</span>
                        <span className="text-text-primary font-dmmono">
                          {p.player.toLocaleString()} {needsSquad ? `(+${p.treasury.toLocaleString()} treasury)` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {needsSquad && (
                  <Field label="Host Squad *">
                    {squads.length === 0 ? (
                      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
                        <p className="text-text-muted text-sm mb-2">You need to be in a squad to host a squad tournament</p>
                        <button onClick={() => navigate('/squads')} className="text-brand-cyan text-sm font-bold">Browse Squads</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {squads.map(s => (
                          <button key={s.id} onClick={() => setSquadId(s.id)}
                            className={`w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                              squadId === s.id ? 'border-brand-cyan bg-brand-cyan/5' : 'border-white/[0.06] bg-white/[0.03] hover:border-white/10'
                            }`}>
                            <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-muted">
                              <Icon name="shield" size={18} />
                            </div>
                            <div className="flex-1">
                              <p className="text-text-primary text-sm font-bold">{s.name}</p>
                              <p className="text-text-muted text-[10px]">{s.memberCount || 0} members</p>
                            </div>
                            {squadId === s.id && <Icon name="check_circle" size={20} className="text-brand-cyan" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </Field>
                )}
              </div>
            </SectionCard>
          )}

          {step === 4 && (
            <SectionCard title="Review & Create">
              <ReviewRow label="Name" value={name || '—'} />
              <ReviewRow label="Game" value={finalGame || '—'} />
              <ReviewRow label="Format" value={bracketCfg?.label || '—'} />
              <ReviewRow label={needsSquad ? 'Max squads' : 'Max players'} value={String(maxParticipants)} />
              <ReviewRow label="Entry fee" value={fee ? `${fee.toLocaleString()} coins` : 'Free'} />
              <ReviewRow label="Prize pool" value={`${estimatedPrize.toLocaleString()} coins`} />
              {type === 'battle_royale' && <ReviewRow label="Games per event" value={String(brGameCount)} />}
              {type === 'swiss' && <ReviewRow label="Swiss rounds" value={String(swissRounds)} />}
              <ReviewRow label="Live stream" value={streamRequired ? 'Required' : 'Optional'} />
              {needsSquad && <ReviewRow label="Host squad" value={squads.find(s => s.id === squadId)?.name || '—'} />}
              {description && (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <p className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted mb-1">Description</p>
                  <p className="text-text-primary text-sm">{description}</p>
                </div>
              )}

              {/* Skill-based competition affirmation — required before create */}
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <p className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted mb-2">
                  Competition Classification
                </p>
                <p className="text-text-secondary text-xs leading-relaxed mb-3">
                  VERGR tournaments are <strong>skill-based competitions</strong>.
                  Outcomes must be determined by player skill — no randomized
                  prize draws, no betting on third-party outcomes, no
                  chance-based mechanics. Entry fees are pooled into a prize
                  fund and paid to winners; VERGR retains a 5% organizing fee.{' '}
                  <a href="#/learn/tournament-rules" target="_blank" rel="noopener noreferrer"
                     className="text-brand-cyan hover:underline">Read the Tournament Rules</a>.
                </p>
                <button type="button"
                  onClick={() => setAgreedToSkillTerms(v => !v)}
                  className="flex items-start gap-2.5 text-left">
                  <span className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    agreedToSkillTerms ? 'bg-brand-cyan border-brand-cyan' : 'border-white/[0.15] bg-surface-2'
                  }`}>
                    {agreedToSkillTerms && <Icon name="check" size={14} className="text-bg-dark" />}
                  </span>
                  <span className="text-text-primary text-xs leading-snug">
                    I confirm this tournament is a skill-based competition with
                    no chance-based mechanics, and I agree to the VERGR
                    Tournament Rules.
                  </span>
                </button>
              </div>
            </SectionCard>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between">
            <button onClick={handleBack} disabled={step === 1}
              className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-primary text-sm font-semibold disabled:opacity-30">
              Back
            </button>
            {step < 4 ? (
              <button onClick={handleNext}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110">
                Next Step
              </button>
            ) : (
              <button onClick={handleCreate} disabled={!canSubmit || loading}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110 disabled:opacity-40">
                {loading ? 'Creating…' : 'Create Tournament'}
              </button>
            )}
          </div>
        </main>

        {/* Right rail */}
        <AppRightRail>
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            <div className="h-20 bg-gradient-to-br from-brand-violet/40 via-brand-pink/20 to-brand-cyan/20 flex items-center justify-center">
              <Icon name="emoji_events" size={36} className="text-white/80" />
            </div>
            <div className="p-4 space-y-2">
              <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted">Tournament Summary</div>
              <div className="font-syne font-extrabold text-text-primary text-lg leading-tight truncate">
                {name || 'Untitled Tournament'}
              </div>
              <SummaryRow label="Game"    value={finalGame || '—'} />
              <SummaryRow label="Format"  value={bracketCfg?.label || '—'} />
              <SummaryRow label={needsSquad ? 'Squads' : 'Players'} value={String(maxParticipants)} />
              <SummaryRow label="Entry"   value={fee ? `${fee.toLocaleString()}c` : 'Free'} />
              <SummaryRow label="Pool"    value={`${estimatedPrize.toLocaleString()}c`} gold />
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="help" size={16} className="text-brand-cyan" />
              <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted">Need Help?</div>
            </div>
            <p className="text-text-secondary text-[12px] leading-snug mb-3">
              New to hosting? Read the quick-start guide for bracket formats, prize math, and host responsibilities.
            </p>
            <button onClick={() => navigate('/help/tournaments')}
              className="w-full py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-text-primary text-xs font-semibold">
              Open host guide
            </button>
          </div>

          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            <div className="h-24 bg-gradient-to-br from-brand-violet/30 to-brand-pink/20 flex items-center justify-center relative">
              <img src="/brand/graphic-tournament-rules.png" alt=""
                className="h-20 w-auto object-contain drop-shadow-xl" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <div className="p-4">
              <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted mb-2">Tournament Rules</div>
              <ul className="space-y-1.5">
                {RULES_CHECKLIST.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-text-secondary">
                    <Icon name="check_circle" size={14} className="text-brand-cyan mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </AppRightRail>
      </div>

      {connectPlatform && (
        <ConnectAccountModal
          platform={connectPlatform}
          onClose={() => setConnectPlatform(null)}
          uid={currentUser?.uid}
          showToast={showToast}
        />
      )}
      {showInviteModal && (
        <InvitePlayersModal
          platform={requiredAccount}
          gameName={finalGame}
          invitedUsers={invitedUsers}
          setInvitedUsers={setInvitedUsers}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* shared input style */}
      <style>{`
        .input {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 12px 14px;
          color: var(--text-primary, #fff);
          font-size: 14px;
          outline: none;
        }
        .input:focus { border-color: rgba(77,255,212,0.4); }
        .input::placeholder { color: rgba(255,255,255,0.35); }
      `}</style>
    </div>
  );
}

// ───────────── Banner picker (preset + upload) ─────────────
function BannerPicker({ game, bannerUrl, setBannerUrl, uploading, onFile }) {
  const presets = presetBannersForGame(game);
  return (
    <div className="space-y-3">
      {bannerUrl && (
        <div className="relative rounded-xl overflow-hidden border border-white/[0.08]" style={{ aspectRatio: '3 / 1' }}>
          <img src={bannerUrl} alt="" className="w-full h-full object-cover" />
          <button onClick={() => setBannerUrl('')}
            className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/60 text-white text-[11px] font-bold">
            Clear
          </button>
        </div>
      )}
      {game && presets.length > 0 && (
        <div>
          <p className="text-text-muted text-[10px] font-dmmono uppercase tracking-[0.14em] mb-2">Suggested for {game}</p>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((src, i) => (
              <button key={i} onClick={() => setBannerUrl(src)}
                className={`rounded-lg overflow-hidden border ${bannerUrl === src ? 'border-brand-cyan ring-2 ring-brand-cyan/40' : 'border-white/[0.08]'}`}
                style={{ aspectRatio: '3 / 1' }}>
                <img src={src} alt="" className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.style.background = 'linear-gradient(135deg,#7B6FFF22,#C87FFF22)'; }} />
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <input type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        <div className={`w-full p-3 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
          uploading ? 'border-brand-violet/40 bg-brand-violet/5' : 'border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2]'
        }`}>
          <p className="text-text-secondary text-xs font-semibold">
            {uploading ? 'Uploading…' : bannerUrl ? 'Replace with custom image' : 'Upload custom banner (3:1)'}
          </p>
          <p className="text-text-muted text-[10px] mt-0.5">PNG / JPG, recommended 1500×500</p>
        </div>
      </label>
    </div>
  );
}

// ───────────── Inline Connect-account modal ─────────────
function ConnectAccountModal({ platform, onClose, uid, showToast }) {
  const meta = PLATFORM_META[platform];
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  if (!meta) return null;

  const submit = async () => {
    const v = val.trim();
    if (!v || saving) return;
    setSaving(true);
    try {
      if (platform === 'steam') {
        if (!/^7656119\d{10}$/.test(v)) {
          showToast('Steam ID must be a 17-digit Steam64 (starts with 7656119)', 'error');
          setSaving(false); return;
        }
        await linkSteam({ steamId64: v });
      } else {
        await updateLinkedAccount(uid, platform, v);
      }
      showToast(`${meta.name} connected!`, 'success');
      onClose();
    } catch (err) {
      showToast(err?.message || 'Failed to connect', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#12121e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, width: 440, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: meta.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{meta.letter}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Connect {meta.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Required to host this game's tournaments.</div>
          </div>
        </div>
        <input type="text" value={val} onChange={e => setVal(e.target.value)} placeholder={meta.placeholder} autoFocus
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.7)', fontSize: 13, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving || !val.trim()}
            style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, padding: '8px 20px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving || !val.trim() ? 0.6 : 1 }}>
            {saving ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────── Invite-players modal ─────────────
// Default list = users who have the game's required platform linked. Search
// box narrows by username prefix. Toggle a user's chip to add/remove from the
// invite list.
function InvitePlayersModal({ platform, gameName, invitedUsers, setInvitedUsers, onClose }) {
  const [term, setTerm] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!platform) { setUsers([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      getUsersWithLinkedAccount(platform, { term, limitCount: 60 })
        .then(setUsers)
        .catch(() => setUsers([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [platform, term]);

  const isInvited = (id) => invitedUsers.some(u => u.id === id);
  const toggle = (u) => {
    setInvitedUsers(isInvited(u.id)
      ? invitedUsers.filter(x => x.id !== u.id)
      : [...invitedUsers, { id: u.id, username: u.username, avatar: u.avatar, vpLevel: u.vpLevel }]);
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#12121e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 0, width: 520, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 18, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Invite Players</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
            {platform
              ? `Showing players with ${PLATFORM_META[platform]?.name || platform} linked${gameName ? ` for ${gameName}` : ''}.`
              : 'Search players by username.'}
          </div>
          <input type="text" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by username…" autoFocus
            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box', marginTop: 12 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading && <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading…</div>}
          {!loading && users.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              No players found{platform ? ` with ${PLATFORM_META[platform]?.name} linked` : ''}.
            </div>
          )}
          {!loading && users.map(u => {
            const invited = isInvited(u.id);
            return (
              <div key={u.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 4, background: invited ? 'rgba(124,58,237,0.08)' : 'transparent' }}>
                <img src={u.avatar || '/brand/logo.png'} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: '#222' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{u.username || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>VP Lvl {u.vpLevel || 1}</div>
                </div>
                <button onClick={() => toggle(u)}
                  style={{ background: invited ? 'transparent' : 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: invited ? '1px solid rgba(255,255,255,0.15)' : 'none', color: invited ? 'rgba(255,255,255,0.8)' : '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {invited ? 'Invited' : 'Invite'}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{invitedUsers.length} invited</span>
          <button onClick={onClose}
            style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, padding: '8px 20px', fontWeight: 600, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-text-muted text-[10px] font-dmmono uppercase tracking-[0.18em] mb-2 block">{label}</label>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
      <span className="text-[11px] font-dmmono uppercase tracking-[0.14em] text-text-muted">{label}</span>
      <span className="text-text-primary text-sm font-semibold">{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, gold }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className={`font-dmmono font-bold ${gold ? 'text-brand-gold' : 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

// ───────────────────────── Mobile wizard ─────────────────────────
// Simplified version — stacks each step vertically with the same Back/Next footer.
function MobileWizard(props) {
  const {
    step, name, setName, description, setDescription, game, setGame, customGame, setCustomGame,
    type, setType, plan, bracketCfg, maxParticipants, setMaxParticipants, entryFee, setEntryFee,
    squadId, setSquadId, squads, needsSquad, brGameCount, setBrGameCount,
    streamRequired, setStreamRequired, swissRounds, prizeBreakdown, fee, limitCheck, finalGame,
    // Phase 1–3 additions
    seriesFormat, setSeriesFormat, seedingMode, setSeedingMode,
    structurePreset, setStructurePreset, eligibleSquadCount,
    onBack, onNext, onCreate, canSubmit, loading,
  } = props;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5">
        {STEPS.map(s => (
          <div key={s.id} className={`flex-1 h-1.5 rounded-full ${
            step >= s.id ? 'bg-brand-violet' : 'bg-white/[0.08]'
          }`} />
        ))}
      </div>
      <div className="text-[10px] font-dmmono uppercase tracking-[0.18em] text-brand-violet">
        Step {step} / 4 — {STEPS[step-1].label}
      </div>

      {step === 1 && (
        <>
          <Field label="Tournament Name *">
            <input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Friday Night Cup" maxLength={60} />
          </Field>
          <Field label="Short Description">
            <textarea rows={3} className="input resize-none" value={description} onChange={e=>setDescription(e.target.value)} maxLength={240} />
          </Field>
          <Field label="Game *">
            <div className="flex flex-wrap gap-2">
              {GAMES.map(g => {
                const soon = COMING_SOON_GAMES.has(g);
                const selected = game === g;
                return (
                  <button key={g} onClick={() => props.pickGame(g)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                      soon ? 'bg-brand-ember/5 border border-brand-ember/50 text-brand-ember/80'
                      : selected ? 'bg-brand-cyan/15 border border-brand-cyan/40 text-brand-cyan'
                      : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                    }`}>
                    <span>{g}</span>
                    {soon && <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-brand-ember/20 text-brand-ember">Soon</span>}
                  </button>
                );
              })}
            </div>
            {game === 'Other' && <input className="input mt-3" value={customGame} onChange={e=>setCustomGame(e.target.value)} placeholder="Enter game name…" />}
            {props.requiredAccount && !props.hasRequiredAccount && (
              <button onClick={() => props.setConnectPlatform(props.requiredAccount)}
                className="mt-3 w-full p-3 rounded-xl border border-brand-gold/40 bg-brand-gold/5 text-left flex items-center gap-2">
                <Icon name="link_off" size={16} className="text-brand-gold" />
                <span className="flex-1 text-text-primary text-xs font-bold">Connect {PLATFORM_META[props.requiredAccount].name}</span>
                <span className="text-brand-gold text-[11px] font-bold">Connect</span>
              </button>
            )}
          </Field>
          <Field label="Banner Image">
            <BannerPicker
              game={props.finalGame}
              bannerUrl={props.bannerUrl}
              setBannerUrl={props.setBannerUrl}
              uploading={props.bannerUploading}
              onFile={props.handleBannerFile}
            />
          </Field>
          {(props.squads || []).length > 0 && (
            <Field label="Hosted By (optional)">
              <select
                value={props.hostSquadId || ''}
                onChange={(e) => props.setHostSquadId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-text-primary"
              >
                <option value="">Myself</option>
                {(props.squads || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.tag || 'My squad'}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Visibility *">
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'public',  label: 'Public',  icon: 'public', desc: 'Anyone can join' },
                { id: 'private', label: 'Private', icon: 'lock',   desc: 'Invite-only' },
              ].map(v => (
                <button key={v.id} onClick={() => props.setVisibility(v.id)}
                  className={`p-3 rounded-xl border text-left ${
                    props.visibility === v.id ? 'border-brand-violet bg-brand-violet/5' : 'border-white/[0.06] bg-white/[0.03]'
                  }`}>
                  <div className="flex items-center gap-2"><Icon name={v.icon} size={14} /><p className="text-text-primary text-xs font-bold">{v.label}</p></div>
                  <p className="text-text-muted text-[10px] mt-1">{v.desc}</p>
                </button>
              ))}
            </div>
            {props.visibility === 'private' && (
              <button onClick={() => props.setShowInviteModal(true)}
                className="mt-3 w-full p-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 flex items-center gap-2">
                <Icon name="group_add" size={16} className="text-brand-cyan" />
                <span className="flex-1 text-left text-text-primary text-xs font-bold">
                  {props.invitedUsers.length === 0 ? 'Invite Players' : `${props.invitedUsers.length} invited — edit`}
                </span>
              </button>
            )}
          </Field>
        </>
      )}

      {step === 2 && (
        <>
          <Field label="Format *">
            <div className="space-y-2">
              {BRACKET_TYPE_LIST.map(t => {
                const allowed = isBracketTypeAllowed(t.id, plan);
                const selected = type === t.id;
                const isSquadFormat = t.mode === 'squad';
                const minSquadsNeeded = (t.allowedPlayers?.[0]) || 4;
                const supplyOk = !isSquadFormat || eligibleSquadCount === null
                  || eligibleSquadCount >= minSquadsNeeded;
                const locked = !allowed || !supplyOk;
                return (
                  <button key={t.id} onClick={() => supplyOk && allowed && setType(t.id)}
                    className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 ${
                      selected ? 'border-brand-violet bg-brand-violet/5' :
                      !locked ? 'border-white/[0.06] bg-white/[0.03]' :
                      'border-white/[0.04] opacity-60'
                    }`}>
                    <Icon name={t.icon} size={18} className={selected ? 'text-brand-violet' : 'text-text-muted'} />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-text-primary text-sm font-bold">{t.label}</p>
                        {!supplyOk && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan">
                            Unlocks at {minSquadsNeeded} squads
                          </span>
                        )}
                      </div>
                      <p className="text-text-muted text-[11px]">{t.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Phase 2 — Tournament Structure (mobile) */}
          <Field label="Tournament Structure">
            <div className="flex flex-col gap-2">
              {STAGE_PRESETS.map((p) => {
                const selected = structurePreset === p.id;
                const mismatch = p.forcesType && p.forcesType !== type;
                return (
                  <button key={p.id}
                    onClick={() => {
                      if (mismatch) {
                        setType(p.forcesType);
                        setSeriesFormat(p.forcesSeriesFormat || 'bo1');
                      }
                      setStructurePreset(p.id);
                    }}
                    className={`text-left p-3 rounded-lg border ${
                      selected ? 'bg-brand-violet/15 border-brand-violet/40'
                               : 'bg-white/[0.04] border-white/[0.06]'
                    }`}>
                    <div className="flex items-center gap-2">
                      <Icon name={p.id === 'single_stage' ? 'view_module' : 'route'}
                        size={14} className={selected ? 'text-brand-violet-light' : 'text-text-muted'} />
                      <div className={`text-sm font-bold ${selected ? 'text-brand-violet-light' : 'text-text-primary'}`}>{p.label}</div>
                    </div>
                    <div className="text-[11px] text-text-muted mt-1">{p.sub}</div>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={needsSquad ? 'Max Squads' : 'Max Players'}>
            <div className="flex gap-2 flex-wrap">
              {(bracketCfg?.allowedPlayers || []).map(n => (
                <button key={n} onClick={() => setMaxParticipants(n)}
                  className={`flex-1 min-w-[56px] py-2.5 rounded-lg text-sm font-bold ${
                    maxParticipants === n ? 'bg-brand-gold/15 border border-brand-gold/40 text-brand-gold' : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                  }`}>{n}</button>
              ))}
            </div>
          </Field>
          {type === 'battle_royale' && (
            <Field label="Games per Event">
              <div className="flex gap-2">
                {[1,3,5,7].map(n => (
                  <button key={n} onClick={() => setBrGameCount(n)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${
                      brGameCount === n ? 'bg-brand-ember/15 border border-brand-ember/40 text-brand-ember' : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                    }`}>{n}</button>
                ))}
              </div>
            </Field>
          )}

          {/* Phase 3 — Series Format (mobile). Hidden only for BR. */}
          {type !== 'battle_royale' && (
            <Field label="Series Format">
              <div className="flex gap-2">
                {[
                  { id: 'bo1', label: 'Bo1', desc: '1 game' },
                  { id: 'bo3', label: 'Bo3', desc: 'first to 2' },
                  { id: 'bo5', label: 'Bo5', desc: 'first to 3' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setSeriesFormat(opt.id)}
                    className={`flex-1 py-2.5 px-2 rounded-lg text-left ${
                      seriesFormat === opt.id
                        ? 'bg-brand-violet/15 border border-brand-violet/40 text-brand-violet-light'
                        : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                    }`}>
                    <div className="text-sm font-bold">{opt.label}</div>
                    <div className="text-[10px] opacity-80">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </Field>
          )}

          {/* Phase 3 — Seeding mode (mobile). */}
          {type !== 'battle_royale' && (
            <Field label="Seeding">
              <div className="flex gap-2">
                {[
                  { id: 'random', label: 'Random' },
                  { id: 'manual', label: 'Manual' },
                  { id: 'rating', label: 'Rating' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setSeedingMode(opt.id)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${
                      seedingMode === opt.id
                        ? 'bg-brand-cyan/15 border border-brand-cyan/40 text-brand-cyan'
                        : 'bg-white/[0.04] border border-white/[0.06] text-text-muted'
                    }`}>{opt.label}</button>
                ))}
              </div>
            </Field>
          )}
          <button onClick={() => !bracketCfg?.streamRequired && setStreamRequired(!streamRequired)}
            className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 ${
              streamRequired ? 'border-brand-ember/40 bg-brand-ember/5' : 'border-white/[0.06] bg-white/[0.03]'
            }`}>
            <Icon name="live_tv" size={18} className={streamRequired ? 'text-brand-ember' : 'text-text-muted'} />
            <div className="flex-1">
              <p className="text-text-primary text-sm font-bold">Live Stream</p>
              <p className="text-text-muted text-[11px]">{bracketCfg?.streamRequired ? 'Required' : 'Optional'}</p>
            </div>
            <div className={`w-9 h-5 rounded-full relative ${streamRequired ? 'bg-brand-ember' : 'bg-white/[0.08]'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${streamRequired ? 'right-0.5' : 'left-0.5'}`} />
            </div>
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <Field label={`Entry Fee (coins) — max ${MAX_ENTRY_FEE_COINS.toLocaleString()}`}>
            <input type="number" min="0" max={MAX_ENTRY_FEE_COINS} className="input font-dmmono" value={entryFee} onChange={e=>setEntryFee(e.target.value)} placeholder="0" />
            <p className="text-text-muted text-[11px] mt-1.5">
              Pool cap: {MAX_PRIZE_POOL_COINS.toLocaleString()} coins.
            </p>
          </Field>
          {limitCheck && !limitCheck.ok && (
            <div className="p-3 rounded-xl bg-brand-ember/10 border border-brand-ember/30 text-brand-ember text-xs">
              {limitCheck.error}
            </div>
          )}
          {fee > 0 && (
            <div className="p-3 rounded-xl bg-brand-gold/5 border border-brand-gold/20 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-text-secondary">Gross pool</span><span className="text-brand-gold font-dmmono font-bold">{prizeBreakdown.gross.toLocaleString()}c</span></div>
              <div className="flex justify-between text-xs"><span className="text-text-muted">Mod cut (5%)</span><span className="text-text-muted font-dmmono">−{prizeBreakdown.modCut.toLocaleString()}</span></div>
              <div className="h-px bg-white/[0.06]" />
              {prizeBreakdown.payouts.map(p => (
                <div key={p.place} className="flex justify-between text-xs">
                  <span className="text-text-secondary">{p.label} ({p.pct}%)</span>
                  <span className="text-text-primary font-dmmono">{p.player.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {needsSquad && (
            <Field label="Host Squad *">
              {squads.length === 0 ? (
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center text-text-muted text-sm">Join a squad first.</div>
              ) : (
                <div className="space-y-2">
                  {squads.map(s => (
                    <button key={s.id} onClick={() => setSquadId(s.id)}
                      className={`w-full p-3 rounded-xl border flex items-center gap-3 ${
                        squadId === s.id ? 'border-brand-cyan bg-brand-cyan/5' : 'border-white/[0.06] bg-white/[0.03]'
                      }`}>
                      <Icon name="shield" size={16} className="text-text-muted" />
                      <p className="flex-1 text-left text-text-primary text-sm font-bold">{s.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}
        </>
      )}

      {step === 4 && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-2">
          <ReviewRow label="Name"   value={name || '—'} />
          <ReviewRow label="Game"   value={finalGame || '—'} />
          <ReviewRow label="Format" value={bracketCfg?.label || '—'} />
          <ReviewRow label={needsSquad ? 'Squads' : 'Players'} value={String(maxParticipants)} />
          <ReviewRow label="Entry"  value={fee ? `${fee.toLocaleString()}c` : 'Free'} />
          <ReviewRow label="Pool"   value={`${(fee*maxParticipants).toLocaleString()}c`} />
          <ReviewRow label="Stream" value={streamRequired ? 'Required' : 'Optional'} />
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button onClick={onBack} disabled={step === 1}
          className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-primary text-sm font-semibold disabled:opacity-30">Back</button>
        {step < 4 ? (
          <button onClick={onNext}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold">Next</button>
        ) : (
          <button onClick={onCreate} disabled={!canSubmit || loading}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold disabled:opacity-40">
            {loading ? 'Creating…' : 'Create'}
          </button>
        )}
      </div>

      <style>{`
        .input { width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:12px 14px; color:#fff; font-size:14px; outline:none; }
        .input:focus { border-color:rgba(77,255,212,0.4); }
        .input::placeholder { color:rgba(255,255,255,0.35); }
      `}</style>
    </div>
  );
}
