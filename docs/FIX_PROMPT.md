# FIX PROMPT — paste this into the other Claude Code account

You are fixing bugs found in a live QA audit of the Vergr app. **Do not re-run the
audit and do not re-discover the bugs.** They are already written up, with exact
file/line, current code, the fix, and a verify step, in:

> **`docs/APP_AUDIT.md`** — this is your source of truth. Findings are numbered
> A1…A52. Read a finding in full before touching it; each one names the file, the
> current code, the exact change, and how to verify.

Also read, once, before starting:
- `CLAUDE.md` — project rules, stack, deploy commands, "Hard rules".
- The memory index the harness loads each session (feedback_* / project_* files).

## Environment facts you need

- React 18 + Vite SPA. Firebase project `vergr-44494`, **named Firestore DB
  `vgrdb`**, Functions region `europe-west1`. Windows + PowerShell (Bash tool also
  available). Live site: https://vergr.app (also `vergr-44494.web.app`).
- **The founder checks the LIVE site.** A passing `npm run build` is invisible to
  him. After each change that is user-facing you MUST deploy (see commands below),
  or the fix does not exist as far as he is concerned.
- Firestore rules are a **permissive union**: multiple `allow` blocks are OR'd, so
  a later `allow write: if false` does NOT revoke an earlier grant. `isAuth()`
  includes anonymous/guest sessions. This is the root shape behind A24/A29/A30/
  A32/A37.

## Fix order (do them in these batches, deploy at each batch boundary)

**Batch 1 — Firestore rules (one deploy covers all of them).** Highest severity,
lowest blast radius, and they share a single deploy. In `firestore.rules`:
- **A37** — `conversations` `allow get: if isAuth()` leaks `lastMessage` (DM
  content) to any signed-in user. Gate on participant membership.
- **A29** — `calls/{callId}` has no participant check: any user can read/write a
  call doc (offer/answer/candidates). Gate reads+writes to caller/callee uids.
- **A24** — `squads` members subcollection lets a member self-write `role:
  'president'`, which then unlocks treasury writes. Make role server-only (or gate
  to current president / callable).
- **A32** — `transactions` are client-writable. Make them server-only (Cloud
  Functions write; clients read own).
- **A30** — `users` `allow read: if true` (+ public vergrMe drafts). Tighten to
  the fields that must be public; keep drafts private.
- **A25** — `votes` rule left open "for debugging". Close it.
  Deploy: `firebase deploy --only firestore:rules`
  Verify each with the REST reproduction noted in the finding (as a
  NON-participant token, the read/write must now fail).

**Batch 2 — app-blanking + broken media (deploy hosting after).**
- **A41 #1 / A50** — `src/components/media/InlineVideoPlayer.jsx:129` references
  `resolvedSrc`, which is declared nowhere → every one of the 12 importers throws
  on render; MediaLightbox (enlarge) blanks the whole app. Fix: use `src`. This is
  a one-word fix and it un-breaks video enlarge, PostCard, ClipViewer, etc.
- **A50** — no error boundary in `src/router/AppRouter.jsx`: one render throw
  empties `#root`. Add a top-level error boundary so a single bad component can't
  white-screen the app.
- **A21** — CatchAllRoute has no 404; add one.
  Deploy: `npm run build` then `firebase deploy --only hosting`
  (tell the founder Ctrl+Shift+R — the service worker caches hard).

**Batch 3 — streaming (functions + the missing ingest binary).**
- **A44** — `vergr-ingest` (Hetzner) rejects the streamKey that
  `getStreamIngest`/`createStreamSession` now issue (401 "invalid stream key"),
  because the compiled ingest binary resolves keys the OLD way and its source is
  not in the repo. This is the finding to read most carefully — the fix is on the
  box, not only in `functions/streaming.js`. Do not claim it is fixed from code
  alone; it needs the box path or a key-format reconciliation, verified with the
  REST `/ingest/init` probe in the finding.

**Batch 4 — DM/call UX correctness (hosting deploy).**
- **A51** — DM poll create hangs on "Creating…" forever (the write succeeds; the
  client promise never resolves). See `CreatePollSheet.jsx`, `ChatThreadScreen`
  `handleCreatePoll`, `firestore.js:createChatPoll`. Squad poll works, so compare
  against `sendPoll` in `SquadChatThreadScreen`.
- **A49** — legacy DM send path passes no `onProgress` → frozen "0.0 MB" spinner.
- **A47 / A48** — `CallScreen.jsx`: remote `<video object-cover>` crops portrait
  video (violate-of `feedback_video_fit`; letterbox + blurred fill instead); and
  `handleEnd` routes to `/messages` with no `ended` branch → blank flash. Route to
  `/messages/${chatId}` and render an ended state.
- **A52** — `SquadChatThreadScreen`/`SquadInfoRail` swallow the members fetch
  error and show "Members — 2" + "No members yet." + "0 online" at once.

**Batch 5 — everything else in A1…A46 not above**, in the order the Summary table
in `docs/APP_AUDIT.md` ranks them. A23 (`claimQuestReward` trusts a client-set
`reward`) is a functions fix; A7 is Play-blocker copy; the rest are UI/layout.

## Build / deploy commands (from `CLAUDE.md`)

```
npm run build
firebase deploy --only hosting
firebase deploy --only functions:NAME1,NAME2      # name them; avoid full redeploy
firebase deploy --only firestore:rules
```

## Hard rules (from CLAUDE.md + this project's memory — do not violate)

- **Never remove a feature/screen/route/button** without explicit permission. A
  broken screen gets fixed or stubbed "Coming soon", never deleted.
- **No em dashes** anywhere (chat, code, commits, this file). Commas/periods/
  parentheses/colons.
- **Edit code with the Edit tool, never a shell heredoc** — bash ate a JSX
  template literal + a `const` during the audit and white-screened `/messages`.
- **Deploy after user-facing changes** (the founder checks live, not the build).
- **Do not overclaim.** "Deployed" is not "verified". Reproduce the fix the same
  way the finding proved the bug (REST probe, live page, console).
- **Android APK: verify the built ARTIFACT, not the command** (`node
  scripts/publish-apk.mjs` enforces this; don't weaken its guards). Not relevant
  to the web batches above but relevant if any fix touches native.
- **Zero out-of-pocket cost.** No new paid services; Firebase Spark-compatible.
- Keep `CLAUDE.md` current: move a fixed finding to done, note anything you could
  not verify.

## What NOT to do

- Don't start new testing — the audit account is doing that separately.
- Don't refactor beyond the finding. Fix the named bug, verify, move on.
- Don't touch tournaments (retired/unrouted), gems (deleted), or the withdrawal
  flow (deleted) — see `CLAUDE.md`.
