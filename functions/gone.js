/**
 * HTTP 410 Gone for help articles removed in the revenue-share migration.
 *
 * ## Why this exists rather than a 301
 *
 * These URLs documented user-initiated withdrawal, coin-to-gem conversion and
 * whitelisted payout addresses. None of that exists: `requestWithdrawal` throws,
 * `sendGems` throws, and Vergr pays creators a revenue share on its own schedule
 * (docs/REVENUE_SHARE_PLAN.md section 1.4).
 *
 * They were briefly 301'd to the closest surviving article. That was wrong on
 * two counts, both of which matter more than the link equity it preserved:
 *
 *   1. A 301 keeps the URL permanently resolvable. "It redirects elsewhere" is a
 *      weak answer to an underwriter asking whether withdrawals were removed.
 *      410 is the auditable one: the resource is permanently gone.
 *   2. A 301 passes topical signal INTO the target, teaching search engines that
 *      the surviving earnings article is about withdrawal. That is precisely the
 *      association this migration exists to sever.
 *
 * 410 (not 404) because the removal is permanent and we want search engines to
 * drop these fast. Google treats 410 as a stronger, quicker removal signal.
 *
 * ## Why a function at all
 *
 * `firebase.json` `redirects` can only emit 3xx, and the SPA catch-all rewrite
 * (`** -> /index.html`) turns every unmatched path into HTTP 200 with the app
 * shell, which Google classes as a soft 404. A rewrite to this function, placed
 * BEFORE the catch-all, is the only way hosting can return a real 410.
 *
 * The rewrites are enumerated per slug on purpose. Pointing `/platform/help/**`
 * here would route every help article through a function, killing the
 * prerendered static HTML and billing an invocation per help pageview.
 */

const functions = require('firebase-functions/v2');

const REGION = 'europe-west1';

// Kept for the response body only; hosting decides what reaches this function.
const REMOVED_COUNT = 31;

const BODY = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page removed</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; background: #0B0B14; color: #fff;
    font-family: 'DM Sans', system-ui, sans-serif; text-align: center; padding: 24px;
  }
  .w { max-width: 30rem; }
  h1 { font-family: 'Syne', system-ui, sans-serif; font-size: 1.5rem; margin: 0 0 12px; }
  p { color: #9CA3AF; line-height: 1.6; margin: 0 0 24px; }
  a {
    display: inline-block; padding: 10px 18px; border-radius: 10px;
    background: #7B1FFF; color: #fff; text-decoration: none; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="w">
    <h1>This page has been removed</h1>
    <p>
      It described a feature Vergr no longer offers. Coins are a licence to access
      features on Vergr: they have no cash value and cannot be transferred or
      redeemed for money. Creators are paid a share of the revenue their content
      generates, on Vergr's schedule.
    </p>
    <a href="/platform/help">Go to the Help Centre</a>
  </div>
</body>
</html>`;

exports.goneHelp = functions.https.onRequest(
  // maxInstances was 3, which 503'd under a burst: six concurrent probes got
  // three 5xx. A 5xx tells Google 'come back later' and DELAYS the deindex that
  // this function exists to cause, so the cap is raised. Costs nothing at rest,
  // Cloud Functions bills per invocation, not per instance cap.
  { region: REGION, memory: '128MiB', maxInstances: 20 },
  (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.status(410).type('html').send(BODY);
  },
);

exports.REMOVED_COUNT = REMOVED_COUNT;
