// Avatars for the simulator cast.
//
// ⚠ THE SIDE RAIL EXISTS TO POPULATE THINGS SO NOTHING RENDERS EMPTY. Founder,
// 2026-08-31. An empty avatar circle is exactly the kind of hole that makes a
// capture unusable: chat rows, the supporters cluster, the profile sheet and the
// squad grid all draw a person, and all of them were drawing a grey disc.
//
// ⚠ NO REAL PEOPLE, NO STOCK PHOTOS, NO GENERATED FACES. Every capture from this
// screen is published material (Play store listings), so a real face is a
// likeness we have no release for and a generated one still reads as a claim
// about a user who does not exist. These are deterministic identicons: a
// two-stop gradient plus the initial, rendered as an inline SVG data URI. Zero
// requests, zero files, and legible at the 18px the chat rows draw them at.
//
// ⚠ DETERMINISTIC BY UID, so the same person keeps the same face between
// renders. A random colour per mount would make two screenshots of the same
// stream disagree with each other.

const PALETTE = [
  ['#7B6FFF', '#B44FFF'],
  ['#FF4D6A', '#FF8A5B'],
  ['#F5C542', '#FF9F45'],
  ['#3D7FFF', '#4DD4FF'],
  ['#C87FFF', '#FF6FB5'],
  ['#2BC48A', '#4DFFC3'],
  ['#FF6B6B', '#C44FFF'],
  ['#5B8CFF', '#8F6FFF'],
];

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * A data-URI avatar for a cast member. Safe to hand straight to <UserAvatar
 * src>, which renders an <img>.
 */
export function faceFor(uid = 'x', name = '?') {
  const [a, b] = PALETTE[hash(uid) % PALETTE.length];
  const initial = (name.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();
  const svg = [
    "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>",
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>",
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>`,
    '</linearGradient></defs>',
    "<rect width='96' height='96' rx='48' fill='url(#g)'/>",
    "<text x='48' y='62' font-family='Syne, DM Sans, sans-serif' font-size='42'",
    " font-weight='800' fill='rgba(255,255,255,0.92)' text-anchor='middle'>",
    initial,
    '</text></svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
