// VERGR rank badge system.
// Each rank has 3 sub-badges, awarded as the user progresses through that rank's
// 10-level band. Badge art lives in `public/badges/<rank><range>.webp`.
// Public profiles show all 3 badges of the user's CURRENT rank: the earned ones
// solid, future ones as silhouettes — driving them to push for the next badge.
//
// Source of truth for VP/level math: src/utils/vpSystem.js
// (this file only adds the badge-art mapping on top of those ranks).

// 30 art files, 3 per rank × 10 ranks (Immortal at L100 reuses Ascendant 97–100).
export const BADGE_RANKS = [
  {
    id: 'rookie', name: 'Rookie', ring: null, ringColor: '#8A8F98',
    minLevel: 1, maxLevel: 10,
    tiers: [
      { id: 'rookie-1-3',   label: '1–3',   min: 1,  max: 3,  art: '/badges/rookie1-3.webp' },
      { id: 'rookie-4-6',   label: '4–6',   min: 4,  max: 6,  art: '/badges/rookie4-6.webp' },
      { id: 'rookie-7-10',  label: '7–10',  min: 7,  max: 10, art: '/badges/rookie7-10.webp' },
    ],
  },
  {
    id: 'contender', name: 'Contender', ring: 'bronze', ringColor: '#CD7F32',
    minLevel: 11, maxLevel: 20,
    tiers: [
      { id: 'contender-11-13', label: '11–13', min: 11, max: 13, art: '/badges/contender11-13.webp' },
      { id: 'contender-14-16', label: '14–16', min: 14, max: 16, art: '/badges/contender14-16.webp' },
      { id: 'contender-17-20', label: '17–20', min: 17, max: 20, art: '/badges/contender17-20.webp' },
    ],
  },
  {
    id: 'rival', name: 'Rival', ring: 'silver', ringColor: '#C0C0C0',
    minLevel: 21, maxLevel: 30,
    tiers: [
      { id: 'rival-21-23', label: '21–23', min: 21, max: 23, art: '/badges/rival21-23.webp' },
      { id: 'rival-24-26', label: '24–26', min: 24, max: 26, art: '/badges/rival24-26.webp' },
      { id: 'rival-27-30', label: '27–30', min: 27, max: 30, art: '/badges/rival27-30.webp' },
    ],
  },
  {
    id: 'challenger', name: 'Challenger', ring: 'gold', ringColor: '#F5C542',
    minLevel: 31, maxLevel: 40,
    tiers: [
      { id: 'challenger-31-33', label: '31–33', min: 31, max: 33, art: '/badges/challenger31-33.webp' },
      { id: 'challenger-34-36', label: '34–36', min: 34, max: 36, art: '/badges/challenger34-36.webp' },
      { id: 'challenger-37-40', label: '37–40', min: 37, max: 40, art: '/badges/challenger37-40.webp' },
    ],
  },
  {
    id: 'elite', name: 'Elite', ring: 'platinum', ringColor: '#4DFFD4',
    minLevel: 41, maxLevel: 50,
    tiers: [
      { id: 'elite-41-43', label: '41–43', min: 41, max: 43, art: '/badges/elite41-43.webp' },
      { id: 'elite-44-46', label: '44–46', min: 44, max: 46, art: '/badges/elite44-46.webp' },
      { id: 'elite-47-50', label: '47–50', min: 47, max: 50, art: '/badges/elite47-50.webp' },
    ],
  },
  {
    id: 'champion', name: 'Champion', ring: 'diamond', ringColor: '#7B6FFF',
    minLevel: 51, maxLevel: 60,
    tiers: [
      { id: 'champion-51-53', label: '51–53', min: 51, max: 53, art: '/badges/champion51-53.webp' },
      { id: 'champion-54-56', label: '54–56', min: 54, max: 56, art: '/badges/champion54-56.webp' },
      { id: 'champion-57-60', label: '57–60', min: 57, max: 60, art: '/badges/champion57-60.webp' },
    ],
  },
  {
    id: 'veteran', name: 'Veteran', ring: 'ruby', ringColor: '#E0115F',
    minLevel: 61, maxLevel: 70,
    tiers: [
      { id: 'veteran-61-63', label: '61–63', min: 61, max: 63, art: '/badges/veteran61-63.webp' },
      { id: 'veteran-64-66', label: '64–66', min: 64, max: 66, art: '/badges/veteran64-66.webp' },
      { id: 'veteran-67-70', label: '67–70', min: 67, max: 70, art: '/badges/veteran67-70.webp' },
    ],
  },
  {
    id: 'legend', name: 'Legend', ring: 'emerald', ringColor: '#2EC27E',
    minLevel: 71, maxLevel: 80,
    tiers: [
      { id: 'legend-71-73', label: '71–73', min: 71, max: 73, art: '/badges/legend71-73.webp' },
      { id: 'legend-74-76', label: '74–76', min: 74, max: 76, art: '/badges/legend74-76.webp' },
      { id: 'legend-77-80', label: '77–80', min: 77, max: 80, art: '/badges/legend77-80.webp' },
    ],
  },
  {
    id: 'mythic', name: 'Mythic', ring: 'cosmic', ringColor: '#C87FFF', animated: true,
    minLevel: 81, maxLevel: 90,
    tiers: [
      { id: 'mythic-81-83', label: '81–83', min: 81, max: 83, art: '/badges/mythic81-83.webp' },
      { id: 'mythic-84-86', label: '84–86', min: 84, max: 86, art: '/badges/mythic84-86.webp' },
      { id: 'mythic-87-90', label: '87–90', min: 87, max: 90, art: '/badges/mythic87-90.webp' },
    ],
  },
  {
    // Ascendant covers L91-99; Immortal (L100) reuses the top Ascendant badge with rainbow ring.
    id: 'ascendant', name: 'Ascendant', ring: 'celestial', ringColor: '#FFB347', animated: true,
    minLevel: 91, maxLevel: 100,
    tiers: [
      { id: 'ascendant-91-93',  label: '91–93',  min: 91, max: 93, art: '/badges/ascendant91-93.webp' },
      { id: 'ascendant-94-96',  label: '94–96',  min: 94, max: 96, art: '/badges/ascendant94-96.webp' },
      { id: 'ascendant-97-100', label: '97–100', min: 97, max: 100, art: '/badges/ascendant97-100.webp' },
    ],
  },
];

// Find the rank a level belongs to.
export function getRankForLevel(level) {
  const lvl = Math.max(1, Math.min(100, level || 1));
  return BADGE_RANKS.find(r => lvl >= r.minLevel && lvl <= r.maxLevel) || BADGE_RANKS[0];
}

// Find the specific badge tier the user has just earned at this level.
export function getCurrentBadge(level) {
  const lvl = Math.max(1, Math.min(100, level || 1));
  const rank = getRankForLevel(lvl);
  return rank.tiers.find(t => lvl >= t.min && lvl <= t.max) || rank.tiers[0];
}

// Return all 3 tiers of the user's current rank, with `earned: true|false` flagged.
// Locked tiers should render as silhouettes on the public profile to drive progression.
export function getCurrentRankProgress(level) {
  const lvl = Math.max(1, Math.min(100, level || 1));
  const rank = getRankForLevel(lvl);
  return {
    rank,
    tiers: rank.tiers.map(t => ({
      ...t,
      earned: lvl >= t.min,
      isCurrent: lvl >= t.min && lvl <= t.max,
    })),
  };
}

// Return every badge the user has earned across all ranks (for a full collection view).
export function getAllEarnedBadges(level) {
  const lvl = Math.max(1, Math.min(100, level || 1));
  const out = [];
  for (const rank of BADGE_RANKS) {
    for (const tier of rank.tiers) {
      if (lvl >= tier.min) {
        out.push({ ...tier, rankId: rank.id, rankName: rank.name, ringColor: rank.ringColor });
      }
    }
  }
  return out;
}

/**
 * The small variant of a badge, for the 13px chat crest.
 *
 * ⚠ THE FULL-SIZE ART IS 1024x1024 AND AVERAGES 167 KB. Measured across all 30
 * files: 5,004 KB. A chat showing eight distinct rank bands downloaded ~1.4 MB
 * and decoded eight 1024x1024 surfaces (4 MB of RGBA each) to paint eight
 * 13-pixel icons. The 64px variants average 1.9 KB, a 98.9% reduction.
 *
 * Generated by `scripts/build-badge-sizes.mjs`, which `npm run check` verifies,
 * so a badge added without its small variant fails the build rather than
 * quietly serving a megabyte into the busiest surface in the app.
 *
 * ⚠ /prestige renders at 96px and must keep the full-size art — this is only
 * for the crest.
 */
export const smallBadgeArt = (art) =>
  (typeof art === 'string' && art.startsWith('/badges/')
    ? art.replace('/badges/', '/badges/sm/')
    : art);
