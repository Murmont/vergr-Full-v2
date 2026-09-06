// Guards the admin call simulator (/admin/call-preview).
//
// ⚠ IT ENCODES CLASSES OF DEFECT, NOT ONE-OFF FACTS. Every rule here is a
// mistake the stream simulator already made and paid for: a surface wired to
// half the simulator, a cap invented instead of mirrored from the server, an
// upload rail that only reached one screen, a control that was drawn and did
// nothing. The point is that the same shape cannot come back here.
//
// ⚠ RUN WITH DUMP=1 TO SEE EVERY ASSERTION. The total moves on its own because
// several rules loop over content (surfaces, findings, seat lists), so a DROP
// looks identical to lost coverage. `DUMP=1 node scripts/call-preview-check.mjs
// > a.txt`, make the change, dump again, and compare: gained is fine, LOST is a
// regression. A passing run with fewer assertions is not a passing run.
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'src/screens/admin/callPreview/';
const HARNESS = 'src/screens/admin/AdminCallPreviewScreen.jsx';
const read = (f) => readFileSync(DIR + f, 'utf8');
const readAbs = (f) => readFileSync(f, 'utf8');

// The shipped call code the preview claims to copy. A rule about what the
// product does must read the product, never the copy.
const PROD = {
  call: 'src/screens/messages/CallScreen.jsx',
  group: 'src/screens/messages/GroupCallScreen.jsx',
  squad: 'src/screens/squads/SquadStreamScreen.jsx',
  channel: 'src/screens/messages/VoiceChannelScreen.jsx',
  ring: 'src/components/IncomingCallOverlay.jsx',
  // ⚠ THE DEAD RINGER IS TRACKED ON PURPOSE. IncomingCallManager is imported
  // nowhere (AppRouter mounts IncomingCallOverlay only) yet holds a divergent
  // copy of the accept and decline rules, so it is exactly the file a future
  // session would fix by mistake. Listed so the findings panel can name it and
  // so rule 15 can tell a stale finding from a typo.
  deadRinger: 'src/components/IncomingCallManager.jsx',
  pill: 'src/components/VoiceSessionPill.jsx',
  hub: 'src/screens/calls/CallsScreen.jsx',
  groupUtil: 'src/utils/groupCall.js',
  voiceUtil: 'src/utils/voiceSession.js',
};

let n = 0;
const fails = [];
const check = (cond, msg) => {
  n++;
  if (process.env.DUMP) console.log(`${n}\t${String(msg).slice(0, 76)}`);
  if (!cond) fails.push(msg);
};

// ⚠ STRIP COMMENTS BEFORE ASSERTING, ALWAYS. Three separate rules in the stream
// guard failed against the comment that EXPLAINED the defect they existed to
// catch, reporting a fault that was not there. A guard that cries wolf gets
// ignored, which is worse than not having it. Blanks each comment while keeping
// the line count so a rule can still report a real line number.
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n2 = src.length;
  while (i < n2) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < n2 && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      while (i < n2 && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else {
      out += src[i]; i++;
    }
  }
  return out;
}

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.js') || f.endsWith('.jsx'));
const SRC = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const CODE = Object.fromEntries(FILES.map((f) => [f, codeOnly(SRC[f])]));
const harness = readAbs(HARNESS);
const harnessCode = codeOnly(harness);
const allCode = Object.values(CODE).join('\n') + '\n' + harnessCode;
const allSrc = Object.values(SRC).join('\n') + '\n' + harness;

// ── 1. It must not become real ───────────────────────────────────────────
//
// ⚠⚠ THE WHOLE PREMISE. A simulator that opens a peer connection, joins the SFU
// or writes a `calls` doc from inside an admin page is not a simulator, it is a
// second implementation with none of the safeguards, and it would ring a real
// person from a screenshot tool.
const FORBIDDEN = [
  ['getUserMedia', 'ask for a real camera or microphone'],
  ['getDisplayMedia', 'ask for a real screen'],
  ['RTCPeerConnection', 'open a real peer connection'],
  ['connectSFU', 'join the real SFU'],
  ['joinGroupCall', 'join a real group call'],
  ['joinVoiceChannel', 'join a real voice channel'],
  ['onSnapshot', 'read Firestore'],
  ['httpsCallable', 'call a Cloud Function'],
  ['firebase/firestore', 'import Firestore'],
  ['WebSocket', 'open a socket'],
];
for (const [token, why] of FORBIDDEN) {
  check(!allCode.includes(token), `the call simulator must never ${why} (found "${token}")`);
}

// ── 2. The sim reaches every surface, through the context ────────────────
//
// ⚠⚠ THIS IS THE DEFECT THAT SHIPPED FOUR TIMES IN THE STREAM PREVIEW. A prop
// allowlist maintained by hand dropped uploaded avatars, then the PiP video,
// then reactions, then the combo meter, and each time a control was mounted on
// a surface with nothing feeding it and nothing failed. The founder found every
// one. The fix is that surfaces read the sim from context and the harness hands
// the provider the WHOLE hook return.
check(
  /<PreviewAssetsProvider[^>]*sim=\{sim\}/.test(harnessCode),
  'the harness must pass the WHOLE sim to PreviewAssetsProvider, not a hand-picked prop list',
);
check(
  !/sim(Props|Bag)\s*=\s*\{/.test(harnessCode),
  'no hand-maintained prop allowlist in the call harness: pass the sim through the provider',
);

// Every surface file that renders call state must read it from the context.
const SURFACE_FILES = FILES.filter((f) => f.startsWith('Preview'));
check(SURFACE_FILES.length >= 5, 'expected at least five surface files under callPreview/');
for (const f of SURFACE_FILES) {
  check(
    CODE[f].includes('usePreviewSim'),
    `${f} must read the simulator from usePreviewSim(), never from threaded props`,
  );
}

// ── 3. Faces come from the resolver, never straight off the cast ─────────
//
// ⚠ THE STREAM PREVIEW MISSED SEVEN SURFACES THIS WAY. The founder uploaded
// faces and half the captures still showed identicons, because those surfaces
// read `person.avatar` directly. useFaces() is the one resolver.
for (const f of SURFACE_FILES) {
  const usesAvatar = /UserAvatar[\s\S]{0,400}?src=/.test(CODE[f]) || CODE[f].includes('faceOf(');
  if (!usesAvatar) continue;
  check(
    CODE[f].includes('useFaces'),
    `${f} draws an avatar, so it must resolve it through useFaces() or an uploaded face never reaches it`,
  );
  check(
    !/src=\{\s*\w+\.avatar\s*\}/.test(CODE[f]),
    `${f} must not read .avatar straight off a person: that bypasses the uploaded-face resolver`,
  );
}
// The chrome resolves faces for the tiles, so it needs it too.
check(CODE['callChrome.jsx'].includes('useFaces'), 'callChrome must resolve faces through useFaces()');

// ── 4. Uploads are the SHARED store, not a second one ────────────────────
//
// ⚠ TWO STORES WOULD MEAN TWO RAILS AND TWO UPLOADS FOR ONE PERSON, and the two
// tools disagreeing about what a cast member looks like. previewAssets.js keys
// by uid; both simulators use the same cast, so they must use the same store.
check(
  CODE['useCallSim.js'].includes("from '../streamPreview/previewAssets'"),
  'the call sim must use the SHARED preview asset store, not a second IndexedDB database',
);
check(
  CODE['callCast.js'].includes("from '../streamPreview/previewCast'"),
  'the call cast must be the stream preview cast: same uids, or an uploaded face cannot resolve',
);
check(
  !/new Dexie\(/.test(allCode),
  'the call simulator must not open its own Dexie database: uploads are shared with the stream preview',
);

// ── 5. An object URL is never minted in a render body ────────────────────
//
// [[reference-object-url-in-render]] — a fresh URL every pass flickers the media
// and leaks every previous one.
for (const f of FILES) {
  const body = CODE[f];
  if (!body.includes('createObjectURL')) continue;
  check(
    f === 'useCallSim.js',
    `${f} mints an object URL: that belongs in the sim hook's handler or loader, never in a render body`,
  );
}
check(
  CODE['useCallSim.js'].includes('revokeObjectURL'),
  'every minted object URL must be revoked on unmount or leaving the screen leaks them',
);

// ── 6. Caps are MIRRORED from the server, never invented ─────────────────
//
// ⚠⚠ A CAP THE SERVER DOES NOT HAVE IS A CAPTURE OF SOMETHING IMPOSSIBLE. The
// group call allows 8 cameras and the squad hangout allows 2, and both are
// enforced by the SFU. The preview reading a different number would advertise a
// layout the product refuses to produce.
const prodGroup = readAbs(PROD.groupUtil);
const prodSquad = readAbs(PROD.squad);
const serverGroupCap = /MAX_CALL_VIDEO\s*=\s*(\d+)/.exec(prodGroup)?.[1];
const serverSquadCap = /MAX_VIDEO_PUBLISHERS\s*=\s*(\d+)/.exec(prodSquad)?.[1];
check(!!serverGroupCap, 'could not read MAX_CALL_VIDEO out of src/utils/groupCall.js');
check(!!serverSquadCap, 'could not read MAX_VIDEO_PUBLISHERS out of SquadStreamScreen.jsx');
const previewGroupCap = /MAX_CALL_VIDEO\s*=\s*(\d+)/.exec(CODE['PreviewGroupCall.jsx'])?.[1];
const previewSquadCap = /MAX_VIDEO_PUBLISHERS\s*=\s*(\d+)/.exec(CODE['PreviewSquadCall.jsx'])?.[1];
check(
  previewGroupCap === serverGroupCap,
  `group camera cap drift: the preview says ${previewGroupCap}, groupCall.js says ${serverGroupCap}`,
);
check(
  previewSquadCap === serverSquadCap,
  `squad camera cap drift: the preview says ${previewSquadCap}, SquadStreamScreen says ${serverSquadCap}`,
);

// ── 7. A voice channel has no camera ─────────────────────────────────────
//
// ⚠ voiceSession.js DROPS EVERY NON-AUDIO REMOTE TRACK, so a camera in a voice
// channel is not a thing that can happen. A camera control there would be a
// button that cannot work.
check(
  !/videocam/.test(CODE['PreviewVoiceChannel.jsx']),
  'the voice channel preview must not draw a camera control: voiceSession drops every non-audio track',
);
check(
  readAbs(PROD.voiceUtil).includes("kind === 'audio'") || readAbs(PROD.voiceUtil).includes("!== 'audio'"),
  'voiceSession.js no longer looks audio-only: re-check whether the voice channel may now carry video',
);

// ── 8. A muted seat never wears a speaking ring ──────────────────────────
//
// ⚠ THE REAL RMS LOOP CARRIES THIS GUARD and it is the single most confusing
// thing a call grid can get wrong.
check(
  /speakingFor[\s\S]{0,600}?seats\.filter\(\(s\) => s\.micOn\)/.test(CODE['useCallSim.js']),
  'speakingFor() must only ever light up a seat whose mic is on',
);
check(
  /includeMe && micOn/.test(CODE['useCallSim.js']),
  'speakingFor() must not light up YOUR ring while you are muted',
);

// ── 9. Every icon-only control is named ──────────────────────────────────
//
// ⚠ `Icon` IS aria-hidden APP-WIDE since 2026-09-02, so an icon-only button no
// longer inherits an accidental name from its ligature and has none at all
// unless it is given one. On a call screen that means End announces as nothing.
for (const f of [...SURFACE_FILES, 'callChrome.jsx']) {
  const body = CODE[f];
  // Buttons whose entire content is an <Icon>, with no aria-label on the button.
  const bad = [...body.matchAll(/<button(?![^>]*aria-label)[^>]*>\s*(\{[^}]*\}\s*)?<Icon[^>]*\/>\s*<\/button>/g)];
  check(bad.length === 0, `${f} has ${bad.length} icon-only button(s) with no aria-label`);
}
check(
  /aria-label=\{label\}/.test(CODE['callChrome.jsx']),
  'CallBtn must forward its label to aria-label, or every call control is unnamed',
);

// ── 10. No semi-transparent pills ────────────────────────────────────────
//
// ⚠⚠ FOUNDER, REPEATEDLY: "I FUCKING HATE THE SEMI TRANSPARENT PILL BACKGROUNDS
// IT IS GROSS STOP USING IT". A low-alpha white over video has no value of its
// own and turns to mud. The ONE exemption is a full-bleed scrim, whose job is to
// let the picture read behind it. A scrim is not a pill.
for (const f of [...SURFACE_FILES, 'callChrome.jsx']) {
  const body = CODE[f];
  const washes = [...body.matchAll(/background:\s*'rgba\(255,\s*255,\s*255,\s*0?\.\d+\)'/g)];
  check(washes.length === 0, `${f} uses a white wash as a background (${washes.length}), use a solid value`);
  // A dark rgba background is only allowed on something that covers the frame.
  const darkWashes = [...body.matchAll(/background:\s*'rgba\(0,\s*0,\s*0,[^']*\)'/g)];
  for (const m of darkWashes) {
    const around = body.slice(Math.max(0, m.index - 260), m.index);
    const isScrim = /inset:\s*0/.test(around) || /aria-hidden/.test(around);
    check(isScrim, `${f} uses a dark rgba fill that is not a full-bleed scrim`);
  }
}
check(
  !/backdropFilter/.test(CODE['callChrome.jsx']),
  'backdropFilter does nothing behind an opaque fill: it belongs only on a scrim',
);

// ── 11. No em dashes anywhere ────────────────────────────────────────────
//
// Hard rule in CLAUDE.md, and the stream guard found a THIRD one in shipped
// viewer copy because nothing was looking.
for (const f of FILES) {
  const bad = (SRC[f].match(/—/g) || []).length;
  check(bad === 0, `${f} contains ${bad} em dash(es)`);
}
check((harness.match(/—/g) || []).length === 0, 'the call harness contains an em dash');

// ── 12. Nothing reads as a placeholder ───────────────────────────────────
//
// ⚠ CAPTURES FROM THIS SCREEN GET PUBLISHED. "User 1", "Test", "Lorem" or a
// "TODO" in visible copy is the difference between a store screenshot and an
// embarrassment.
const PLACEHOLDERS = ['Lorem ipsum', 'TODO', 'FIXME', 'placeholder text', 'User 1', 'Test User', 'xxx'];
for (const p of PLACEHOLDERS) {
  check(!allCode.includes(p), `placeholder copy "${p}" must not appear in the call simulator`);
}

// ── 13. The surface list is the whole inventory ──────────────────────────
//
// ⚠ A SURFACE MISSING FROM THE PICKER CANNOT BE DESIGNED OR CAPTURED, which is
// exactly how the avatar orbit shipped visible to nobody but its owner. Every
// call surface that exists in the product must be reachable here.
const REQUIRED_SURFACES = ['voice', 'video', 'group', 'squad', 'channel', 'ring', 'hub', 'pill', 'rows'];
for (const id of REQUIRED_SURFACES) {
  check(
    new RegExp(`id:\\s*'${id}'`).test(harnessCode),
    `the surface picker is missing "${id}": that surface can never be captured`,
  );
}
// And each one must actually render something.
for (const id of REQUIRED_SURFACES) {
  check(
    new RegExp(`case '${id}':\\s*return <`).test(harnessCode),
    `surface "${id}" is listed in the picker but the switch renders nothing for it`,
  );
}

// ── 14. Every copy names its source ──────────────────────────────────────
//
// ⚠ A COPY WITH NO SOURCE LINE IS A COPY NOBODY WILL EVER UPDATE. When the real
// screen changes, the only thing that makes the copy findable is the file and
// line recorded at the copy site.
for (const f of SURFACE_FILES) {
  check(
    /Copied layout source:\s*\S+\.jsx:?\d*/.test(SRC[f]),
    `${f} must record "Copied layout source: <file>:<line>" so the copy can be kept in step`,
  );
}

// ── 15. The findings panel stays honest ──────────────────────────────────
//
// ⚠⚠ A SIMULATOR THAT QUIETLY DESIGNS AROUND A DEFECT TURNS IT INTO A
// SCREENSHOT NOBODY EVER FIXES. Each finding names a file; if that file stops
// existing the finding is stale and must be re-checked rather than left
// asserting something about a file that is gone.
const findingFiles = [...harness.matchAll(/where:\s*'([^':]+\.jsx?)(:\d+)?'/g)].map((m) => m[1]);
check(findingFiles.length >= 5, 'the findings panel should carry the defects found while building this');
for (const f of new Set(findingFiles)) {
  const hit = Object.values(PROD).some((p) => p.endsWith('/' + f));
  check(hit, `findings panel names "${f}", which is not one of the call files this guard tracks`);
}
// The three CallScreen defects are the load-bearing ones. If any is fixed in
// the real file, the finding must come out in the same commit.
const callSrc = readAbs(PROD.call);
check(
  /flip_camera_ios[\s\S]{0,200}?<\/button>/.test(callSrc) && !/flip_camera[\s\S]{0,300}?onClick/.test(callSrc),
  'CallScreen flip-camera now has an onClick: remove that finding from the panel',
);
check(
  !callSrc.includes('setSinkId'),
  'CallScreen now sets an audio sink: the speaker-button finding is stale, remove it',
);
check(
  callSrc.includes('safeReload'),
  'CallScreen no longer full-page-reloads on failure: remove that finding from the panel',
);

// ── 16. The group ring must not claim to be peer to peer ─────────────────
//
// ⚠ A GROUP CALL ROUTES THROUGH OUR OWN SFU, which decrypts and re-encrypts
// every hop. A specific security claim printed under a call that does not meet
// it is a bug, not copy.
check(
  /p2p=\{!group\}/.test(CODE['PreviewCallOther.jsx']),
  'the incoming-ring preview must only claim P2P for a one-to-one call',
);
check(
  /p2p \?/.test(CODE['callChrome.jsx']),
  'EncryptedNote must branch on p2p rather than printing one claim for every call kind',
);

// ── 17. Wiring ───────────────────────────────────────────────────────────
const shell = readAbs('src/screens/admin/AdminShell.jsx');
const routes = readAbs('src/router/AdminRoutes.jsx');
const access = readAbs('functions/adminAccess.js');
check(shell.includes("id: 'call-preview'"), 'AdminShell must carry a call-preview nav entry');
check(routes.includes('path="call-preview"'), 'AdminRoutes must mount the call-preview route');
check(
  /'call-preview'/.test(access),
  "functions/adminAccess.js ADMIN_SCREENS must list 'call-preview' or a sub-admin can never be granted it",
);
// ⚠ THE ADMIN CHUNK MUST STAY OUT OF THE APK. AdminRoutes is the only entry
// point and it is gated behind the native flag in AppRouter; a static import
// from anywhere else pulls the whole admin bundle back into the app.
check(
  !readAbs('src/router/AppRouter.jsx').includes('AdminCallPreviewScreen'),
  'the call preview must not be imported from AppRouter: it would ship the admin chunk in the APK',
);

// ── 18. It is described as a simulator, on the screen ────────────────────
check(
  /Nothing here is live/.test(harness),
  'the screen must say on its face that nothing on it is live',
);

// ── report ───────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`call-preview-check: ${fails.length} of ${n} assertions FAILED`);
  fails.forEach((f) => console.error('  x ' + f));
  process.exit(1);
}
console.log(`call-preview-check: ${n} assertions passed`);
