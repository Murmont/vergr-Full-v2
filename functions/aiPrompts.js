// CJS mirror of src/utils/aiPrompts.js — keep in sync.

const COMMON = `You are analyzing a single video frame from a competitive gaming tournament stream. The frame is from approximately the END of a match. Your job: identify who won.

Rules:
- Respond ONLY with strict JSON: { "winner": "player1" | "player2" | "draw" | "unclear", "confidence": 0.0-1.0, "evidence": "string explaining what you saw" }
- "confidence" 0.9+ means you're certain (winner clearly shown)
- "confidence" 0.5-0.8 means likely but not certain
- "confidence" <0.5 means unclear — say so honestly, do not guess
- "player1" = the streamer's POV / left team / first listed
- "player2" = opponent / right team / second listed
- Use "unclear" when the frame doesn't show match-end state`;

const AI_PROMPTS = {
  'Counter-Strike 2':       `${COMMON}\n\nLook for: final scoreboard (first-to-13 / 16 rounds), "T WIN" / "CT WIN" banners, MVP screen.`,
  'VALORANT':               `${COMMON}\n\nLook for: "VICTORY" / "DEFEAT" banner, 13-X final round score, team summary screen.`,
  'Dota 2':                 `${COMMON}\n\nLook for: "Radiant Victory" / "Dire Victory" banner, ancient destruction animation.`,
  'League of Legends':      `${COMMON}\n\nLook for: "VICTORY" / "DEFEAT" banner, post-game team stats, nexus explosion.`,
  'Overwatch 2':            `${COMMON}\n\nLook for: "VICTORY" / "DEFEAT" banner, round scoreboard, POTG.`,
  'Apex Legends':           `${COMMON}\n\nLook for: "Champion" banner, "#1 Victory Royale", squad placement.`,
  'Rocket League':          `${COMMON}\n\nLook for: final goal-count scoreboard, "WINNER!" banner, BO5 series score.`,
  'Tekken':                 `${COMMON}\n\nLook for: "K.O." text, BO3/BO5 round counter, winner character portrait.`,
  'Street Fighter 6':       `${COMMON}\n\nLook for: "K.O." / "PERFECT" final round, round counter, winner portrait.`,
  'Super Smash Bros. Ultimate': `${COMMON}\n\nLook for: "GAME!" text, stock counters, winner spotlight.`,
  'Brawlhalla':             `${COMMON}\n\nLook for: "Player X Wins" banner, stock indicators, KO replay.`,
  'EA Sports FC':           `${COMMON}\n\nLook for: final score scoreboard, "Full Time" banner.`,
  'FIFA':                   `${COMMON}\n\nLook for: final score scoreboard, match-end animation.`,
  'Halo Infinite':          `${COMMON}\n\nLook for: "VICTORY" / "DEFEAT" banner, final round score.`,
  'Rainbow Six Siege':      `${COMMON}\n\nLook for: final round score (first-to-7), "VICTORY"/"DEFEAT" banner.`,
  'Call of Duty':           `${COMMON}\n\nLook for: final score scoreboard, "VICTORY"/"DEFEAT" banner, series score.`,
  'StarCraft II':           `${COMMON}\n\nLook for: "Victory" / "Defeat" banner with race icons, post-game stats.`,
};

const DEFAULT_PROMPT = `${COMMON}\n\nLook for any scoreboard, win banner, or game-over indicator. Return your best guess.`;

function promptForGame(game) {
  return AI_PROMPTS[game] || DEFAULT_PROMPT;
}

module.exports = { AI_PROMPTS, DEFAULT_PROMPT, promptForGame };
