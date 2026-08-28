// Phase B guard for the <UserName> migration.
//
// Without this, the next screen someone writes renders a name directly, misses
// every name effect, and nothing notices — which is the exact situation that
// made the migration necessary in the first place (723 sites, no component).
//
// Modelled on scripts/vp-mirror-check.mjs: every assertion is named, --list
// prints them all so a green run can be shown to be real rather than vacuous,
// and it is negative-tested (see the bottom of this comment).
//
// TWO CLASSES OF FAILURE
//
//   1. CORRUPTION — `$<UserName` or `=<UserName`. Always a bug, anywhere in the
//      tree. See docs/effects/01-username-component.md: the codemod shipped 36
//      of these and `npm run build` was green every time, because JSX legally
//      accepts an element as an attribute value. This check is the only thing
//      that catches it.
//
//   2. RAW RENDER — a name interpolated straight into JSX child position in a
//      file listed as MUST-adopt. Those files are the ones whose names carry
//      cosmetics; a raw render there is a name that silently misses them.
//
// WHAT IS DELIBERATELY NOT CHECKED
//
// Strings. `alt={u.displayName}`, `name={u.displayName}` passed to a child that
// expects text, and anything inside a template literal are all CORRECT as
// strings and must never migrate. So is a name that gets .toUpperCase()d, and a
// nickname, which is your private label for someone and must not inherit their
// cosmetics.
//
//   node scripts/username-render-check.mjs          check
//   node scripts/username-render-check.mjs --list   print every assertion
//
// NEGATIVE TEST (run it after any change to this file):
//   put `{author.displayName}` back into src/components/PostCard.jsx and this
//   must FAIL. A check that cannot fail is worse than no check.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LIST = process.argv.includes('--list');
const norm = (p) => p.split('\\').join('/');

// docs/effects/01-username-component.md §3.1 — surfaces that show one person's
// identity to another person, so their names carry cosmetics.
const MUST_ADOPT = [
  'components/PostCard.jsx',
  'components/streams/ChatPanel.jsx',
  'components/streams/JoinAnnouncer.jsx',
  'components/streams/MobileLiveViewer.jsx',
  'components/MessagesListPanel.jsx',
  'components/UserPickerSheet.jsx',
  'components/RightSidebarPanel.jsx',
  'components/DiscoveryStrip.jsx',
  'components/SuggestionsCarousel.jsx',
  'components/MobileNavDrawer.jsx',
  'components/SendCoinsModal.jsx',
  'components/profile/profilePolish.jsx',
  'screens/profile/ProfileScreen.jsx',
  'screens/profile/PublicProfileScreen.jsx',
  'screens/profile/native/NativeProfileScreens.jsx',
  'screens/profile/FollowListScreen.jsx',
  'screens/messages/ChatDetailScreen.jsx',
  'screens/messages/FriendsScreen.jsx',
  'screens/messages/native/NativeFriendsScreen.jsx',
  'screens/search/SearchResultsAllScreen.jsx',
  'screens/explore/ExploreScreen.jsx',
  'screens/explore/native/NativeDiscoveryScreens.jsx',
  'screens/home/native/NativeHomeScreens.jsx',
  'screens/shorts/ShortsDeck.jsx',
  'screens/viewer/ClipViewerScreen.jsx',
  'screens/streams/ViewerStreamScreen.jsx',
  'screens/squads/SquadMembersScreen.jsx',
  'screens/calls/CallsScreen.jsx',
];

const walk = (d, o = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (/\.jsx$/.test(p)) o.push(p);
  }
  return o;
};

const results = [];
const assert = (name, ok, detail) => { results.push({ name, ok, detail }); };

// ── 1. Corruption, tree-wide ────────────────────────────────────────
for (const f of walk('src')) {
  const rel = norm(relative('src', f));
  const src = readFileSync(f, 'utf8');
  const hits = [];
  src.split('\n').forEach((l, i) => {
    if (/[$=]<UserName/.test(l)) hits.push(i + 1);
  });
  if (hits.length) {
    assert(`no <UserName> in a string or attribute position — ${rel}`, false,
      `lines ${hits.join(', ')}: a <UserName> element preceded by $ or = is inside a template literal or an attribute, where a STRING is required`);
  }
}
assert('no <UserName> in a string or attribute position — tree-wide',
  !results.some((r) => !r.ok), 'scanned every .jsx under src/');

// ── 2. Raw name renders in MUST-adopt files ─────────────────────────
// JSX CHILD position only: preceded by `>` (possibly with whitespace) or by the
// start of an expression container's line. Attributes and template literals are
// excluded by construction, because those are correct as strings.
const RAW = />\s*\{\s*[A-Za-z_$][\w$]*\??\.(displayName|username)\s*[|}]/;

for (const rel of MUST_ADOPT) {
  const p = join('src', rel);
  let src;
  try { src = readFileSync(p, 'utf8'); } catch {
    assert(`MUST-adopt file exists — ${rel}`, false, 'listed in the inventory but not on disk; fix the list or the path');
    continue;
  }
  const hits = [];
  src.split('\n').forEach((l, i) => { if (RAW.test(l)) hits.push(i + 1); });
  assert(`renders names via <UserName> — ${rel}`, hits.length === 0,
    hits.length ? `lines ${hits.join(', ')} interpolate a name directly in JSX child position` : `${(src.match(/<UserName/g) || []).length} <UserName> instance(s)`);
}

// ── 3. The component itself still applies the mask ──────────────────
const comp = readFileSync('src/components/UserName.jsx', 'utf8');
assert('UserName applies the Vanguard mask', /applyVanguardMask/.test(comp),
  'the mask MUST win over every cosmetic; without it a masked persona leaks identity');
assert('UserName honours the masked escape hatch', /masked \? user :/.test(comp),
  'call sites pass `masked` when the object is already masked, to avoid double-applying');

const failed = results.filter((r) => !r.ok);
if (LIST) for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\nusername-render-check: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const r of failed) console.error(`FAIL ${r.name}\n     ${r.detail}`);
  process.exit(1);
}
