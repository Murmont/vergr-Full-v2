import fs from 'fs';
const out = JSON.parse(fs.readFileSync('scripts/_help_status.json', 'utf8'));
const label = {
  'getting-started':'Getting started','account':'Account & sign up','profile':'Your profile',
  'vergrme':'Vergr.me','verification':'Verification & KYC','security-privacy':'Security & privacy',
  'economy':'Coins, Gems & VP','buying-coins':'Buying Coins','wallet':'Wallet',
  'converting':'Converting Coins to Gems','withdrawing':'Withdrawing & payouts','earning':'Making money',
  'tips':'Tips','vp-ranks':'VP & ranks','posting':'Posting & content','feed-discovery':'Feed & discovery',
  'clips-shorts':'Clips & Shorts','streaming':'Going live','watching':'Watching streams',
  'twitch':'Twitch & multi-streaming','tournaments':'Tournaments','coaching':'Coaching','squads':'Squads',
  'creator-studio':'Creator Studio','memberships':'Plans & memberships','messaging':'Messaging & calls',
  'notifications':'Notifications','status':'Status','vanguard':'The Vanguard','safety':'Safety & reporting',
  'referrals':'Referrals','apps':'Apps & install','settings':'Settings','troubleshooting':'Troubleshooting',
  'trust':'Trust, fees & legality',
};
let done = 0, rem = 0;
const lines = [];
lines.push('## Completion status (updated 2026-06-06)');
lines.push('');
lines.push('Auto-generated from the published article files. `[x]` = written + live, `[ ]` = not yet written.');
lines.push('Regenerate with `node scripts/helpStatus.mjs && node scripts/helpStatusMd.mjs`.');
lines.push('');
for (const o of out) {
  done += o.done.length; rem += o.rem.length;
  lines.push(`### ${label[o.c] || o.c}  (${o.done.length}/${o.done.length + o.rem.length} done)`);
  for (const t of o.done) lines.push(`- [x] ${t}`);
  for (const t of o.rem) lines.push(`- [ ] ${t}`);
  lines.push('');
}
const header = `**Progress: ${done} of ${done + rem} articles published.**\n\n`;
fs.writeFileSync('scripts/_help_status.md', header + lines.join('\n'));
console.log(`wrote scripts/_help_status.md (${done}/${done + rem})`);
