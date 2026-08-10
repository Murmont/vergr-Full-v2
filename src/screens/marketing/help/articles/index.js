// All help-center article bodies, merged from the per-category folders.
// Each category folder has its own index.js listing that category's article files.
// helpContent.jsx imports this as the BODIES map (slug -> { summary, updated, body }).
import c0 from './account/index.js';
import c1 from './apps/index.js';
import c2 from './buying-coins/index.js';
import c4 from './converting/index.js';
import c5 from './creator-studio/index.js';
import c6 from './earning/index.js';
import c7 from './economy/index.js';
import c8 from './getting-started/index.js';
import cFeed from './feed-discovery/index.js';
import cClips from './clips-shorts/index.js';
import cNotif from './notifications/index.js';
import cStatus from './status/index.js';
import cSettings from './settings/index.js';
import c9 from './memberships/index.js';
import c10 from './messaging/index.js';
import c11 from './posting/index.js';
import c12 from './profile/index.js';
import c13 from './referrals/index.js';
import c14 from './safety/index.js';
import c15 from './security-privacy/index.js';
import c16 from './squads/index.js';
import c17 from './streaming/index.js';
import c18 from './tips/index.js';
import c19 from './tournaments/index.js';
import c20 from './trust/index.js';
import c21 from './twitch/index.js';
import c22 from './vanguard/index.js';
import c23 from './vergrme/index.js';
import c24 from './verification/index.js';
import c25 from './vp-ranks/index.js';
import c26 from './wallet/index.js';
import c27 from './watching/index.js';
import c28 from './withdrawing/index.js';
import cTrouble from './troubleshooting/index.js';

const BODIES = {
  ...c0,
  ...c1,
  ...c2,
  ...c4,
  ...c5,
  ...c6,
  ...c7,
  ...c8,
  ...c9,
  ...c10,
  ...c11,
  ...c12,
  ...c13,
  ...c14,
  ...c15,
  ...c16,
  ...c17,
  ...c18,
  ...c19,
  ...c20,
  ...c21,
  ...c22,
  ...c23,
  ...c24,
  ...c25,
  ...c26,
  ...c27,
  ...c28,
  ...cFeed,
  ...cClips,
  ...cNotif,
  ...cStatus,
  ...cSettings,
  ...cTrouble,
};

export default BODIES;
