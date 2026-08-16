# Search Console removals — 43 URLs

Generated 2026-08-16. Every URL below already returns **HTTP 410 Gone** with
`X-Robots-Tag: noindex, nofollow`, verified live. This file is the founder task
that a 410 alone cannot do.

## Why this is still needed when the URLs already 410

A 410 only takes effect **when Google next recrawls that URL**, which can be days
or weeks. Until then the old title and snippet keep appearing in results. The
Removals tool hides them from Google Search within hours.

**The Removals tool is temporary (about 6 months) by design.** It is a
suppression, not a deletion. That is fine here, because the 410 is doing the
permanent work underneath: by the time the suppression lapses Google will have
recrawled and dropped the URL for good. Do not skip the 410 and rely on this
tool, and do not re-add the pages.

## How to do it

1. Go to https://search.google.com/search-console and select the **vergr.app**
   property. If the property is the domain (`vergr.app`) rather than the URL
   prefix (`https://vergr.app/`), either works.
2. Left sidebar, near the bottom: **Removals**.
3. Stay on the **Temporary Removals** tab. Click **New Request**.
4. Choose **Remove this URL only**, paste one URL, click **Next**, then
   **Submit Request**. Repeat.
5. There is no bulk paste and no CSV import. It is one at a time, roughly 10
   seconds each.

**The shortcut worth taking.** For the two groups below marked *prefix*, use
**Remove all URLs with this prefix** instead of doing them one by one. That
collapses 6 requests into 1 and 31 into… still 31, because the help URLs do not
share a prefix that is safe to wipe (`/platform/help/` would remove the whole
help centre). So: use the prefix option for `/platform/play`, and do the rest
individually.

⚠ Do NOT submit a prefix request for `/platform/help/`. It would suppress all
352 live help articles.

## Priority

If you only do some, do these first. They are what a payment processor or
underwriter types into Google when checking whether the withdrawal claims were
real:

- everything containing `withdraw`
- everything containing `convert` or `commission`
- `is-playing-games-for-money-on-vergr-gambling`
- `make-money-gaming`

## The list

### A. Growth funnel — 2 single + 1 prefix (3 requests, covers 8 URLs)

```
https://vergr.app/platform/make-money-gaming
https://vergr.app/platform/legit
```

Then one **prefix** request for:

```
https://vergr.app/platform/play
```

That prefix covers `/platform/play` itself plus `/platform/play/apex`, `/cs2`,
`/fc25`, `/nba2k`, `/rocketleague`, `/warzone`.

### B. Retired competition articles — 3 requests

```
https://vergr.app/platform/help/is-playing-games-for-money-on-vergr-gambling
https://vergr.app/platform/help/how-does-vergr-detect-cheating
https://vergr.app/platform/help/how-does-vergr-verify-results-and-prevent-cheating
```

### C. Withdrawal — 14 requests

```
https://vergr.app/platform/help/how-do-i-withdraw-my-earnings
https://vergr.app/platform/help/how-do-i-withdraw-to-my-bank-account
https://vergr.app/platform/help/how-do-i-cash-out-my-gems
https://vergr.app/platform/help/how-long-does-a-withdrawal-take
https://vergr.app/platform/help/what-is-the-minimum-withdrawal
https://vergr.app/platform/help/why-is-there-a-hold-on-my-withdrawal
https://vergr.app/platform/help/why-was-my-withdrawal-put-under-review
https://vergr.app/platform/help/how-do-i-cancel-a-pending-withdrawal
https://vergr.app/platform/help/i-sent-a-withdrawal-to-the-wrong-address-can-i-get-it-back
https://vergr.app/platform/help/can-i-withdraw-in-regular-money-instead-of-crypto
https://vergr.app/platform/help/where-do-i-see-the-status-of-my-withdrawal
https://vergr.app/platform/help/what-fees-apply-when-i-withdraw
https://vergr.app/platform/help/which-currency-can-i-withdraw-as-real-money
https://vergr.app/platform/help/do-i-need-to-be-verified-to-withdraw-gems
```

### D. Withdrawal addresses — 4 requests

```
https://vergr.app/platform/help/what-is-a-withdrawal-address-and-how-do-i-set-it
https://vergr.app/platform/help/what-is-a-whitelisted-withdrawal-address-and-why-do-i-need-one
https://vergr.app/platform/help/how-do-i-add-or-remove-a-withdrawal-address
https://vergr.app/platform/help/why-can-i-not-withdraw-until-i-am-verified
```

### E. Conversion and commission — 6 requests

```
https://vergr.app/platform/help/what-is-the-conversion-commission
https://vergr.app/platform/help/how-do-i-lower-my-conversion-commission
https://vergr.app/platform/help/how-do-i-reduce-the-commission-charged-when-i-withdraw
https://vergr.app/platform/help/why-does-the-conversion-rate-change-with-my-rank
https://vergr.app/platform/help/what-is-the-conversion-rate-at-each-rank
https://vergr.app/platform/help/how-do-i-convert-coins-into-gems
```

### F. Gems — 6 requests

```
https://vergr.app/platform/help/why-can-i-not-convert-gems-back-into-coins
https://vergr.app/platform/help/what-is-the-difference-between-coins-and-gems
https://vergr.app/platform/help/how-do-coins-gems-and-vp-work-together
https://vergr.app/platform/help/what-are-gems
https://vergr.app/platform/help/do-gems-expire
https://vergr.app/platform/help/what-are-vc-vp-and-gems
```

### G. Replaced by a live article — 1 request

```
https://vergr.app/platform/help/how-do-i-check-my-coin-and-gem-balance
```

Its replacement, `/platform/help/how-do-i-check-my-coin-balance`, is live and
must NOT be removed.

**Total: 36 requests covering 43 URLs.**

## After submitting

- **Do not resubmit the sitemap** expecting it to speed this up. The sitemap
  controls what is offered for crawling; it has never controlled removal, and
  these URLs are already out of it.
- Check **Indexing → Pages** in a week or two. The removed URLs should move to
  "Not found (404)" or "Blocked due to other 4xx". That is the permanent drop
  landing, and it is the signal that the 410 has done its job.
- If any still show as indexed after a month, use **URL Inspection → Request
  Indexing** on them. It sounds backwards, but it forces a recrawl, and the
  recrawl is what sees the 410.
