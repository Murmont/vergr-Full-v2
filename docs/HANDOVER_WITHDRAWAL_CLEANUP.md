# Handover prompt — continue the withdrawal/revenue-share cleanup

Paste everything below the line into the new session.

---

I'm continuing work on Vergr (repo `C:\Users\damie\Downloads\GitHub\vergr-Full-v2`).

## Read these first, in this order, before touching anything

1. `docs/WITHDRAWAL_REMOVAL_LIST.md` — the live checklist. Ticked boxes are DONE and verified; do
   not redo them. SIX unticked boxes are what is left, and two of those are founder decisions.
2. `docs/REVENUE_SHARE_PLAN.md` §1.4 and §1.5 — the principal model. This is the spec, and it is
   the thing most sessions get wrong.
3. `CLAUDE.md`, but ONLY the two sections at the top: the "READ BEFORE TRUSTING ANYTHING BELOW"
   banner and "What Vergr IS". The rest of that file has been found stale repeatedly.

## The rule the whole task enforces

**Users can NEVER withdraw, convert, or transfer anything.** `requestWithdrawal` throws
(`functions/withdrawals.js:280`), `sendGems`/`quoteGemSend` throw (`functions/gemTransfer.js:91`),
`buyCoinsWithGems` is disabled. Coins are a revocable licence to access features: no cash value,
non-transferable, not redeemable. Gems are accrued revenue share Vergr OWES, are never shown to a
user, and the internal accrual unit must never be printed next to a user-facing amount.

Vergr is the **principal**: a viewer buys Coins from Vergr (Vergr revenue at that moment), spends
them on Vergr features, and Vergr then pays creators a share of the revenue their content generated,
on Vergr's own schedule, as a supplier expense. Same structure as Twitch/YouTube/Patreon.

**Never write** "marketplace", "multi-vendor", "selling on behalf of others", "forwarding funds",
"stored value", or "skill-gaming winnings" about Vergr. `sellerUid` in `functions/entitlements.js`
is pre-migration naming, not the legal relationship. Tournaments are retired and unrouted
(`AppRouter.jsx` has exactly one tournament route and it is admin-only).

## What is already done (2026-08-16, deployed to vergr.app)

- `public/llms.txt` rewritten to the principal model.
- 31 help articles removed: 28 deleted (whole `withdrawing/` and `converting/` categories, 5
  stragglers, 3 gem-subject) and 3 replaced with real-feature equivalents. 28 CTA links repointed.
- ~178 sentence rewrites across the remaining published help articles.
- `legalContent.js` (ToS + privacy) and `compliancePolicies.js` (AML + anti-fraud) corrected.
- The crypto deposit surface is fully unrouted; all in-app withdrawal/convert/address UI is gone.
- 14 live components rewritten, including the signup screen and the wallet walkthrough.

## Verified state at handover (2026-08-16, all deployed to vergr.app)

These were checked against the LIVE site, not the build. Do not re-verify unless something looks wrong.

- 31/31 removed help URLs return HTTP 410 with `X-Robots-Tag: noindex, nofollow`.
- Surviving articles and `/platform/help` return 200. VLink still served by `vlinkApp`.
- `llms.txt` carries zero withdrawal claims and states coins cannot be redeemed for money.
- `sitemap.xml` contains zero withdrawal URLs (420 locs, 387 help URLs, 355 articles).
- No user-facing withdrawal or conversion claim remains anywhere in `src/`, except inside files that
  are unrouted (listed in sections C and F of the removal list).

`functions/goneHelp` is deployed in europe-west1. Nothing else in `functions/` was changed by this
work, and the founder has unrelated uncommitted WIP throughout `functions/` — do not commit that
blindly.

## What is left

See the six unticked boxes in `docs/WITHDRAWAL_REMOVAL_LIST.md`. Two of them are founder decisions
(the unpublished tournament legal doc and the unpublished 37-article tournament help category) —
ask before acting on those. `growthContent.js` is full of withdrawal copy but `GrowthScreens.jsx` is
not routed, so fix it only if it is ever going to be routed.

**Already decided, do not reopen:** the 31 removed help URLs return HTTP 410 via the `goneHelp`
function, NOT 301 redirects. They were briefly 301s and that was reverted, because a redirect keeps
the URL resolvable and passes withdrawal-topic signal into the surviving article, which works against
the entire point of the migration. Detail in section H of the removal list. The only outstanding piece
is a founder action: Search Console removal requests, since a 410 only bites once Google recrawls.

## Traps that cost real time in the last session. Do not repeat them.

1. **Never assert a fact about this codebase from `CLAUDE.md` or memory. Grep first.** A stale
   commission rate and a stale "we removed X" note both got repeated to a payment processor.
2. **The Bash heredoc eats backslashes on this machine (Git Bash on Windows).** `\\'` and regex
   escapes like `[\]\\]` silently lose a backslash and the script fails or, worse, matches nothing.
   Write scripts with the Write tool to a scratchpad file and `node` them, or use line-based
   matching with no regex at all.
3. **Line endings are mixed (CRLF and LF).** Multi-line string anchors fail silently. Prefer
   line-based edits: split on `/\r?\n/`, find the line by `includes()`, rejoin with the file's own
   EOL. Always assert a match and abort loudly if the count is not exactly 1.
4. **Curly vs straight apostrophes.** Some files use `'` and some use `’`. A rule that "doesn't
   match" is usually this. Print the real string out of the file before writing the rule.
5. **`git checkout -- <path>` to undo a bad edit also reverts registry/index files in that path**,
   silently undoing earlier good work. After any revert, reconcile rather than assume.
6. **ALWAYS run `npm run build`, never `npx vite build`.** The postbuild step
   (`scripts/prerenderHelp.mjs`) is what writes the prerendered help pages and the real
   `dist/sitemap.xml`. `vite build` alone leaves a stale 34-URL sitemap and no prerendered pages,
   and it looks like it succeeded.
7. **If a script computes edits, make sure it actually writes the file.** One did not, which deleted
   `.jsx` files while leaving their imports in place and broke the build.
8. **Do not tick a checklist box without grepping to confirm it.** The whole point of that file is
   that a wrong tick costs the next session more than an untouched box.

## Help-centre mechanics (needed for any article work)

- Article URLs are `/platform/help/<slug>` with **no category segment**. Category pages are
  `/platform/help/category/<id>`.
- An article needs THREE things in sync or the build breaks: the `.jsx` file, an import + map entry
  in `src/screens/marketing/help/articles/<category>/index.js`, and a question line in
  `src/screens/marketing/help/helpContent.jsx`. Categories also need an entry in the `CATEGORIES`
  array and an import in `articles/index.js`.
- If those drift, reconcile the registries against what is on disk rather than replaying edits.
- CTAs appear in two shapes, single-line `{ to: ..., label: ... },` and multi-line. A rewriter that
  assumes one shape will corrupt the other.

## Working style the founder expects

Terse. No trailing recaps. No em dashes. Do not ask "shall I continue" — finish the task. Do not ask
questions that the code can answer; go and read the code. Flag genuine founder decisions (money,
pricing, SEO indexation, deleting published content) and do not make them unilaterally. Deploy with
`npm run build` then `npx firebase deploy --only hosting`; the founder checks the live site, so a
passing build is not evidence of anything.
