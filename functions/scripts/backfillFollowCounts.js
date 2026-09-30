// One-off backfill (2026-09-27): set users/{uid}.followerCount and
// followingCount to the TRUE counts from the `follows` collection.
//
// ## Why
//
// Until 2026-09-11 every follow was counted twice: the client batch AND the
// `onNewFollower` trigger both incremented, while an unfollow decremented once,
// so both fields drifted upward for good. The double write is gone, but the old
// inflation stayed on every existing account, and Explore, the 100-follower
// public-stream gate and suggestion cards read these fields.
//
// ## Cost
//
// Two aggregation counts per account (a count bills 1 read per 1,000 index
// entries, minimum 1) plus one write for each account whose numbers are wrong.
//
// ## Run (from functions/)
//
//   node scripts/backfillFollowCounts.js           DRY RUN, prints the changes
//   node scripts/backfillFollowCounts.js --apply   writes them
//
// Uses the Firestore REST API with the Firebase CLI's own login on this machine
// (the account that deploys). The Admin SDK refuses a user credential for
// Firestore, which is why this is REST. Safe to re-run: an account that is
// already right is not written.

const os = require('os');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const BASE = 'https://firestore.googleapis.com/v1/projects/vergr-44494/databases/vgrdb/documents';

async function token() {
  const store = require(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'));
  const refresh = store?.tokens?.refresh_token;
  if (!refresh) throw new Error('Firebase CLI is not logged in on this machine (no refresh token).');
  const npmRoot = require('child_process').execSync('npm root -g').toString().trim();
  const { getAccessToken } = require(path.join(npmRoot, 'firebase-tools', 'lib', 'auth.js'));
  const t = await getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform']);
  return t.access_token;
}

async function call(tok, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const num = (v) => (v == null ? null : Number(v.integerValue ?? v.doubleValue ?? NaN));

async function count(tok, field, uid) {
  const res = await call(tok, `${BASE}:runAggregationQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredAggregationQuery: {
        aggregations: [{ alias: 'n', count: {} }],
        structuredQuery: {
          from: [{ collectionId: 'follows' }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: uid } } },
        },
      },
    }),
  });
  return Number(res[0]?.result?.aggregateFields?.n?.integerValue || 0);
}

(async () => {
  const tok = await token();
  console.log(APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to write)');

  const users = [];
  let pageToken = '';
  do {
    const q = `${BASE}/users?pageSize=300&mask.fieldPaths=followerCount&mask.fieldPaths=followingCount&mask.fieldPaths=username${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await call(tok, q);
    users.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  let wrong = 0, written = 0;
  for (const u of users) {
    const uid = u.name.split('/').pop();
    const f = u.fields || {};
    const haveFr = num(f.followerCount), haveFg = num(f.followingCount);
    const [followers, following] = await Promise.all([count(tok, 'followingId', uid), count(tok, 'followerId', uid)]);
    if (haveFr === followers && haveFg === following) continue;
    wrong += 1;
    const name = f.username?.stringValue || uid;
    console.log(`${name.padEnd(24)} followers ${haveFr ?? '-'} -> ${followers}   following ${haveFg ?? '-'} -> ${following}`);
    if (APPLY) {
      await call(tok, `${BASE}/users/${uid}?updateMask.fieldPaths=followerCount&updateMask.fieldPaths=followingCount`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { followerCount: { integerValue: String(followers) }, followingCount: { integerValue: String(following) } } }),
      });
      written += 1;
    }
  }
  console.log(`${users.length} accounts checked, ${wrong} wrong, ${written} written.`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
