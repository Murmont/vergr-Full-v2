// docs/effects/04 §5: prove every name colour is legible, by MEASUREMENT.
//
// A name colour is free (eyedropper, hex, anything), so #000000 on a near-black
// surface is one tap away. `ensureContrast` lifts a low-contrast pick to WCAG
// 4.5:1 rather than overriding it. This asserts that it actually does, for every
// preset accent AND for the pathological cases, on every surface a name sits on.
//
// ⚠ THIS IS ALSO THE NEGATIVE TEST FOR `inkFor`. docs/effects/04 originally said
// to reuse `inkFor()` from profileThemes.js. It only ever DARKENS, which is right
// for dark ink on a light surface and catastrophic here: on #0B0B14 it would
// drive a dim accent toward black and render the name invisible. The rows below
// would fail if anyone swapped it back in.
//
//   node scripts/name-contrast-check.mjs
//   node scripts/name-contrast-check.mjs --list
import { PROFILE_ACCENTS } from '../src/utils/rankUnlocks.js';
import { ensureContrast, contrastRatio } from '../src/utils/color.js';

const LIST = process.argv.includes('--list');
const TARGET = 4.5;

// Every surface a name is rendered on, from SURFACE_HEX in UserName.jsx.
const SURFACES = [
  ['chat / feed row', '#14141F'],
  ['profile page',    '#0B0B14'],
];

// Deliberately awful picks a user can make in two taps with the eyedropper.
const PATHOLOGICAL = [
  ['pure black',   '#000000'],
  ['near-black',   '#0a0a12'],
  ['deep navy',    '#101028'],
  ['dark violet',  '#2a0b4d'],
  ['mid grey',     '#555a63'],
];

const rows = [];
for (const [sName, sHex] of SURFACES) {
  for (const a of [...PROFILE_ACCENTS.map((x) => [x.name, x.color]), ...PATHOLOGICAL]) {
    const [name, hex] = a;
    const fixed = ensureContrast(hex, sHex, TARGET);
    const before = contrastRatio(hex, sHex);
    const after = contrastRatio(fixed, sHex);
    rows.push({
      label: `${name} on ${sName}`,
      ok: after >= TARGET - 0.01,
      detail: `${hex} -> ${fixed}  ${before.toFixed(2)}:1 -> ${after.toFixed(2)}:1`,
    });
  }
}

const failed = rows.filter((r) => !r.ok);
if (LIST) for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label.padEnd(34)} ${r.detail}`);
console.log(`\nname-contrast-check: ${rows.length - failed.length}/${rows.length} meet ${TARGET}:1`);
if (failed.length) {
  for (const r of failed) console.error(`FAIL ${r.label}  ${r.detail}`);
  process.exit(1);
}
