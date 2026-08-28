// Enumerates JSX sites that render a person's name, so the <UserName> migration
// works from a list instead of from memory. Classifies each as:
//   OBJECT  — renders user.displayName / masked.displayName directly. Mechanical.
//   STRING  — renders a pre-resolved local string. Needs the data flow changed.
// Skips the MUST-NOT surfaces (admin, auth, onboarding, settings, marketing).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
// Path separators differ per platform; normalise before testing or the skip
// silently matches nothing on Windows and admin screens leak into the list.
const norm = (p) => p.split('\\').join('/');
// MUST-NOT surfaces from docs/effects/01-username-component.md §3.2, plus the
// retired tournament screens. A moderator must see the plain true name, forms
// show your own name, and marketing pages are static.
const SKIP = /(screens\/admin|screens\/auth|screens\/onboarding|screens\/settings|screens\/marketing|tournament|vanguard|streamPreview)/i;

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx$/.test(p)) out.push(p);
  }
  return out;
};

// A name rendered straight off an object — the mechanical case.
const OBJECT_RE = /\{\s*[a-zA-Z_$][\w$]*(?:\?)?\.(?:displayName|username)\b[^}]*\}/g;
// A bare local identifier that is clearly a name — needs the data flow changed.
const STRING_RE = /\{\s*(?:displayName|name|senderName|authorName|otherName)\s*\}/g;

const rows = [];
for (const f of walk(ROOT)) {
  if (SKIP.test(norm(f))) continue;
  const src = readFileSync(f, 'utf8');
  const obj = (src.match(OBJECT_RE) || []).length;
  const str = (src.match(STRING_RE) || []).length;
  const done = (src.match(/<UserName/g) || []).length;
  if (obj + str + done === 0) continue;
  rows.push({ f: relative(ROOT, f), obj, str, done });
}
rows.sort((a, b) => (b.obj + b.str) - (a.obj + a.str));

let to = 0, ds = 0;
for (const r of rows) { to += r.obj + r.str; ds += r.done; }
console.log(`files ${rows.length} | remaining sites ${to} | already migrated ${ds}\n`);
console.log('OBJ STR DONE  FILE');
for (const r of rows) {
  console.log(String(r.obj).padStart(3), String(r.str).padStart(3), String(r.done).padStart(4), ' ', r.f);
}
