# Security-rules tests

Proves `firestore.rules` offline, against the Firestore emulator. No real
accounts, no live data, no cost.

```bash
cd tests/rules
npm install     # first time only
npm test
```

## Why this exists

Six security findings shipped on 2026-08-19 (`docs/APP_AUDIT.md` A24, A25, A29,
A32, A37). "Rules compiled successfully" is not evidence that a rule works, and
it is certainly not evidence that the flows sitting behind it still work. Three
of those five fixes could NOT use the fix the audit proposed, because the
proposal would have broken a real flow:

- denying `list` on `calls` would have stopped every incoming call ringing
- participants-only `get` on `conversations` would have broken private-group
  invite pages
- keying a squad vote doc to the voter's uid would have broken voting outright

Each of those is now a test. **Whenever you touch `firestore.rules`, run this
first.**

## What it asserts

Two halves, and the second is the one that protects real users:

1. every hole the audit found is genuinely closed
2. every legitimate flow those rules sit in front of still works — answering a
   call, joining a public group, opening a private-group invite, joining a
   public squad, casting a squad vote, reading your own ledger

## Gotchas

- **Java 21+ is required by firebase-tools 14/15**, and this machine has 17.
  That is why this folder pins its own `firebase-tools@13`, which runs on 17.
  Use `npm test` from inside this folder, not the global `firebase` CLI.
- `run.mjs` loads `../../firestore.rules` directly, never a copy, so it cannot
  test a stale snapshot. `firebase.json` points at `placeholder.rules` (a
  deny-all) purely because the emulator needs *some* rules file at boot and
  cannot reference one outside its own directory; the test environment replaces
  it. Do not "helpfully" copy the real rules over that placeholder.
- Tests share one emulator and run in order, so **side effects carry across**.
  Carol deliberately self-joins a squad during A24, which is why the A25
  outsider assertions use Dave, who never joins anything. Getting this wrong
  produces two convincing false failures.
