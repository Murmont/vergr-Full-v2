// Per-game AI moderation prompts.
//
// Used by the Vision OCR pass (Phase 1B) to focus model attention on the
// scoreboard / win-screen cues specific to each game. Without these, Vision
// reads the whole frame and gets distracted by chat, kill feeds, sponsor
// overlays, etc.
//
// Mirrored on server at functions/aiPrompts.js. Keep both files in sync.
//
// When adding a new game:
//  1. Identify the "match end" visual cue (text banner, scoreboard, etc.)
//  2. Add what text the OCR should look for + the layout pattern
//  3. Add the team/player identifier pattern if visible

const COMMON = `You are analyzing a single video frame from a competitive gaming tournament stream. The frame is from approximately the END of a match. Your job: identify who won.

Rules:
- Respond ONLY with strict JSON: { "winner": "player1" | "player2" | "draw" | "unclear", "confidence": 0.0-1.0, "evidence": "string explaining what you saw" }
- "confidence" 0.9+ means you're certain (winner clearly shown)
- "confidence" 0.5-0.8 means likely but not certain
- "confidence" <0.5 means unclear — say so honestly, do not guess
- "player1" = the streamer's POV / left team / first listed
- "player2" = opponent / right team / second listed
- Use "unclear" when the frame doesn't show match-end state`;

export const AI_PROMPTS = {
  'Counter-Strike 2': `${COMMON}

Look for:
- Final scoreboard with "Round X / Y" reaching MR12 limit (first to 13 in a half, or 16 total in classic).
- "T WIN" / "CT WIN" round banners (last round indicator).
- MVP screen showing the winning team's logo.
- End-of-match summary with team scores in large text.

The team with the higher round count is the winner. If the streamer is on the winning team, return "player1"; otherwise "player2".`,

  'VALORANT': `${COMMON}

Look for:
- "VICTORY" / "DEFEAT" banner in large purple/red text (frame center).
- Final round score "13-X" (first to 13 in BO1).
- End-of-match team summary showing both teams' agent rosters.

The streamer's perspective shows VICTORY = player1 won; DEFEAT = player2 won.`,

  'Dota 2': `${COMMON}

Look for:
- "Radiant Victory" or "Dire Victory" banner.
- Post-game scoreboard showing team kills + match duration.
- Ancient destruction animation in the background.

Identify which team is "Radiant" (typically green/bottom-left) vs "Dire" (red/top-right). Map to player1/player2 based on which side the streamer is on (usually visible in HUD).`,

  'League of Legends': `${COMMON}

Look for:
- "VICTORY" / "DEFEAT" banner with team logos.
- Post-game team stats screen (kills, gold, time).
- Nexus explosion animation.

Streamer's team result determines player1 (victory) or player2 (defeat).`,

  'Overwatch 2': `${COMMON}

Look for:
- "VICTORY" / "DEFEAT" banner.
- Final round scoreboard with both team objective progress.
- Play of the Game (POTG) highlights player from winning team.

Map to player1 = streamer's team (typically left); player2 = opponent.`,

  'Apex Legends': `${COMMON}

Look for:
- "Champion" banner with the winning squad's name.
- "#1 Victory Royale" or similar placement banner.
- End-of-match scoreboard with squad rankings.

Apex is a battle royale — placement matters. If the tournament tracks "Player N won" semantics, use placement #1 = player1 (if it's the streamer's squad).`,

  'Rocket League': `${COMMON}

Look for:
- Goal-count scoreboard at end of match (e.g. "BLUE 3 - 2 ORANGE").
- "WINNER!" banner over the winning team color.
- BO5 series score (first to 3 wins).

Streamer's team color → player1 or player2 based on which side they're on.`,

  'Tekken': `${COMMON}

Look for:
- "K.O." text after the final round.
- Round counter showing first-to-3 in BO5 series (or first-to-2 in BO3).
- Character victory portrait with name.
- Winner's name banner.

Match player1/player2 to the displayed character names + streamer's controller side (left = player1).`,

  'Street Fighter 6': `${COMMON}

Look for:
- "K.O." or "PERFECT" final round indicator.
- Round counter (BO3/BO5 first-to-N).
- Winner portrait with character name.

Player on the LEFT side of the screen = player1; right = player2.`,

  'Super Smash Bros. Ultimate': `${COMMON}

Look for:
- "GAME!" text at the end of a match.
- Stock counters (most matches are 3 stocks); winner is the one with stocks remaining.
- Final character spotlight with "Wins" text.

Player1 = left-side characters; player2 = right side.`,

  'Brawlhalla': `${COMMON}

Look for:
- "Player X Wins" banner with the winning fighter highlighted.
- Stock indicators at top — winner has stocks remaining.
- Final-blow KO replay.

Map by player slot number to player1/player2.`,

  'EA Sports FC': `${COMMON}

Look for:
- Final score scoreboard (e.g. "ARSENAL 2 - 1 LIVERPOOL").
- "Full Time" banner.
- Trophy / win animation if applicable.

Streamer's team = player1; opponent's = player2.`,

  'FIFA': `${COMMON}

Look for:
- Final score scoreboard at full time.
- Match-end celebration animation.

Same as EA Sports FC.`,

  'Halo Infinite': `${COMMON}

Look for:
- "VICTORY" / "DEFEAT" banner.
- Final round score for objective modes (Slayer first-to-50, CTF/Strongholds objective points).
- End-of-match team scoreboard.

Streamer's team result → player1/player2.`,

  'Rainbow Six Siege': `${COMMON}

Look for:
- Final round score (first to 7 in standard BO11 rounds, or BO12 in ranked).
- "VICTORY" / "DEFEAT" banner.
- End-of-match operator selection screen with team scores.

Map by streamer's team side.`,

  'Call of Duty': `${COMMON}

Look for:
- Final score scoreboard for Hardpoint (250) / S&D (first to 6 rounds) / Control (first to 3 rounds).
- "VICTORY" / "DEFEAT" banner.
- Series score (typically BO5 maps).

Map by streamer's team.`,

  'StarCraft II': `${COMMON}

Look for:
- "Victory" / "Defeat" banner with race icons.
- Post-game stats screen.

Streamer's race/POV = player1.`,
};

export const DEFAULT_PROMPT = `${COMMON}

Look for any scoreboard, win banner, or game-over indicator. Return your best guess at the winner.`;

export function promptForGame(game) {
  return AI_PROMPTS[game] || DEFAULT_PROMPT;
}
