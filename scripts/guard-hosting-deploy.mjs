#!/usr/bin/env node
/**
 * BLOCKS a Firebase Hosting deploy that would break VLink.
 *
 * ## The incident this exists to prevent (2026-08-10)
 *
 * A broken build was fixed by restoring files from another branch with an
 * explicit path list. `firebase.json` was NOT in that list, so the working tree
 * kept an OLD 90-line copy from before VLink existed, while everything around
 * it came from the new world. Roughly ten `firebase deploy --only hosting` runs
 * then re-published that stale config.
 *
 * Firebase Hosting REPLACES the entire config on every deploy. There is no
 * merge. So each deploy silently deleted the `/vlink` and `/vlink/**` rewrites,
 * `/l/**`, and ~20 marketing/share routes. `vergr.app/vlink` fell through to the
 * catch-all `** -> /index.html` and served the Vergr React SPA instead of the
 * Shopify app. The Shopify reviewer saw a blank page and REJECTED the app.
 *
 * Nothing about that failure was detectable by reading a diff of firebase.json,
 * because the file was never edited. The damage came from deploying a file that
 * had not been updated. A memory note does not catch that. A guard does.
 *
 * ## What it checks
 *
 * 1. Every rewrite in REQUIRED_REWRITES is present and points at the right
 *    function. These are the routes that, if missing, silently serve the SPA to
 *    somebody expecting an app.
 * 2. The catch-all `** -> /index.html` is LAST. Firebase matches rewrites in
 *    order, so a catch-all above `/vlink` swallows it just as effectively as
 *    deleting it.
 * 3. The rewrite count has not collapsed. A config with a fraction of the
 *    expected routes is a stale file, whatever it happens to contain.
 *
 * ## How it runs
 *
 * - `hosting.predeploy` in firebase.json — fires on EVERY `firebase deploy`
 *   from this repo, whoever or whatever runs it. This is the real protection:
 *   it does not depend on an agent choosing to check.
 * - `--hook` mode, wired into .claude/settings.json as a PreToolUse hook, so an
 *   agent's deploy command is refused before the CLI is even reached.
 *
 * Exit codes: 0 pass. 1 fail (aborts firebase). 2 fail in hook mode (blocks the
 * tool call and shows the reason).
 */
import fs from 'fs';

const HOOK = process.argv.includes('--hook');

/**
 * Routes that MUST survive every deploy.
 *
 * VLink is a separately-deployed Shopify app whose public URL is
 * `https://vergr.app/vlink`. It is served by the `vlinkApp` function through
 * these rewrites and by nothing else. Losing them does not error — it serves
 * the wrong app with a 200, which is why this has to be checked rather than
 * noticed.
 */
const REQUIRED_REWRITES = [
  { source: '/vlink', functionId: 'vlinkApp', why: 'VLink Shopify app entry point (app_url in the Shopify manifest)' },
  { source: '/vlink/**', functionId: 'vlinkApp', why: 'VLink OAuth callback, webhooks and admin' },
  { source: '/l/**', functionId: 'vlinkStorefront', why: 'VLink public storefront links' },
];

/** Below this, the config is stale rather than merely edited. */
const MIN_REWRITES = 15;

const fail = (lines) => {
  const msg = [
    '',
    '  ╔════════════════════════════════════════════════════════════════╗',
    '  ║  HOSTING DEPLOY BLOCKED — this would break VLink               ║',
    '  ╚════════════════════════════════════════════════════════════════╝',
    '',
    ...lines.map((l) => '  ' + l),
    '',
    '  Firebase Hosting REPLACES the whole config on deploy. Deploying a',
    '  firebase.json without these routes takes vergr.app/vlink offline and',
    '  serves the Vergr SPA to Shopify instead. That has already caused one',
    '  app rejection.',
    '',
    '  FIX: restore the full config, then re-run.',
    '      git checkout kotlin-native -- firebase.json',
    '  Then confirm: node scripts/guard-hosting-deploy.mjs',
    '',
  ].join('\n');
  process.stderr.write(msg + '\n');
  process.exit(HOOK ? 2 : 1);
};

// ── Hook mode: only interfere with an actual hosting deploy ────────────────
if (HOOK) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let cmd = '';
  try {
    const payload = JSON.parse(raw || '{}');
    cmd = payload?.tool_input?.command || '';
  } catch { /* not JSON: fall through and allow */ }

  const isDeploy = /firebase\s+deploy/.test(cmd);
  const onlyMatch = cmd.match(/--only\s+([^\s]+)/);

  // ── SECOND VECTOR: an unscoped functions deploy would DELETE VLink ───────
  //
  // `vlinkApp` and `vlinkStorefront` are deployed in THIS Firebase project but
  // live in the VLink repo, so they are absent from this repo's `functions/`
  // source. A bare `firebase deploy` or `--only functions` makes the CLI treat
  // them as orphans and offer to delete them — and `--force` deletes them
  // without asking. That would take VLink's backend down, not merely its route.
  //
  // Whether they are insulated by being in a separate `vlink` codebase could
  // not be verified from this machine, so the deploy is scoped instead. Naming
  // functions explicitly is what every deploy here already does, so this costs
  // nothing and removes the question.
  if (isDeploy) {
    const only = onlyMatch?.[1] || '';
    const bareDeploy = !onlyMatch;
    const unscopedFunctions = /(^|,)functions(,|$)/.test(only); // 'functions' with no :name

    if (bareDeploy) {
      fail([
        'Bare `firebase deploy` is not allowed in this repo.',
        '',
        'It deploys EVERYTHING — hosting, rules, and every function — and will',
        'offer to delete deployed functions that are absent from this source.',
        'vlinkApp and vlinkStorefront are exactly that: deployed here, but owned',
        'by the VLink repo.',
        '',
        'Use an explicit scope, e.g.:',
        '    firebase deploy --only hosting',
        '    firebase deploy --only functions:getAccess,functions:purchaseAccess',
      ]);
    }
    if (unscopedFunctions) {
      fail([
        '`--only functions` without naming functions is not allowed here.',
        '',
        'It prunes deployed functions missing from this source, which includes',
        'vlinkApp and vlinkStorefront (owned by the VLink repo). Deleting those',
        'takes the Shopify app offline.',
        '',
        'Name them:  firebase deploy --only functions:name1,functions:name2',
      ]);
    }
  }

  // Deleting a VLink function by name, from this repo, is always a mistake.
  if (/firebase\s+functions:delete/.test(cmd) && /vlink|shopify/i.test(cmd)) {
    fail([
      'Refusing to delete a VLink / Shopify function from this repo.',
      'Those belong to the VLink repo and back the live Shopify app.',
    ]);
  }

  // Everything below only guards HOSTING.
  const touchesHosting = !onlyMatch || /(^|,)hosting(:|,|$)/.test(onlyMatch[1]);
  if (!isDeploy || !touchesHosting) process.exit(0);
}

// ── The checks ─────────────────────────────────────────────────────────────
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
} catch (e) {
  fail([`firebase.json could not be read or parsed: ${e.message}`]);
}

const hosting = Array.isArray(cfg.hosting) ? cfg.hosting[0] : cfg.hosting;
const rewrites = hosting?.rewrites || [];
const problems = [];

for (const req of REQUIRED_REWRITES) {
  const hit = rewrites.find((r) => r.source === req.source);
  if (!hit) {
    problems.push(`MISSING rewrite  ${req.source}  ->  ${req.functionId}`);
    problems.push(`                 ${req.why}`);
  } else if (hit.function?.functionId !== req.functionId) {
    problems.push(`WRONG target     ${req.source}  ->  ${hit.function?.functionId || hit.destination || '?'}`);
    problems.push(`                 expected ${req.functionId} — ${req.why}`);
  }
}

// Order matters as much as presence.
const catchAll = rewrites.findIndex((r) => r.source === '**');
if (catchAll !== -1 && catchAll !== rewrites.length - 1) {
  problems.push(`CATCH-ALL '**' is at position ${catchAll + 1} of ${rewrites.length}, not last.`);
  problems.push('                 Firebase matches in order, so everything below it is dead.');
}

if (rewrites.length < MIN_REWRITES) {
  problems.push(`ONLY ${rewrites.length} rewrites (expected >= ${MIN_REWRITES}).`);
  problems.push('                 This looks like a stale firebase.json from an older branch.');
}

if (problems.length) fail(problems);

if (!HOOK) {
  process.stdout.write(`guard-hosting-deploy: OK — ${rewrites.length} rewrites, VLink routes intact\n`);
}
process.exit(0);
