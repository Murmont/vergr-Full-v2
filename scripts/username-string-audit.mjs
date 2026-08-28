// Classifies the remaining STRING name sites by KIND.
//
// The point: "renders a name string" is NOT the same as "should become
// <UserName>". An alt attribute, a `name={}` prop passed to a child, a template
// literal in a message body and a window.confirm all need PLAIN TEXT. Putting a
// React element there would either render "[object Object]" or break the child.
//
// Only a VISIBLE RENDER — a name shown as page content — should migrate.
//   node scripts/username-string-audit.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const norm = (p) => p.split('\\').join('/');
const SKIP = /(screens\/admin|screens\/auth|screens\/onboarding|screens\/settings|screens\/marketing|tournament|vanguard|streamPreview)/i;

const walk = (d, o = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (/\.jsx$/.test(p)) o.push(p);
  }
  return o;
};

// ⚠ A bare `{name}` is NOT enough to identify a person's name. Verified false
// positives from the first pass: Icon.jsx renders an ICON ligature, EmojiPicker
// uses it as a React `key`, and CreateSquadScreen / CreateGroupChatScreen /
// CreateEventScreen use it as a form `value` for the SQUAD / GROUP / EVENT
// name. AuthContext passes it to a Firebase call.
//
// So: the match must be in a JSX TEXT POSITION (between > and <), and lines
// that are clearly an attribute or a key are excluded outright.
const RE = /(?:>\s*)\{\s*(displayName|senderName|authorName|otherName|name)\s*\}|\{\s*(displayName|senderName|authorName|otherName)\s*\}/;
const NOT_A_RENDER = /(value|key|ref|id|htmlFor|onChange)=\{/;
const kinds = { render: [], attr: [], prop: [], text: [] };

for (const f of walk('src')) {
  if (SKIP.test(norm(f))) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (!RE.test(l) || NOT_A_RENDER.test(l)) return;
    const loc = `${norm(relative('src', f))}:${i + 1}`;
    if (/(alt|title|placeholder|aria-label)=\{/.test(l)) kinds.attr.push(loc);
    else if (/[A-Za-z]+[Nn]ame=\{/.test(l)) kinds.prop.push(loc);
    else if (/`|window\.confirm|text:\s|^\s*\/\//.test(l)) kinds.text.push(loc);
    else kinds.render.push(loc);
  });
}

console.log('STRING sites by kind');
console.log('  VISIBLE RENDER -> migrate  ', kinds.render.length);
console.log('  alt/title attribute        ', kinds.attr.length, '  must stay a string');
console.log('  name={} prop to a child    ', kinds.prop.length, '  must stay a string');
console.log('  template / confirm / text  ', kinds.text.length, '  must stay a string');
console.log('\nVISIBLE RENDER sites:');
for (const x of kinds.render) console.log('  ', x);
