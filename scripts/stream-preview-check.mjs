// Guards the admin stream simulator (/admin/stream-preview).
//
// Exists because the same defect shipped three times: the founder uploaded
// avatars and they did not appear, each time for a different reason, and each
// time the fix was "wire up the one surface he named" rather than "find the
// class". These assertions encode the class.
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'src/screens/admin/streamPreview/';
const read = (f) => readFileSync(DIR + f, 'utf8');

// ⚠⚠ THE STATE LAYER IS TWO FILES NOW, AND EVERY RULE ABOUT IT MUST SEE BOTH.
// On 2026-09-04 the eight PURE state components (Centred, ChatStateBanner,
// TtsStrip, ZeroViewers, EmptyChat, VpEarnedChip, PreviewLevelUp, StreamPaywall)
// moved to src/components/streams/states/ so the real screens and the preview
// share ONE definition. 22 rules failed instantly, all of them reading
// previewStates.jsx by name. That is the guard working: it noticed the move.
//
// readState() is the fix and it is deliberately a CONCATENATION rather than a
// second path, because a rule about ZeroViewers should not have to know which
// file that component currently sits in. Absence assertions get stricter for
// free: they now cover the shipped file too.
// ⚠⚠ PRODUCTION FILES JOIN THIS LIST AS THE PORT REACHES THEM. A THIRD EM DASH
// WAS FOUND IN SHIPPED COPY because the copy rules enumerate the PREVIEW
// directory: MobileLiveViewer told a viewer "The replay is still processing —
// check back in a few minutes" and nothing was looking. A rule that only defends
// the simulator is defending the wrong thing.
const PORTED_PATHS = [
  'src/components/streams/ChatPanel.jsx',
  'src/components/streams/MobileLiveViewer.jsx',
  'src/screens/streams/BroadcasterScreen.jsx',
  'src/screens/streams/native/NativeBroadcasterScreen.jsx',
  'src/screens/streams/ViewerStreamScreen.jsx',
  'src/screens/streams/GoLiveSetupScreen.jsx',
  'src/screens/streams/native/NativeGoLiveScreen.jsx',
  'src/screens/streams/CoStreamingScreen.jsx',
  'src/screens/streams/StreamEndingScreen.jsx',
];
const STATE_PATHS = [
  'src/components/streams/states/index.jsx',
  'src/components/streams/states/tokens.js',
];
// ⚠⚠ COUNT A JSX TAG, NEVER A BARE SUBSTRING. This has now bitten five separate
// rules: <ChatStateBannerX> contains <ChatStateBanner, <ZeroViewersX> contains
// <ZeroViewers, and each guard passed while its component had been renamed out of
// existence. A tag ends at whitespace, a slash or a closing bracket, so check for
// the boundary and the whole class goes away.
const countTag = (src, name) => {
  let n = 0;
  const open = '<' + name;
  for (let i = src.indexOf(open); i >= 0; i = src.indexOf(open, i + 1)) {
    const c = src.charAt(i + open.length);
    if (c === ' ' || c === '/' || c === '>' || c === String.fromCharCode(10)) n++;
  }
  return n;
};

const readState = () => read('previewStates.jsx')
  + STATE_PATHS.map((f) => String.fromCharCode(10) + readFileSync(f, 'utf8')).join('');
let n = 0;
const fails = [];
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

// ⚠ STRIP COMMENTS BEFORE ASSERTING, ALWAYS. Three separate checks in this file
// have now failed against the comment that EXPLAINS the defect they exist to
// catch — the guard reads "maxWidth: '88%'" in a warning about maxWidth: '88%'
// and reports a fault that is not there. A guard that cries wolf gets ignored,
// which is worse than not having it. Handles //, /* */ and JSX {/* */}.

// Blank out every comment while keeping the line count, so a rule can report a real
// line number. `codeOnly` above deletes lines and therefore shifts them.
const stripComments = (src) => {
  const out = src.split("");
  let i = 0, inBlock = false, inLine = false, inStr = "";
  for (; i < out.length; i++) {
    const c = out[i], nx = out[i + 1];
    if (inBlock) { if (c === "*" && nx === "/") { out[i] = " "; out[i + 1] = " "; i++; inBlock = false; } else if (c !== "\n" && c !== "\r") out[i] = " "; continue; }
    if (inLine) { if (c === "\n") inLine = false; else out[i] = " "; continue; }
    // ⚠⚠ A QUOTE THAT CROSSES A NEWLINE IS NOT A STRING, IT IS PROSE.
    // JSX text carries apostrophes: MobileLiveViewer:1578 reads "the broadcaster's
    // stream", and that apostrophe opened a fake string that swallowed everything
    // up to the next quote, INCLUDING a real comment 15 lines later. The em-dash
    // rule then reported a comment as shipped copy.
    //
    // A real JS string literal never contains a raw newline; only a template
    // literal does. So resetting at a newline for the two quote characters is
    // correct, and it makes the stripper self-correcting on JSX prose.
    //
    // This affected EVERY rule that uses stripComments on a JSX file, not just
    // the one that surfaced it.
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) { inStr = ""; continue; }
      if (c === String.fromCharCode(10) && inStr !== String.fromCharCode(96)) { inStr = ""; }
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") { inStr = c; continue; }
    if (c === "/" && nx === "*") { out[i] = " "; out[i + 1] = " "; i++; inBlock = true; continue; }
    if (c === "/" && nx === "/") { out[i] = " "; out[i + 1] = " "; i++; inLine = true; continue; }
  }
  return out.join("");
};

const codeOnly = (src) => src
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

// ── 1. ONE identity table ────────────────────────────────────────────────
// The bug: previewGifters defined its own uids (g1-g4) for people who were
// already in CAST, so six supporter surfaces could never show an uploaded
// face. A second table is invisible in review because both render fine.
// ⚠ ENUMERATED, NOT HAND-LISTED. The first version listed files by hand and
// left out PreviewSoloPortrait/Landscape — the exact two files where the tip
// alert was missing. A guard that does not look at a file cannot defend it.
// ⚠ NO BLANKET SKIP LIST. There was one, and previewCast.js was on it — the
// file that defines the cast AND the tip script — so the gift-name rule below
// never looked at the one place a gift name actually lived. A file is exempted
// from ONE rule, at that rule, never from the whole guard.
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));

// Rule 1 only: these legitimately define or derive identities.
const OWNS_IDENTITY = ['previewCast.js', 'previewFaces.js'];
for (const f of FILES.filter((x) => !OWNS_IDENTITY.includes(x))) {
  const src = read(f);
  // A literal uid outside previewCast.js means a person defined somewhere else.
  const bad = [...src.matchAll(/uid:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((u) => !['host', 'preview-host'].includes(u));
  check(bad.length === 0,
    `${f} defines its own uid(s) [${bad.join(', ')}] — every person must come from CAST in previewCast.js, or an uploaded avatar can never reach them`);
}

// ── 2. No placeholder identities ─────────────────────────────────────────
// These captures go on the Play listing.
for (const f of FILES) {
  const src = read(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  for (const word of ['Preview Streamer', '[username]', 'Lorem']) {
    check(!src.includes(word), `${f} still ships the placeholder "${word}"`);
  }
}

// ── 3. No hollow avatars ─────────────────────────────────────────────────
// The bug: two chat rows had src={null} hardcoded, so those surfaces drew an
// empty disc and threw an uploaded face away without erroring.
for (const f of FILES) {
  check(!/<UserAvatar[^>]*src=\{null\}/.test(read(f)),
    `${f} renders <UserAvatar src={null}> — a hollow disc that silently ignores uploads`);
}

// ── 4. Every avatar resolves through the override ────────────────────────
// Either faceOf() (the context) or an explicit avatars[uid] lookup. A raw
// `user.avatar` read is the cast identicon and can never be the upload.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = read(f);
  for (const m of src.matchAll(/<UserAvatar[^>]*src=\{([^}]*)\}/g)) {
    const expr = m[1].trim();
    const ok = expr.includes('faceOf(') || expr.includes('avatars[') || /^avatar$/.test(expr);
    check(ok, `${f} renders an avatar from \`${expr}\` — must go through faceOf() or the avatars map`);
  }
  // A CALLER passing the raw cast avatar to a child is the same defect one
  // level up: the child renders src={avatar} faithfully and still shows the
  // identicon. Checking only UserAvatar's own src misses it entirely.
  //
  // ⚠ NO REGEX HERE, DELIBERATELY. This check was written three times as a
  // regex and lost its backslashes every time it passed through a generating
  // script, so it matched nothing and reported green. Splitting on a literal
  // has no escapes to lose. [[reference-mixed-line-endings]] is the same
  // family: the thing that breaks is the layer in between, not the logic.
  for (const part of src.split(' avatar={').slice(1)) {
    const expr = part.slice(0, part.indexOf('}')).trim();
    // ⚠ A BINDING WRAPPER THAT ALREADY RESOLVED IT IS THE POINT, NOT THE DEFECT.
    // The rule exists because passing `host?.avatar` straight through bypasses the
    // uploaded-face resolver. A wrapper that CALLS useFaces() and hands the result
    // to a pure view is doing exactly what this rule wants: it is the only place
    // that resolves, and the view below it cannot resolve anything.
    const resolvedAbove = expr === 'avatar' && src.includes('useFaces()(');
    const ok = expr.includes('faceOf(') || expr.includes('avatars[') || resolvedAbove;
    check(ok, `${f} passes avatar={${expr}} to a child — the caller must resolve the upload, the child cannot`);
  }
}

// ── 5. Tips render as the DESIGNED combo feed, never an alert pill ───────
// ⚠ THIS RULE REPLACED ITS OWN OPPOSITE. The first version asserted that a
// surface with a sub alert must also mount a TipAlertOverlay, on the reasoning
// that half a pair was a bug. It was not: the solo views deliberately had no
// tip pill because tips are the combo feed the founder designed (avatar, "Sent
// X", coin, big xN counter, left-aligned). Acting on that wrong rule put the
// replaced component back on six surfaces. A guard that encodes a guess is
// worse than no guard, because it defends the mistake.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = read(f);
  check(!src.includes('<TipAlertOverlay'),
    `${f} mounts <TipAlertOverlay> — tips are <GiftFeed>, the designed combo feed`);
  // Any surface that shows a sub alert is a live surface, so it owes tips too.
  if (src.includes('<SubAlertOverlay')) {
    check(src.includes('<GiftFeed'),
      `${f} announces subs but has no <GiftFeed> — tips would not show at all`);
  }
}

// The Fire tip control must drive the feed, not just the ledger.
const simTip = read('useStreamSim.js');
const fireTipAt = simTip.indexOf('const fireTip = useCallback');
const fireTipBody = fireTipAt < 0 ? '' : simTip.slice(fireTipAt, simTip.indexOf('}, [', fireTipAt));
check(fireTipBody.includes('lastGift:'),
  'fireTip does not write lastGift — the designed combo feed reads that field and would never fire');
// ── 6. Coins use the brand coin, never the Material glyph ────────────────
// CoinIcon.jsx says to use it "everywhere instead of <Icon name='paid'/>".
//
// ⚠⚠ THIS RULE WAS GREEN WHILE THE STREAM-ENDED SCREEN DREW `paid` AND A LITERAL
// "●" FOR TIPS EARNED. It only matched the literal prop `name="paid"`, and that
// screen passes the icon as DATA — `{ label: 'Tips Earned', icon: 'paid' }` in an
// array it then maps over. A check that only sees one spelling of a thing defends
// one spelling of a thing.
//
// ⚠ AND IT READ THE RAW FILE, so it then failed against the COMMENT explaining
// the fix. Every rule in here reads codeOnly() for that reason.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  check(!src.includes('name="paid"'), `${f} uses the Material "paid" glyph — coins render with <CoinIcon>`);
  check(!src.includes("icon: 'paid'"), `${f} passes the Material "paid" glyph as icon data — coins render with <CoinIcon>`);
  // A bare bullet standing in for the coin is the same defect wearing a costume.
  check(!/['"`]● \$\{/.test(src) && !src.includes('`● '),
    `${f} draws a bullet where the coin belongs — use <CoinIcon>`);
}

// ── 7. Uploads survive a refresh ─────────────────────────────────────────
const sim = read('useStreamSim.js');
check(sim.includes('loadAssets(') && sim.includes('putAsset('),
  'useStreamSim no longer persists uploads — a refresh would wipe every avatar and both videos');
check(sim.includes('setVideo') && sim.includes('videoKey('),
  'the slot-based video store is gone — a PiP needs two sources and a four-way co-host needs four');

// ── 8. Alerts never anchor to the top ───────────────────────────
// A top-anchored alert lands on the host capsule and the viewer/close controls.
// Founder saw a tip pill sitting across the streamer's own name.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = read(f);
  for (const part of src.split('AlertOverlay').slice(1)) {
    const tag = part.slice(0, part.indexOf('/>') + 2);
    check(!tag.includes("anchor=\"top\""), `${f} anchors an alert to the top — it collides with the header`);
  }
}

// ── 9. Reactions rise from the like button ───────────────────────
// ReactionsFloor reads originX as a raw CSS length. The simulator passed a
// Math.random() FRACTION, which is not a valid length, so every heart pinned to
// the left edge while the button emitting them sits on the right.
// ⚠ ASSERT THE CODE, IN THE RIGHT SCOPE. A substring test over the whole file
// counted the comments that EXPLAIN why originX is gone and reported a fault
// that was not there — twice, because a /** */ block survives a "//" filter.
// Slice out the burst literal and assert inside THAT, the same correction this
// repo already recorded for the boostBucket guard.
const sim9 = read('useStreamSim.js');
const burstAt = sim9.indexOf('const burst = Array.from(');
const burst = burstAt < 0 ? '' : sim9.slice(burstAt, sim9.indexOf(';', burstAt));
check(burstAt >= 0 && !burst.includes('originX'),
  'useStreamSim passes originX to ReactionsFloor — a unitless fraction is not a CSS length and pins every heart to the left edge');

// ── 10. Coins are never drawn as something else ──────────────────
// The tip alert rendered a five-point STAR polygon beside a coin amount, so a
// 250-coin tip read "★ 250".
const alerts = readFileSync('src/components/streams/StreamGoalAndAlerts.jsx', 'utf8');
check(!alerts.includes('<polygon points="8,1'),
  'StreamGoalAndAlerts draws coins as a star polygon — use <CoinIcon>');
check(alerts.includes('CoinIcon'), 'StreamGoalAndAlerts no longer imports the brand coin');

// ── 11. Coins (VC) are the only thing a viewer can send ───────────
// ⚠ GIFTING IS DEFERRED IN CLAUDE.md ("do NOT start without explicit
// go-ahead") and there is no gift catalogue anywhere in the product. The tip
// feed rendered "Sent Rose" / "Sent Galaxy" from hardcoded names, so a screen
// whose captures go on the Play listing was advertising a feature that does
// not exist. Founder: "there are no roses or anything else there are only
// coins (VC)".
const ITEM_WORDS = ['Rose', 'Galaxy', 'Crown', 'Diamond', 'Lion', 'Rocket', 'Heart Me'];
for (const f of FILES) {
  const code = read(f).split(String.fromCharCode(10))
    .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*'); })
    .join(String.fromCharCode(10));
  for (const w of ITEM_WORDS) {
    check(!code.includes("'" + w + "'"),
      `${f} names a gift item ('${w}') — there are no gifts, only coins (VC)`);
  }
  check(!code.includes('gift:'),
    `${f} carries a gift type — a single currency has no item taxonomy`);
}

// ── 12. The tip row never truncates a normal handle ─────────────
// ⚠ "ZERO…" IN A PILL WITH ROOM TO SPARE. The row carried maxWidth: '88%', a
// percentage resolved against an absolutely positioned shrink-to-fit parent
// whose width depends on the row — circular, resolves tiny, and the flex column
// (minWidth: 0) then collapsed so the ellipsis fired on LAYOUT, not on length.
// TikTok shows the whole handle. A pixel cap has nothing circular to resolve.
const solo = read('previewSoloParts.jsx');
const rowAt = solo.indexOf('function GiftRow');
const rowEnd = solo.indexOf('export function GiftFeed');
const rowSrc = rowAt < 0 ? '' : codeOnly(solo.slice(rowAt, rowEnd));
check(rowAt >= 0 && !rowSrc.includes("maxWidth: '"),
  'GiftRow uses a percentage maxWidth — inside a shrink-to-fit absolute parent that resolves tiny and truncates the name');

// ── 13. Hearts are drawn, not an OS emoji ────────────────────
// An emoji glyph is whatever the OS ships, so the same stream looks different
// on Windows and Android and matches the brand on neither.
const rf = codeOnly(readFileSync('src/components/streams/ReactionsFloor.jsx', 'utf8'));
check(!rf.includes('❤'), 'ReactionsFloor renders an emoji heart — use the inline SVG path');
check(rf.includes('HEART_COLORS'), 'ReactionsFloor lost its colour palette — one repeated colour reads as a glitch');
check(rf.includes('data-reduced-motion'),
  'ReactionsFloor only checks the media query — Settings → Appearance sets html[data-reduced-motion] and a media query cannot see it');

// ── 14. Videos resolve from the provider, never a prop ──────────
// ⚠ `facecamVideo` WAS A PROP IN simProps, WENT MISSING IN AN UNRELATED EDIT,
// AND NOTHING FAILED — the PiP just rendered empty. Same class as the avatars.
// A prop must be remembered at every hop; a context cannot be forgotten.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const code = codeOnly(read(f));
  check(!code.includes('sceneVideo') && !code.includes('facecamVideo'),
    `${f} threads a video as a prop — use usePreviewVideos()/videoFor(slot)`);
}

// A co-host tile must take its OWN slot, or four publishers show one clip.
const stages = codeOnly(read('PreviewStreamStages.jsx'));
check(stages.includes('videoFor(t.slot)') && stages.includes("slot: 'guest1'"),
  'the co-host grid no longer picks a per-tile video slot — every guest would show the same clip');
// The seat model: a camera-off guest keeps their box and shows their face.
check(stages.includes('name="mic"') && !stages.includes('videocam_off'),
  'a participant with no video shows a camera glyph again — the reference shows their AVATAR with a MIC, because Panel is the audio mode and a crossed-out camera reads as a fault rather than a person talking');
check(stages.includes("right: 8, top: '50%'"),
  'the panel guest column is not down the right any more — the reference puts it there, not along the bottom');
check(stages.includes('camOff') && stages.includes('faceOf(tile)'),
  'a camera-off tile no longer shows the person — it must be their avatar, not an anonymous glyph, or a viewer cannot tell who is still in the room');
check(stages.includes("layout === 'panel'"),
  'the Panel layout is gone — it is the mode the reference uses for audio guests and one-on-one');

// Every slot the rail offers must be one a renderer actually asks for.
const slotSrc = read('previewAssets.js');
// ⚠ NO REGEX. Its `\s` was eaten passing through the script that wrote this
// line, so the pattern matched nothing and the check reported "0 slots" against
// a file that declares five. Fifth time in this session; splitting on a literal
// has no escapes to lose.
const slots = slotSrc.split("{ id: '").slice(1).map((p) => p.slice(0, p.indexOf("'")));
check(slots.length >= 5, `previewAssets declares ${slots.length} video slots — a four-way co-host plus a facecam needs five`);
// ⚠ EXCLUDE THE DECLARATION FILE. previewAssets.js is where the slots are
// DEFINED, so counting it as a consumer made every slot look used — including
// one nothing renders. A guard that treats a declaration as a use can never
// find an orphan.
const allCode = FILES.filter((f) => f !== 'previewAssets.js')
  .map((f) => codeOnly(read(f)))
  .join(String.fromCharCode(10));
for (const slot of slots) {
  const used = allCode.includes(`'${slot}'`) || (slot.startsWith('guest') && allCode.includes('guest${'));
  check(used, `video slot '${slot}' is offered in the rail but no surface reads it — an upload with nowhere to go`);
}

// ── 15. A LIVE SURFACE CARRIES THE WHOLE LIVE KIT ──────────────
// ⚠⚠ THIS IS THE RULE THAT SHOULD HAVE EXISTED FIRST. Founder, 2026-09-01:
// "yesterday I asked you to fix the reaction button and you did that but only
// on the solo screen, so now today i need to waste tokens to tell you to do it
// on the other screens". He was right. ReactionsFloor was rendered by ONE of
// six live surfaces; the other five were handed `reactions` by simProps and
// threw it away, so firing a reaction did nothing on the split view, the
// landscape view, the desktop viewer, the broadcaster or the co-host viewer.
//
// Fixing a shared component and wiring a single caller is not fixing a feature.
// A surface that renders live chrome renders ALL of it, and this fails the
// build rather than waiting for the founder to find the next missing one.
const LIVE_KIT = [
  ['<GiftFeed', 'the tip combo feed'],
  ['<SubAlertOverlay', 'the subscribe alert'],
  ['<JoinAnnouncer', 'the entrance ribbon'],
  ['<ReactionsFloor', 'floating reactions'],
  ['<PreviewSheets', 'the tap-through sheets'],
];
// A file is a live surface if it announces entrances — that is the cheapest
// unambiguous marker of "this renders a running stream".
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (!src.includes('<JoinAnnouncer')) continue;
  for (const [tag, what] of LIVE_KIT) {
    check(src.includes(tag), `${f} is a live surface but does not render ${what} (${tag}) — that control does nothing here`);
  }
}

// ── 16. THE VIDEO GROWS. THE CHAT IS FIXED. ────────────────
// ⚠⚠ GETTING THIS BACKWARDS PRODUCED THE GAP, AND THEN A WORSE FIX FOR IT.
// The video is the product on a streaming app. It takes every pixel left after
// the header, the chat and the composer, so there is no leftover space for a
// dead band to form in. Sizing the region from the tile aspect instead made the
// video SMALLER and let the chat expand into the difference: the measured gap
// went to zero and the screen got worse, because a gap of zero is a metric and
// not a design.
// ⚠ BOTH SIDES, NOT JUST THE VIEWER. This rule watched PreviewViewerScreen only,
// and the broadcaster spent that whole time rendering `inset: 0` tiles measuring
// 177x826 — an aspect of 0.215 against the reference's 0.667. The founder
// screenshotted it. A rule that guards one of two surfaces is how the fix stayed
// on one of two surfaces.
for (const f of ['PreviewViewerScreen.jsx', 'PreviewBroadcasterScreen.jsx']) {
  const src = codeOnly(read(f));
  if (!src.includes('PreviewCoHostGrid')) continue;
  check(src.includes('stageAspect('),
    f + ' sizes the co-host region without stageAspect() — cells revert to full-height slices, which is what made the frames look stretched');
}
// And panel must not be sized by the GRID aspect: its one host tile would change
// shape with the guest count (measured 1.333 at two guests, 0.667 at four).
const panelSrc = codeOnly(read('PreviewStreamStages.jsx'));
check(panelSrc.includes('PANEL_ASPECT') && panelSrc.includes("layout === 'panel' ? PANEL_ASPECT"),
  'panel is back on the grid aspect — the host tile will resize itself as guests join');
const viewerSrc = codeOnly(read('PreviewViewerScreen.jsx'));
check(!viewerSrc.includes(String.fromCharCode(39) + String.fromCharCode(48) + " 0 44%"),
  'the co-host region is back to a fixed slice of screen height — whatever the chat does not use shows as a dead band');

// ⚠ AND THE CHAT MUST NOT GROW. Checking only that the video grows misses the
// case where BOTH do: the chat then takes half the slack and the video is
// short again. Exactly one of the two is allowed to be flexible.
// The strip above the grid always says something.
const stages2 = codeOnly(read('PreviewStreamStages.jsx'));
check(stages2.includes('CELL_ASPECT = 2 / 3'),
  'the co-host cell is no longer the measured 2:3 portrait shape from the reference');
check(stages2.includes('const seats = n <= 2 ? 2 : 4;'),
  'the seat model is gone — live cells would stretch to fill instead of keeping a fixed seat shape');
{
  const stripAt = viewerSrc.indexOf("padding: '0 10px 8px', flexShrink: 0 }}>");
  const strip = stripAt < 0 ? '' : viewerSrc.slice(stripAt, stripAt + 900);
  check(strip.includes("flexWrap: 'wrap' }}>") && strip.includes('streamDoc.game &&'),
  'the strip above the grid lost its chip row — the tip goal moved onto the stage (broadcaster-placed), so the chips are the ONLY thing left keeping that band from rendering empty');
}

// ── 17. Chat never draws over the composer ──────────────────
// ⚠ THE OVERLAY OUTRANKED THE INPUT. Chat sat at z-index 4 against the
// composer's 3, and its bottom offset did not clear the composer's real
// height, so the feed drew across the comment box and the dock icons and ran
// past them. Founder had to point it out from a screenshot I had already
// called verified.
const vc = codeOnly(read('PreviewViewerScreen.jsx'));
// ⚠ THIS ONCE MATCHED A LITERAL STYLE STRING AND FIRED ON A CORRECT FILE.
// Splitting the flex onto a child (to make room for the chat-state banner)
// deleted the string while leaving the z-index it protects untouched. Assert
// the ORDERING instead: the composer must outrank the chat block.
// ⚠ REGEX-FREE ON PURPOSE. Building this as a regex through a generator lost
// its backslashes twice (\d became a literal d), so the guard reported a fault
// that did not exist. indexOf cannot be mangled in transit.
const zAfter = (hay, needle) => {
  const at = hay.indexOf(needle);
  if (at < 0) return NaN;
  return parseInt(hay.slice(at + needle.length, at + needle.length + 4), 10);
};
const composerZ = zAfter(vc, "{!chatHidden && <div style={{ position: 'relative', zIndex: ");
const chatZ = zAfter(vc, ": { position: 'relative', zIndex: ");

check(Number.isFinite(composerZ) && Number.isFinite(chatZ) && composerZ > chatZ,
  `the composer no longer outranks the chat overlay (composer z=${composerZ}, chat z=${chatZ}) — the feed will draw across the input and the dock`);

// ── 18. A viewer can put the chat away ────────────────────
// ⚠ AND THE GESTURE DIFFERS BY SURFACE ON PURPOSE. A left-to-right swipe is
// the browser's own back gesture, so binding dismissal to it walks the viewer
// off the stream. Native gets the swipe, the browser gets a long press.
check(vc.includes('chatHidden'),
  'the chat can no longer be dismissed — a viewer cannot just watch the stream');
check(vc.includes('Show chat'),
  'a dismissed chat has no way back — that is a dead end');
const dis = codeOnly(read('useChatDismiss.js'));
check(dis.includes('native') && dis.includes('HOLD_MS'),
  'the dismiss gesture no longer distinguishes native from browser — a rightward swipe in a browser is its back gesture');

// ── 19. Letterboxed video gets a blurred fill, never a brand gradient ─
// ⚠ [[feedback-video-fit]] IS A STANDING RULE AND THE SPLIT VIEW BROKE IT.
// A 16:9 desktop source was letterboxed over the purple brand gradient, so
// the stream read as a small window pasted on a marketing background. Never
// crop the frame; letterbox it and fill the bars with a blurred copy.
for (const f of ['PreviewSoloPortrait.jsx', 'PreviewSoloLandscape.jsx']) {
  const src = codeOnly(read(f));
  check(src.includes('blur(28px)'),
    f + ' letterboxes without a blurred fill — the frame sits on a flat brand gradient');
}

// The tip goal is status and belongs at the top, not stacked on the chat.
const mv = codeOnly(read('PreviewMobileViewer.jsx'));
const dockAt = mv.indexOf('bottom dock');
const dock = dockAt < 0 ? '' : mv.slice(dockAt);
check(!dock.includes('StreamGoalBar'),
  'the tip goal is back in the bottom dock — it is status, it belongs in the top strip, not pushed against the chat');

// ── 20. A DISPLAY WITHOUT ITS DATA IS THE RECURRING DEFECT ──────
// ⚠⚠ THIS HAS NOW SHIPPED THREE TIMES: uploaded avatars, the PiP video, and
// reactions. Each time the component was mounted on every surface and the
// DATA was threaded to one of them, so the control looked present and did
// nothing. Nothing failed; the founder found each one.
//
//   "why the fuck did i spend tokens getting it working on the solo
//    immersive if you havent done it on the other screens at the same time"
//
// A surface that renders ReactionsFloor must not take `reactions` as a prop:
// it reads the sim context, which cannot be forgotten at a call site.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (!src.includes('<ReactionsFloor')) continue;
  check(src.includes('usePreviewSim()'),
    f + ' renders ReactionsFloor but does not read the sim context — if a caller forgets the prop the button is silently dead');
}

// The like button must actually emit.
const parts = codeOnly(read('previewSoloParts.jsx'));
const fhAt = parts.indexOf('function FloatingHeart');
const fh = fhAt < 0 ? '' : parts.slice(fhAt, fhAt + 700);
check(fh.includes('onClick'),
  'FloatingHeart has no onClick — it renders, it looks pressable, and it does nothing');

// ── 21. One heart per tap; the meter earns the burst ───────────
// ⚠ SIX HEARTS PER TAP WAS WRONG and the combo meter was missing entirely.
// It exists in the shipped viewer (ComboMeter, a vertical fill bar above the
// like button) but was defined INSIDE MobileLiveViewer and never exported,
// so the simulator could not show it and the founder noticed it gone.
const simC = codeOnly(read('useStreamSim.js'));
check(simC.includes('HEART_COMBO_MAX'),
  'the like combo is gone — the meter has nothing to fill and the burst has no trigger');
check(simC.includes('spawnHearts(1)') || simC.includes('fireReaction = useCallback((n = 1)'),
  'a tap emits more than one heart again — the shipped viewer spawns exactly one per tap');
// ⚠ THE METER LIVES INSIDE THE LIKE BUTTON, AND NOWHERE ELSE. Mounted as a
// sibling it had to be positioned above the heart on five separate screens, and
// one screen ended up with a meter and no button at all. Bundled, it cannot be
// on a surface whose button is missing, and there is no per-screen offset.
// ⚠ AND THE REACTION ARRAY MUST DRAIN. ReactionsFloor re-maps its WHOLE events
// array on every change — it cannot tell a new event from an old one — so an
// array that only ever gets capped re-spawns everything still in it. That is why
// "one heart per tap" measured as seven. The real viewer removes each reaction
// from its own state after 2600ms; this must too, or the count creeps back.
const spawnAt = codeOnly(read('useStreamSim.js')).indexOf('const spawnHearts');
const spawnBody = spawnAt < 0 ? '' : codeOnly(read('useStreamSim.js')).slice(spawnAt, spawnAt + 420);
check(spawnBody.includes('prev.filter'),
  'spawnHearts never removes its burst — ReactionsFloor re-spawns the whole backlog on the next tap');
check(!spawnBody.includes('slice(-40)'),
  'the reaction array is capped instead of drained again — a cap is not a lifetime, and this is the exact bug');

const heartHost = codeOnly(read('previewSoloParts.jsx'));
check(heartHost.includes('<ComboMeter'),
  'the combo meter left the like button — five surfaces now have to place it themselves');
for (const f of FILES.filter((x) => x.endsWith('.jsx') && !x.endsWith('previewSoloParts.jsx'))) {
  check(!codeOnly(read(f)).includes('<ComboMeter'),
    f + ' mounts its own combo meter again — it belongs to <FloatingHeart>');
}

// ── 22. EVERY KEY A SURFACE READS MUST EXIST ON THE SIM ─────────
// ⚠⚠ THIS IS THE RULE THAT SHOULD HAVE EXISTED FIRST. The same defect has now
// shipped FOUR times: uploaded avatars, the PiP video, reactions, and combo.
// Every time, a surface destructured something the provider was never given,
// React handed back undefined, the default kicked in, and the feature was
// silently dead. Nothing threw. Nothing failed the build. The founder found
// each one.
//
// A missing key is now a build failure.
const simSrc = read('useStreamSim.js');
const retAt = simSrc.lastIndexOf('  return {');
const simReturn = retAt < 0 ? '' : simSrc.slice(retAt);
for (const f of FILES) {
  const src = codeOnly(read(f));
  for (const part of src.split('} = usePreviewSim()')) {
    const open = part.lastIndexOf('{');
    if (open < 0) continue;
    const decl = part.slice(open + 1);
    // A destructure is one statement on one or two lines; anything with a
    // semicolon or a blank line in it is unrelated code that happened to sit
    // before the call.
    if (decl.includes(';') || decl.includes(String.fromCharCode(10, 10))) continue;
    for (const raw of decl.split(',')) {
      const key = raw.split('=')[0].split(':')[0].trim();
      if (!key) continue;
      check(simReturn.includes(key),
        f + ' reads `' + key + '` from the sim, but useStreamSim never returns it — it will be undefined and the feature silently dead');
    }
  }
}

// And the provider must be handed the WHOLE sim, not a curated subset —
// the allowlist is what dropped all four.
const adminSrc = codeOnly(readFileSync('src/screens/admin/AdminStreamPreviewScreen.jsx', 'utf8'));
check(adminSrc.includes('sim={sim}'),
  'the provider is fed a curated object again — a hand-maintained allowlist has silently dropped a key four times');

// ── 23. THERE IS ONE LIKE BUTTON, AND IT IS WIRED ───────────────
// ⚠⚠ THREE SURFACES HAD THREE DIFFERENT LIKE BUTTONS. Two of them were pure
// decoration — same icon, same glass, no onClick — and the landscape view had
// none at all. So "the like button works" was true on exactly one screen while
// looking true on all of them, and rule 21 passed the whole time because it
// only checked that a METER was mounted, never that anything could fill it.
//
// A bespoke copy is now a build failure: every surface renders <FloatingHeart>,
// which reads fireReaction out of the context itself, so there is no prop for a
// caller to forget and no second definition to go stale.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (f.endsWith('previewSoloParts.jsx')) continue; // the one definition
  check(!src.includes('aria-label="Like"'),
    f + ' hand-rolls its own like button — two of those shipped with no onClick; use <FloatingHeart>');
  // ⚠ AND ONE OF THE FOUR CARRIED NO aria-label, so the check above walked
  // straight past it. The heart ART is the tell that cannot be omitted.
  check(!src.includes('src={likeIcon}'),
    f + ' draws the heart icon itself — that is a like button, wired or not; use <FloatingHeart>');
  // A surface that floats hearts must also offer a way to send one — with one
  // real exception: the BROADCASTER sees hearts arriving from viewers and has
  // nothing to tap, because nobody likes their own stream.
  if (!src.includes('<ReactionsFloor') || f.includes('Broadcaster')) continue;
  check(src.includes('<FloatingHeart'),
    f + ' floats hearts but has no like button — the landscape view shipped exactly like this');
}
const heartSrc = codeOnly(read('previewSoloParts.jsx'));
const heartFn = heartSrc.slice(heartSrc.indexOf('export function FloatingHeart'));
// A plain includes, deliberately: three attempts to write this as a regex lost
// their backslashes on the way into the file and matched nothing.
check(heartFn.slice(0, 900).includes('onClick={() => fireReaction'),
  'the shared like button lost its handler — every surface goes dead at once');
// ── 24. A CHAT THAT IS RENDERED MUST BE HANDED ITS MESSAGES ────────
// ⚠⚠ A SPLICE DROPPED `messages={messages}` FROM ONE CALL SITE AND THE BUILD
// WAS GREEN. The whole admin route went to the ErrorBoundary with
// "Cannot read properties of undefined (reading 'map')" — found by opening the
// page, not by any check. Same family as the codemod that shipped 36 broken
// sites: [[reference-green-build-is-not-correctness]].
//
// The component now defaults `messages = []` so it can never throw, and this
// asserts every call site still passes them, so a silently EMPTY chat cannot
// replace a silently CRASHING one.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  for (const part of src.split(/<(?:SimChat|PreviewChat)(?=[\s/>])/).slice(1)) {
    const props = part.slice(0, part.indexOf('/>') + 1);
    if (props.includes('function')) continue; // the declaration, not a call
    check(props.includes('messages='),
      f + ' renders a chat without passing `messages` — that crashed the whole admin route once');
  }
}
const chatDecl = codeOnly(read('previewChrome.jsx'));
check(chatDecl.includes('messages = []'),
  'PreviewChat lost its empty-array default — a missing prop becomes a route crash again');
// ── 25. A CHAT MUST BE BOUNDED, AND NOT BY A VIEWPORT UNIT ─────────
// ⚠⚠ THREE SCREENS DREW CHAT THROUGH THEIR OWN COMPOSER, and the desktop
// broadcaster's list measured 1,753px tall inside a 620px frame. Two causes,
// both encoded here:
//
// 1. `minHeight: 0` stops a flex child PUSHING its siblings. It does not stop it
//    PAINTING outside its box. Only overflow:hidden does, and `height: 100%`
//    does not always resolve — hence the absolute-fill mode.
// 2. `vh` is 30% of the ADMIN'S BROWSER WINDOW. The frame is a fixed device box
//    (393x852) and it is what gets captured, so a viewport unit made the layout
//    of a screenshot tool depend on the window it was screenshotted from.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  // A CSS length, so it is always a digit followed by vh and then a delimiter.
  check(!/\dvh\b/.test(src),
    f + ' sizes something in vh — the simulator frame is a fixed pixel box, so a viewport unit is always wrong here');
  // ⚠ A CALL INTO A LOCAL WRAPPER IS EXEMPT. PreviewBroadcasterScreen defines its
  // OWN PreviewChat (list + composer + dock) and THAT wrapper carries the bound;
  // demanding `fill` at the outer call site would demand it in the wrong place.
  const ownsWrapper = src.includes('function PreviewChat(');
  for (const part of src.split(/<(?:SimChat|PreviewChat)(?=[\s/>])/).slice(1)) {
    const props = part.slice(0, part.indexOf('/>') + 1);
    if (props.includes('layout="side"')) continue;   // docked column, parent-bounded
    if (ownsWrapper && !props.includes('overlay')) continue;
    if (props.includes('overlay ') && ownsWrapper) continue;
    check(props.includes('fill') || props.includes('height='),
      f + ' renders a chat with no bound at all — it will paint over whatever sits below it');
  }
}
// ── 26. ROLE, NOT JUST GEOMETRY ─────────────────────────────
// ⚠⚠ EVERY RULE ABOVE THIS ONE MEASURES BOXES, and that is why the whole set
// passed while every desktop VIEWER was handed timeout / ban / clear-chat and
// the BROADCASTER had no moderation at all. Mod tools on the wrong screen have
// perfect geometry. A guard that only measures cannot fail on a permission bug.
//
// The authority model is not invented here — functions/streamChatMod.js gates
// mute/ban/pin behind loadStreamForMod (host OR moderator) and the chat rules
// behind loadStream (host only). previewRoles.js mirrors it.
const rolesSrc = codeOnly(read('previewRoles.js'));
check(rolesSrc.includes('canModerate') && rolesSrc.includes('canConfigureChat'),
  'previewRoles lost a tier — moderation is host-or-mod, chat RULES are host-only, and the server enforces both');

// A moderation control may not render without a role check in the same file.
// ⚠ THE PERSON SHEET'S OWN LABELS WERE MISSING FROM THIS LIST, so the file that
// carries the most dangerous rows was only being watched by coincidence (it
// happens to contain 'Slow mode'). A word list has to name what it defends.
// ⚠ STATUS IS NOT A CONTROL. 'Slow mode' and 'Followers-only' appear both as
// host CONTROLS and as viewer-facing STATUS (“Slow mode is on — one message every
// 5s”). Triggering on those alone flagged previewStates.jsx, which renders
// banners and has no controls at all. Only unambiguous ACTION labels trigger the
// rule; the ambiguous ones are still checked once a file is in scope.
const MOD_WORDS = ['Timeout a viewer', 'Ban a viewer', 'Clear chat',
  'Appoint a moderator', 'Time out', 'Ban from this stream', 'Make moderator'];
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (!MOD_WORDS.some((w) => src.includes(w))) continue;
  // The BROADCASTER is the host by definition, and PreviewModeration IS the
  // host's dedicated moderation screen. Neither needs to ask who is watching.
  if (f.includes('Broadcaster') || src.includes('function PreviewModeration')) continue;
  // ⚠⚠ THE FIRST VERSION OF THIS CHECK WAS USELESS AND ONLY A NEGATIVE TEST
  // SHOWED IT. `src.includes('canModerate(')` is a substring test over a WHOLE
  // FILE, so ungating the gavel still passed — the file mentions canModerate
  // elsewhere (the panel-close derivation). Third time this exact shape has
  // fooled a guard in this repo. The gate has to be in the CONTROL'S OWN SCOPE:
  // slice the characters immediately before it and assert the check is in THAT.
  // ⚠ A GATE HAS MORE THAN ONE SPELLING. This accepted only the desktop panel's
  // shape, so adding the same rows to the person sheet — correctly wrapped in
  // `{canModerate(role) && (` — was reported as ungated. A rule that knows one
  // spelling of a thing defends one spelling of a thing (the same mistake rule 6
  // made with the `paid` glyph).
  let gated = src.includes('ModerationSheet') || src.includes('canModerate(role) && (');
  if (!gated) {
    const at = src.indexOf('Moderation actions');
    gated = at > 0 && src.slice(Math.max(0, at - 260), at).includes('canModerate(');
  }
  check(gated,
    f + ' renders moderation controls with no role gate — every viewer could ban people');
}

// ⚠ A GATE WRITTEN IN PROSE IS NOT A GATE. The old panel's own footer read
// "Broadcaster / moderator only" while rendering for everyone.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  for (const claim of ['moderator only', 'Broadcaster / moderator', 'host only']) {
    if (!src.toLowerCase().includes(claim.toLowerCase())) continue;
    if (f.includes('Broadcaster')) continue;   // the host, by definition
    check(src.includes('canModerate(') || src.includes('canConfigureChat('),
      f + ' claims "' + claim + '" in copy but has no role check — a caption is not a permission');
  }
}

// ⚠ NO UNBUILT-FEATURE COPY. These captures go on the Play listing, and
// "Cheer with VP" shipped beside "price tiers pending" for a gifting system
// CLAUDE.md records as DEFERRED with no catalogue.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  // ⚠ 'placeholder' IS AN HTML ATTRIBUTE, not prose — the first version of this
  // rule failed on every <input placeholder="…">. Match only user-visible copy.
  for (const w of ['coming soon', 'Coming Soon', 'tiers pending', 'TBD', 'not yet available']) {
    check(!src.includes(w),
      f + ' ships "' + w + '" — a Play-store capture must not advertise something unbuilt');
  }
  check(!src.includes('Cheer with VP'),
    f + ' brings back Cheer with VP — VP is progression, coins are the only spend');
}
// ── 27. EVERY BROADCASTER 'More' SHEET OFFERS MODERATION ───────────
// ⚠ THE FILE HAS THREE BROADCASTER BRANCHES AND TWO SEPARATE "More" SHEETS.
// Adding the moderation row reached one of them, so the SOLO broadcaster still
// had no way in — found by opening the sheet, not by grepping, because the
// label I searched for did exist, in the other branch. Count the sheets.
const bcSrc = codeOnly(read('PreviewBroadcasterScreen.jsx'));
const sheets = bcSrc.split('{moreOpen &&').length - 1;
const modRows = bcSrc.split("label=\"Chat moderation\"").length - 1;
check(sheets > 0 && modRows >= sheets,
  'a broadcaster More sheet has no Chat moderation row — ' + modRows + ' row(s) for ' + sheets + ' sheet(s)');
// ── 28. YOU CAN ALWAYS REACH A PERSON ──────────────────────────
// ⚠⚠ THE WHOLE OF MODERATION AND GIFTING RESTED ON ONE MISSING ATTRIBUTE.
// PreviewChat opens the person sheet from , and ChatRow never
// emitted it — measured  count of ZERO across every surface. So
// nobody could be timed out, banned, promoted, reported or gifted to, because
// every one of those asks "which person?" and no screen could answer.
//
// Two ways in, and both are guarded: the chat row, and the viewer count.
const chatSrc = codeOnly(read('previewChrome.jsx'));
// ⚠ SCOPED TO ChatRow's OWN MARKUP, and only a negative test showed why. A
// whole-file `includes('data-uid')` stayed GREEN with the attribute deleted,
// because the click handler contains the SELECTOR STRING '[data-uid]'. The rule
// was proving the READER existed while the EMITTER was gone — which is the exact
// bug it exists to catch. Fourth time a substring-over-a-whole-file check has
// fooled a guard in this repo.
const chatRowAt = chatSrc.indexOf('function ChatRow');
const chatRowSrc = chatRowAt < 0 ? '' : chatSrc.slice(chatRowAt, chatRowAt + 1800);
check(chatRowSrc.includes('data-uid='),
  'ChatRow stopped emitting data-uid — tapping a name goes dead and every per-person action becomes unreachable');
check(chatSrc.includes("closest"),
  'the chat click handler reads e.target directly again — a tap on the avatar image finds no uid');
check(chatSrc.includes('function ViewerListSheet'),
  'the viewer list is gone — a host cannot see who is in the room, which is the only way to reach someone who has not just spoken');
check(chatSrc.includes('placeholder="Search viewers"'),
  'the viewer list lost its search — six faces is not a picker on a stream with 1,284 viewers');

// Every live surface offers a way into the viewer list.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (!src.includes('<ReactionsFloor')) continue;   // live surfaces only
  // ⚠ THE HANDLER, NOT THE TAG. Accepting `<ViewerPill` alone passed with the
  // onClick deleted — a pill that opens nothing is exactly the dead control this
  // rule exists to stop. Only the action counts.
  check(src.includes("kind: 'viewers'"),
    f + ' has no way to open the viewer list — that is how this feature ended up on one surface four times before');
}
// ── 29. A HANDLER WIRED TO A BARE onClick VALIDATES ITS OWN ARGUMENT ───
// ⚠⚠ ADDING AN OPTIONAL  PARAMETER TO fireTip BROKE THE RAIL INSTANTLY.
// The rail wires it as , so React passes the CLICK EVENT
// as the first argument. A SyntheticEvent is truthy, so the goal maths did
//  and the tip goal rendered **0 / 5,000**. Found by testing,
// not by reading — the code looks perfectly reasonable.
const simArgs = codeOnly(read('useStreamSim.js'));
const tipAt = simArgs.indexOf('const fireTip = useCallback');
const tipBody = tipAt < 0 ? '' : simArgs.slice(tipAt, tipAt + 420);
check(tipBody.includes('Number.isFinite'),
  'fireTip trusts its first argument again — it is wired to a bare onClick, so that argument is a click event and the tip goal goes to 0');
// ── 30. FAILURE STATES EXIST, AND ON EVERY SURFACE ─────────────────
// ⚠⚠ THE PREVIEW COULD ONLY DRAW A STREAM THAT WAS WORKING. Measured against
// the real viewers: reconnect 7 references vs 0, buffering 1 vs 0, and nothing
// at all for host-dropped, ended-while-watching, offline, muted, slow mode or
// the paywall. Those are screens real people hit and a creator pricing a stream
// needs to SEE what a non-subscriber sees. A tool that can only capture the
// happy path cannot design the unhappy ones.
for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
  const src = codeOnly(read(f));
  if (!src.includes('<ReactionsFloor')) continue;   // live surfaces only
  check(src.includes('<PlaybackState'),
    f + ' has no playback state overlay — reconnecting, host-dropped and offline cannot be captured there');
  check(src.includes('<StreamPaywall'),
    f + ' cannot show a gated stream — entitlements.js supports subscriber-only and ticketed streams and no surface could draw one');
  // ⚠⚠ COUNT THE RENDER BRANCHES, DO NOT ASK WHETHER THE FILE MENTIONS THEM.
  // The file-level version of this rule passed while PreviewBroadcasterScreen
  // had the states on ONE of its three returns: broadcaster desktop could not
  // draw a reconnect or a gated stream at all. A single String.replace() only
  // ever patches the first match, which is the same shape as the codemod that
  // shipped 36 broken sites. PreviewSheets is the marker for a live render
  // path, so the two counts must be equal.
  const paths = (src.match(/<PreviewSheets openSheet=/g) || []).length;
  const states = (src.match(/<StreamPaywall kind={gate}/g) || []).length;
  check(paths === states,
    f + ' has ' + paths + ' render branches but the state overlays on ' + states + ' of them — a branch that cannot show reconnect, ended, offline or a paywall');
}
// ⚠ 31. THE CHAT-STATE BANNER IS ON EVERY VIEWER SURFACE.
// A composer you cannot type in, with nothing saying why, reads as a broken
// app rather than a rule. Every viewer surface has to be able to say what chat
// is doing to THIS person and what would change it.
//
// ⚠ THE BROADCASTER IS DELIBERATELY EXEMPT and must not be added: the copy is
// second-person ("you are timed out"), a host is never rate-limited by their
// own room, and the host sees these as SETTINGS in the moderation sheet.
const VIEWER_SURFACES = FILES.filter((x) => x.endsWith('.jsx') && x.startsWith('Preview')
  && !x.includes('Broadcaster'));
for (const f of VIEWER_SURFACES) {
  const src = codeOnly(read(f));
  if (!src.includes('<ReactionsFloor')) continue;   // live surfaces only
  check(src.includes('<ChatStateBanner'),
    f + ' has no chat-state banner — slow mode, followers-only, subscribers-only and a timeout are all invisible there');
  check(/chatState = 'open'/.test(src),
    f + ' mounts the banner but never reads chatState off the context, so it can only ever draw the open state');
}
// The state must come from the SIMULATOR, or the rail cannot drive it.
{
  const sim = codeOnly(read('useStreamSim.js'));
  for (const k of ['playback', 'setPlayback', 'chatState', 'setChatState', 'gate', 'setGate']) {
    check(sim.includes(k), 'useStreamSim no longer exposes ' + k + ' — the rail control for it is now inert');
  }
}

// ── 32. THE ENDED SCREEN OFFERS A REPLAY, IN ALL FOUR OF ITS STATES ──
// ⚠ THE VIEWER'S ENDED SCREEN HAD ONE BUTTON AND NO REPLAY, on a product
// whose Pro tier sells 90-day replays as a headline perk. This is the only
// screen a viewer ever reaches a replay from, so it is the screen that decides
// whether the feature is worth paying for.
//
// ⚠ FOUR COPY STATES, NOT ONE (MobileLiveViewer.jsx:657). "still processing"
// and "no longer available" are different promises and must not collapse into
// each other — one is worth waiting for and one is not.
{
  const ended = codeOnly(read('PreviewEndAndSetup.jsx'));
  for (const phrase of ['Catch the replay', 'still processing', 'no longer available', 'goes live again']) {
    check(ended.includes(phrase),
      'the ended screen lost the "' + phrase + '" state — the four replay outcomes have collapsed into one message');
  }
  check(ended.includes('Watch replay'), 'the ended screen has no Watch replay button — the only route to a replay a viewer ever gets');
  check(ended.includes('setReplayOpen(true)') && ended.includes('setReplayOpen(false)'),
    'the replay player cannot be opened or cannot be left — a one-way screen is worse than no screen');
  check(ended.includes('Following') && ended.includes("setFollowed"),
    'the ended screen lost its Follow action — the one thing that converts a finished stream into a return visit');
  // The rail has to be able to drive all four, and on the phase where they show.
  const rail = codeOnly(read('../AdminStreamPreviewScreen.jsx'));
  check(rail.includes('sim.setVod'), 'the rail can no longer select a replay state, so three of the four are uncapturable');
  // ⚠ THE SELECTOR WAS FIRST PUT IN THE LIVE-ONLY PANEL, WHICH HID IT ON THE
  // ENDED PHASE — the only phase it controls. Second control this session to
  // do that, after the phase chips collided with the playback labels.
  const vodAt = rail.indexOf('sim.setVod');
  const before = rail.slice(Math.max(0, vodAt - 1400), vodAt);
  check(before.lastIndexOf("phase === 'ended'") > before.lastIndexOf("phase === 'live'"),
    'the replay selector sits inside the live-only panel again — it is invisible on the ended phase, which is the only place it applies');
}

// ── 33. SPOKEN CHAT (TTS) IS CAPTURABLE, ON EVERY VIEWER SURFACE ──
// ⚠ TTS HAD TWO REFERENCES IN THE REAL VIEWERS AND ZERO HERE. A feature that
// reads a stranger's words aloud into someone's ears could not be designed,
// reviewed or screenshotted.
{
  for (const f of VIEWER_SURFACES) {
    const src = codeOnly(read(f));
    if (!src.includes('<ReactionsFloor')) continue;
    check(src.includes('<TtsStrip'),
      f + ' has no spoken-chat strip — muted, needs-a-tap and the Pro lock are all invisible there');
  }
  const st = codeOnly(readState());
  // ⚠ MUTE IS MANDATORY (ChatPanel.jsx:518). A strip that can start speech and
  // not stop it is the one version of this that must never ship.
  check(st.includes('Spoken messages muted') && st.includes('Mute spoken messages'),
    'the spoken-chat strip lost its mute state — the viewer would have no one-tap way to stop a stranger being read aloud');
  // ⚠ SILENT AUTOPLAY REFUSAL IS THE STATE PEOPLE ACTUALLY HIT (streamTts.js:42).
  check(st.includes('Tap to hear spoken messages'),
    'the needs-a-gesture state is gone — Web Speech fails silently without one, so the feature just looks broken');
  // ⚠ THE LOCKED STRIP MUST NAME BOTH GATES, NOT JUST THE PAID ONE.
  // canUseStreamTts() returns true on level OR Pro (founder, 2026-08-26: "both,
  // can be unlocked or by subscribing to pro"). The strip used to read "Spoken
  // chat is a Pro feature", which is true and incomplete: it hides the earned
  // path and turns a ladder reward into a paywall. This asserts the substance,
  // not a literal, so the copy can be rewritten without silently losing a gate.
  {
    // SCOPED TO TtsStrip. The first version searched the whole file for
    // `locked:` and matched an earlier component, so the slice held someone
    // else's object and both assertions failed against correct code.
    const fn = st.indexOf('export function TtsStrip');
    const m = fn > 0 ? st.indexOf('locked:', fn) : -1;
    check(m > 0, 'the spoken-chat locked state is gone. It is the view that explains why nothing is being read aloud');
    if (m > 0) {
      // TO END OF LINE, NOT TO the next `},`. A template placeholder ends in
      // `},` too, so ${TTS_LEVEL}, terminated the slice mid-string and the Pro
      // half of the sentence fell outside it. The row is one line; use the line.
      const row = st.slice(m, st.indexOf(String.fromCharCode(10), m));
      check(/level/i.test(row),
        'the locked spoken-chat strip no longer names the LEVEL gate. canUseStreamTts passes on level OR Pro, so Pro-only copy hides the path a free player can actually earn');
      check(/pro/i.test(row),
        'the locked spoken-chat strip no longer names Pro, which is the immediate way in');
      check(!row.includes('level ${') || st.includes('RANK_UNLOCKS.find'),
        'the spoken-chat level is interpolated from something other than RANK_UNLOCKS. Read the real ladder, never restate the number');
    }
    check(st.includes('TTS_UNLOCK_ID'),
      'previewStates no longer imports TTS_UNLOCK_ID, so the level shown is a literal that will drift from the ladder');
  }
  // ⚠ IT MUST NEVER ACTUALLY SPEAK. A capture session that starts talking is a defect.
  check(!st.includes('speechSynthesis') && !st.includes('SpeechSynthesisUtterance'),
    'the preview is calling real speech synthesis — a screenshot tool must never make noise');
  // The host owns the switch, and the rail must be able to drive the viewer states.
  check(codeOnly(read('PreviewBroadcasterScreen.jsx')).includes('Read chat aloud'),
    'the host lost the Read chat aloud toggle — ttsEnabled is theirs to set and nothing else can turn it on');
  check(codeOnly(read('../AdminStreamPreviewScreen.jsx')).includes('sim.setTts'),
    'the rail can no longer select a spoken-chat state, so four of the five are uncapturable');
}

// ── 34. THE FAILURE AND EMPTY STATES ────────────────────────────────
// ⚠⚠ ZERO VIEWERS IS THE MOST IMPORTANT SCREEN IN THE PRODUCT AND NEITHER THE
// PREVIEW NOR THE SHIPPED BROADCASTER HAD IT. Measured with the viewer count
// driven to 0: the screen renders the digit "0" beside an eye icon and nothing
// else. Every new creator sees this, and what it says decides whether they
// stream a second time.
{
  const st = codeOnly(readState());
  // It must offer WORK TO DO. Reassurance changes no numbers.
  for (const act of ['Share the link', 'Invite a friend', 'Boost this stream']) {
    check(st.includes(act), 'the zero-viewer state lost "' + act + '" — it is one of only three things that change the number');
  }
  // ⚠ AND IT MUST NOT READ AS FAILURE. A host told nobody is watching ends the
  // stream; the framing is early, not empty.
  check(st.includes('You are live and early'),
    'the zero-viewer heading changed — it must frame the moment as early, never as nobody watching');

  // ⚠ A BITRATE NUMBER IS NOT A WARNING (BroadcasterScreen.jsx:1088 shows one
  // and nothing else). Both host-side failures have to interrupt and say which
  // end is at fault.
  check(st.includes('Your connection is struggling') && st.includes('You are offline'),
    'the broadcaster health warnings are gone — a host cannot see their own uplink dying');
  check(st.includes('Lower quality') && st.includes('Reconnect'),
    'the health warnings lost their actions — a warning with nothing to press is an alarm, not a control');

  // ⚠ BANNED IS NOT MUTED. A timeout ends by itself and says when; a ban does
  // not, and the only honest offer is the appeal.
  check(st.includes('You are banned from this chat') && st.includes("'Appeal'"),
    'the banned chat state is gone or lost its appeal path — a banned viewer would wait for a countdown that never comes');

  // ⚠ A BLOCK IS NOT A PAYWALL. There is nothing to buy, so a purchase CTA
  // would be a lie.
  check(st.includes('Not available in your region') && st.includes('For verified adults'),
    'the region and age blocks are gone — two states a real viewer hits that no surface could draw');
  const regionAt = st.indexOf('Not available in your region');
  const regionBlock = regionAt < 0 ? '' : st.slice(Math.max(0, regionAt - 400), regionAt + 400);
  check(!/Unlock for|Subscribe/.test(regionBlock),
    'the region block is offering a purchase — there is nothing to buy, and selling against a block is a lie');

  check(st.includes('No messages yet') && st.includes('Chat is quiet so far'),
    'the empty-chat state is gone — an empty chat with nothing in it reads as broken, and it is every stream\'s first minutes');

  // The rail must be able to drive the host failures.
  check(codeOnly(read('../AdminStreamPreviewScreen.jsx')).includes('sim.setHealth'),
    'the rail can no longer select a broadcast-health state, so neither host failure is capturable');

  // ⚠ AND THEY GO ON EVERY BRANCH. Same trap as the state overlays.
  const bc = codeOnly(read('PreviewBroadcasterScreen.jsx'));
  const paths = (bc.match(/<PreviewSheets openSheet=/g) || []).length;
  const warn = (bc.match(/<HealthWarning state=/g) || []).length;
  const zero = (bc.match(/<ZeroViewers compact/g) || []).length;
  check(paths === warn && paths === zero,
    'the broadcaster has ' + paths + ' render branches but the health warning on ' + warn + ' and the zero-viewer state on ' + zero + ' — a branch where a host cannot see either');
}

// ── 35. THE SHORTFALL NEVER BLOCKS THE PURCHASE ─────────────────────
// ⚠⚠ FOUNDER, ON EXACTLY THIS: "we cant create a design that prevents the user
// from checking out if they are already there and willing to pay." So a tip or
// boost priced above the balance CHANGES WHAT THE BUTTON DOES. It is never
// disabled, and it never navigates away — leaving a live stream to buy coins
// means missing the moment you were paying for.
{
  const ch = codeOnly(read('previewChrome.jsx'));

  // the shortfall is computed and shown
  check(ch.includes('const short = Math.max(0, cost - balance)'),
    'the tip sheet no longer compares the price against the wallet — "not enough coins" is invisible again');
  check(ch.includes('short') && ch.includes('Your balance'),
    'the tip sheet stopped showing the balance — being surprised at the last step is what makes a purchase get abandoned');

  // ⚠ AND THE BUTTON MUST STAY LIVE. A disabled CTA is the banned design.
  const tipAt = ch.indexOf('function TipSheet');
  const tipEnd = ch.indexOf('function QuickSheet');
  const tipBody = tipAt >= 0 && tipEnd > tipAt ? ch.slice(tipAt, tipEnd) : '';
  check(tipBody.length > 0, 'could not isolate TipSheet to check its CTA');
  check(!/disabled=\{[^}]*short/.test(tipBody),
    'the tip CTA is disabled on a shortfall — the one design the founder ruled out by name');
  check(tipBody.includes('Top up'),
    'the tip CTA no longer offers a top-up, so a viewer who is short has nowhere to go');

  // ⚠ TOP-UP IS A SHEET OVER THE STREAM, NEVER A ROUTE.
  check(ch.includes('function TopUpSheet'), 'the top-up sheet is gone — the Top up button leads nowhere, which is the defect this whole audit exists for');
  const tuAt = ch.indexOf('function TopUpSheet');
  const tuBody = tuAt >= 0 ? ch.slice(tuAt, tuAt + 3000) : '';
  check(!/navigate\(|href=|window\.location/.test(tuBody),
    'the top-up sheet navigates — leaving a live stream to buy coins means missing the moment you were paying for');

  // ⚠⚠ THE PRICES COME FROM THE REAL, FOUNDER-LOCKED LADDER. Inventing a pack,
  // a price or a bonus here would put a number on a capture that Vergr does not
  // charge.
  check(/import \{ COIN_PACKS \} from '\.\.\/\.\.\/\.\.\/utils\/vpSystem'/.test(ch),
    'the top-up sheet is no longer reading COIN_PACKS from vpSystem — a local price list would advertise prices Vergr does not charge');
  check(!/priceUSD:\s*[0-9]/.test(tuBody) && !/coins:\s*[0-9]{2,}/.test(tuBody),
    'the top-up sheet has hardcoded coin amounts or prices in it — the ladder is founder-locked and must be read, never restated');

  check(codeOnly(read('../AdminStreamPreviewScreen.jsx')).includes('sim.setBalance'),
    'the rail can no longer set the wallet balance, so the shortfall state is unreachable');

  // ── EMPTY CHAT, AT EVERY RENDER SITE ──
  // ⚠ FIVE PLACES RENDER THE MESSAGE LIST, NOT ONE. Fixing the shared
  // PreviewChat alone leaves the three solo/viewer surfaces showing a bare box.
  let sites = 0, guarded = 0;
  for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
    const src = codeOnly(read(f));
    sites += (src.match(/messages(\.slice\(-\d+\))?\.map\(/g) || []).length;
    guarded += (src.match(/messages\.length === 0 && <EmptyChat/g) || []).length;
  }
  check(sites > 0 && guarded >= 5,
    'only ' + guarded + ' of ' + sites + ' message-list render sites have an empty state — an empty chat with nothing in it reads as broken, and it is every stream\'s first minutes');
}

// ⚠ 36. NO OVERLAY MAY HAVE A SEE-THROUGH FILL OVER LIVE VIDEO.
// The broadcast health warning shipped with an 18% amber tint and its text ran
// straight through the gameplay behind it — unreadable, and only visible by
// rendering it. Semi-transparent colour over a busy, saturated background
// averages to mud; the tone belongs on the BORDER and the icon, never the fill.
// Same lesson `.vg-bloom` and the store art already record.
{
  const st = codeOnly(readState());
  // every panel that sits over the video declares its base
  for (const [name, needle] of [
    ['HealthWarning', 'export function HealthWarning'],
    ['ZeroViewers', 'export function ZeroViewers'],
  ]) {
    const at = st.indexOf(needle);
    const body = at < 0 ? '' : st.slice(at, at + 2200);
    check(at >= 0, name + ' is gone from previewStates');
    // the fill must be a near-black at 0.8+ alpha, not a tinted wash
    // ⚠ REGEX-FREE ON PURPOSE. Four separate attempts to write this as a regex
    // through a generator lost their backslashes, turning \( into a capture
    // group, so it matched nothing and passed on a file that still had the bug.
    // ⚠ A SOLID HEX IS THE STRONGEST FORM OF THIS, NOT A FAILURE OF IT. These
    // panels were rewritten to solid values after the founder rejected
    // semi-transparent pill backgrounds outright, and the first version of this
    // rule then failed on them for "declaring no rgba background" — a guard
    // failing on code that had become MORE correct. Accept either: a solid hex,
    // or a dark rgba at 0.8+ alpha.
    const solid = body.includes("background: S.") || body.includes("background: '#");
    const fills = [];
    let fillAt = body.indexOf("background: 'rgba(");
    while (fillAt >= 0) {
      const open = fillAt + 17;
      const close = body.indexOf(')', open);
      if (open > 0 && close > open) {
        const parts = body.slice(open + 1, close).split(',').map((x) => Number(x.trim()));
        if (parts.length === 4 && parts.every((x) => Number.isFinite(x))) fills.push(parts);
      }
      fillAt = body.indexOf("background: 'rgba(", fillAt + 1);
    }
    const base = fills[0];
    const bad = !base ? [] : [base].filter(([r, g, b2, alpha]) => {
      const dark = r < 60 && g < 60 && b2 < 60;
      return !dark && alpha < 0.8;   // a tint over video, not a base
    });
    check(solid || fills.length > 0,
      name + ' declares no background at all — it cannot be checked for legibility over video');
    check(solid || bad.length === 0,
      name + ' has a see-through coloured fill (' + bad.map((x) => 'rgba(' + x.join(',') + ')').join(', ') + ') — over live gameplay that text is unreadable');
  }
}

// ── 37. EVERY CHAT ROW WEARS WHAT THE LADDER SELLS ──────────────────
// ⚠⚠ `UserName` APPEARS IN 97 FILES ACROSS THE APP AND IN ZERO OF THE PREVIEW.
// So the chat — the single most-captured surface in the product — rendered a
// plain bold name and showed none of the typeface, colour, gradient, glow or
// rank crest that the entire VP ladder exists to sell. Every screenshot taken
// from this tool undersold the product.
//
// ⚠ THREE COMPONENTS RENDER A CHAT NAME, not one: previewChrome.ChatRow,
// previewSoloParts.SoloChatRow and PreviewViewerScreen.PreviewChatRow. Wiring
// one leaves the two solo views and both viewer layouts on plain text — the
// one-surface miss this audit keeps finding.
{
  const ROWS = [
    ['previewChrome.jsx', 'function ChatRow('],
    ['previewSoloParts.jsx', 'export function SoloChatRow('],
    ['PreviewViewerScreen.jsx', 'function PreviewChatRow('],
  ];
  for (const [f, sig] of ROWS) {
    const src = codeOnly(read(f));
    const at = src.indexOf(sig);
    check(at >= 0, f + ' no longer defines ' + sig + ' — the row this rule guards is gone');
    const body = at < 0 ? '' : src.slice(at, at + 2600);
    check(body.includes('<UserName'),
      f + ' renders a chat name without <UserName> — the typeface, colour, gradient and glow the ladder sells would all be invisible');
    check(body.includes('<RankBadge'),
      f + ' renders a chat name without the rank crest — the only place most users ever see the level system');
    // ⚠ THE LEVEL IS WHAT SWITCHES EVERY COSMETIC ON. A <UserName> with no
    // vpLevel renders exactly the plain text this rule exists to stop.
    check(body.includes('vpLevel'),
      f + ' passes no vpLevel, so <UserName> resolves nothing and the row is plain text with extra steps');
  }
  // The message has to carry it, or no row can.
  const cast = codeOnly(read('previewCast.js'));
  check(cast.includes('vpLevel: c.vpLevel') && cast.includes('isMod: !!c.isMod'),
    'makeMessage stopped carrying vpLevel or isMod — a chat row cannot look a person up, so a badge only on the cast entry can never be drawn');
}

// ⚠ 38. NO CYAN, AND ONE BADGE PER THING.
// I hand-rolled a cyan MOD pill in the chat row. Two faults at once: cyan
// #4DFFD4 is off-brand (violet, pink and gold only), and it was a SECOND visual
// language for a badge the product already ships as founder-supplied ART,
// sitting in the same list as the real one on the solo views.
{
  for (const f of FILES) {
    const src = codeOnly(read(f));
    check(!src.includes("4DFFD4") && !src.includes("77,255,212"),
      f + " uses brand cyan — the palette is violet, pink and gold; cyan was ruled off-brand");
  }
  // one definition per badge
  const chrome = codeOnly(read("previewChrome.jsx"));
  check(chrome.includes("<ModBadge") && chrome.includes("<SubPill"),
    "the chat row hand-rolled its badges again instead of using the shipped ones — two designs for one thing in the same list");
  const parts = codeOnly(read("previewSoloParts.jsx"));
  check(parts.includes("export function ModBadge") && parts.includes("export function SubPill"),
    "the shared badge components stopped being exported, so every surface will grow its own again");
}

// ── 39. NO ICON-ONLY BUTTON MAY BE UNNAMED ──────────────────────────
// ⚠⚠ A MATERIAL LIGATURE IS NOT AN ACCESSIBLE NAME. `Icon` renders the icon id
// as text — that is how a ligature font works — so before `aria-hidden` a
// screen reader announced "close", "cameraswitch", "content_cut", "poll",
// "badge", "mood" and "settings" as button names, and on the desktop
// broadcaster the id ran INTO the label: "micMic", "videocamCamera",
// "dashboard_customizeLayout". Six of seven surfaces were affected.
//
// Accessibility is a Play review item for an app with live UGC, so this is a
// launch blocker, not polish.
{
  const st = codeOnly(read('../../../components/Icon.jsx'));
  check(st.includes('aria-hidden'),
    'Icon stopped being aria-hidden — every icon in the APP is leaking its ligature into the accessible name again');

  // ⚠ AND THE OTHER HALF: with the ligature hidden, an icon-only button has NO
  // name unless it carries one. Scan for a <button> whose only child is an
  // <Icon> and which has no aria-label.
  for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
    const src = read(f);
    let i = 0;
    const offenders = [];
    for (;;) {
      const b1 = src.indexOf('<button', i);
      if (b1 < 0) break;
      const gt = src.indexOf('>', b1);
      const end = src.indexOf('</button>', gt);
      i = b1 + 7;
      if (gt < 0 || end < 0) continue;
      const openTag = src.slice(b1, gt + 1);
      const inner = src.slice(gt + 1, end);
      if (openTag.includes('aria-label')) continue;
      // one Icon and nothing else that could name it
      const icons = (inner.match(/<Icon\s/g) || []).length;
      if (icons !== 1) continue;
      if (inner.includes('<img')) continue;   // an alt IS a valid name
      const stripped = inner.replace(/<Icon[\s\S]*?\/>/g, '').replace(/\s/g, '');
      if (stripped.length > 0) continue;      // it has its own text
      const nm = (inner.match(/name="([a-z_]+)"/) || [])[1] || '?';
      offenders.push(nm);
    }
    check(offenders.length === 0,
      f + ' has icon-only button(s) with no aria-label (' + offenders.join(', ') + ') — a screen reader announces nothing at all for them');
  }
}

// ⚠ 40. THE TWO COMPLIANCE ITEMS THAT GET AN APP REJECTED.
// Google requires, for an app carrying live UGC, an in-app path to the community
// guidelines FROM CHAT, and a way to contest an enforcement action. The stream
// had neither: a banned viewer was simply told no, with no route out.
{
  const ch = codeOnly(read("previewChrome.jsx"));
  // ⚠ THE REAL ROUTE, NOT AN INVENTED PAGE. AppRouter:820.
  check(ch.includes("/platform/acceptable-use"),
    "the guidelines link is gone from the report and appeal sheets — Google asks for an in-app path to them from chat");
  check(ch.includes("function AppealSheet"),
    "the appeal sheet is gone — an enforcement action with no way to contest it is a Play review item");
  check(ch.includes("kind === 'appeal'"),
    "the appeal sheet is not routed, so the Appeal button leads nowhere — worse than no appeal, because it looks like a route out");
  const st = codeOnly(readState());
  check(st.includes("onAppeal") && st.includes("appeal: 'ban'") && st.includes("appeal: 'timeout'"),
    "the banned/timed-out banners lost their appeal route");
  for (const f of VIEWER_SURFACES) {
    const src = codeOnly(read(f));
    if (!src.includes("<ChatStateBanner")) continue;
    check(src.includes("onAppeal="),
      f + " renders the chat-state banner without an appeal handler, so its Appeal button is dead on that surface");
  }
}

// ⚠ 41. A PHASE THAT OPENS A SHEET MUST MOUNT A SHEET HOST.
// “Share the replay” on the ended screen set the sheet state and NOTHING
// rendered it, because only the live surfaces mounted <PreviewSheets>. The state
// change was real and the render was missing, so the button was dead — the exact
// class of defect this whole audit exists to remove, reintroduced by me. Found by
// clicking it, not by reading it.
{
  const rail = codeOnly(read("../AdminStreamPreviewScreen.jsx"));
  // ⚠ REGEX-FREE. Fifth time a generated pattern lost its backslashes today.
  const opens = rail.split("setOpenSheet({").length - 1;
  check(opens === 0 || rail.includes("<PreviewSheets"),
    "the rail opens a sheet on a phase that mounts no <PreviewSheets> — that control is dead");
  // and the growth actions themselves
  const ended = codeOnly(read("PreviewEndAndSetup.jsx"));
  check(ended.includes("Share the replay"),
    "the replay cannot be shared — it is the only artefact a finished stream leaves behind");
  check(ended.includes("Schedule your next stream"),
    "the host lost the schedule action, at the one moment they are most likely to commit to another stream");
  check(ended.includes("UP NEXT"),
    "the end of a stream sends the viewer to a list again — naming one live stream is the difference between a session ending and continuing");
  // ⚠ FOLLOW *IS* THE NOTIFY MECHANISM (index.js onStreamWentLive). There is NO
  // per-creator notification setting on the server, so a bell would be a control
  // implying a preference that does not exist.
  check(ended.includes("notification the moment they go live") || ended.includes("will get a notification"),
    "the Follow button stopped saying what it does — it is the only go-live notification switch there is");
}

// ── 42. THE FOUNDER DECISIONS OF 2026-09-02 ─────────────────────────
// Four answers, built. Each guard names the reasoning so it is not undone by
// someone who does not know why it is there.
{
  const st = codeOnly(readState());
  const ch = codeOnly(read('previewChrome.jsx'));

  // ── 4. AUDIO-ONLY BROADCASTS
  // ⚠ A CO-HOST ALREADY JOINS AUDIO-ONLY, so refusing a solo host is an
  // inconsistency, not a policy — and a creator with no camera cannot broadcast
  // at all today.
  check(st.includes('export function AudioStage'), 'the audio-only stage is gone — a podcast or a camera-less creator has no surface');
  // ⚠⚠ SILENCE PLUS A BLACK RECTANGLE READS AS BROKEN. The three things that stop
  // that are the words, the level meter and the host identity. Losing any one of
  // them and a viewer reports a bug instead of listening.
  check(st.includes('AUDIO ONLY'), 'the audio stage no longer SAYS it is audio-only — a viewer cannot tell it from a failed video');
  check(st.includes('scaleY'), 'the audio level meter is gone — it is the only proof the stream is still alive when nobody is talking');
  // ⚠⚠ AND IT MUST NOT OUTRANK A REAL FAILURE — NOW ENFORCED BY z-ORDER, NOT BY
  // SOURCE ORDER. This rule used to demand that PlaybackState and StreamPaywall
  // appear within 500 characters BEFORE `<AudioStage`, which encoded the old
  // architecture: all three in one ternary. That architecture was the bug. Audio-
  // only is not a blocking state, it REPLACES THE VIDEO, and rendering it like a
  // blocking state put an opaque `inset: 0` layer at z-4 over the whole surface.
  // Measured on the live page 2026-09-02, with elementFromPoint at each control's
  // centre: the mobile broadcaster had 2 reachable controls and 10 buried — among
  // them **End stream and Mic**, so a host could not stop their own broadcast — and
  // the desktop viewer had 0 reachable and 20 buried, Follow and the composer
  // included. Six of the seven surfaces were unusable in audio-only.
  //
  // The real invariant was never 'appears later in the file'. It is: the failure
  // states paint ABOVE the audio stage. Both route through `Centred` at zIndex 7,
  // so what has to be true is that every audio stage sits below that.
  {
    // ⚠ NO REGEX IN THIS RULE, DELIBERATELY. A generated pattern loses its
    // backslashes on the way through the tooling and then matches nothing while
    // reporting green, which is worse than having no rule. String search only.
    // ⚠ CENTRED NOW HAS TWO LAYERS, and the invariant is the LOWER of them. Rule 50
    // raised blocking states to z-12 so they clear the dock at z-8; non-blocking ones
    // stay at z-7. Either way the floor is 7, which is what has to beat the audio stage.
    const BLOCKING_Z = 7;
    check(st.includes('zIndex: blocking ? 12 : ' + BLOCKING_Z + ','),
      'the blocking-state layer no longer bottoms out at z-' + BLOCKING_Z + ' — this rule can no longer prove the audio stage sits under a failure');
    // ⚠ THE VIEW MOVED. AudioStage is now a thin preview binding and AudioStageView
    // holds the layer, so this looks for the VIEW's signature.
    check(st.includes('export function AudioStageView(') && st.includes('z = 4 }'),
      'AudioStage no longer takes a `z` — its layer is fixed again and a call site cannot put it under the chrome');
    check(st.includes("inset: 0, zIndex: z,"),
      'AudioStage stopped using its `z` prop, so passing one does nothing');
    for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
      const src = codeOnly(read(f));
      let at = src.indexOf('<AudioStage');
      while (at !== -1) {
        const tag = src.slice(at, src.indexOf('/>', at) + 2);
        // ⚠ A BINDING WRAPPER FORWARDS z THROUGH {...props}. AudioStage is now a thin
        // preview binding around AudioStageView; requiring a literal z={} on it would
        // demand the wrapper restate a prop it is already passing through.
        if (tag.includes('{...props}')) { at = src.indexOf('<AudioStage', at + 1); continue; }
        const zi = tag.indexOf('z={');
        const z = zi === -1 ? NaN : parseInt(tag.slice(zi + 3), 10);
        check(Number.isFinite(z) && z < BLOCKING_Z,
          f + ' renders the audio stage without a `z` below ' + BLOCKING_Z + ' — at or above it audio-only covers the whole surface and buries the controls, which is exactly how End stream was lost');
        // ⚠ AND IT MUST NOT GO BACK INTO THE BLOCKING TERNARY. That was the shape
        // the defect had, so name the regression rather than inferring it from z.
        const before = src.slice(Math.max(0, at - 160), at);
        check(!before.includes(': audioOnly'),
          f + ' put the audio stage back inside the blocking-state ternary — it belongs at the media layer, straight after the video');
        at = src.indexOf('<AudioStage', at + 1);
      }
    }
  }

  // ── 5 + 7. WHO CAN WATCH, WHO CAN CLIP — the host controls, in one sheet
  // ⚠ "Stream settings" WAS A DEAD ROW (onClick just closed the menu).
  check(ch.includes('function StreamSettingsSheet'), 'the stream settings sheet is gone — the Stream settings row goes back to being dead');
  check(ch.includes("kind === 'streamsettings'"), 'the settings sheet is not routed, so the row that opens it leads nowhere');
  check(ch.includes('WHO CAN WATCH') && ch.includes('WHO CAN CLIP'),
    'the host lost the who-can-watch or who-can-clip control — both are founder decisions from 2026-09-02');
  // ⚠⚠ TWO SEPARATE LIMITS. WHO may clip is the host's; HOW MUCH is the CLIPPER's
  // plan (streamClips.js:24) and this setting must never be read as a length
  // control. The copy is what keeps them apart.
  check(ch.includes('This picks who may clip, not how much'),
    'the clip setting stopped distinguishing WHO from HOW MUCH — a host will read it as a length control and the plan limits will look broken');
  // ⚠ ASSERT A FRAGMENT THAT DOES NOT SPAN A SOURCE LINE BREAK. The full sentence
  // wraps in the JSX, so codeOnly() sees a newline inside it and the literal never
  // matched — a guard failing on correct code.
  check(ch.includes('Free 30s and 3 per session, Lite 60s and 5') && ch.includes('Pro 90s and'),
    'the per-plan clip limits are no longer stated, or no longer match functions/streamClips.js');

  // ── 6. THE MOD-ONLY CHANNEL
  check(st.includes('export function ModChannelSwitch'), 'the mod-only channel is gone — mods are back to coordinating a ban in front of the person being banned');
  // ⚠⚠ IT IS A SWITCH ON THE CHAT, NOT AN OVERLAY. The first version was a
  // full-width segmented bar PLUS a second feed block stacked over the real chat,
  // and the founder rejected it: "should not take up the whole screen that is bad
  // design. add it as an actual switch that changes the live chat, not an overlay."
  check(!st.includes('ModChannelFeed'),
    'a separate mod feed block is back — there is ONE chat surface and the switch changes which room it shows, it does not stack a second chat over the first');
  // ⚠ A PLAIN VIEWER MUST NOT EVEN SEE THAT A SECOND ROOM EXISTS.
  const barAt = st.indexOf('export function ModChannelSwitch');
  const barBody = barAt < 0 ? '' : st.slice(barAt, barAt + 1800);   // the whole function, not a peek at its head
  // ⚠⚠ THE MOD CHANNEL HAS ITS OWN GATE, AND VANGUARD IS NOT IN IT. Founder,
  // 2026-09-02: this room is the BROADCASTER's moderators coordinating about THEIR
  // stream. Vergr's own platform moderators do not sit in a creator's private room,
  // and putting them there works against the Vanguard identity mask CLAUDE.md
  // requires. `canUseModChannel` is separate from `canModerate` on purpose: they
  // answer different questions and a change to one must not silently move the other.
  check(barBody.includes('canUseModChannel(role)'),
    'the mod channel is no longer gated on canUseModChannel — either a viewer can see the private room exists, or Vergr staff were put inside a creator\'s room');
  // ⚠ THE FAILURE MODE IS STILL A MOD TYPING SOMETHING PRIVATE INTO PUBLIC CHAT, so
  // the armed state has to be unmistakable at a glance: it names the room and it
  // goes red. That signal replaced the big banner; losing it too leaves nothing.
  check(barBody.includes('Mods only') && barBody.includes('lock'),
    'the armed mod switch no longer names the room or shows the lock — a moderator has nothing to glance at before typing');
  check(barBody.includes('S.danger'),
    'the mod switch lost its red armed state, which is the only colour signal that chat is not public');
  // ⚠ AND THE SWITCH MUST ACTUALLY CHANGE THE CHAT. One place decides which room
  // every surface renders; without that swap the button is decoration.
  const rail2 = codeOnly(read('../AdminStreamPreviewScreen.jsx'));
  check(rail2.includes("sim.chatChannel === 'mods' ? sim.modMessages : sim.messages"),
    'the mod switch no longer swaps the message list, so it changes nothing on any surface');
}

// ── 43. NO SEMI-TRANSPARENT PILL BACKGROUNDS ────────────────────────
// ⚠⚠ FOUNDER, 2026-09-02, having said it before: *"I FUCKING HATE THE SEMI
// TRANSPARENT PILL BACKGROUNDS IT IS GROSS STOP USING IT"*.
//
// A low-alpha white on a dark page is not a surface — it has no value of its own,
// it shifts with whatever is behind it, and over video it turns to mud. It is the
// same "fake glass" he rejected by name for the selected typeface state. Every
// chip, row and control takes a REAL hex from `S` in previewStates.jsx, and a
// selected state is a solid fill.
//
// ⚠ THREE THINGS ARE DELIBERATELY EXEMPT, and a blanket ban would repaint his own
// design:
//   • SHEET SCRIMS — rgba(0,0,0,0.55..0.8). A scrim exists to let the page read as
//     being behind it. A scrim is not a pill.
//   • `glass` / `glassDark` — the SHIPPED dock treatment, copied from the real
//     viewer. Not mine to change.
//   • the `border` token — a 1px stroke on an input or a real surface is the one
//     place his own note says a stroke belongs. This rule is about FILLS.
{
  // ⚠⚠ ENUMERATED, NOT HAND-LISTED. This rule ran against TWO files for four waves
  // while ELEVEN others kept their washes: a rgba(0,0,0,0.5) round button and a
  // rgba(0,0,0,0.45) stat chip on the broadcaster, a rgba(124,58,237,0.9) subscribed
  // pill under a white hairline in the portrait viewer, a rgba(240,165,0,0.18) gold
  // pill on the tournament card. A guard whose file list covers only what was already
  // fixed is not evidence about anything else.
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.jsx'))) {
    const src = read(f);
    const offenders = [];
    // ⚠ THE DRAWN GAMEPLAY SCENE IS ART, NOT UI CHROME. `Scene` paints a fake
    // broadcast — a horizon line, an abstract HUD — and those elements are
    // deliberately translucent so they sit IN the scene. Exempt the whole function
    // by scope rather than pretending each line is a control.
    let body = src;
    const sceneAt = src.indexOf('function SceneFallback(');   // the drawn backdrop, not Scene's wrapper
    if (sceneAt >= 0) {
      const sceneEnd = src.indexOf(String.fromCharCode(10) + 'export function Scene(', sceneAt + 10);
      body = src.slice(0, sceneAt) + (sceneEnd > 0 ? src.slice(sceneEnd) : '');
    }
    const lines = body.split(String.fromCharCode(10));
    lines.forEach((line, i) => {
      // ⚠ A TOKEN DEFINITION HAS NO ‘background’ IN IT, and skipping those let the
      // negative test pass while `purpleSoft` was reverted to rgba(124,58,237,0.18)
      // — the exact root cause this rule exists for, invisible to the rule. A wash
      // in a token is worse than one at a call site: it repaints every use at once.
      const t = line.trim();
      const isBorder = t.startsWith("border") || line.includes("border:") || line.includes("borderColor") || line.includes("boxShadow");
      const isToken = t.includes(": 'rgba(") && !line.includes("background") && !isBorder && !t.startsWith('color');
      if (!line.includes('background') && !isToken) return;
      if (isBorder && !line.includes('background')) return;
      if (line.includes('export const glass')) return;          // shipped dock treatment
      if (line.includes('rgba(0,0,0,')) return;                  // a scrim
      if (line.includes('gradient(')) return;
      // ⚠ A FULL-BLEED SCRIM IS EXEMPT AND ALWAYS WAS. It is translucent so the page
      // reads as being behind it, which is its entire job. It is identifiable by
      // covering its parent, never by its colour.
      if (line.includes('inset: 0') || line.includes('position: absolute, inset')) return;                    // ⚠ a gradient stop MUST fade to transparent; the drawn gameplay scene is art, not a control
      // any rgba used as a FILL whose alpha is below 0.8 and which is not near-black
      let at = line.indexOf('rgba(');
      while (at >= 0) {
        // an rgba INSIDE a border/shadow/outline declaration is a stroke, not a fill,
        // and this rule is about fills. A mixed line carries both.
        const before = line.slice(Math.max(0, at - 26), at);
        if (/border|boxShadow|outline|color:s*$/.test(before)) { at = line.indexOf('rgba(', at + 1); continue; }
        const close = line.indexOf(')', at);
        if (close > at) {
          const parts = line.slice(at + 5, close).split(',').map((x) => Number(x.trim()));
          if (parts.length === 4) {
            const [r, g, b2, alpha] = parts;
            const nearBlack = r < 60 && g < 60 && b2 < 60;
            if (alpha < 0.8 && !nearBlack) offenders.push((i + 1) + ": rgba(" + parts.join(",") + ")");
          }
        }
        at = line.indexOf('rgba(', at + 1);
      }
    });
    check(offenders.length === 0,
      f + ' has semi-transparent fill(s) again [' + offenders.slice(0, 4).join(' | ') + '] — use a solid value from S, not a wash');
  }
  // ⚠ AND A PILL IS NOT A SWITCH. He asked for a switch and I shipped a chip that
  // changed colour. A switch is a track with a knob that slides.
  const st = codeOnly(readState());
  const swAt = st.indexOf('export function ModChannelSwitch');
  const swBody = swAt < 0 ? '' : st.slice(swAt, swAt + 1800);
  check(swBody.includes('role="switch"') && swBody.includes('aria-checked'),
    'the mod control is not a switch any more — it must announce itself as one, not as a button');
  check(swBody.includes('borderRadius: 999') && swBody.includes("left: on ?"),
    'the mod switch lost its track and sliding knob — a chip that changes colour is not a switch');
}

// ⚠ 44. GIFT-A-SUB — the three decisions the founder accepted on 2026-09-02.
// Each is a thing that could plausibly be built the other way, so each is guarded.
{
  const ch = codeOnly(read("previewChrome.jsx"));
  const at = ch.indexOf("function GiftSubSheet");
  const body = at < 0 ? "" : ch.slice(at, at + 4200);
  check(at >= 0, "the gift-a-sub sheet is gone");
  // ⚠ 1. NO GIFTER REQUIREMENT. Every gate on a purchase reduces purchases, and an
  // unsubscribed gifter costs nothing — the coins were still bought at retail.
  check(!body.includes("mustBeSubscribed") && !body.includes("viewerIsSubscribed"),
    "a gifter-must-be-subscribed gate was added — the founder accepted the recommendation NOT to have one");
  // ⚠ 2. IT DOES NOT RENEW, and the sheet has to SAY so. Renewing on the gifter’s
  // wallet is a silent recurring charge on someone else’s behalf.
  check(body.includes("does not renew"),
    "the gift sheet stopped saying the gift does not renew — the buyer has to know they are not being signed up to a recurring charge");
  // ⚠ 3. BULK IS QUANTITY x PRICE, NO DISCOUNT. A discount here undercuts
  // RETAIL_COIN_USD, which payram.js uses as the floor so a custom coin amount
  // cannot beat a pack.
  // ⚠ A SUBSTRING TEST CANNOT SEE A DISCOUNT. The first version checked for
  // "priceCoins * qty" and PASSED against `Math.floor(priceCoins * qty * 0.8)` — the
  // exact thing it exists to stop, sitting inside the string it was matching. Read
  // the WHOLE cost line and assert nothing else is applied to it.
  const costLine = (body.split(String.fromCharCode(10)).find((l) => l.includes("const cost =")) || "").trim();
  check(costLine === "const cost = MEMBERSHIP_TIERS[pick].priceCoins * qty;",
    "the gift total is no longer exactly quantity x the tier price (" + costLine + ") — any multiplier there is a coin discount by another name, and it undercuts RETAIL_COIN_USD");
  check(body.includes("no bulk discount"),
    "the sheet stopped stating there is no bulk discount");
  // ⚠ AND A SHORTFALL NEVER BLOCKS THE PURCHASE, same rule as the tip sheet.
  check(body.includes("Top up") && !/disabled={[^}]*short/.test(body),
    "the gift CTA blocks on a shortfall instead of offering a top-up — the design the founder ruled out by name");
}

// ── 45. THE TWO KINDS OF MODERATOR ARE NOT THE SAME THING ───────────
// A STREAM MODERATOR is picked by the broadcaster for THEIR room
// (`streams/{id}.moderatorUids`). VANGUARD is Vergr's own app-wide collective.
//
// ⚠⚠ I GAVE VANGUARD THE STREAM-MOD TIER AND THE SERVER DOES NOT.
// `loadStreamForMod` (streamChatMod.js:47) is exactly
//     hostUid === uid || moderatorUids.includes(uid)
// with no Vanguard branch anywhere in that file — so every control it revealed to a
// Vanguard would answer `permission-denied`. That is the precise defect
// previewRoles.js warns about in its own header, committed while writing the header.
{
  const roles = codeOnly(read('previewRoles.js'));
  const modAt = roles.indexOf('export function canModerate');
  const modBody = modAt < 0 ? '' : roles.slice(modAt, modAt + 200);
  check(modAt >= 0, 'canModerate is gone from previewRoles');
  check(!modBody.includes('vanguard'),
    'canModerate grants Vanguard the stream-moderator tier again — loadStreamForMod refuses them, so every control it reveals answers permission-denied');
  const chAt = roles.indexOf('export function canUseModChannel');
  const chBody = chAt < 0 ? '' : roles.slice(chAt, chAt + 260);
  check(chAt >= 0, 'canUseModChannel is gone — the mod channel fell back onto the generic moderation gate');
  // ⚠⚠ VANGUARD MUST BE IN THIS ONE. I first put them here, then over-corrected and
  // locked them out, and the founder caught the second version: **a private room the
  // platform cannot see is a moderation blind spot**, and this is the room where that
  // matters most — small, private, occupied by people with power over other users. If
  // a mod team coordinates harassment, this room is the evidence.
  //
  // They are SILENT (Peer.silent in the relay) and AUDITED on join, which is what
  // keeps the identity mask intact. Removing them here would put the simulator out of
  // step with `canJoinModRoom`, which is the real gate and is deployed.
  check(chBody.includes('vanguard'),
    'Vanguard were locked out of the mod channel again — a private room Vergr cannot see is a moderation blind spot, and the deployed relay (canJoinModRoom) lets them in, so the simulator would be lying');
  // and the two gates must stay different functions, because they answer different
  // questions: read the room, versus hold the broadcaster’s mute/ban tier.
  check(roles.includes('export function canModerate') && chAt !== roles.indexOf('export function canModerate'),
    'canUseModChannel and canModerate collapsed into one — Vanguard read the room but do NOT get the broadcaster\'s moderation tier, which loadStreamForMod refuses them');

  // ── the REAL gate lives in the relay, and it is tested there ──
  // ⚠ THE SIMULATOR IS NOT THE BOUNDARY. Whatever the client believes, privacy is
  // whatever the relay refuses at join time.
  {
    const relay = read('../../../../infra/chat/src/main.go');
    check(relay.includes('func canJoinModRoom('),
      'the relay lost canJoinModRoom — the mod channel has no server-side gate, which means it is not private at all');
    check(relay.includes('p.silent = modChannel && isVanguard && !isStreamMod'),
      'the relay stopped marking a reading Vanguard silent — a named platform moderator in a three-person room is identified by elimination');
    check(relay.includes('auditModChannelRead'),
      'the relay stopped auditing mod-channel reads — silent to the room is fine, silent in the log is not');
    check(relay.includes('strings.HasSuffix(id, ":mods")'),
      'the mods room runs presence again — startPresence would write streams/<id>:mods.viewerCount every 10s to a doc that does not exist');
  }
}

// ⚠ 46. THE MOD CHANNEL IS WIRED IN THE REAL APP, NOT ONLY THE SIMULATOR.
// The relay enforced it and chatRelay.js could ask for it, but for a while NO REAL
// SCREEN OPENED IT — the feature existed at both ends and connected in the middle
// nowhere. That is the shape of half-finished work this repo keeps producing, so it
// is guarded on the real component, not the preview.
{
  const cp = read('../../../components/streams/ChatPanel.jsx');
  // ⚠ SCOPED TO THE CALL. The first version checked the whole file for ‘channel,’,
  // which is also in the effect’s dependency array — so deleting it from the
  // connectChat call still passed. Third substring-too-broad guard today.
  const ccAt = cp.indexOf('connectChat({');
  const ccBody = ccAt < 0 ? '' : cp.slice(ccAt, ccAt + 260);
  check(ccAt >= 0 && ccBody.includes('channel,'),
    'ChatPanel stopped passing a channel to connectChat — the mod room is unreachable from the real app again');
  // ⚠ THE SOCKET MUST REOPEN ON A SWITCH, or the control flips a label and keeps
  // the old room — a control that does nothing, which this codebase has a list of.
  check(cp.includes('[streamId, currentUser, showToast, channel]'),
    'the chat effect no longer depends on `channel`, so switching rooms would not reconnect');
  // ⚠ AND THE TWO ROOMS MUST NOT SHARE A MESSAGE LIST.
  check(cp.includes('useEffect(() => { setMessages([]); }, [channel]);'),
    'messages are no longer cleared when the room changes — private lines would stay on screen after switching back to public');
  // ⚠ VANGUARD CHECKED SEPARATELY. The relay lets them in but hello.mod is false
  // for them, so relying on canModerate alone would refuse a door the server opens.
  check(cp.includes('canSeeModRoom') && cp.includes('vanguardRank'),
    'the mod switch no longer accounts for Vanguard — a platform moderator would be refused a room the relay would have let them into');
  // ⚠ THE COMPOSER NAMES THE ROOM. The one failure mode is typing something private
  // into public chat, and the input is where that happens.
  check(cp.includes('Message moderators only…'),
    'the composer stopped naming the room — the last thing a moderator looks at before posting no longer says which chat they are in');
  // ⚠ A SWITCH, NOT A PILL.
  check(cp.includes('role="switch"') && cp.includes('aria-checked={channel'),
    'the mod control in the real chat is no longer a switch');
}

// ⚠ 47. RAIDS — the founder decisions of 2026-09-02, and the CTA collision.
{
  const st = codeOnly(readState());
  // ⚠ THE RAID BANNER IS CANONICAL IN THE REAL APP, NOT THE PREVIEW. It lived in
  // previewStates for one afternoon; the simulator now imports it, so the invariants
  // below belong to the file a REAL viewer renders.
  const raidUi = codeOnly(read("../../../components/streams/RaidControls.jsx"));
  check(raidUi.includes("export function RaidBanner"), "the raid landing banner is gone");
  check(st.includes("RaidBanner") && st.includes("components/streams/RaidControls"),
    "the preview stopped importing the real RaidBanner — a second copy is how this repo grows two definitions that drift");
  // ⚠⚠ EVERY BANNER IN THAT BAND MUST CLEAR THE FLOATING LIKE BUTTON. This is the
  // THIRD control to collide with it (Follow, Subscribe, then Stay here). A way out
  // that cannot be pressed is worse than no way out: the viewer believes they opted
  // out and gets moved anyway.
  for (const [fn, src] of [["ChatStateBanner", st], ["RaidBanner", raidUi]]) {
    const at = src.indexOf("export function " + fn);
    const body = at < 0 ? "" : src.slice(at, at + 1400);
    // ⚠ CHECK THE SIGNATURE, NOT THE BODY. `reserveRight` also appears in the style
    // (`paddingRight: 12 + reserveRight`), so a whole-body substring passed even with
    // the PROP deleted. Fourth substring-too-broad guard today.
    const sig = body.split(String.fromCharCode(10))[0];
    check(sig.includes("reserveRight"),
      fn + " no longer takes reserveRight — its action sits under the 44-48px floating heart on every live viewer surface");
  }
  // ⚠ THE COUNTDOWN AND THE WAY OUT ARE THE MECHANIC, not decoration. Without them a
  // raid is something done TO someone.
  check(raidUi.includes("Stay here") && raidUi.includes("Taking you there in"),
    "the raid banner lost its countdown or its Stay here — that is what makes a raid something viewers go along with rather than something done to them");
  check(raidUi.includes("is raiding"),
    "the raid banner no longer names who is taking you where — an unattributed move reads as the app malfunctioning");

  // ── the server side, which is where the founder decisions actually bind ──
  const raids = read("../../../../functions/raids.js");
  // ⚠ THE TARGET DECIDES WHO MAY RAID THEM. The control that kills hate raids.
  check(raids.includes("raidPolicy") && raids.includes("anyone") && raids.includes("following"),
    "the raid target lost control over who may raid them — that is the one control that prevents hate raids and it must exist on day one");
  // ⚠ A BLOCK BEATS EVERY POLICY, including ‘anyone’.
  check(raids.includes("collection('blocked')"),
    "a blocked user can raid again — someone who blocked you must never receive your audience");
  // ⚠ FOUNDER DECISION: never onto an audio-only or gated stream.
  check(raids.includes("audio_only") && raids.includes("gated"),
    "raids can land on an audio-only or gated stream again — the founder ruled both out");
  // ⚠ FOUNDER DECISION: NO minimum viewer count. A floor locks out exactly the small
  // creators the feature exists to help.
  check(!/minViewers|MIN_VIEWERS|viewers <s*d/.test(raids),
    "a minimum viewer count crept into raids — the founder said no floor");
  // ⚠ ONE RAID PER STREAM, or a host can move the same audience in waves.
  check(raids.includes("has already raided"),
    "a stream can raid more than once — that is both a farming route and a way to hit a target with wave after wave");
  check(raids.includes("raid_sent"),
    "the raid VP award is gone — the founder approved it to reward good-natured hosts");
}

// ── 44. THE PIXEL AUDIT: things measured on the live page, not read in source ──
// ⚠⚠ EVERY RULE HERE EXISTS BECAUSE A CONTROL WAS PRESENT, CORRECT IN SOURCE, AND
// UNUSABLE ON SCREEN. Reading the JSX would not have found any of them; each was
// caught by probing elementFromPoint across a control's whole footprint. They are
// pinned here so the fix cannot quietly come undone.
{
  const bc = codeOnly(read('PreviewBroadcasterScreen.jsx'));
  const dv = codeOnly(read('PreviewDesktopViewer.jsx'));
  const st2 = codeOnly(readState());

  // ⚠ THE ACTION RAIL IS ANCHORED TO THE CHAT STACK, NOT TO A SECOND GUESS AT THE
  // SAME NUMBER. `top: 36%` + four 46px pills ran to y=527 while the stack below
  // starts at 58% (y=494) and painted over it: 33 of the Share button's 46px were
  // buried and elementFromPoint at its centre returned the tip-goal bar.
  check(bc.includes("bottom: 'calc(42% + 8px)'"),
    'the broadcaster action rail is no longer anchored to the chat stack — Share goes back under the tip goal, dead');
  check(!bc.includes("right: 10, top: '36%'"),
    'the action rail is back on a hard-coded top% that does not track the chat stack');

  // ⚠ THE CAMERA CONTROL MUST NOT CONTRADICT THE STAGE.
  check(bc.includes('const camLive = camOn && !audioOnly;'),
    'the camera button is independent of the format again — the desktop studio drew a lit Camera button under a stage reading AUDIO ONLY');

  // ⚠ THE VP/MOD CHIP ROW IS A FULL-WIDTH INVISIBLE BAR. Left hit-testable, its
  // empty half swallowed taps on the chat behind it — avatars and rank crests
  // simply stopped responding, with nothing visibly wrong.
  for (const f of FILES.filter((x) => x.endsWith('.jsx'))) {
    const src = codeOnly(read(f));
    if (!src.includes('<VpEarnedChip')) continue;
    const at = src.indexOf('<VpEarnedChip');
    const row = src.slice(Math.max(0, at - 200), at);
    check(row.includes("pointerEvents: 'none'"),
      f + ' lets the VP/mod chip row eat taps — its empty half sits over the chat and blocks avatars and rank crests');
  }
  check(st2.includes("pointerEvents: 'auto',"),
    'the chips stopped opting back into pointer events, so the row being none makes them unclickable too');

  // ⚠ THE FLOATING STATUS BAND SPANS THE FULL WIDTH AT z-8 and, hit-testable,
  // blocks a stripe of the stream behind it even while it shows nothing but a chip.
  // Same shape as the VP row one level in: the target looks correct and simply
  // stops responding.
  check(bc.split("top: 64, zIndex: 8, pointerEvents: 'none' }}>").length - 1 === 3,
    'a broadcaster status band is hit-testable again — all three branches must pass taps through, or a full-width stripe of the stream stops responding');
  // ⚠ SCOPE THE ASSERTION TO THE FUNCTION. An `|| src.includes('pointerEvents:')`
  // fallback made this pass unconditionally — a guard that cannot fail is worse than
  // no guard, and this repo has shipped four of them.
  for (const fn of ['ZeroViewers', 'HealthWarning']) {
    const at = st2.indexOf('export function ' + fn);
    const body = at < 0 ? '' : st2.slice(at, at + 1400);
    check(body.includes("pointerEvents: 'auto'"),
      fn + ' no longer opts back into pointer events — the status band around it passes taps through, so its buttons are decorative');
  }

  // ⚠ `minWidth: 0` IS WHAT MAKES flex-shrink WORK. Without it the nowrap gifter
  // chips overflowed the 340px rail by 49px and overflow:hidden sliced the third
  // gifter through the middle of their name.
  check(dv.includes("alignItems: 'center', gap: 5, minWidth: 0, padding: '3px 8px'"),
    'the top-gifters chips lost minWidth:0 — the strip overflows its rail again and the third gifter is cut through the name');

  // ⚠ NO CAMERA PiP ON AN AUDIO-ONLY BROADCAST.
  for (const f of ['PreviewSoloPortrait.jsx', 'PreviewSoloLandscape.jsx', 'PreviewDesktopViewer.jsx']) {
    const src = codeOnly(read(f));
    if (!src.includes('<FacecamPip')) continue;
    const at = src.indexOf('<FacecamPip');
    check(src.slice(Math.max(0, at - 120), at).includes('!audioOnly'),
      f + ' draws a facecam PiP on an audio-only stream — a camera on a broadcast that by definition has none');
  }
}

// ── 45. NO PER-INSTANCE <style> IN A COMPONENT THAT RENDERS MANY TIMES ───────
// ⚠⚠ UserAvatar SHIPPED ONE <style> TAG PER AVATAR. Measured on the live preview:
// 53 inline style tags on a single page, 51 of them byte-identical copies of the same
// 258-character block — and `animate-spin-slow` was ALREADY a Tailwind utility
// (tailwind.config.js), so the block only ever redefined it, later in the cascade.
//
// The reason it is guarded rather than just fixed: a <style> tag is TEXT CONTENT, and
// an accessible name falls back to text content. Every icon-only button wrapping an
// avatar was therefore announced as "@keyframes spin-slow from transform rotate...".
// It also breaks any innerText read over a container holding an avatar, which is a
// trap this repo has already hit once.
{
  // ⚠ STRIP COMMENTS FIRST. The note left in UserAvatar explaining the removal
  // contains the words it forbids, so a raw substring test fails on the FIXED file.
  // Self-matching again — fourth time in this session.
  const ua = codeOnly(readFileSync('src/components/UserAvatar.jsx', 'utf8'));
  check(!ua.includes('<style'),
    'UserAvatar renders a <style> tag again — one copy per avatar (51 on one page last time), it overrides the real Tailwind utility, and it becomes the accessible name of any button wrapping an avatar');
}

// ── 46. THE FOUNDER'S THREE STANDING VISUAL RULES, ENFORCED ──────────────────
// ⚠⚠ All three were still being broken on 2026-09-03 AFTER a full audit, because the
// audit read source and never measured the rendered page. Each is now a rule.
{
  const STREAM_FILES = ['src/components/streams/MobileLiveViewer.jsx', 'src/components/streams/ChatPanel.jsx', 'src/components/streams/StreamPoll.jsx', 'src/components/streams/StreamGoalAndAlerts.jsx', 'src/components/streams/JoinAnnouncer.jsx', 'src/components/streams/UserQuickSheet.jsx', 'src/components/streams/BoostStreamSheet.jsx', 'src/components/streams/HlsPlayer.jsx', 'src/components/streams/CoHostInviteModal.jsx', 'src/components/streams/BannedWordsEditor.jsx', 'src/components/streams/TipCatalogEditor.jsx', 'src/components/streams/BroadcasterCopilot.jsx'];

  // (1) THE FONT. `Inter` is NOT loaded anywhere in this app — document.fonts holds
  // Syne, DM Sans, DM Mono, Baloo 2 and Material Symbols, and nothing else. So
  // `Inter, system-ui` silently renders in the OS font: measured by glyph width,
  // 215.99px against DM Sans's 224.18px for the same string. 21 declarations were on
  // the broken chain, which is why the poll read in a different typeface to the chat
  // beside it. Declaring a face that does not exist is the whole bug.
  // ⚠ THE REAL SCREENS TOO, NOT JUST THE SIMULATOR. The first version of this rule
  // covered previewChrome and the shared components, so ViewerStreamScreen (7
  // declarations), BroadcasterScreen, the native broadcaster, the live-invite banner, the
  // co-stream invite and the HUD all kept rendering in the OS font for another wave.
  const REAL_STREAM_SCREENS = [
    'src/screens/streams/ViewerStreamScreen.jsx',
    'src/screens/streams/BroadcasterScreen.jsx',
    'src/screens/streams/native/NativeBroadcasterScreen.jsx',
    'src/screens/streams/CoStreamInviteScreen.jsx',
    'src/screens/streams/CoStreamingScreen.jsx',
    'src/screens/streams/GoLiveSetupScreen.jsx',
    'src/components/LiveInviteBanner.jsx',
    'src/screens/hud/HudOverlay.jsx',
  ];
  for (const f of STREAM_FILES.concat(REAL_STREAM_SCREENS).concat(FILES.filter((x) => x.endsWith('.jsx')).map((x) => DIR + x))) {
    let src; try { src = codeOnly(readFileSync(f, 'utf8')); } catch { continue; }
    check(!src.includes('Inter,') && !src.includes("Inter'") && !src.includes('Inter"'),
      f + ' declares the Inter font, which this app does not load — it falls through to the OS font and renders in a different typeface to everything beside it');
  }

  // (2) NO FAKE GLASS ON A PILL OR BUTTON. The exemption is a full-bleed SCRIM, whose
  // job is to let the video read through. A pill sitting on gameplay is not a scrim:
  // a wash has no value of its own and turns to mud over a bright frame.
  // ⚠ ALL THREE COPIES. previewChrome, MobileLiveViewer AND previewSoloParts each
  // define their own glass/glassDark. Fixing two left the split and landscape viewers
  // still drawing the wash — the live probe caught it, this rule stops it recurring.
  // ⚠⚠ FIVE COPIES, NOT THREE, AND THIS RULE ONLY READ THREE. That is why it stayed green
  // for two waves while PreviewViewerScreen still defined glass as rgba(255,255,255,0.10)
  // under a rgba(255,255,255,0.18) edge — the same white, stroke nearly twice the fill —
  // and the SHIPPED VergrMeStreamBanner still drew the dark wash on a REAL stream.
  // Fourth instance of 'a token fixed in some copies and not others' in this project.
  for (const f of ['src/screens/admin/streamPreview/previewChrome.jsx', 'src/components/streams/MobileLiveViewer.jsx', 'src/screens/admin/streamPreview/previewSoloParts.jsx', 'src/screens/admin/streamPreview/PreviewViewerScreen.jsx', 'src/components/streams/VergrMeStreamBanner.jsx', 'src/demo/DemoLiveViewer.jsx']) {
    const src = codeOnly(readFileSync(f, 'utf8'));
    // ⚠ SLICE TO THE STATEMENT'S OWN CLOSE, NOT A FIXED WINDOW. A 200-char window
    // ran past `glass` into the code below it and flagged that code's rgba — the same
    // bleed that made the dotted-key guard cry wolf.
    const decl = (name) => { const at = src.indexOf(' ' + name + ' = {');
      return at < 0 ? '' : src.slice(at, src.indexOf('};', at) + 2); };
    // ⚠ NOT EVERY FILE DEFINES BOTH. VergrMeStreamBanner has only glassDark, and asserting
    // on an empty declaration made this rule fail against a file that was CORRECT — a guard
    // that cries wolf gets ignored, which is worse than not having it. Assert per token,
    // and only where that token is actually declared.
    for (const [name, decl$] of [['glass', decl('glass')], ['glassDark', decl('glassDark')]]) {
      if (!decl$) continue;
      check(!decl$.includes('rgba('),
        f + ': ' + name + ' went back to a translucent fill — these are the header and dock PILLS, drawn on live gameplay');
      check(decl$.includes("border: 'none'"),
        f + ': ' + name + ' carries a border again — it was a stroke BRIGHTER than its own fill, which is the hairline doing the separating');
    }
    check(decl('glass') || decl('glassDark'),
      f + ' no longer declares glass or glassDark — this rule exists because the token has FIVE copies and fixing three left two washes live, so a copy going missing from this list is the failure mode');
  }

  // (3) THE VERIFIED TICK GOES BESIDE THE NAME, NEVER ON THE AVATAR. Pinned to the
  // avatar corner it overlaps the portrait and reads as clipped. Two files had it on
  // the avatar while two others already had it beside the name WITH A COMMENT saying
  // that is where it belongs — one component, two placements.
  for (const f of ['src/components/streams/MobileLiveViewer.jsx', DIR + 'PreviewMobileViewer.jsx']) {
    const src = codeOnly(readFileSync(f, 'utf8'));
    let at = src.indexOf('name="check"');
    while (at !== -1) {
      const before = src.slice(Math.max(0, at - 320), at);
      check(!before.includes("position: 'absolute'"),
        f + ' pins the verified tick onto the avatar again — it belongs next to the display name, where it cannot overlap the portrait');
      at = src.indexOf('name="check"', at + 1);
    }
  }
}

// ── 47. A `position: fixed` COMPONENT MUST BE CONTAINED BY THE DEVICE FRAME ────
// ⚠⚠ `LevelUpCelebration` is `fixed inset-0`, which on a real phone means "the
// screen" and inside the simulator means "the browser window". Measured 2026-09-03: it
// rendered 2043x915, centred on the admin page, 777px past the left of the frame and
// 873px past the right, dimming the admin sidebar. The one screen that exists to be
// captured could not be captured, and no earlier sweep saw it because the celebration
// had timed out by the time each one ran.
//
// A transform on an ancestor is what makes it the containing block for fixed children.
{
  const st3 = codeOnly(readState());
  const at = st3.indexOf('export function PreviewLevelUp');
  const body = at < 0 ? '' : st3.slice(at, at + 700);
  check(body.includes('translateZ(0)'),
    'PreviewLevelUp no longer establishes a containing block — the celebration is `position: fixed` and escapes the simulated device, centring on the whole admin page');
}

// ── 48. A SHEET IS A MODAL: IT TRAPS FOCUS AND SAYS SO ─────────────────────
// ⚠⚠ NONE OF THE SIXTEEN SHEETS TRAPPED FOCUS. Measured 2026-09-03 with one open:
// **46 controls behind the scrim were still keyboard-reachable**, and focus really did
// land on them — the sheet stays visually on top while the keyboard walks around behind
// it, so the ring is somewhere the user cannot see. None carried role="dialog" or
// aria-modal either, so a screen reader never announced one had opened.
//
// `inert` on the siblings is the mechanism. A keydown handler that re-cycles Tab has to
// guess the tab order and gets shift-Tab and browser chrome wrong; `inert` removes the
// rest of the surface from the tab order AND the accessibility tree in one attribute.
{
  const ch2 = codeOnly(read('previewChrome.jsx'));
  check(ch2.includes('function SheetHost'),
    'the sheet host is gone — every sheet goes back to letting the keyboard walk out behind it');
  const at = ch2.indexOf('function SheetHost');
  const body = at < 0 ? '' : ch2.slice(at, at + 1800);
  check(body.includes('role="dialog"') && body.includes('aria-modal="true"'),
    'the sheet host stopped declaring itself a dialog — a screen reader gets no announcement that one opened');
  check(body.includes('.inert = true'),
    'the sheet host no longer inerts what is behind it, so focus escapes the modal again');
  check(body.includes('prev.focus'),
    'the sheet host no longer restores focus on close — it falls to <body> and the next Tab restarts at the top of the page');
  check(ch2.includes('<PreviewSheetBody {...props} />'),
    'PreviewSheets no longer routes through the host, so the dialog semantics are bypassed');
}

// ── 49. USER-GENERATED TEXT CARRIES dir="auto" ─────────────────────────────
// ⚠⚠ NOT ONE ELEMENT IN THE APP SET `dir` (measured 2026-09-03). Wave 3 fixed the
// two most visible carriers — the display name and the chat message body — and stopped
// there, so an Arabic or Hebrew STREAM TITLE, BIO or POLL QUESTION still rendered inside
// an LTR box. The glyphs shape correctly either way, which is exactly why it survives a
// glance: what goes wrong is the ellipsis landing on the wrong side and mixed content
// (a Latin game name inside an Arabic title) ordering backwards against it.
//
// ⚠ THE SET IS "TEXT A USER TYPED", NOT "ALL TEXT". Our own English chrome does not need
// it and adding it there is noise. Titles, bios, poll questions and poll options are
// typed by a person; "LIVE", "Tip", "Followers only" are not.
//
// ⚠ THE ASSERTION WALKS BACK TO THE OPENING TAG rather than testing the file for the
// substring. A file-wide `includes('dir="auto"')` passes as soon as ONE element in it
// carries the attribute, which is the self-matching shape that produced five useless
// guards in one session — StreamPoll would go green on the question alone while every
// option row stayed LTR.
{
  const UGC = [
    ['src/screens/admin/streamPreview/PreviewBroadcasterScreen.jsx', '>{streamDoc.title}</span>', 2],
    ['src/screens/admin/streamPreview/PreviewViewerScreen.jsx', '>{streamDoc.title}</span>', 1],
    ['src/screens/admin/streamPreview/PreviewViewerScreen.jsx', ">{streamDoc.title || 'Live stream'}</div>", 1],
    ['src/screens/admin/streamPreview/PreviewDesktopViewer.jsx', ">{d.title || 'LIVE stream'}</div>", 1],
    // moved with AudioStageView to the shared state layer
    ['src/components/streams/states/index.jsx', '>{title}</div>}', 1],
    ['src/components/streams/StreamPoll.jsx', '>{poll.question || poll.title}</div>', 1],
    ['src/components/streams/StreamPoll.jsx', '>{opt}</span>', 1],
    ['src/components/streams/UserQuickSheet.jsx', '>{user.bio}</div>', 1],
    ['src/components/monetization/StreamPaywall.jsx', '>{title}</div>', 1],
    ['src/screens/streams/ViewerStreamScreen.jsx', ">{streamDoc.title || 'Live stream'}</div>", 1],
  ];
  for (const [file, token, count] of UGC) {
    const s = codeOnly(readFileSync(file, 'utf8'));
    const hits = [];
    for (let at = s.indexOf(token); at !== -1; at = s.indexOf(token, at + 1)) hits.push(at);
    check(hits.length === count,
      file + ' no longer renders ' + token + ' (' + hits.length + ' of ' + count + ') — the dir="auto" rule cannot defend a line it cannot find');
    for (const at of hits) {
      const back = s.slice(Math.max(0, at - 460), at);
      const tag = back.slice(back.lastIndexOf('<'));
      check(tag.includes('dir="auto"'),
        file + ': ' + token + ' lost dir="auto" — an RTL title, bio or poll question renders in an LTR box, so the ellipsis lands on the wrong side and mixed content orders backwards');
    }
  }
}

// ── 50. A FULL-BLEED STATE CARRIES ITS OWN WAY OUT, AND SITS ABOVE THE DOCK ──
// ⚠⚠ MEASURED ON THE DEPLOYED PAGE 2026-09-03. Every state built on `Centred` — host
// dropped, stream ended, offline, subscribers-only, ticketed, age-restricted,
// region-blocked — laid a full-frame scrim over the whole UI. The host row, Viewers,
// More and Leave were all covered, so the ONLY reachable control was the one CTA. On
// "Region blocked", which has no CTA by design, **nothing on the screen was reachable
// at all**: a viewer with no way out and no button that does anything.
//
// This is the audio-only defect a second time — a layer mounted so it buries the exit.
//
// ⚠ IT ALSO SAT AT z-7 WHILE THE DOCK IS z-8, so a live poll painted over the ended
// screen and covered "Watch the replay".
//
// ⚠ NOT EVERY STATE IS BLOCKING, AND THE COPY DECIDES. Host-dropped says the stream is
// still open; offline says you keep your place in chat. Blocking the room contradicts
// the sentence on screen, so those two are non-blocking like connecting/reconnecting.
{
  const ps = codeOnly(readState());
  const at = ps.indexOf('function Centred(');
  const body = at < 0 ? '' : ps.slice(at, ps.indexOf(String.fromCharCode(10) + '}', at));
  check(at >= 0, 'Centred is gone — rule 50 cannot defend a component it cannot find');
  check(body.includes('aria-label="Leave stream"'),
    'Centred no longer draws a Leave control — a gated or ended viewer is left with no way out, and a region-blocked one with no reachable control at all');
  check(body.includes('zIndex: blocking ? 12 : 7'),
    'Centred went back under the dock — at z-7 against the dock z-8, a live poll paints over the ended screen and covers its own CTA');
  check(body.includes("pointerEvents: blocking ? 'auto' : 'none'"),
    'Centred lost its pointer-events split, so a non-blocking state buries the chrome behind it again');
  check(ps.includes('spin blocking={false}'),
    'host-dropped is blocking again — its own copy says the stream is still open, so it must not bury chat and the exit');
  check(ps.includes('spin={false} blocking={false}'),
    'offline is blocking again — its own copy says you keep your place in chat, so it must not bury chat');
}

// ── 51. RED IS TWO TOKENS, BECAUSE ONE VALUE CANNOT DO BOTH JOBS ─────────────
// ⚠ #ef4444 measured **3.76:1 under white as a FILL** (End Stream, the LIVE pill) and
// **4.29:1 as TEXT on a dark panel** (the TTS muted strip). It fails both floors, in
// opposite directions, so darkening fixes the fill and breaks the text and vice versa.
// ⚠ previewStates READS THE WHOLE STATE LAYER. The red tokens moved to
// components/streams/states/tokens.js with the components that use them, so a rule
// pointed at the preview file alone reports a token as lost when it simply lives
// in its proper home now.
for (const file of ['previewStates.jsx', 'PreviewBroadcasterScreen.jsx', 'PreviewDesktopViewer.jsx', 'PreviewViewerScreen.jsx']) {
  const s = file === 'previewStates.jsx' ? codeOnly(readState()) : codeOnly(read(file));
  check(!s.includes("'#ef4444'"),
    file + " went back to a single #ef4444 red — it measures 3.76:1 under white type and 4.29:1 as type on a dark panel, so it cannot serve as both a fill and an ink");
  check(s.includes('redFill'),
    file + ' lost the redFill token, so a red fill carrying white type has no value that clears 4.5:1');
}

// ── 52. THE POLL'S DISMISS MUST ACTUALLY DISMISS ────────────────────────────
// ⚠⚠ It was `onClose={() => {}}`. StreamPollCard renders its close button only when
// onClose is truthy, so the preview drew a control that swallowed the tap — inert
// theatre on the surface the Play screenshots come from. It also poisoned this audit:
// the poll stayed up through every reset and made five later surfaces report their own
// CTA as blocked, which cost two full re-runs before the cause was found.
{
  const pm = codeOnly(read('PreviewMobileViewer.jsx'));
  check(!pm.includes('onClose={() => {}}'),
    'PreviewMobileViewer passes an empty onClose to StreamPollCard again — the dismiss button renders and does nothing');
  check(pm.includes('onClose={dismissPoll}'),
    'the poll card is no longer wired to a real dismiss');
  const us = codeOnly(read('useStreamSim.js'));
  check(us.includes('const dismissPoll'), 'useStreamSim no longer defines dismissPoll');
  check(us.includes('dismissPoll,'), 'useStreamSim no longer returns dismissPoll, so the card silently gets undefined and the button disappears');
}

// ── 53. THE LEVEL-UP CELEBRATION OBEYS THE VISUAL RULES ─────────────────────
// ⚠⚠ IT BROKE THREE AT ONCE AND SURVIVED EVERY EARLIER SWEEP BECAUSE IT IS A TRANSIENT.
// Control run on the deployed page: zero ghost outlines before firing it, four after.
// The card carried a white hairline over its own fill; the badge, every unlock row and
// the Continue button were each a tint under a BRIGHTER ring. Continue is the primary
// action of the screen, and a primary state is a SOLID accent fill, never a tint plus a
// ring — its label also measured 4.41:1 against the 4.5 floor.
{
  const lu = codeOnly(readFileSync('src/components/engagement/LevelUpCelebration.jsx', 'utf8'));
  check(!lu.includes('border border-white/[0.08]'),
    'LevelUpCelebration went back to a white hairline over its own fill — the same defect the poll card was fixed for');
  for (const tint of ["color + '15'", "color + '10'"]) {
    check(!lu.includes(tint),
      'LevelUpCelebration went back to a ' + tint + ' tint fill — a tint with a ring is not a surface, and on Continue it is the primary action');
  }
  for (const ring of ['}30' + String.fromCharCode(96), '}22' + String.fromCharCode(96), '}25' + String.fromCharCode(96)]) {
    check(!lu.includes(ring),
      'LevelUpCelebration went back to a ring over a tint — the hairline is doing the separating a value step should do');
  }
  check(lu.includes('ensureContrast('),
    'LevelUpCelebration no longer solves its ink per tier — the fill is the TIER colour, and white on Bronze is 3.3:1');
}

// ── 54. A TOGGLE IS SOLID IN BOTH STATES ────────────────────────────────────
// ⚠⚠ THE STUDIO TOGGLE BROKE BOTH STANDING RULES, ONE IN EACH STATE. Measured on the
// deployed page: OFF was a rgba(255,255,255,0.06) white wash under a BRIGHTER
// rgba(255,255,255,0.09) hairline, so the stroke did all the separating; ON was a
// rgba(124,58,237,0.15) tint under a solid purple ring, which is exactly the selected
// state the founder has rejected twice. One control, both banned patterns.
{
  const pb = codeOnly(read('PreviewBroadcasterScreen.jsx'));
  const at = pb.indexOf('setMobileStudio((v) => !v)');
  const row = at < 0 ? '' : pb.slice(pb.lastIndexOf('<button', at), pb.indexOf('</button>', at));
  check(at >= 0, 'the Studio toggle is gone — rule 54 cannot defend a control it cannot find');
  check(!row.includes('rgba(255,255,255,0.06)'),
    'the Studio toggle went back to a white wash fill — a wash has no value of its own and needs a hairline to be visible at all');
  check(!row.includes('purpleSoft'),
    'the Studio toggle went back to a tint for its ON state — a selected state is a SOLID accent fill, never a tint plus a ring');
  check(row.includes("border: 'none'"),
    'the Studio toggle grew a border again — it was brighter than its own fill in the OFF state');
}

// ── 55. THE HOST'S ACTION RAIL IS NOT BURIED BY THE PANEL GUEST COLUMN ───────
// ⚠⚠ MEASURED ON THE DEPLOYED PAGE, WITH A CONTROL RUN. Solo reached all four host
// controls and co-host GRID reached all four; co-host PANEL reached none:
//     panel + 2 guests  →  Start a poll, Share this stream    buried
//     panel + 3 guests  →  all four buried
//     panel + 4 guests  →  all four buried
// The guest column is right:8 / width:32% (x 259-385 on a 393 frame) and the rail is
// right:10 with 46px pills (x 337-383), so they share the same band BY CONSTRUCTION and
// it gets worse with every guest. A host in panel mode could not clip, poll, share or
// flip the camera.
//
// ⚠ THE COLUMN IS NOT THE THING THAT MOVES. Its geometry is measured off the founder's
// own TikTok reference (242 of 750 = 32%, flush right, 4:5 tiles) and annotated as such.
// This rule pins BOTH halves so the pair cannot drift back into each other.
{
  const pb = codeOnly(read('PreviewBroadcasterScreen.jsx'));
  check(pb.includes("isCoHost && cohostLayout === 'panel' ? { left: 10 } : { right: 10 }"),
    "the host action rail is back on the right in panel co-host — it shares that band with the guest column, which buried all four controls at 3 and 4 guests");
  const st = codeOnly(read('PreviewStreamStages.jsx'));
  // ⚠ PIN THE DECISION, NOT THE LITERAL WIDTH. The column was re-sized from HEIGHT
  // (32% of a 393px stage made each 4:5 tile 126x157, so three filled 81% of a 590px
  // stage). What rule 55 actually depends on is that the column is RIGHT-ANCHORED and
  // wide enough to share the band, which is still true — so assert that, not the number.
  check(st.includes("right: 8, top: '50%'") && st.includes("guests.length >= 3 ? '24%' : '32%'"),
    'the panel guest column moved — rule 55 put the action rail on the LEFT because the column owns the right band, so if the column changes that decision has to be re-made');
}

// ── 56. GO LIVE AND ENDED OBEY THE SAME RULES AS THE LIVE PHASE ─────────────
// ⚠⚠ NEITHER PHASE HAD EVER BEEN SWEPT. Every earlier wave drove the LIVE phase, so the
// two screens that bracket a broadcast kept the entire set of banned patterns, measured
// on the deployed page 2026-09-03:
//
//   inputs        rgba(255,255,255,0.04) wash under a BRIGHTER rgba(255,255,255,0.09) edge
//   Share replay  transparent fill under a rgba(255,255,255,0.09) edge — a ring over nothing
//   Schedule next same
//   back / Later  same, in the native Go Live app bar
//   stat cards    #14141F under a rgba(255,255,255,0.06) edge
//   up-next card  #14141F under a rgba(255,255,255,0.09) edge
//   follower gate rgba(245,158,11,0.10) tint under a rgba(245,158,11,0.4) amber RING
//   locked CTA    rgba(255,255,255,0.08) wash
//   six strings   4.05:1 and 3.78:1 against a 4.5 floor
//
// ⚠ A TRANSPARENT FILL UNDER A HAIRLINE IS THE PUREST FORM OF THE BANNED PATTERN: there
// is no fill at all for the stroke to be brighter than, so the stroke IS the component.
//
// ⚠ THE INPUT BORDER IS DELIBERATELY STILL THERE. It is the one exemption the rule
// carries — an input's border is the affordance. What was wrong was the FILL.
{
  const es = codeOnly(read('PreviewEndAndSetup.jsx'));
  check(es.includes("const FIELD = '#191527'"),
    'PreviewEndAndSetup lost its solid FIELD token — the inputs and chips go back to a white wash');
  check(!es.includes("'rgba(255,255,255,0.04)'"),
    'a wash fill is back on PreviewEndAndSetup — that is the fill that forced the hairline to be brighter than it');
  check(!es.includes("'rgba(255,255,255,0.08)'"),
    'the locked Go Live CTA is a white wash again');
  // ⚠ THE SECOND SPELLING OF THE SAME THING. Two buttons wrote it as a ternary —
  //  with  — so the first
  // version of this rule reported green while Follow and Browse live were still rings
  // over nothing on the deployed page. Both spellings are pinned.
  // ⚠ AND THE THIRD SPELLING. The replay player's own Share and Back sat on the video as
  // rgba(10,10,20,0.78) under a brighter C.border hairline, written with a template
  // literal so neither of the two checks above matched it. No sweep had ever opened the
  // replay player, so only this guard found them. A control over video takes a solid hex.
  check(!es.includes("background: 'rgba(10,10,20,0.78)'"),
    'a control on the replay player is a translucent wash under a hairline again — a control floating over video takes a solid hex, which is what S.chipOnVideo exists for');
  check(!es.includes("'1px solid ' + C.border"),
    'a button on PreviewEndAndSetup is a ring over nothing again, written as a ternary — transparent fill with a hairline for an edge');
  check(!es.includes("background: 'transparent', border:"),
    'a button on PreviewEndAndSetup is a ring over nothing again — transparent fill, hairline edge');
  check(!es.includes("rgba(245,158,11,0.10)"),
    'the follower-gate notice is an amber tint under an amber ring again — a tint with a ring is not a surface');
  check(!es.includes("textDim: '#a0a0b8'") && !es.includes("textMuted: '#6b7280'"),
    'PreviewEndAndSetup went back to the dim greys that measured 4.05:1 and 3.78:1 on its own cards');
  check(!es.includes("'#6B7280'"),
    'a literal #6B7280 is back on PreviewEndAndSetup — the literals are how the stat labels escaped the token change the first time');
}

// ── 58. THE SHEETS: SELECTED IS SOLID, A BUTTON HAS A FILL, TYPE IS LEGIBLE ──
// ⚠⚠ THE SIXTEEN SHEETS ARE THE MAIN CAPTURE SURFACE AND HAD NEVER BEEN CONTRAST-SWEPT.
// Driven one at a time through the React sheet opener on the deployed page 2026-09-03:
//
//   MOD badge          1.87:1  — the worst reading in this whole audit. It set no colour
//                                of its own, so near-white text inherited onto bright green
//   Pin message        2.92:1  — the disabled CTA
//   Clear chat         3.76:1  — a DESTRUCTIVE confirm, white on #ef4444
//   9 viewer handles   3.84:1
//   tip amount "100c"  4.19:1  — and it was a fill under a solid purple RING
//
// ⚠ A SELECTED STATE IS A SOLID ACCENT FILL. Two selectable controls still drew the
// banned "fill plus a ring": the tip amount chip and the membership tier row.
//
// ⚠ A BUTTON WITH background:'transparent' AND A HAIRLINE IS THE EXTREME CASE of the
// rule — there is no fill at all for the stroke to be brighter than. The founder named
// this shape directly: "buttons using the gross outline that is lighter than the
// component background".
//
// ⚠ THE SHEET CONTAINERS ARE DELIBERATELY NOT TOUCHED. Their edge is the C.border panel
// token, which is open item D5 — a founder decision, not a technical one. Panels and
// cards stay; CONTROLS are fixed.
{
  const pc = codeOnly(read('previewChrome.jsx'));
  check(!pc.includes("textDim: '#a0a0b8'") && !pc.includes("textMuted: '#6b7280'"),
    'previewChrome went back to the dim greys that measured 3.84:1 and 2.92:1 inside its own sheets');
  check(pc.includes('redFill:') && pc.includes('onGreen:'),
    'previewChrome lost redFill/onGreen — Clear chat goes back to 3.76:1 and the MOD badge to 1.87:1');
  check(!pc.includes("background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800"),
    'a sheet button is a ring over nothing again — transparent fill under a hairline');
  check(!pc.includes("background: 'transparent', color: C.text, fontSize: 13, fontWeight: 800"),
    'the person sheet Message button is a ring over nothing again');
  check(!pc.includes("background: 'transparent', color: C.text, fontSize: 14, fontWeight: 800"),
    'the confirm sheet Cancel is a ring over nothing again');
  check(!pc.includes('amount === p ? C.purpleSoft'),
    'the tip amount chip is a fill under a ring again — a selected state is a SOLID accent fill');
  check(!pc.includes('pick === m.id ? C.purpleSoft'),
    'the pin-a-message row is a fill under a ring again — it is a selectable control, same rule as the tip chip');
  check(!pc.includes('secs === s ? C.purple : C.border'),
    'the slow-mode chips are back to a hairline over their own fill');
  check(!pc.includes('selected ? C.purpleSoft'),
    'the membership tier row is a fill under a ring again — same rule as the tip chip');
  check(pc.includes('background: C.green, color: C.onGreen'),
    'the MOD badge set no colour of its own again — it inherits near-white onto bright green and measured 1.87:1');
  check(pc.includes('aria-label={`Remove ${w}`}'),
    'the banned-word remove button lost its accessible name — <Icon> is aria-hidden, so it announced nothing at all');
  check(pc.includes('minWidth: 24, minHeight: 24 }}><Icon name="close" size={14} /></button>'),
    'the banned-word remove button is back under the 24x24 floor (measured 15x22)');
}

// The two states the product ALREADY has are imported, never re-drawn.
const stSrc = codeOnly(readState());
check(stSrc.includes('ReconnectingOverlay') && stSrc.includes('StreamLoadingCover'),
  'previewStates stopped importing the real overlays — a second copy of a shipped component drifts from it');

// ── GHOST OUTLINES, AND WHY THIS RULE IS ENUMERATED ──────────────────────
// Measured on the deployed page, every desktop panel was ringed by a hairline at
// dL 0.008-0.015 against its own fill, while the fill itself was only 0.0032-0.0038
// off the page behind it. So the stroke was doing the work the VALUE LADDER should
// do, which is precisely the border-soup root cause CLAUDE.md already records:
// "fix the ladder, not the symptom".
//
// ⚠⚠ THE REASON THIS SURVIVED 1060 GREEN ASSERTIONS IS THE ONE WORTH REMEMBERING:
// the fake-glass rule below it was scoped to TWO files out of thirteen. A guard whose
// file list covers only what was already fixed proves nothing about its siblings, and
// the `border` token had SEVEN copies. Both rules are now ENUMERATED from the
// directory, so a new file is covered the day it lands.
{
  const files = readdirSync(DIR).filter((f) => f.endsWith('.jsx'));

  // (a) the value ladder: no palette may go back to the fill that needed a stroke
  for (const f of files) {
    const src = codeOnly(read(f));
    check(!src.includes("card: '#12121e'") && !src.includes("panel: '#16161f'"),
      f + ' put the low-contrast card/panel fill back (#12121e / #16161f) — that 0.003 step off the page is exactly why every panel needed a hairline. Raise the value, do not re-add the stroke');
  }

  // (b) no panel, card, tile or sheet may ring itself again
  const OK_BORDER = ['fieldEdge', 'dashed'];
  for (const f of files) {
    const src = codeOnly(read(f));
    const bad = [];
    src.split(String.fromCharCode(10)).forEach((line, i) => {
      let at = line.indexOf('1px solid ');
      while (at >= 0) {
        const seg = line.slice(at, at + 60);
        // an input's edge IS its affordance, and a dashed empty-slot box is one too
        if (!OK_BORDER.some((k) => seg.includes(k)) && (seg.includes('.border') || seg.includes('rgba(255,255,255,0.0'))) {
          bad.push((i + 1) + ': ' + seg.trim().slice(0, 44));
        }
        at = line.indexOf('1px solid ', at + 1);
      }
    });
    check(bad.length === 0,
      f + ' has hairline outline(s) again [' + bad.slice(0, 3).join(' | ') + '] — a panel separates by VALUE. The only stroke allowed is fieldEdge on a text input');
  }

  // (c) and a divider must fade, or it terminates at full strength as a cage edge
  for (const f of files) {
    const src = read(f);
    if (!src.includes('ruleBottom') && !src.includes('ruleTop')) continue;
    check(src.includes('rgba(255,255,255,0) 0%') && src.includes('rgba(255,255,255,0) 100%'),
      f + ' declares a divider that no longer fades at both ends — a rule that stops at full strength reads as a cage edge');
  }
}


// ── EVERY BUTTON CARRIES A HANDLER ───────────────────────────────────────
// 37 dead controls were wired in this audit, in four separate rounds, and each
// round only found the ones the previous round had stopped masking. The last
// thirteen were invisible to the live probe for a reason worth writing down:
// the browser sweep drove the LIVE phase across ten surfaces and NEVER OPENED A
// SHEET OR A BLOCKING STATE, so it reported "0 dead controls" while a destructive
// confirm dialog's Confirm button, five sheet CTAs, and the Leave X on the
// subscriber/age/region gates all did nothing. Two of those were the ONLY way out
// of a full-bleed state — the same defect the founder himself caught in wave 5.
//
// A source rule has none of that blind spot: it does not care what is on screen.
{
  const files = readdirSync(DIR).filter((f) => f.endsWith('.jsx'));
  for (const f of files) {
    // ⚠ COMMENTS STRIPPED, LINE COUNT PRESERVED. The first version read the raw file
    // and fired on a JSX comment that DESCRIBES a handler-less button. That is the
    // "guard cries wolf against the comment explaining the defect" trap this file warns
    // about in its own header, hit for the fourth time.
    // ⚠ AND IT IS REGEX-FREE ON PURPOSE: the first repair was written through `node -e`
    // and the shell ate its backslashes, so the file would not even parse.
    const raw = stripComments(read(f));
    const bad = [];
    let at = raw.indexOf('<button');
    while (at >= 0) {
      // the opening tag ONLY. Scanning a fixed window instead runs into the NEXT
      // element and reads its onClick as this one's — the same window bug that made
      // an earlier guard pass while the thing it guarded was broken.
      let depth = 0, end = -1;
      for (let i = at; i < raw.length; i++) {
        const c = raw[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) { end = i; break; }
      }
      const tag = raw.slice(at, end < 0 ? at + 400 : end + 1);
      const hasHandler = tag.includes('onClick') || tag.includes('onPointerDown')
        || tag.includes('onMouseDown') || tag.includes('onChange') || tag.includes('{...');
      // a disabled button is deliberately inert, and that IS its state
      if (!hasHandler && !tag.includes('disabled')) {
        bad.push(raw.slice(0, at).split(String.fromCharCode(10)).length + ': ' + tag.replace(/\s+/g, ' ').slice(0, 52));
      }
      at = raw.indexOf('<button', end < 0 ? at + 7 : end);
    }
    check(bad.length === 0,
      f + ' has button(s) with no handler [' + bad.slice(0, 3).join(' | ') + '] — a control that swallows the press is worse than no control. Give it the action it names, or mark it disabled');
  }
}


// ── A PROP THE SURFACE READS MUST ACTUALLY BE PASSED ─────────────────────
// ⚠⚠ THIS IS THE FIFTH TIME. The file's own simProps comment already lists four:
// uploaded avatars, the PiP video, reactions, then combo — "a control was wired on
// one surface, the data it needs was never threaded to the others, and nothing
// failed, it just did nothing there". Number five was `scene`: PreviewDesktopViewer
// declares `scene = 'game'` and gates the facecam PiP on it, the rail's Game+cam /
// Camera only control drives `scene`, and the call site never passed it. The default
// held it at 'game' forever, so the toggle changed nothing and the founder found it.
//
// eslint cannot see this: a missing prop is a legal default, not an undefined.
// A green build and 1116 green assertions both said fine.
{
  const admin = stripComments(readFileSync('src/screens/admin/AdminStreamPreviewScreen.jsx', 'utf8'));
  // each entry: the component, and the props it reads that the RAIL drives
  const NEEDS = {
    PreviewDesktopViewer: ['streamType', 'guestCount', 'cohostLayout', 'camsOff', 'scene'],
    PreviewBroadcasterScreen: ['streamType', 'guestCount', 'cohostLayout', 'camsOff'],
    PreviewViewerScreen: ['streamType', 'guestCount', 'soloView', 'scene', 'cohostLayout', 'camsOff'],
  };
  for (const [comp, props] of Object.entries(NEEDS)) {
    const at = admin.indexOf('<' + comp + ' ');
    if (at < 0) { check(false, comp + ' is no longer mounted in the preview screen'); continue; }
    const end = admin.indexOf('/>', at);
    const call = end < 0 ? admin.slice(at, at + 700) : admin.slice(at, end);
    const missing = props.filter((k) => !call.includes(k + '={'));
    check(missing.length === 0,
      comp + ' is missing rail-driven prop(s) [' + missing.join(', ') + '] at its call site — the component declares a DEFAULT for them, so nothing errors and the control silently does nothing. This exact shape has now shipped five times');
  }
}


// ── A GATE WHOSE BODY IS ONLY A COMMENT RENDERS AN EMPTY OBJECT ──────────
// ⚠⚠ THIS CRASHED A WHOLE SURFACE AND EVERY CHECK WAS GREEN. Deleting an element from
// inside a logical-AND gate and leaving the JSX comment behind produces this shape:
//
//     cond && (            <- open paren
//       JSX comment        <- the entire body
//     )                    <- close paren
//
// A parenthesised JSX comment is an EMPTY OBJECT LITERAL, and React refuses to render
// one: error #31, "object with keys {}". The mobile broadcaster co-host surface died to
// the ErrorBoundary. eslint passed, the build passed, and 1129 assertions passed — the
// file is syntactically perfect and only fails when that branch actually renders.
//
// This is the JSX-comment trap in a new costume. The parse-error version has bitten this
// project eight times; this is the first RUNTIME one, and it is worse because nothing
// static catches it.
{
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.jsx'))) {
    const lines = read(f).split(String.fromCharCode(10));
    const bad = [];
    for (let i = 0; i < lines.length - 2; i++) {
      const open = lines[i].trimEnd();
      if (!open.endsWith('&& (') && !open.endsWith('? (')) continue;
      // walk to the matching close, collecting the body
      let body = [], j = i + 1;
      for (; j < lines.length && j < i + 12; j++) {
        const t = lines[j].trim();
        if (t === ')}' || t === ') : (' || t === ')}') break;
        if (t) body.push(t);
      }
      if (!body.length) continue;
      // a body made of NOTHING but comment lines is the defect
      const allComment = body.every((t) => t.startsWith('{/*') || t.startsWith('/*') || t.startsWith('*')
        || t.endsWith('*/}') || t.endsWith('*/'));
      if (allComment) bad.push((i + 1) + ': ' + open.trim().slice(0, 44));
    }
    check(bad.length === 0,
      f + ' has a gate whose body is only a comment [' + bad.slice(0, 3).join(' | ')
      + '] — a parenthesised JSX comment is an empty object literal and React error #31 crashes the surface on render. Delete the whole gate, do not leave the comment inside it');
  }
}


// ── NEVER SHOW A VIEWER VP THAT NOBODY IS PAID ───────────────────────────
// ⚠⚠ Founder caught this by looking at a screenshot: "why is the viewer seeing the vp
// this stream?". VpEarnedChip computed the viewer figure from `watch_stream_hour` in
// src/utils/vpSystem.js — a key that appears in NO server path. functions/engagementVp.js
// awards exactly create_post, get_comment, go_live, stream_hour and raid_sent. Watching
// earns nothing, and it is not on the /prestige earn table either, so five viewer
// surfaces advertised VP that never arrives.
//
// The BROADCASTER chip is honest: go_live and stream_hour are both server-awarded.
// The rule is therefore about the host prop, not about the component.
{
  const viewerFiles = ['PreviewDesktopViewer.jsx', 'PreviewMobileViewer.jsx',
    'PreviewSoloLandscape.jsx', 'PreviewSoloPortrait.jsx', 'PreviewViewerScreen.jsx'];
  for (const f of viewerFiles) {
    const src = codeOnly(read(f));
    check(!src.includes('<VpEarnedChip'),
      f + ' shows a viewer the VP-earned chip again — nothing awards watch_stream_hour, so that number is a promise the product never keeps. Wiring it server-side is an economy change and a founder decision, not a UI one');
  }
  // and the host chip must still be there, or the honest half was thrown out with it
  const b = codeOnly(read('PreviewBroadcasterScreen.jsx'));
  check((b.match(/<VpEarnedChip host/g) || []).length === 3,
    'the broadcaster VP chip is no longer on all three branches — go_live and stream_hour ARE server-awarded, so the host figure is real and should show');
}

// AN EM DASH IN SHIPPED COPY IS A HARD-RULE BREACH, AND ONLY RENDERING FOUND IT.
//
// The region-blocked gate read "not on your account — everything else on Vergr
// still works." It had been in the file for weeks. It survived every previous
// pass because no probe reads TEXT, and it is a full-screen takeover that had
// never once been screenshotted, so nobody had ever looked at it.
//
// 20 sites across 14 strings were carrying one. CLAUDE.md bans the character in
// every output, and a store screenshot of a blocking gate is about as visible as
// output gets.
//
// The rule reads CODE ONLY, on purpose. Comments are stripped by the bundler
// (verified: no comment text appears anywhere in dist/), so an em dash in a
// warning block cannot reach a user and banning it there would only push people
// to write worse notes.
//
// Enumerated from readdirSync so a new file is covered the day it is added.
// ⚠ USE stripComments, NOT codeOnly. codeOnly DELETES comment lines, so every
// line number it reports is an index into the stripped text rather than the file,
// and it keeps TRAILING `// ...` comments, which is a false positive. The first
// version of this rule did both: it reported "previewStates.jsx:14" for a trailing
// comment on some other line entirely. stripComments is string-aware and blanks in
// place, so the count is preserved and the line number is real.
// ⚠ THE SHARED STATE FILES ARE IN SCOPE TOO. They left the preview directory on
// 2026-09-04, so FILES (which enumerates that directory) stopped covering them
// the moment they became SHIPPED production copy. That is the wrong direction:
// an em dash there now reaches a real viewer, not just a screenshot.
{
  for (const f of FILES.concat(STATE_PATHS, PORTED_PATHS)) {
    const external = STATE_PATHS.includes(f) || PORTED_PATHS.includes(f);
    const src = external ? readFileSync(f, 'utf8') : read(f);
    const lines = stripComments(src).split(String.fromCharCode(10));
    const hit = lines.findIndex((l) => l.includes(String.fromCharCode(0x2014)));
    check(hit === -1,
      f + (hit >= 0 ? ':' + (hit + 1) : '') + ' has an em dash in shipped copy. It renders, and CLAUDE.md bans the character in every user-facing output. Use a comma, a colon, or two sentences');
  }
}
// THE LOADING / RECONNECTING COVER MUST STAY UNDER THE CHROME.
//
// Measured layer map of the immersive viewer frame:
//   video (auto)  <  cover  <  header 6  <  chat 8  <  dock 9/10
// The cover shipped at z7, which cleared the header too, so Connecting painted
// opaque #0a0a14 over the entire 244x528 frame and left a viewer with no visible
// exit. It is a BLOCKING state, so that is the same defect class as a gate with
// no Leave button.
//
// It cannot go back to z-index auto either: the video is a later sibling, so the
// cover would paint UNDER it and vanish. The window is 1..5 and both ends matter.
{
  const src = readState();
  const i = src.indexOf('<StreamLoadingCover');
  check(i > 0, 'previewStates.jsx no longer mounts StreamLoadingCover');
  if (i > 0) {
    const open = src.lastIndexOf('<div style={{', i);
    const wrapper = src.slice(open, i);
    const m = wrapper.indexOf('zIndex:');
    check(m > 0, 'the connecting/reconnecting cover wrapper lost its explicit zIndex. At z-index auto it paints UNDER the video and disappears');
    if (m > 0) {
      const z = parseInt(wrapper.slice(m + 7, m + 12).trim(), 10);
      check(z >= 1 && z <= 5,
        'the loading cover sits at z' + z + '. The header is z6, so anything >= 6 buries the Leave button under an opaque cover and traps the viewer in a blocking state; anything < 1 puts it under the video');
    }
  }
}
// THE COMPOSER PLACEHOLDER LIVES IN ONE PLACE.
//
// chatState used to drive ChatStateBanner and nothing else, so a banner reading
// "You are banned from this chat" sat directly above a composer reading "Add a
// comment...", dock and all. Five sites each carried their own literal, and two
// of them did not even agree on the ellipsis (... vs the character).
//
// composerCopy() is now the only definition. A new surface that hand-rolls the
// placeholder is a surface that will contradict its own banner, so the literal
// is banned outside the file that defines it.
{
  for (const f of FILES) {
    if (f === 'previewStates.jsx') continue;
    const src = stripComments(read(f));
    check(!src.includes('Add a comment'),
      f + ' hardcodes the composer placeholder. Render <ComposerPill /> instead, or the composer will keep inviting a banned viewer to type');
    check(!src.includes('placeholder="Send a message"'),
      f + ' hardcodes the desktop composer placeholder. It must come from composerCopy(chatState) so the input disables itself when chat is locked');
  }
  const st = stripComments(readState());
  check(st.includes('export function ComposerPill'), 'ComposerPill is gone from previewStates.jsx');
  check(st.includes('export const composerCopy'), 'composerCopy is gone from previewStates.jsx');
}
// THE GOAL MUST START BELOW THE BROADCAST-HEALTH CARD.
//
// MEASURED with health = "Ingest lost", opaque #12101E card:
//   mobile  (244x528)  card runs to 17.7% of frame height
//   desktop (620x384)  card runs to 19.2%
// The fallbacks were originally derived from the VP chip row alone (11.4% /
// 19.5%) because the health warning is a TRANSIENT and was not on screen when
// they were set. At yPct 14 the card covered 80% of the goal and painted over
// its centre, so a broadcaster losing ingest also lost their tip goal.
//
// 20 clears both shapes. It is only the STARTING position; the goal is
// draggable, so a default that is correct in every state costs nothing.
{
  const src = read('PreviewBroadcasterScreen.jsx');
  const hits = src.split('<MovableGoal').slice(1);
  check(hits.length === 3,
    'expected 3 MovableGoal mounts on the broadcaster (mobile solo, mobile co-host, desktop studio), found ' + hits.length);
  hits.forEach((h, i) => {
    const k = h.indexOf('yPct:');
    check(k > 0, 'broadcaster MovableGoal #' + (i + 1) + ' has no yPct fallback');
    if (k > 0) {
      const y = parseInt(h.slice(k + 5, k + 10).trim(), 10);
      check(y >= 20,
        'broadcaster MovableGoal #' + (i + 1) + ' starts the tip goal at yPct ' + y + '. The broadcast-health card reaches 17.7% on mobile and 19.2% on desktop, so anything under 20 puts the goal under an opaque warning the moment ingest drops');
    }
  });
}
// AN EXPIRED POLL MUST READ AS CLOSED.
//
// `closed` was hardcoded false, so a poll that ran out kept saying LIVE POLL with
// a frozen 0s and stayed on screen indefinitely. Found only because several
// minutes of unrelated sheet captures all had a dead poll sitting in the frame.
// The shipped card flips to POLL CLOSED and drops the countdown, and
// useActiveStreamPoll derives that from expiresAt, so the preview must derive it
// too rather than assert a state the product never has.
{
  const src = stripComments(read('PreviewMobileViewer.jsx'));
  check(!src.includes('closed={false}'),
    'the poll card is mounted with closed={false}. An expired poll then reads LIVE POLL at 0s forever, which the shipped card never does');
  check(src.includes('closed={pollClosed}'),
    'the poll card no longer takes a derived closed state');
  check(src.includes('previewPoll?.expiresAt'),
    'pollClosed is no longer derived from expiresAt, so it cannot track the countdown the card renders');
}
// MEMBERSHIP TIERS COME FROM ONE DEFINITION.
//
// previewChrome held a hand-written copy of the creator screen's defaults and it
// had ALREADY DRIFTED before anyone noticed: Supporter read "Exclusive posts"
// against a real "Exclusive posts & behind-the-scenes", and VIP and Legend had
// each lost their Discord perk. The subscribe and gift-a-sub sheets are captured
// for the store, so a drifted copy advertises a product the creator is not given.
//
// Same rule as the VP numbers and the TTS unlock level: read the real thing.
{
  const src = stripComments(read('previewChrome.jsx'));
  check(src.includes('DEFAULT_MEMBERSHIP_TIERS'),
    'previewChrome no longer imports DEFAULT_MEMBERSHIP_TIERS. The tiers shown on the subscribe and gift-a-sub sheets must come from utils/membershipDefaults.js, never a local copy');
  check(!src.includes('priceCoins: 100') && !src.includes('priceCoins: 500'),
    'previewChrome restates a membership price. Import the defaults instead; the last hand-written copy drifted from the real perks without anyone noticing');
  const shared = readFileSync('src/utils/membershipDefaults.js', 'utf8');
  check(!shared.includes('id:'),
    'the shared tier defaults carry an id. Ids are minted per creator, so a shared one would give two creators the same tier id');
  const screen = readFileSync('src/screens/creator/MembershipTiersScreen.jsx', 'utf8');
  check(screen.includes('DEFAULT_MEMBERSHIP_TIERS'),
    'MembershipTiersScreen no longer reads the shared defaults, so the creator screen and the preview can diverge again');
}
// ── PORTED PRODUCTION SURFACES ──
// The preview has 1200+ assertions and the real screens had ZERO. Each file gets
// covered as the port reaches it, or the design regresses the first time somebody
// edits a stream screen without opening it.

// ChatPanel, ported 2026-09-04: chat state is shown BEFORE you type.
{
  const cp = readFileSync('src/components/streams/ChatPanel.jsx', 'utf8');
  // ⚠ TAG BOUNDARY, NOT A BARE SUBSTRING. <ChatStateBannerX still contains
  // <ChatStateBanner, so the first version of this passed with the component renamed
  // out of existence. Fourth time this exact shape has bitten a guard here.
  check(cp.includes('<ChatStateBanner' + String.fromCharCode(10)) || cp.includes('<ChatStateBanner '),
    'ChatPanel no longer renders ChatStateBanner. Being muted or banned then goes back to being discoverable only by typing a message and having it rejected');
  check(cp.includes('setChatBlock(r)'),
    'ChatPanel stopped remembering a muted/banned rejection, so the banner can never appear: those two are facts about this viewer that the client cannot learn any other way');
  // ⚠ THE LOCK MUST NOT WIDEN. followersOnly and slow mode are properties of the
  // ROOM: a follower may chat in a followers-only room and slow mode rate-limits
  // rather than blocks, so locking on either silences people who are allowed to
  // speak. Only the two viewer-specific facts may disable the input.
  check(cp.includes('composerCopy(chatBlock'),
    'ChatPanel derives its composer lock from something other than chatBlock. Locking on followersOnly or slow mode stops followers and rate-limited viewers who are allowed to chat');
  check(!cp.includes('composerCopy(chatState)'),
    'ChatPanel locks the composer on the ROOM state. A follower in a followers-only room would be silenced');
  const line = cp.split(String.fromCharCode(10)).find((l) => l.includes('const friendly'));
  check(line !== undefined, 'ChatPanel lost its rejection copy');
}
// MobileLiveViewer, ported 2026-09-04: the viewer's OWN connection.
//
// Nothing in that file read navigator.onLine, so a viewer who lost wifi saw
// "Reconnecting..." forever: identical to the broadcaster having trouble, with no
// explanation and nothing to act on.
//
// FOUR OF THIS RULE'S FIRST FIVE NEGATIVE TESTS PASSED, every one a trap already
// on record:
//   - it matched navigator.onLine inside the COMMENT explaining its own fix
//   - state="offlineX" contains state="offline"
//   - {false && !online} still contains !online
//   - there are TWO mounts and it only ever required one
// So: comments stripped, tag boundary enforced, and EVERY mount checked.
{
  const mvRaw = readFileSync('src/components/streams/MobileLiveViewer.jsx', 'utf8');
  const mv = stripComments(mvRaw);
  check(mv.includes('navigator.onLine'),
    'MobileLiveViewer no longer detects the viewer being offline, so losing wifi goes back to looking like the broadcaster reconnecting');
  check(mv.includes("addEventListener('offline'"),
    'MobileLiveViewer reads navigator.onLine once but never listens for the change, so it can only ever be right at mount');
  const TAG = 'state="offline"';
  const mounts = [];
  for (let i = mv.indexOf(TAG); i >= 0; i = mv.indexOf(TAG, i + 1)) {
    const after = mv.charAt(i + TAG.length);
    if (after === ' ' || after === '/' || after === '>') mounts.push(i);
  }
  check(mounts.length === 2,
    'expected the offline state on BOTH MobileLiveViewer overlay mounts, found ' + mounts.length + '. The file renders the reconnecting overlay twice, so one mount without it leaves a whole layout telling an offline viewer the broadcaster is reconnecting');
  mounts.forEach((at, n) => {
    const before = mv.slice(Math.max(0, at - 300), at);
    check(before.includes('{!online'),
      'offline mount #' + (n + 1) + ' is not gated on {!online taking precedence, so a stalled overlay can claim the broadcaster is reconnecting while the viewer is the one offline');
    const tag = mv.slice(at, mv.indexOf('/>', at) + 2);
    check(tag.includes('onLeave='),
      'offline mount #' + (n + 1) + ' lost its real leave. Without one it draws a Leave button that does nothing, the dead-control shape this layer already fixed twice');
    check(tag.includes('onRetry='),
      'offline mount #' + (n + 1) + ' lost its retry, so the one action on the screen does nothing');
  });
}
// ChatPanel empty state, ported 2026-09-04.
//
// There was NO empty state: a live stream with nobody talking yet rendered a
// blank column, which reads as a failure to load rather than a room waiting for
// someone to speak. It is every stream's first minutes, so it is the state a new
// creator sees most.
{
  const cp = stripComments(readFileSync("src/components/streams/ChatPanel.jsx", "utf8"));
  check(cp.includes("<EmptyChat"),
    "ChatPanel no longer renders an empty-chat state, so a quiet chat goes back to looking broken");
  const at = cp.indexOf("<EmptyChat");
  if (at > 0) {
    const line = cp.slice(Math.max(0, at - 200), at);
    check(line.includes("messages.length === 0"),
      "the empty-chat state is no longer gated on there being no messages");
    // ⚠ IT MUST NOT SHOW WHILE CONNECTING. Before the socket is open there is
    // legitimately nothing to show, and claiming "no messages yet" then is a
    // statement we cannot support: the loading path owns that moment.
    check(line.includes("connState === "),
      "the empty-chat state is no longer gated on the socket being open, so it flashes \"no messages yet\" during connection when we do not yet know that");
  }
}
// The appeal path, ported 2026-09-04.
//
// The banner's "Appeal" CTA had nowhere to go, and a route out that leads nowhere
// is worse than none. ChatStateBanner only draws that button when a handler is
// passed, so the handler and the sheet are what make it exist at all.
{
  const mv = stripComments(readFileSync("src/components/streams/MobileLiveViewer.jsx", "utf8"));
  check(mv.includes("function AppealSheet("),
    "MobileLiveViewer lost the appeal sheet, so the banner CTA has nowhere to go and stops rendering");
  const mounts = mv.split("onAppeal={(kind) => setAppealKind(kind)}").length - 1;
  check(mounts === 2,
    "expected the appeal route on BOTH ChatPanel mounts, found " + mounts + ". MobileLiveViewer mounts chat twice (fullscreen and normal), so one without it leaves a whole layout where a timed-out viewer cannot appeal");
  check(mv.includes("targetType: 'stream_chat'") && mv.includes("appealText:"),
    "the appeal no longer calls submitAppeal with the shape adminModeration expects (targetType, targetId, appealText)");
  // ⚠ THE MINIMUM IS THE SERVER'S. adminModeration.submitAppeal rejects under 20
  // characters. A form that lets someone write less loses their appeal to an error
  // after they have typed it.
  check(mv.includes("const MIN = 20;"),
    "the appeal form no longer enforces the server minimum of 20 characters, so a short appeal is written and then thrown away by the server");
}
// ZeroViewers, ported 2026-09-04 to ALL THREE broadcaster layouts.
//
// The first minutes of every stream rendered the digit 0 and nothing else: the
// state a new creator sees most, with no copy and nothing to do about it.
//
// ⚠ THREE MOUNTS, NOT ONE. BroadcasterScreen has two layouts and the native
// broadcaster is a SEPARATE 700-line implementation. A change made once ships to
// one layout on one platform, which is the single most likely way this port ends
// up half done.
{
  const files = [
    ["src/screens/streams/BroadcasterScreen.jsx", 2],
    ["src/screens/streams/native/NativeBroadcasterScreen.jsx", 1],
  ];
  for (const [f, want] of files) {
    const src = stripComments(readFileSync(f, "utf8"));
    const got = countTag(src, "ZeroViewers");
    check(got === want,
      f + " renders the zero-viewer state on " + got + " layout(s), expected " + want + ". A broadcaster layout without it shows a bare 0 in the first minutes of every stream");
    check(src.includes("(streamDoc.viewerCount || 0) === 0"),
      f + " no longer gates the zero-viewer state on the count actually being zero");
  }
}
// The host VP chip, ported 2026-09-04 to all three broadcaster layouts.
//
// ⚠⚠ HOST ONLY, AND THIS IS NOT A STYLE CHOICE. go_live and stream_hour are both
// server-awarded, so a host figure is real. NOTHING awards watch_stream_hour, so a
// viewer chip would promise VP that never arrives. The viewer version was removed
// from the preview on 2026-09-04 for exactly that reason; it must not reappear on
// a production viewer either.
{
  for (const [f, want] of [
    ["src/screens/streams/BroadcasterScreen.jsx", 2],
    ["src/screens/streams/native/NativeBroadcasterScreen.jsx", 1],
  ]) {
    const src = stripComments(readFileSync(f, "utf8"));
    const got = countTag(src, "VpEarnedChip");
    check(got === want,
      f + " renders the host VP chip on " + got + " layout(s), expected " + want);
    if (got > 0) {
      const at = src.indexOf("<VpEarnedChip");
      const tag = src.slice(at, src.indexOf("/>", at) + 2);
      check(tag.includes("host"),
        f + " renders VpEarnedChip WITHOUT the host flag, so it computes the viewer figure from watch_stream_hour, which nothing awards");
    }
  }
  for (const f of ["src/components/streams/MobileLiveViewer.jsx", "src/screens/streams/ViewerStreamScreen.jsx"]) {
    const src = stripComments(readFileSync(f, "utf8"));
    check(countTag(src, "VpEarnedChip") === 0,
      f + " shows a VIEWER the VP-earned chip. Nothing awards watch_stream_hour, so that number is a promise the product never keeps; wiring it server-side is an economy change and a founder decision");
  }
}
// The health card and the movable goal, ported 2026-09-04.
{
  const bc = stripComments(readFileSync("src/screens/streams/BroadcasterScreen.jsx", "utf8"));
  // ⚠ THE HEALTH CARD MUST CARRY THE REAL MESSAGE. The signal is the uplink probe
  // capping the bitrate, so the true statement is that quality was ALREADY lowered.
  // The card default says "switch to a lower quality", advice for a situation that
  // has not happened. Shipping the default would replace an accurate message with
  // an inaccurate one.
  check(countTag(bc, "HealthWarningView") === 2,
    "the broadcast-health card is not on both web broadcaster layouts, so one layout tells a struggling host nothing");
  check(bc.includes("Quality lowered to keep you live"),
    "the health card lost the pill's original message. The signal is that quality was ALREADY lowered; the component default advises lowering it, which is not what happened");
  // ⚠ THE GOAL MUST BE MOVABLE ON BOTH LAYOUTS, and there must be a way to turn
  // dragging ON. Always-draggable gets moved by accident mid-stream; never-draggable
  // is the fixed position this replaced.
  check(countTag(bc, "MovableGoal") === 2,
    "the tip goal is not movable on both web broadcaster layouts; it used to render at a fixed position and cover the host's face");
  check(bc.includes("Move the tip goal"),
    "the goal has no entry point to enable dragging, so it can never be moved");
  check(bc.includes("localStorage.removeItem(goalKey)"),
    "resetting the goal position no longer clears storage, so a reset comes back on the next stream");
}
// ViewerStreamScreen (desktop), ported 2026-09-04.
//
// It shares ChatPanel, so it inherited the chat-state banner and empty chat for
// free. What it did NOT inherit was anything held in MobileLiveViewer: the offline
// state and the appeal route both had to be wired here separately.
{
  const vs = stripComments(readFileSync("src/screens/streams/ViewerStreamScreen.jsx", "utf8"));
  check(vs.includes("navigator.onLine"),
    "the desktop viewer no longer detects the viewer being offline, so losing a connection looks like the broadcaster reconnecting");
  check(countTag(vs, "PlaybackStateView") === 1,
    "the desktop viewer no longer renders the offline playback state");
  check(vs.includes("onAppeal={(kind) => setAppealKind(kind)}"),
    "the desktop viewer lost its appeal route, so a muted viewer on desktop sees the banner CTA with nowhere to go");
  check(countTag(vs, "AppealSheet") === 1,
    "the desktop viewer passes an appeal handler but never mounts the sheet, so the button does nothing");
}
// ── THE THREE FOUNDER-APPROVED FEATURES BUILT 2026-09-04 ─────────────────────
// All three were answered on 2026-09-02 and then sat unbuilt. Each is guarded at
// the point where getting it wrong costs money or breaks a promise.
{
  const st = readFileSync('functions/streaming.js', 'utf8');
  const cl = readFileSync('functions/streamClips.js', 'utf8');
  const mb = readFileSync('functions/memberships.js', 'utf8');
  const ix = readFileSync('functions/index.js', 'utf8');

  // AUDIO-ONLY. The field was READ in two places and written by nothing, so the
  // viewer could never draw the audio stage.
  check(st.includes('audioOnly: !!audioOnly'),
    'createStreamSession no longer writes audioOnly, so the field goes back to being read by two places and written by none');
  for (const f of ['src/components/streams/MobileLiveViewer.jsx', 'src/screens/streams/ViewerStreamScreen.jsx']) {
    const v = stripComments(readFileSync(f, 'utf8'));
    check(countTag(v, 'AudioStageView') === 1,
      f + ' no longer renders the audio stage, so an audio-only broadcast shows a dead video area');
  }

  // WHO MAY CLIP. Separate from HOW MUCH, which stays the clipper own plan.
  check(st.includes("clipPolicy: ['everyone', 'followers', 'subscribers'].includes(clipPolicy)"),
    'createStreamSession no longer validates clipPolicy against the three allowed values');
  // ⚠ ENFORCED SERVER-SIDE. A client check is a suggestion; this callable is the
  // only thing between the policy and a clip.
  check(cl.includes("const policy = s.clipPolicy || 'everyone'"),
    'requestStreamClip no longer enforces the clip policy, so a followers-only or subscribers-only stream can be clipped by anyone');
  check(cl.includes('member_subscriptions'),
    'the clip subscriber check no longer reads member_subscriptions. CLAUDE.md names a `memberships` collection that does not exist, and using it would make the check pass for nobody');
  // ⚠ THE TWO LIMITS MUST STAY SEPARATE. Conflating who-may-clip with how-much
  // would silently re-price every plan.
  // DECLARATION, not a bare substring: CLIP_TIERX contains CLIP_TIER.
  check(cl.includes('const CLIP_TIER = {'),
    'the per-plan clip limits are gone. WHO may clip is the host choice; HOW MUCH is the clipper own plan (free 30s/3, lite 60s/5, pro 90s/unlimited)');

  // GIFT A SUB.
  check(mb.includes('exports.giftMembership'),
    'giftMembership is gone from memberships.js');
  check(ix.includes('exports.giftMembership'),
    'giftMembership is not exported from index.js, so it is written but not deployed');
  // ⚠ NO RENEWAL. The recipient never entered payment details.
  check(mb.includes('autoRenew: false'),
    'a gifted membership can renew again. The recipient never entered payment details and must not be billed when the month ends');
  // ⚠ NO DISCOUNT, ENFORCED BY THE SHAPE. There is no quantity table anywhere in
  // that function, so there is nowhere for one to appear by accident.
  check(mb.includes('const total = price * granted.length;'),
    'the gift total is no longer price x count. Founder, 2026-09-02: bulk is qty x price with NO discount, and changing that is an economy decision');
  {
    const at = mb.indexOf('exports.giftMembership');
    const body = at > 0 ? mb.slice(at, mb.indexOf('exports.', at + 10)) : '';
    check(!/0\.\d\s*\*\s*price|price\s*\*\s*0\.\d|discount/i.test(body),
      'a discount or multiplier appeared inside giftMembership. Bulk is qty x price with no discount');
  }
}
// ── WEB / NATIVE PARITY ─────────────────────────────────────────────────────
// The broadcaster and Go Live each exist TWICE. Every feature in this port had to
// be added in two files, and three of them were web-only until a parity check
// caught it. Worse, the native Go Live SENT audioOnly and clipPolicy with no
// control to set them, so both were permanently false: the payload looked correct
// and the user could never change it.
{
  const pairs = [
    ["src/screens/streams/BroadcasterScreen.jsx", "src/screens/streams/native/NativeBroadcasterScreen.jsx",
     ["ZeroViewers", "VpEarnedChip", "MovableGoal"]],
    ["src/screens/streams/GoLiveSetupScreen.jsx", "src/screens/streams/native/NativeGoLiveScreen.jsx",
     ["audioOnly", "clipPolicy"]],
  ];
  for (const [web, nat, feats] of pairs) {
    const w = stripComments(readFileSync(web, "utf8"));
    const n = stripComments(readFileSync(nat, "utf8"));
    for (const feat of feats) {
      // ⚠ A COMPONENT IS CHECKED AS A TAG, NOT A SUBSTRING. <MovableGoalX> contains
      // MovableGoal, and this rule passed with the component renamed out of
      // existence on its first negative test. Seventh time for this exact shape.
      const isComponent = feat[0] === feat[0].toUpperCase();
      const has = (src) => (isComponent ? countTag(src, feat) > 0 : src.includes(feat));
      check(has(w),
        web + " lost " + feat + ", so the web half of a two-implementation feature is gone");
      check(has(n),
        nat + " is missing " + feat + ". The broadcaster and Go Live exist TWICE; a change made once ships to one platform only");
    }
  }
  // ⚠ A CONTROL, NOT JUST A PAYLOAD. Sending a value the user cannot set is worse
  // than not sending it.
  const ng = stripComments(readFileSync("src/screens/streams/native/NativeGoLiveScreen.jsx", "utf8"));
  check(ng.includes("onChange={setAudioOnly}"),
    "the native Go Live sends audioOnly but has no control to set it, so it is permanently false");
  check(ng.includes("onChange={(e) => setClipPolicy(e.target.value)}"),
    "the native Go Live sends clipPolicy but has no picker, so it is permanently everyone");
}
if (fails.length) {
  console.error(`stream-preview-check: ${fails.length} FAILED of ${n}`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`stream-preview-check: ${n} assertions passed`);
