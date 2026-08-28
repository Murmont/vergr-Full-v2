// Migrates direct name renders to <UserName>. Dry-run by default:
//   node scripts/username-codemod.mjs          list what would change
//   node scripts/username-codemod.mjs --apply  write it
//
// ── WHY A CODEMOD ───────────────────────────────────────────────────
// 273 sites across 102 files. Hand-editing that many is slower AND more
// error-prone than one transform that is reviewed once and applied uniformly.
//
// ── THE SAFETY RULE: `masked` IS ALWAYS PASSED ──────────────────────
// <UserName masked> means "this object is already in the form you should
// render" and skips applyVanguardMask. Passing it EVERYWHERE preserves each
// call site's existing behaviour exactly:
//   - sites that already masked (PostCard's maskedAuthor) keep their mask
//   - sites that never masked keep not masking
// Re-masking here would silently CHANGE what some screens show, and Phase A
// must be a pure refactor with zero visual change. Which surfaces should mask
// is a separate decision, made per surface, after this lands.
//
// Only the exact shapes below are touched. Anything else is left for a human —
// a partial migration is fine, a wrong one is not.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = 'src';
const norm = (p) => p.split('\\').join('/');
const SKIP = /(screens\/admin|screens\/auth|screens\/onboarding|screens\/settings|screens\/marketing|tournament|vanguard|streamPreview)/i;

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx$/.test(p)) out.push(p);
  }
  return out;
};

// An identifier chain like `u`, `user`, `masked`, `post.author`, `it?.author`.
const OBJ = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;

// ⚠⚠ THE MOST IMPORTANT LINE IN THIS FILE. Do not remove it.
//
// A `{name}` interpolation is only replaceable when it sits in JSX CHILD
// position. The identical text in two other places needs a STRING and silently
// accepts an element instead:
//
//   `Invited ${u.displayName}`   template literal — the `$` is left stranded and
//                                the element text becomes part of the string, so
//                                a toast reads "Invited $<UserName ... />"
//   alt={u.displayName}          JSX attribute — JSX legally permits an element
//                                as an attribute value, so this COMPILES. alt
//                                becomes [object Object]; `value=` breaks a
//                                controlled input; and CoinCard's `otherName`
//                                calls .toUpperCase() on it and throws.
//
// Both were shipped: 36 sites across two runs, and `npm run build` was green
// every time. A passing build proves the syntax parsed, never that the app
// works. scripts/username-repair.mjs undid it.
const CTX = String.raw`(?<![$=])`;

/** Build the replacement, quoting the fallback correctly. */
const tag = (obj, fallback, handle) =>
  `<UserName user={${obj}} masked${handle ? ' handle' : ''}` +
  (fallback ? ` fallback=${/^['"]/.test(fallback) ? `{${fallback}}` : `{${fallback}}`}` : '') +
  ` />`;

const PATTERNS = [
  // {a.displayName || a.username || 'User'}   and the ?. variants
  {
    re: new RegExp(String.raw`${CTX}\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\|\|\s*('[^']*'|"[^"]*")\s*\}`, 'g'),
    to: (_m, obj, fb) => tag(obj, fb, false),
  },
  // {a.displayName || a.username}
  {
    re: new RegExp(String.raw`${CTX}\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\}`, 'g'),
    to: (_m, obj) => tag(obj, null, false),
  },
  // {a.displayName || 'User'}
  {
    re: new RegExp(String.raw`${CTX}\{\s*(${OBJ})\??\.displayName\s*\|\|\s*('[^']*'|"[^"]*")\s*\}`, 'g'),
    to: (_m, obj, fb) => tag(obj, fb, false),
  },
  // {a.displayName}
  {
    re: new RegExp(String.raw`${CTX}\{\s*(${OBJ})\??\.displayName\s*\}`, 'g'),
    to: (_m, obj) => tag(obj, null, false),
  },

  // ── HANDLE SHAPES ─────────────────────────────────────────────────
  // The dominant remaining shape, 37 sites: a LITERAL `@` sitting in JSX text
  // immediately before the interpolation. `handle` mode re-adds the @, so the
  // literal one MUST be consumed or every handle renders "@@name".
  //
  // ⚠ These deliberately match `@{` and never `@${`, which is what keeps them
  // out of template literals. Every toast and every navigate(`/u/${...}`) in
  // the codebase uses `@${` or `/${`, so none of them can be hit. Verified: the
  // only non-@ `{x.username}` sites left are an alt=, a value= and a username=
  // prop, all of which must stay strings and none of which this can reach.

  // @{a.username || 'you'}  — a STRING LITERAL fallback only. An expression
  // fallback (uid.slice(0,6)) is left for a human; a partial migration is fine,
  // a wrong one is not.
  {
    re: new RegExp(String.raw`@\{\s*(${OBJ})\??\.username\s*\|\|\s*('[^']*'|"[^"]*")\s*\}`, 'g'),
    to: (_m, obj, fb) => tag(obj, fb, true),
  },
  // @{a.username}
  {
    re: new RegExp(String.raw`@\{\s*(${OBJ})\??\.username\s*\}`, 'g'),
    to: (_m, obj) => tag(obj, null, true),
  },

  // ── EXPRESSION FALLBACKS ──────────────────────────────────────────
  // {a?.displayName || a?.username || uid.slice(0, 6)} — the same ladder the
  // literal-fallback patterns above handle, but ending in an EXPRESSION rather
  // than a quoted string. `[^}]+?` is what keeps this honest: it cannot span a
  // nested object literal, so a fallback containing `}` is left for a human.
  //
  // ⚠ `(?<!=)` is NOT decoration. Without it this matched
  //   hostName={profile?.displayName || profile?.username || streamDoc.hostUsername}
  // in BroadcasterScreen (x2) and NativeBroadcasterScreen, replacing a STRING
  // prop that StreamShareSheet renders into a share title with a React element.
  // Three sites, silently broken, and the build would still have passed.
  {
    re: new RegExp(String.raw`${CTX}\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\|\|\s*([^}]+?)\s*\}`, 'g'),
    to: (_m, obj, fb) => tag(obj, fb, false),
  },
  // @{a.username || uid.slice(0, 6)}
  {
    re: new RegExp(String.raw`@\{\s*(${OBJ})\??\.username\s*\|\|\s*([^}]+?)\s*\}`, 'g'),
    to: (_m, obj, fb) => tag(obj, fb, true),
  },
];

const importFor = (file) => {
  // src/components/X.jsx -> './UserName'; deeper -> ../../components/UserName
  const rel = norm(relative(dirname(file), join(ROOT, 'components')));
  const base = rel === '' ? '.' : rel;
  return `${base.startsWith('.') ? base : './' + base}/UserName`.replace('//', '/');
};

let files = 0, sites = 0;
for (const f of walk(ROOT)) {
  if (SKIP.test(norm(f))) continue;
  if (/UserName\.jsx$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  let out = src;
  let n = 0;
  for (const { re, to } of PATTERNS) {
    out = out.replace(re, (...a) => { n++; return to(...a); });
  }
  if (!n) continue;

  // Ensure the import exists, placed after the last existing import line.
  if (!/from '[^']*UserName'/.test(out)) {
    const lines = out.split('\n');
    // ⚠ Match the line that COMPLETES an import, not one that starts it. The
    // first version tested /^import / and so matched the opening line of a
    // MULTI-LINE import, inserting the new import INSIDE it and producing
    // "Expected as but found UserName". Two files hit it.
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import .*from\s+['"][^'"]+['"];?\s*$/.test(lines[i])
       || /^\}\s*from\s+['"][^'"]+['"];?\s*$/.test(lines[i])) last = i;
    }
    lines.splice(last + 1, 0, `import UserName from '${importFor(f)}';`);
    out = lines.join('\n');
  }

  files++; sites += n;
  console.log(String(n).padStart(3), norm(relative(ROOT, f)));
  if (APPLY) writeFileSync(f, out);
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${sites} sites in ${files} files`);
if (!APPLY) console.log('re-run with --apply to write');
