// functions/tournamentStages.js
//
// Phase 2 — multi-stage tournaments. The real esports shape: Swiss → Top 8
// SE Bo3, or 4× RR groups → Top 2 each → SE Bo3 playoffs.
//
// Architecture (additive, zero churn for existing single-format tournaments):
//
//   tournament.stages = [
//     {
//       id: 'stage_1', name: 'Group Stage',
//       type: 'swiss',          // any BRACKET_TYPES key
//       seriesFormat: 'bo1',    // 'bo1' | 'bo3' | 'bo5'
//       seedingMode: 'random',  // 'random' | 'manual' | 'rating' | 'inherit'
//       advanceCount: 8,        // top-N from this stage feed the next
//       swissRounds: 5,         // type-specific
//       brGameCount: 3,
//     },
//     {
//       id: 'stage_2', name: 'Playoffs',
//       type: 'single_elim',
//       seriesFormat: 'bo3',
//       seedingMode: 'inherit',  // use stage_1 standings
//       // (last stage — no advanceCount needed)
//     }
//   ]
//   tournament.currentStageId = 'stage_1'      // updated as stages advance
//   match.stageId = 'stage_1'                  // every match doc carries it
//
// For BACKWARDS COMPAT: tournaments WITHOUT stages[] are treated as
// implicit single-stage. tournament.type stays authoritative for those.
// All existing tournaments + all old code paths keep working untouched.
//
// Stage transitions:
//   1. autoCompleteNonSingleElimIfDone / advanceBracketAfterMatch detect
//      that the CURRENT stage is fully done (per-stage version of the
//      existing per-tournament check).
//   2. If a next stage exists: pull top-N standings (computeRankingForTournament
//      scoped to current stage's matches), seed the next stage's matches,
//      flip currentStageId, update tournament.type to the new stage's type
//      so the existing per-type auto-complete check fires correctly for it.
//   3. If no next stage: original finalizeInternal path runs.

const STAGE_PRESETS = [
  {
    id: 'single_stage',
    label: 'Single Stage (default)',
    description: 'One format, traditional bracket. What every tournament was before today.',
    stages: null, // null = implicit single-stage; tournament.type is authoritative
  },
  {
    id: 'swiss_to_se',
    label: 'Swiss → SE Playoffs',
    description: 'Open qualifier with Swiss rounds, top 8 advance to single-elim Bo3 finals.',
    stages: [
      { id: 'stage_1', name: 'Swiss Qualifier', type: 'swiss',        seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8, swissRounds: 5 },
      { id: 'stage_2', name: 'Playoffs',        type: 'single_elim',  seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  {
    id: 'swiss_to_de',
    label: 'Swiss → DE Playoffs',
    description: 'Swiss open, top 8 into double-elim Bo3 / Bo5 GF.',
    stages: [
      { id: 'stage_1', name: 'Swiss Qualifier', type: 'swiss',        seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8, swissRounds: 5 },
      { id: 'stage_2', name: 'Double-Elim Playoffs', type: 'double_elim', seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  {
    id: 'groups_to_se',
    label: '4 × RR Groups → SE Playoffs',
    description: 'Round-robin groups of 4 (top 2 each advance), then single-elim Bo3.',
    // Groups are modelled as one round_robin stage; the matches engine
    // pairs every participant against every other once. For sub-groups we
    // rely on participant-count caps (16 → 4×4) being enforced at
    // create-time. v1 = single big RR; per-group RR comes with Phase 2.1.
    stages: [
      { id: 'stage_1', name: 'Group Stage',  type: 'round_robin',  seriesFormat: 'bo1', seedingMode: 'random',  advanceCount: 8 },
      { id: 'stage_2', name: 'Playoffs',     type: 'single_elim',  seriesFormat: 'bo3', seedingMode: 'inherit' },
    ],
  },
  {
    id: 'de_only',
    label: 'Double-Elim Only (Bo3 main, Bo5 GF)',
    description: 'Pure double-elim, but with proper Bo3 / Bo5 GF series.',
    stages: [
      { id: 'stage_1', name: 'Double-Elim',   type: 'double_elim',   seriesFormat: 'bo3', seedingMode: 'random' },
    ],
  },
];

// Validate a stages[] array. Returns { ok, error } / { ok:true }.
function validateStages(stages, tournamentGame) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return { ok: false, error: 'stages[] must be a non-empty array.' };
  }
  if (stages.length > 4) {
    return { ok: false, error: 'Maximum 4 stages per tournament.' };
  }
  const { BRACKET_TYPES } = require('./tournamentRules');
  const { validateSeriesFormat } = require('./tournamentSeries');
  const idsSeen = new Set();
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (!s.id) return { ok: false, error: `stages[${i}].id is required.` };
    if (idsSeen.has(s.id)) return { ok: false, error: `Duplicate stage id: ${s.id}.` };
    idsSeen.add(s.id);
    if (!BRACKET_TYPES[s.type]) return { ok: false, error: `Unknown stage type: ${s.type}.` };
    const sv = validateSeriesFormat(s.seriesFormat || 'bo1', tournamentGame, s.type);
    if (!sv.ok) return { ok: false, error: `stages[${i}]: ${sv.error}` };
    if (!['random', 'manual', 'rating', 'inherit'].includes(s.seedingMode || 'random')) {
      return { ok: false, error: `stages[${i}].seedingMode invalid: ${s.seedingMode}` };
    }
    if (i === 0 && (s.seedingMode === 'inherit')) {
      return { ok: false, error: 'First stage cannot inherit seeding (no prior stage).' };
    }
    if (i < stages.length - 1 && !s.advanceCount) {
      return { ok: false, error: `stages[${i}] needs an advanceCount (top-N feeds stage ${i + 1}).` };
    }
  }
  return { ok: true };
}

// Look up a stage by id from tournament.stages[]. Returns null for legacy
// (single-stage implicit) tournaments.
function getStage(tournament, stageId) {
  if (!Array.isArray(tournament.stages)) return null;
  return tournament.stages.find((s) => s.id === stageId) || null;
}
function getCurrentStage(tournament) {
  return getStage(tournament, tournament.currentStageId);
}
function getNextStage(tournament) {
  if (!Array.isArray(tournament.stages)) return null;
  const idx = tournament.stages.findIndex((s) => s.id === tournament.currentStageId);
  if (idx < 0) return null;
  return tournament.stages[idx + 1] || null;
}

module.exports = {
  STAGE_PRESETS,
  validateStages,
  getStage,
  getCurrentStage,
  getNextStage,
};
