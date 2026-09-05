// Solid surface tokens for the live-stream state layer.
//
// MOVED OUT OF THE ADMIN PREVIEW so production and the simulator cannot drift.
// The preview owned these while the real screens had nothing, which is how the
// preview ended up ahead of production on a dozen states.
//
// SOLID VALUES, NOT WASHES. Founder, 2026-09-02, having said it before:
// "I FUCKING HATE THE SEMI TRANSPARENT PILL BACKGROUNDS IT IS GROSS STOP USING
// IT". A low-alpha white on a dark page is not a surface: it has no value of its
// own, it picks up whatever frame is behind it, and over live video it changes
// from shot to shot. Every one of these is opaque.
export const S = {
  chip: '#191527',         // a control on a dark panel
  chipOnVideo: '#100C1C',  // a control floating over gameplay, must not be a wash
  row: '#1A1A2A',          // a raised row inside a panel
  track: '#2A2A38',        // an OFF switch track
  field: '#191527',        // a text input; the BORDER is what says "type here"
  panel: '#12101E',        // a panel over video (opaque)
  danger: '#F04060',
  dangerDim: '#3A1420',    // an armed danger control, solid
};

export const C = {
  // NO `border` TOKEN HERE ON PURPOSE. A spare hairline colour sitting in a
  // palette is how border soup grows back.
  card: '#1A1A2A',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', amber: '#f59e0b',
  // TWO REDS, AND THIS IS NOT A PALETTE PREFERENCE. #ef4444 measured 3.76:1
  // under white as a FILL and 4.29:1 as TEXT on a dark panel: it fails both
  // floors, in opposite directions, so no single value fixes it. red is for
  // type on dark; redFill is for a fill that carries white type.
  red: '#ff6b6b', redFill: '#c62828',
};
