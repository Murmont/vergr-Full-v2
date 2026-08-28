// Rules verification for APP_AUDIT findings A24, A25, A29, A32, A37.
//
// Two halves, and the SECOND is the one that protects real users:
//   1. every hole the audit found is actually closed
//   2. every legitimate flow those rules sit in front of still works
//
// Reads the REAL firestore.rules from the repo, so it can never drift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection,
  query, where, getDocs, arrayUnion, increment,
} from 'firebase/firestore';

// The repo's real rules file, two levels up. Never a copy: a harness that
// tests a stale snapshot is worse than no harness.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.resolve(HERE, '../../firestore.rules');

const A = 'uid_alice', B = 'uid_bob', C = 'uid_carol';
const OWNER = 'uid_owner', AGENT = 'uid_agent', GUEST = 'uid_guest';
// Carol JOINS sq_public during the A24 section, so she is a legitimate member
// by the time A25 runs. Dave never joins anything and stays a true outsider.
const DAVE = 'uid_dave';

let pass = 0, fail = 0;
const results = [];

async function check(group, name, fn) {
  try { await fn(); results.push(['PASS', group, name]); pass++; }
  catch (e) { results.push(['FAIL', group, name, e.message]); fail++; }
}

const env = await initializeTestEnvironment({
  projectId: 'vergr-rules-test',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

// ── Seed, with rules disabled ──────────────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();

  for (const u of [A, B, C, OWNER, AGENT, GUEST, DAVE]) {
    await setDoc(doc(d, 'users', u), { username: u, displayName: u });
  }

  // Conversations
  await setDoc(doc(d, 'conversations', `${A}_${B}`), {
    participants: [A, B], isGroup: false, status: 'active',
    lastMessage: 'SECRET-DM-BODY', lastSenderId: A,
  });
  await setDoc(doc(d, 'conversations', 'support_vergr_support_' + A), {
    participants: [A, AGENT], isGroup: true, visibility: 'private',
    supportThread: true, kind: 'support', lastMessage: 'SECRET-SUPPORT-BODY',
  });
  await setDoc(doc(d, 'conversations', 'grp_public'), {
    participants: [A], isGroup: true, visibility: 'public',
    groupName: 'Public Group', admins: [A], createdBy: A, lastMessage: 'hi',
  });
  await setDoc(doc(d, 'conversations', 'grp_private'), {
    participants: [A], isGroup: true, visibility: 'private',
    groupName: 'Private Group', admins: [A], createdBy: A, lastMessage: 'hi',
  });

  // Calls
  await setDoc(doc(d, 'calls', 'call_ringing'), {
    participants: [A, B], callerId: A, status: 'ringing', type: 'video',
    offer: { type: 'offer', sdp: 'SECRET-SDP-WITH-IP' },
  });
  await setDoc(doc(d, 'calls', 'call_ended'), {
    participants: [A, B], callerId: A, status: 'ended', type: 'video',
  });
  await setDoc(doc(d, 'calls', 'call_ringing', 'callerCandidates', 'c1'), { candidate: 'host 1.2.3.4' });

  // Squads
  await setDoc(doc(d, 'squads', 'sq_public'), { isPublic: true, ownerId: OWNER, memberIds: [OWNER, A], memberCount: 2 });
  await setDoc(doc(d, 'squads', 'sq_public', 'members', OWNER), { userId: OWNER, role: 'president' });
  await setDoc(doc(d, 'squads', 'sq_public', 'members', A), { userId: A, role: 'member' });
  await setDoc(doc(d, 'squads', 'sq_public', 'wallet', 'main'), { balance: 1000 });
  await setDoc(doc(d, 'squads', 'sq_public', 'votes', 'v1'), {
    title: 'Kick Bob?', createdBy: A, options: ['Yes', 'No'],
    voteCounts: {}, voterIds: [], totalVotes: 0, status: 'active',
  });
  await setDoc(doc(d, 'squads', 'sq_private'), { isPublic: false, ownerId: OWNER, memberIds: [OWNER], memberCount: 1 });
  await setDoc(doc(d, 'squads', 'sq_private', 'members', OWNER), { userId: OWNER, role: 'president' });
  // A squad predating the isPublic field, to prove self-join fails closed.
  await setDoc(doc(d, 'squads', 'sq_legacy'), { ownerId: OWNER, memberIds: [OWNER], memberCount: 1 });

  // An empty squad for the createSquad path (owner seeds their own president doc).
  await setDoc(doc(d, 'squads', 'sq_fresh'), { isPublic: true, ownerId: OWNER, memberIds: [OWNER], memberCount: 1 });
});

const alice = env.authenticatedContext(A).firestore();
const bob = env.authenticatedContext(B).firestore();
const carol = env.authenticatedContext(C).firestore();   // outsider, in nothing
const owner = env.authenticatedContext(OWNER).firestore();
const guest = env.authenticatedContext(GUEST, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const dave = env.authenticatedContext(DAVE).firestore();  // never joins anything

// ══ A37 — conversations ════════════════════════════════════════════════
await check('A37', 'participant CAN get their own DM', () =>
  assertSucceeds(getDoc(doc(alice, 'conversations', `${A}_${B}`))));

await check('A37', 'outsider CANNOT get a DM (the confirmed leak)', () =>
  assertFails(getDoc(doc(carol, 'conversations', `${A}_${B}`))));

await check('A37', 'outsider CANNOT get a support thread (guessable id)', () =>
  assertFails(getDoc(doc(carol, 'conversations', 'support_vergr_support_' + A))));

await check('A37', 'outsider CAN get a PUBLIC group (self-join landing page)', () =>
  assertSucceeds(getDoc(doc(carol, 'conversations', 'grp_public'))));

await check('A37', 'outsider CAN get a PRIVATE group (invite landing page)', () =>
  assertSucceeds(getDoc(doc(carol, 'conversations', 'grp_private'))));

await check('A37', 'outsider CANNOT list all conversations', () =>
  assertFails(getDocs(collection(carol, 'conversations'))));

await check('A37', 'participant CAN run the inbox query', () =>
  assertSucceeds(getDocs(query(collection(alice, 'conversations'),
    where('participants', 'array-contains', A)))));

await check('A37', 'outsider CAN still self-join a public group', () =>
  assertSucceeds(updateDoc(doc(carol, 'conversations', 'grp_public'), {
    participants: arrayUnion(C),
  })));

// ══ A29 — calls ════════════════════════════════════════════════════════
await check('A29', 'participant CAN get their call', () =>
  assertSucceeds(getDoc(doc(alice, 'calls', 'call_ringing'))));

await check('A29', 'outsider CANNOT get a call (SDP + IP leak)', () =>
  assertFails(getDoc(doc(carol, 'calls', 'call_ringing'))));

await check('A29', 'outsider CANNOT enumerate the calls collection', () =>
  assertFails(getDocs(collection(carol, 'calls'))));

await check('A29', 'IncomingCallManager query STILL WORKS for the callee', () =>
  assertSucceeds(getDocs(query(collection(bob, 'calls'),
    where('participants', 'array-contains', B),
    where('status', '==', 'ringing')))));

await check('A29', 'outsider CANNOT inject an answer (call hijack)', () =>
  assertFails(updateDoc(doc(carol, 'calls', 'call_ringing'), {
    answer: { type: 'answer', sdp: 'ATTACKER-SDP' }, status: 'active',
  })));

await check('A29', 'callee CAN answer their own call', () =>
  assertSucceeds(updateDoc(doc(bob, 'calls', 'call_ringing'), {
    answer: { type: 'answer', sdp: 'REAL-SDP' }, status: 'active',
  })));

await check('A29', 'outsider CANNOT end someone else\'s call', () =>
  assertFails(updateDoc(doc(carol, 'calls', 'call_ringing'), { status: 'ended' })));

await check('A29', 'participant CAN end their own call', () =>
  assertSucceeds(updateDoc(doc(alice, 'calls', 'call_ringing'), { status: 'ended' })));

await check('A29', 'caller CAN restart a finished call (setDoc whole doc)', () =>
  assertSucceeds(setDoc(doc(alice, 'calls', 'call_ended'), {
    participants: [A, B], callerId: A, status: 'ringing', type: 'audio',
  })));

await check('A29', 'NEW group member CAN start a call on an ended group doc', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'calls', 'call_grp'), {
      participants: [A, B], callerId: A, status: 'ended', isGroup: true,
    });
  });
  // Carol joined the group after the last call, so she is NOT in the stored
  // participants. This is the case a strict immutable-participants rule breaks.
  await assertSucceeds(setDoc(doc(carol, 'calls', 'call_grp'), {
    participants: [A, B, C], callerId: C, status: 'ringing', isGroup: true,
  }));
});

await check('A29', 'outsider CANNOT hijack an ACTIVE call by rewriting it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'calls', 'call_live'), {
      participants: [A, B], callerId: A, status: 'active',
    });
  });
  await assertFails(setDoc(doc(carol, 'calls', 'call_live'), {
    participants: [A, B, C], callerId: C, status: 'ringing',
  }));
});

await check('A29', 'create with a forged callerId is refused', () =>
  assertFails(setDoc(doc(carol, 'calls', 'call_forged'), {
    participants: [A, C], callerId: A, status: 'ringing',
  })));

await check('A29', 'outsider CANNOT read ICE candidates', () =>
  assertFails(getDoc(doc(carol, 'calls', 'call_ringing', 'callerCandidates', 'c1'))));

await check('A29', 'participant CAN write + delete ICE candidates', async () => {
  await assertSucceeds(addDoc(collection(alice, 'calls', 'call_ringing', 'callerCandidates'), { candidate: 'x' }));
  await assertSucceeds(deleteDoc(doc(alice, 'calls', 'call_ringing', 'callerCandidates', 'c1')));
});

// ══ A24 — squads ═══════════════════════════════════════════════════════
await check('A24', 'outsider CANNOT self-join as president (the coin mint)', () =>
  assertFails(setDoc(doc(carol, 'squads', 'sq_public', 'members', C), {
    userId: C, role: 'president',
  })));

await check('A24', 'outsider CAN self-join a PUBLIC squad as a member', () =>
  assertSucceeds(setDoc(doc(carol, 'squads', 'sq_public', 'members', C), {
    userId: C, role: 'member', totalContributed: 0,
  })));

await check('A24', 'outsider CANNOT self-join a PRIVATE squad', () =>
  assertFails(setDoc(doc(carol, 'squads', 'sq_private', 'members', C), {
    userId: C, role: 'member',
  })));

await check('A24', 'GUEST cannot self-join (squad data is not for anon sessions)', () =>
  assertFails(setDoc(doc(guest, 'squads', 'sq_public', 'members', GUEST), {
    userId: GUEST, role: 'member',
  })));

await check('A24', 'squad OWNER can seed their own president doc (createSquad)', () =>
  assertSucceeds(setDoc(doc(owner, 'squads', 'sq_fresh', 'members', OWNER), {
    userId: OWNER, role: 'president',
  })));

await check('A24', 'member CANNOT promote themselves', () =>
  assertFails(updateDoc(doc(alice, 'squads', 'sq_public', 'members', A), { role: 'president' })));

await check('A24', 'member CANNOT unmute themselves', () =>
  assertFails(updateDoc(doc(alice, 'squads', 'sq_public', 'members', A), { mutedUntil: null })));

await check('A24', 'admin CAN change a member role', () =>
  assertSucceeds(updateDoc(doc(owner, 'squads', 'sq_public', 'members', A), { role: 'treasury' })));

await check('A24', 'admin CAN mute a member', () =>
  assertSucceeds(updateDoc(doc(owner, 'squads', 'sq_public', 'members', A), { mutedUntil: new Date() })));

await check('A24', 'member CAN still leave', () =>
  assertSucceeds(deleteDoc(doc(alice, 'squads', 'sq_public', 'members', A))));

await check('A24', 'member CAN read the treasury', () =>
  assertSucceeds(getDoc(doc(owner, 'squads', 'sq_public', 'wallet', 'main'))));

await check('A24', 'member CANNOT write the treasury', () =>
  assertFails(setDoc(doc(owner, 'squads', 'sq_public', 'wallet', 'main'), { balance: 999999 })));

await check('A24', 'member CANNOT forge a squad ledger row', () =>
  assertFails(addDoc(collection(owner, 'squads', 'sq_public', 'transactions'), {
    amount: 999999, type: 'contribution',
  })));

await check('A24', 'self-join fails closed on a squad with no isPublic field', () =>
  assertFails(setDoc(doc(carol, 'squads', 'sq_legacy', 'members', C), {
    userId: C, role: 'member',
  })));

// ══ A25 — squad votes ══════════════════════════════════════════════════
await check('A25', 'outsider CANNOT read squad votes', () =>
  assertFails(getDoc(doc(dave, 'squads', 'sq_public', 'votes', 'v1'))));

await check('A25', 'outsider CANNOT stuff a vote', () =>
  assertFails(updateDoc(doc(dave, 'squads', 'sq_public', 'votes', 'v1'), {
    'voteCounts.0': increment(1), voterIds: arrayUnion(DAVE), totalVotes: increment(1),
  })));

await check('A25', 'outsider CANNOT create a vote', () =>
  assertFails(addDoc(collection(dave, 'squads', 'sq_public', 'votes'), {
    title: 'Outsider vote', createdBy: DAVE, options: ['Yes'],
    voteCounts: {}, voterIds: [], totalVotes: 0,
  })));

await check('A25', 'member CAN cast a vote', () =>
  assertSucceeds(updateDoc(doc(owner, 'squads', 'sq_public', 'votes', 'v1'), {
    'voteCounts.0': increment(1), voterIds: arrayUnion(OWNER), totalVotes: increment(1),
  })));

await check('A25', 'member CANNOT vote twice', () =>
  assertFails(updateDoc(doc(owner, 'squads', 'sq_public', 'votes', 'v1'), {
    'voteCounts.1': increment(1), voterIds: arrayUnion(OWNER), totalVotes: increment(1),
  })));

await check('A25', 'member CANNOT rewrite the question while voting', () =>
  assertFails(updateDoc(doc(owner, 'squads', 'sq_public', 'votes', 'v1'), {
    title: 'Kick Alice?', voterIds: arrayUnion(OWNER),
  })));

await check('A25', 'member CAN create a vote', () =>
  assertSucceeds(addDoc(collection(owner, 'squads', 'sq_public', 'votes'), {
    title: 'New vote', createdBy: OWNER, options: ['Yes', 'No'],
    voteCounts: {}, voterIds: [], totalVotes: 0, status: 'active',
  })));

await check('A25', 'member CANNOT create a vote in someone else\'s name', () =>
  assertFails(addDoc(collection(owner, 'squads', 'sq_public', 'votes'), {
    title: 'Forged', createdBy: A, options: ['Yes'], voteCounts: {}, voterIds: [], totalVotes: 0,
  })));

// ══ A30 — profile visibility ═══════════════════════════════════════════
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'users', 'u_public'), { username: 'pub' });               // no setting = Everyone
  await setDoc(doc(d, 'users', 'u_hidden'), {
    username: 'hid', settings: { privacy: { profileVis: 'Only me' } },
  });
  await setDoc(doc(d, 'users', 'u_friends'), {
    username: 'fr', settings: { privacy: { profileVis: 'Friends & Followers' } },
  });
  // Alice follows u_friends (doc id is `${follower}_${following}`).
  await setDoc(doc(d, 'follows', `${A}_u_friends`), { followerId: A, followingId: 'u_friends' });
});

await check('A30', 'anyone CAN get a default (Everyone) profile', () =>
  assertSucceeds(getDoc(doc(dave, 'users', 'u_public'))));

await check('A30', 'stranger CANNOT get an "Only me" profile', () =>
  assertFails(getDoc(doc(dave, 'users', 'u_hidden'))));

await check('A30', 'stranger CANNOT get a "Friends & Followers" profile', () =>
  assertFails(getDoc(doc(dave, 'users', 'u_friends'))));

await check('A30', 'a FOLLOWER can get a "Friends & Followers" profile', () =>
  assertSucceeds(getDoc(doc(alice, 'users', 'u_friends'))));

await check('A30', 'owner CAN always get their own profile', () =>
  assertSucceeds(getDoc(doc(alice, 'users', A))));

// The reason get/list are split. If this fails, Explore, search and the
// leaderboard are broken for everyone.
await check('A30', 'BULK user query still works with a hidden user present', () =>
  assertSucceeds(getDocs(collection(dave, 'users'))));

// ══ A30 — vergr.me drafts ══════════════════════════════════════════════
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'users', A, 'vergrMe', 'page'), { isPublic: true, displayName: 'Alice' });
  await setDoc(doc(d, 'users', A, 'vergrMe', 'draft'), { bio: 'UNPUBLISHED-SECRET-EDIT' });
});

await check('A30', 'anyone CAN read the public page doc', () =>
  assertSucceeds(getDoc(doc(dave, 'users', A, 'vergrMe', 'page'))));

await check('A30', 'outsider CANNOT read the unpublished draft', () =>
  assertFails(getDoc(doc(dave, 'users', A, 'vergrMe', 'draft'))));

await check('A30', 'owner CAN read their own draft', () =>
  assertSucceeds(getDoc(doc(alice, 'users', A, 'vergrMe', 'draft'))));

await check('A30', 'owner CAN write their own draft', () =>
  assertSucceeds(setDoc(doc(alice, 'users', A, 'vergrMe', 'draft'), { bio: 'edit' })));

await check('A30', 'outsider CANNOT write someone else\'s draft', () =>
  assertFails(setDoc(doc(dave, 'users', A, 'vergrMe', 'draft'), { bio: 'hacked' })));

await check('A30', 'outsider CANNOT write someone else\'s page', () =>
  assertFails(setDoc(doc(dave, 'users', A, 'vergrMe', 'page'), { isPublic: true })));

// ══ A32 — global ledger ════════════════════════════════════════════════
await check('A32', 'user CANNOT forge a ledger row', () =>
  assertFails(addDoc(collection(alice, 'transactions'), {
    userId: A, type: 'tip_received', amount: 500000, currency: 'usd', earning: true,
  })));

await check('A32', 'user CAN still read their own ledger', () =>
  assertSucceeds(getDocs(query(collection(alice, 'transactions'), where('userId', '==', A)))));

await env.cleanup();

// ── Report ─────────────────────────────────────────────────────────────
let last = '';
for (const [status, group, name, err] of results) {
  if (group !== last) { console.log(`\n  ${group}`); last = group; }
  console.log(`    ${status === 'PASS' ? '+' : 'X'} ${name}`);
  if (err) console.log(`        ${err.split('\n')[0].slice(0, 160)}`);
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
