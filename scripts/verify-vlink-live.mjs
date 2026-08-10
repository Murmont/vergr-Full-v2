#!/usr/bin/env node
/**
 * Confirms VLink is actually alive AFTER a hosting deploy.
 *
 * `guard-hosting-deploy.mjs` checks the config before it ships. This checks the
 * result, because the failure mode that caused the 2026-08-10 Shopify rejection
 * was a **200 with the wrong content**: `vergr.app/vlink` fell through the
 * catch-all and served the Vergr React SPA. Nothing errored. Nothing logged.
 * The only way to see it was to look at the bytes.
 *
 * A correct response here is the `vlinkApp` function refusing a request with no
 * shop parameter, i.e. `400 Missing or invalid shop parameter`. An HTML document
 * containing the SPA shell means the rewrite is gone again.
 *
 * Runs as `hosting.postdeploy`. It NEVER fails the deploy — the deploy has
 * already happened by then, and exiting non-zero would only add noise. It shouts.
 */
const URL_TO_CHECK = 'https://vergr.app/vlink';
const TIMEOUT_MS = 15000;

// Hosting takes a moment to propagate the new config.
await new Promise((r) => setTimeout(r, 4000));

const shout = (lines) => {
  process.stderr.write([
    '',
    '  ****************************************************************',
    '  *  VLINK MAY BE DOWN — CHECK BEFORE TELLING SHOPIFY ANYTHING   *',
    '  ****************************************************************',
    '',
    ...lines.map((l) => '  ' + l),
    '',
    '  Expected: 400 "Missing or invalid shop parameter" from vlinkApp.',
    '  If you got an HTML page, the /vlink rewrite is missing again:',
    '      git checkout kotlin-native -- firebase.json && firebase deploy --only hosting',
    '',
  ].join('\n') + '\n');
};

try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const res = await fetch(URL_TO_CHECK, { signal: ctrl.signal, redirect: 'manual' });
  clearTimeout(t);

  const body = (await res.text()).slice(0, 400);
  // The tell: the SPA shell. If this string is present, we are serving Vergr
  // where VLink should be.
  const isSpa = /<!DOCTYPE html>/i.test(body) && /<div id="root"|<html lang="en" class="dark"/i.test(body);

  if (isSpa) {
    shout([
      `${URL_TO_CHECK} returned ${res.status} and the VERGR SPA.`,
      'Shopify will render this as a BLANK PAGE and reject the app.',
    ]);
  } else {
    process.stdout.write(`verify-vlink-live: OK — /vlink served by vlinkApp (${res.status})\n`);
  }
} catch (err) {
  shout([`Could not reach ${URL_TO_CHECK}: ${err.message}`, 'Verify by hand before assuming it is fine.']);
}
