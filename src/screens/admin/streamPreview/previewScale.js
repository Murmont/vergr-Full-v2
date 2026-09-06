// The stream surfaces' type, radius, spacing and motion scales.
//
// ⚠⚠ WHY THIS EXISTS. Measured across the preview and the stream components on
// 2026-09-05: **23 distinct font sizes** in half-point steps from 8.5 to 24,
// **19 distinct border radii**, and **13 distinct gaps** covering nearly every
// integer from 2 to 14. That is the single biggest reason the surfaces read
// eyeballed rather than designed, and it is the thing the research is bluntest
// about: values that are almost-but-not-quite the same are what separates cheap
// from considered, and typography carries more of that impression than any
// other single element.
//
// For contrast, Twitch publishes SIX type roles, FOUR radii and a 4px spacing
// scale, and holds to them across the whole product.
//
// ⚠ THE STEPS COME FROM WHAT IS ALREADY USED, NOT FROM A RATIO I LIKED. The
// frequency count was 13(105) 12(83) 11(74) 14(47) for type and 8(102) 6(68)
// 10(49) 4(29) for gaps, so those peaks ARE the design; what got removed is the
// half-points and the near-duplicates sitting one pixel either side of them.
// Snapping to a ratio instead would have moved hundreds of call sites for no
// gain and broken the dense chat rows this app actually needs.

// Type. Eight steps, all whole numbers, no half-points. Adjacent 1px steps
// survive only in the 11-14 body band, where a live chat genuinely uses them.
export const TYPE = {
  micro: 9,     // pill labels: LIVE, SUB, MOD
  caption: 11,  // metadata under a name
  small: 12,    // secondary body
  body: 13,     // the workhorse: chat rows, sheet copy
  strong: 14,   // buttons, emphasised body
  subhead: 16,  // section titles
  title: 20,    // sheet and card titles
  display: 24,  // the one big number or name on a surface
};

// Radius. 22 and 28 are CONTAINER-ONLY and both are spec'd rather than chosen:
// 28 is the Material 3 modal bottom-sheet top radius, 22 is the centred modal
// measured off the founder's own tip-sheet mockup.
export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  modal: 22,
  sheet: 28,
  pill: 999,
};

// Spacing. 2 survives as a hairline gap (a value and its unit); everything else
// is the 4/8/12/16 rhythm.
export const SPACE = { hair: 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16 };

// Motion, taken from Twitch's published tokens because ours were per-call-site.
export const MOTION = {
  fast: '120ms',
  standard: '200ms',
  slow: '320ms',
  enter: 'cubic-bezier(0.2, 0.6, 0.25, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
};

// The allowed values, for the guard. A literal outside these is drift.
export const TYPE_STEPS = Object.values(TYPE);
export const RADIUS_STEPS = Object.values(RADIUS);
export const SPACE_STEPS = Object.values(SPACE);
