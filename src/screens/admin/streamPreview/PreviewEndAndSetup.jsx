// Go Live setup + Stream ending — the two ends of a broadcast.
//
// ⚠ THESE WERE MISSING FROM THE FIRST SIMULATOR AND THAT WAS THE WORST GAP IN
// IT. The tool exists so no screenshot needs a real broadcast, and these are the
// two screens you cannot reach without starting or finishing one. They were
// missed because the build started from "which preview files exist" instead of
// "which screens does a stream pass through". See docs/STREAM_PREVIEW_PLAN.md §3.
//
// ⚠ COPIES OF THE SHIPPED DESIGN. No camera, no getUserMedia, no device
// enumeration, no callable, no navigation. Production files are untouched.
//
// Source of each copied block:
//   Go Live palette / inputField / btnPrimary   GoLiveSetupScreen.jsx:23, 1596, 1588
//   Go Live layout (preview, title, advanced)   GoLiveSetupScreen.jsx ~790-880
//   Go Live CTA + follower-gate state           GoLiveSetupScreen.jsx:617-631
//   Ingest cards                                GoLiveSetupScreen.jsx:1239-1256
//   Stream ending                               StreamEndingScreen.jsx (whole file)

import { useState } from 'react';
import Icon from '../../../components/Icon';
import { CoinIcon } from '../../../components/CoinIcon';

// copied verbatim from GoLiveSetupScreen.jsx:23
// ⚠ A FIELD IS SOLID AND ITS BORDER IS THE AFFORDANCE. The fill was
// rgba(255,255,255,0.04) — a wash with no value of its own, which is exactly why the
// hairline had to be brighter than it for the box to be visible at all. Same value as
// S.field in previewStates, whose own comment records this rule.
//
// ⚠⚠ NEITHER GO LIVE NOR ENDED HAD EVER BEEN SWEPT. Every earlier wave measured the LIVE
// phase, so these two screens kept the whole set: wash inputs, buttons held together by a
// hairline over nothing, an amber tint under a brighter amber ring, and six body strings
// below the contrast floor.
const FIELD = '#191527';
// ⚠ A CONTROL FLOATING OVER VIDEO IS SOLID TOO. These two sat on the replay player as
// rgba(10,10,20,0.78) under a brighter C.border hairline. The probe never saw them
// because the replay player is a state no sweep had opened — the guard caught them.
// Same value as S.chipOnVideo in previewStates, whose comment records the rule.
const CHIP_ON_VIDEO = '#100C1C';

// ⚠ A rule that stops at full strength reads as a cage edge, so this fades at both ends.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };

const C = {
  // ⚠ THE LADDER, NOT THE STROKE. See PreviewBroadcasterScreen for the measurement.
  // `fieldEdge` is the ONE border left: a text input's edge IS its affordance.
  bg: '#09090f', card: '#1A1A2A', cardSoft: '#14141F',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)', fieldEdge: '#2E2E42',
  // ⚠ RAISED TO CLEAR 4.5:1 ON THIS SCREEN'S OWN CARDS. Measured on the deployed page:
  // #a0a0b8 came out at 4.05:1 and #6b7280 at 3.78:1 against the #14141F stat cards, so
  // six body strings on the ended screen sat under the floor — "You watched", "Peak
  // Viewers", "UP NEXT", "Live now · same game" and both replay lines.
  text: '#e8e8f0', textDim: '#b7b7cb', textMuted: '#9298ab',
  purple: '#7B1FFF', purpleLight: '#B44FFF', red: '#ef4444', green: '#22c55e',
};

// copied verbatim from GoLiveSetupScreen.jsx:1596
const inputField = {
  width: '100%', boxSizing: 'border-box',
  background: FIELD, border: `1px solid ${C.fieldEdge}`,
  borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none',
};

// copied verbatim from GoLiveSetupScreen.jsx:1588
const btnPrimary = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 18px',
  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
  border: 'none', borderRadius: 8,
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 0 16px rgba(123,31,255,0.4)',
};

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6 }}>{children}</div>;
}

// GoLiveSetupScreen.jsx:1476
function IngestCard({ active, icon, title, desc, note }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, padding: 14, borderRadius: 12, cursor: 'pointer',
      background: active ? '#251A46' : C.cardSoft, border: 'none',
      boxShadow: active ? 'inset 3px 0 0 #b44fff' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name={icon} size={18} style={{ color: active ? C.purpleLight : C.textDim }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{desc}</div>
      {note && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

/**
 * Go Live setup.
 *
 * `gated` previews the follower-gate state. ⚠ THAT STATE IS REACHABLE IN
 * PRODUCTION ONLY WHILE app_config/general.streamFollowerGateEnabled IS ON, and
 * it is currently OFF — so it cannot be screenshotted from a real account at
 * all right now. Being able to capture it anyway is a large part of why this
 * surface belongs in the simulator.
 */
// ── OBS / RTMP connect panel ────────────────────────────────────────────────
//
// ⚠⚠ THE SHIPPED GO LIVE SCREEN NEVER SHOWS THE STREAM KEY. `createStreamSession`
// returns `{ ingestUrl, streamKey }` (functions/streaming.js:575) and
// GoLiveSetupScreen renders neither: the entire OBS branch is one line of bitrate
// advice at ~line 1190. A host who picks OBS is told what bitrate to use and is
// never told where to send it, so the source they chose cannot be connected at
// all. This panel is what that branch should have been.
//
// ⚠ THE KEY IS A CREDENTIAL. It is masked by default, revealed deliberately, and
// carries its own warning — anyone holding it can broadcast as this person
// ([[reference-stream-key-is-a-credential]]).
//
// ⚠ THE BITRATE IS THE PLAN'S, NOT A SUGGESTION. `infra/rtmp-auth` reads the
// plan on nginx-rtmp's on_publish and a 5s watchdog DISCONNECTS anything over
// the cap for 15 seconds (Free 4 / Lite 6 / Pro 9 Mbps). Printing a number the
// server will hang up on is worse than printing nothing, so the copy says what
// happens rather than advising.

const OBS_PLANS = {
  free: { label: 'Free', kbps: 4000, res: '480p30' },
  lite: { label: 'Lite', kbps: 6000, res: '720p60' },
  pro: { label: 'Pro', kbps: 9000, res: '1080p60' },
};

// waiting  — key minted, OBS has not connected
// live     — receiving, healthy
// unstable — receiving, over cap or dropping frames
const OBS_STATES = {
  waiting: { label: 'Waiting for OBS', tone: '#9298ab', dot: '#6b7280' },
  live: { label: 'Receiving', tone: '#22c55e', dot: '#22c55e' },
  unstable: { label: 'Unstable', tone: '#f59e0b', dot: '#f59e0b' },
};

function ObsRow({ label, value, mono = true, secret = false, revealed, onReveal, onCopy, copied }) {
  const shown = secret && !revealed ? '•'.repeat(28) : value;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', color: C.textMuted, textTransform: 'uppercase' }}>{label}</span>
        {secret && (
          <button type="button" onClick={onReveal} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, background: 'transparent',
            border: 'none', cursor: 'pointer', color: C.purpleLight, fontSize: 11, fontWeight: 800,
          }}>
            <Icon name={revealed ? 'visibility_off' : 'visibility'} size={13} />
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        )}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'linear-gradient(180deg, #150f2e 0%, #0f0d21 100%)',
        border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: '11px 12px',
      }}>
        <span className={mono ? 'vg-mono' : ''} style={{
          flex: 1, minWidth: 0, fontSize: 13, color: C.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          letterSpacing: secret && !revealed ? '0.06em' : 0,
        }}>{shown}</span>
        <button type="button" onClick={onCopy} aria-label={`Copy ${label}`} style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8, cursor: 'pointer', border: 'none',
          background: copied ? '#1f4d2e' : '#23233A', color: copied ? '#7ee2a8' : C.text,
          fontSize: 12, fontWeight: 800,
        }}>
          <Icon name={copied ? 'check' : 'content_copy'} size={13} />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ObsConnectPanel({ plan = 'free', state = 'waiting', kbps = null, dropped = 0, twitchLinked = false, mirror = false }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(null);
  const p = OBS_PLANS[plan] || OBS_PLANS.free;
  const s = OBS_STATES[state] || OBS_STATES.waiting;
  const live = state !== 'waiting';
  // The real values come back from createStreamSession; these are the shapes it
  // returns, so a capture of this screen matches what a host actually sees.
  const server = 'rtmp://rtmp.vergr.app/live';
  // ⚠ New key ACTUALLY MINTS ONE. A regenerate button that does nothing is the
  // defect the guard exists for, and it is worse here than elsewhere: a host
  // presses it because they believe the old key is compromised.
  const [key, setKey] = useState('vgr_7f3c91ab24e05d68fa1c4b7e92a5d0');
  const newKey = () => {
    const hex = Array.from({ length: 26 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    setKey('vgr_' + hex);
    setRevealed(false);
    setCopied(null);
  };
  const copy = (what, text) => {
    try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked */ }
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 1400);
  };

  return (
    <div style={{
      background: 'linear-gradient(180deg, #17132f 0%, #131228 55%, #0e0d22 100%)',
      border: '1px solid #2e2a46', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.055)',
      borderRadius: 16, padding: 14, marginTop: 12,
    }}>
      {/* status first: the question a host has open OBS to answer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
        <span style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: s.dot }} />
          {live && <span style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: `1px solid ${s.dot}`, opacity: 0.45 }} />}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: s.tone }}>{s.label}</span>
        {live && kbps != null && (
          <span className="vg-mono" style={{ fontSize: 12, color: C.textDim }}>
            {kbps.toLocaleString()} kbps
          </span>
        )}
        {live && dropped > 0 && (
          <span className="vg-mono" style={{ fontSize: 12, color: '#f59e0b' }}>{dropped} dropped</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textMuted }}>
          {p.label.toUpperCase()} · {p.res}
        </span>
      </div>

      <ObsRow label="Server" value={server}
        onCopy={() => copy('server', server)} copied={copied === 'server'} />
      <ObsRow label="Stream key" value={key} secret revealed={revealed}
        onReveal={() => setRevealed((v) => !v)}
        onCopy={() => copy('key', key)} copied={copied === 'key'} />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={() => copy('both', `${server}\n${key}`)} style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 12, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #a84dff 0%, #9a43f8 38%, #7427f4 100%)',
          boxShadow: '0 8px 20px rgba(124,58,237,0.42), inset 0 1px 0 rgba(255,255,255,0.3)',
          color: '#fff', fontSize: 13, fontWeight: 800,
        }}>
          <Icon name={copied === 'both' ? 'check' : 'content_copy'} size={15} />
          {copied === 'both' ? 'Copied both' : 'Copy both'}
        </button>
        <button type="button" onClick={newKey} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
          background: 'linear-gradient(180deg, #1c1c3c 0%, #141530 100%)',
          border: '1px solid #423a5f', color: C.text, fontSize: 13, fontWeight: 800,
        }}>
          <Icon name="autorenew" size={15} />New key
        </button>
      </div>

      {/* ⚠ WHAT THE SERVER DOES, NOT ADVICE. The watchdog hangs up; say so. */}
      <div style={{
        display: 'flex', gap: 12, marginTop: 12, padding: 12, borderRadius: 12,
        background: 'linear-gradient(180deg, #100e26 0%, #0c0b1f 100%)', border: '1px solid #2e2a46',
      }}>
        <Icon name="tune" size={17} style={{ color: C.purpleLight, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
          In OBS set the video bitrate to <strong className="vg-mono" style={{ color: '#fff' }}>{p.kbps.toLocaleString()} kbps</strong> or
          under, and the keyframe interval to <strong style={{ color: '#fff' }}>2s</strong>.
          Go over the cap for 15 seconds and the server drops the connection.
        </div>
      </div>

      {/* Twitch is only offered on the OBS source, because the relay-out happens
          on the RTMP path. Saying so where the choice is made stops the founder's
          own question: why is "stream to both" greyed out on browser. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, padding: '11px 12px',
        borderRadius: 12, background: 'linear-gradient(180deg, #17132f 0%, #0e0d22 100%)',
        border: '1px solid #2e2a46',
      }}>
        <Icon name="cast_connected" size={17} style={{ color: twitchLinked ? '#B44FFF' : C.textMuted, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Stream to Twitch as well</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
            {twitchLinked ? 'One OBS feed, both platforms. Chat is bridged both ways.' : 'Connect Twitch in Settings to switch this on.'}
          </div>
        </div>
        {/* a switch is a track with a knob, never a pill */}
        <span aria-hidden style={{
          flexShrink: 0, width: 40, height: 23, borderRadius: 999, padding: 2,
          background: mirror && twitchLinked ? 'linear-gradient(180deg, #9a4cf5, #7526f5)' : '#2A2A38',
          display: 'flex', justifyContent: mirror && twitchLinked ? 'flex-end' : 'flex-start',
        }}>
          <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff' }} />
        </span>
      </div>
    </div>
  );
}

export function PreviewGoLive({ doc, gated = false, advancedOpen = false, ingest = 'browser', obsState = 'waiting', plan = 'free', twitchLinked = true, mirror = false, onGoLive }) {
  const [advanced, setAdvanced] = useState(advancedOpen);
  const followersToGo = 100 - 42;

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.bg, color: C.text, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ padding: 20 }}>

        {/* camera preview + live controls */}
        <div style={{
          position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 16,
          overflow: 'hidden', marginBottom: 16,
          background: 'radial-gradient(120% 80% at 50% 0%, #241a3a 0%, #0c0c16 70%)',
          display: 'grid', placeItems: 'center',
        }}>
          <div style={{ textAlign: 'center', color: '#3a3a55' }}>
            <Icon name="videocam" size={38} />
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', marginTop: 6 }}>CAMERA PREVIEW</div>
          </div>
          <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 8 }}>
            {['mic', 'videocam'].map((ic) => (
              <span key={ic} style={{ width: 32, height: 32, borderRadius: '50%', background: '#100C1C', display: 'grid', placeItems: 'center', color: '#fff' }}>
                <Icon name={ic} size={16} />
              </span>
            ))}
          </div>
          {/* mic meter */}
          <div style={{ position: 'absolute', right: 12, bottom: 18, width: 90, height: 4, borderRadius: 999, background: '#2A2A38', overflow: 'hidden' }}>
            <div style={{ width: '62%', height: '100%', background: C.green }} />
          </div>
        </div>

        {/* title — the fast path */}
        <div style={{ marginBottom: 14 }}>
          <FieldLabel>Title</FieldLabel>
          <input readOnly value={doc?.title || ''} placeholder="Give your stream a title…" style={inputField} />
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, textAlign: 'right' }}>
            {(doc?.title || '').length}/140
          </div>
        </div>

        {/* advanced accordion — GoLiveSetupScreen.jsx ~860 */}
        <button type="button" onClick={() => setAdvanced((v) => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '10px 12px', marginBottom: advanced ? 16 : 8,
          background: C.card, borderRadius: 12,
          color: C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>
          <Icon name="tune" size={16} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            Advanced options (description, tags, cover, audience, quality, tips, source)
          </span>
          <Icon name="expand_more" size={18} style={{ transform: advanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>

        {advanced && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.textDim, letterSpacing: '0.08em', margin: '14px 0 10px' }}>
              6 · BROADCAST FROM
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <IngestCard active={ingest === 'browser'} icon="language" title="This browser"
                desc="Share your screen or camera straight from here." note="Nothing to install" />
              <IngestCard active={ingest === 'rtmp'} icon="desktop_windows" title="OBS / RTMP"
                desc="Keep your scenes, overlays and alerts." note="Standard RTMP" />
            </div>

            {/* ⚠ THE PANEL APPEARS WHERE THE SOURCE IS CHOSEN. Picking OBS and then
                having to hunt for the key is the shipped behaviour, except the shipped
                one never shows the key at all. */}
            {ingest === 'rtmp' && (
              <ObsConnectPanel plan={plan} state={obsState}
                kbps={obsState === 'unstable' ? 9800 : 5600}
                dropped={obsState === 'unstable' ? 42 : 0}
                twitchLinked={twitchLinked} mirror={mirror} />
            )}

            <div style={{ fontSize: 11, fontWeight: 800, color: C.textDim, letterSpacing: '0.08em', margin: '18px 0 10px' }}>
              5 · TIPS &amp; GOAL
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Goal amount</FieldLabel>
                <input readOnly value={doc?.goal?.targetCoins || 0} style={inputField} />
              </div>
              <div style={{ flex: 2 }}>
                <FieldLabel>What for?</FieldLabel>
                <input readOnly value={doc?.goal?.reason || ''} placeholder="e.g. New mic fund" style={inputField} />
              </div>
            </div>
          </div>
        )}

        {/* CTA — GoLiveSetupScreen.jsx:617-631, including the gated state */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={gated ? undefined : onGoLive} style={{ ...btnPrimary, padding: '11px 22px', fontSize: 13, opacity: gated ? 0.5 : 1, cursor: gated ? 'not-allowed' : 'pointer' }}>
            {gated ? <Icon name="lock" size={15} /> : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="white" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="3" fill="white" />
              </svg>
            )}
            {gated ? `${followersToGo} followers to go live` : 'Go Live'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stream ending. Copied from StreamEndingScreen.jsx, which is 46 lines of
 * Tailwind; the classes are reproduced as inline styles here so the card renders
 * identically inside the preview frame regardless of the admin shell's own
 * cascade.
 */
// ⚠⚠ THE VIEWER USED TO SEE THE BROADCASTER'S SUMMARY. Both roles rendered this
// screen byte-identically, so someone who had merely WATCHED a stream was shown
// "Great stream! Here is your summary." with the host's NEW FOLLOWERS and TIPS
// EARNED on it. Those are the streamer's private numbers.
/**
 * ⚠ THE VIEWER'S ENDED SCREEN HAD NO REPLAY, ON A PRODUCT THAT SELLS THEM.
 * Pro's headline perk is 90-day replays and this is the only screen a viewer
 * ever reaches one from. The preview offered a single button, “Back to live
 * streams”, so the screen that has to turn a finished stream into a follow or
 * a rewatch could not be designed or captured at all.
 *
 * ⚠ THE REAL SCREEN HAS FOUR COPY STATES, NOT ONE (MobileLiveViewer.jsx:657):
 * replay ready / still processing / expired / never existed. Those are four
 * different promises, and “check back in a few minutes” must not be collapsed
 * into “no longer available” — one is worth waiting for and one is not.
 */
export function PreviewStreamEnded({ stats = {}, role = 'broadcaster', host = null, onDone, vod = 'available', onShare, onSchedule }) {
  const viewer = role === 'viewer';
  const [replayOpen, setReplayOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const cells = viewer ? [
    { label: 'You watched', value: stats.watched || '52m', icon: 'schedule' },
    { label: 'Peak Viewers', value: stats.peakViewers || '1,402', icon: 'visibility' },
  ] : [
    { label: 'Duration', value: stats.duration || '1h 24m', icon: 'schedule' },
    { label: 'Peak Viewers', value: stats.peakViewers || '1,402', icon: 'visibility' },
    { label: 'New Followers', value: stats.newFollowers || '38', icon: 'person_add' },
    // ⚠ THE MATERIAL `paid` GLYPH AND A LITERAL "●" WERE STANDING IN FOR THE
    // BRAND COIN. Rule 6 of the guard exists to stop exactly this and could not
    // see it, because the icon was passed as DATA (`icon: 'paid'`) rather than
    // as a literal `name="paid"` prop. Both are fixed: the coin is <CoinIcon>.
    { label: 'Tips Earned', value: String(stats.tips ?? 2450), coin: true, icon: 'savings' },
  ];
  // The replay player. Mirrors MobileLiveViewer.jsx:641 — full-bleed video
  // with one pill back to the summary and nothing else over it.
  if (viewer && replayOpen) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 50% 40%, #1a1030 0%, #06060d 70%)' }}>
          <div style={{ textAlign: 'center' }}>
            <Icon name="play_circle" size={54} style={{ color: C.purpleLight }} />
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 10 }}>Replay · 1h 24m</div>
          </div>
        </div>
        {/* A scrubber, because a replay with no seek bar does not read as a
            player and a store screenshot of one proves nothing. */}
        <div style={{ padding: '10px 14px 16px', background: '#0A0A12' }}>
          <div style={{ height: 3, borderRadius: 2, background: '#2A2A38', overflow: 'hidden' }}>
            <div style={{ width: '34%', height: '100%', background: C.purpleLight }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textMuted, marginTop: 6 }}>
            <span className="vg-mono">28:41</span><span className="vg-mono">1:24:06</span>
          </div>
        </div>
        {/* ⚠ A REPLAY NOBODY CAN SHARE IS A DEAD END. It is the only artefact a
            finished stream leaves behind, and sharing it is the one thing that
            brings someone who was not there. */}
        <button onClick={onShare} aria-label="Share this replay" style={{
          position: 'absolute', top: 14, right: 12, padding: '8px 14px', borderRadius: 999,
          background: CHIP_ON_VIDEO, border: 'none', color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}><Icon name="ios_share" size={15} /> Share</button>
        <button onClick={() => setReplayOpen(false)} style={{
          position: 'absolute', top: 14, left: 12, padding: '8px 14px', borderRadius: 999,
          background: CHIP_ON_VIDEO, border: 'none', color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}><Icon name="arrow_back" size={15} /> Back</button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, overflowY: 'auto', background: '#0B0B14',
      color: '#fff', fontFamily: 'DM Sans, system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 24px 32px',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%', marginBottom: 24,
        background: '#251A46', display: 'grid', placeItems: 'center',
      }}>
        <Icon name="live_tv" size={40} style={{ color: C.purpleLight }} />
      </div>
      <h1 className="vg-syne" style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
        {viewer ? 'Stream Ended' : 'Stream Ended'}
      </h1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 24px', textAlign: 'center' }}>
        {!viewer ? 'Great stream! Here is your summary.'
          : vod === 'available' ? 'Catch the replay, or follow for the next one.'
            : vod === 'pending' ? 'The replay is still processing. Check back in a few minutes.'
              : vod === 'expired' ? 'The replay for this stream is no longer available.'
                : `Follow to get notified when ${host?.displayName || 'they'} goes live again.`}
      </p>

      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 32 }}>
        {cells.map((s) => (
          <div key={s.label} style={{
            padding: 16, borderRadius: 16, textAlign: 'center',
            background: '#14141F', border: 'none',
          }}>
            <Icon name={s.icon} size={20} style={{ color: C.textMuted }} />
            <p className="vg-mono" style={{ fontWeight: 700, fontSize: 16, margin: '4px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {s.coin && <CoinIcon size={15} />}{s.value}
            </p>
            <p style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ⚠ THREE ACTIONS, NOT ONE, AND THE ORDER IS THE POINT. The replay is
          the thing that keeps someone on the page, so it leads when there is
          one; Follow becomes the primary when there is not. Follow is viewer
          only — a host cannot follow themselves. */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {viewer && vod === 'available' && (
          <button onClick={() => setReplayOpen(true)} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, ' + C.purple + ', ' + C.purpleLight + ')', color: '#fff',
            fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><Icon name="play_circle" size={17} /> Watch replay</button>
        )}
        {viewer && (
          <button onClick={() => setFollowed((v) => !v)} style={{
            width: '100%', padding: 16, borderRadius: 16, cursor: 'pointer', fontWeight: 700, fontSize: 14,
            // ⚠ SECONDARY IS A REAL SURFACE, NOT A RING OVER NOTHING. When the replay
            // is the primary action this drops to secondary — which means a solid step
            // down in value, not a transparent box held together by a hairline.
            background: followed || vod === 'available' ? FIELD : '#7B1FFF',
            border: 'none',
            color: followed ? C.textDim : '#fff',
          }}>{followed ? 'Following' : 'Follow'}</button>
        )}
        {/* ⚠ FOLLOW *IS* THE NOTIFY MECHANISM, so the button says so rather than
            growing a second bell beside it. `onStreamWentLive` (index.js:2920)
            pushes “X is live” to a host's followers and there is NO per-creator
            notification setting on the server — a bell would be a control implying
            a preference that does not exist. */}
        {viewer && (
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: -2 }}>
            {followed ? `You will get a notification when ${host?.displayName || 'they'} go live.` : 'Following means a notification the moment they go live.'}
          </div>
        )}
        {viewer && vod === 'available' && (
          <button onClick={onShare} style={{
            width: '100%', padding: 16, borderRadius: 16, cursor: 'pointer', fontWeight: 700, fontSize: 14,
            background: FIELD, border: 'none', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><Icon name="ios_share" size={16} /> Share the replay</button>
        )}
        {/* ⚠ SCHEDULING IS REAL, NOT A MOCK. GoLiveSetupScreen.scheduleStream writes
            `scheduledStart`, so the host's next stream can genuinely be booked from
            here — the moment they are most likely to commit to one. */}
        {!viewer && (
          <button onClick={onSchedule} style={{
            width: '100%', padding: 16, borderRadius: 16, cursor: 'pointer', fontWeight: 700, fontSize: 14,
            background: FIELD, border: 'none', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><Icon name="event" size={16} /> Schedule your next stream</button>
        )}
        {/* ⚠ THE END OF A STREAM IS WHERE AN AUDIENCE IS LOST. "Browse live" sends
            someone to a list and hopes; naming one live stream they are likely to
            want is the difference between a session ending and continuing.

            ⚠ NOT A RAID. A raid moves the HOST's audience on the host's command and
            is a new mechanic with its own economy and abuse surface — it is an open
            founder decision (LIVE_STREAM_READINESS Part 7 #2) and is deliberately
            NOT built here. This is the viewer choosing, on their own screen. */}
        {viewer && (
          <div style={{ width: '100%', marginTop: 4, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, marginBottom: 8, textAlign: 'left' }}>UP NEXT</div>
            <button onClick={onDone} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px',
              borderRadius: 16, border: 'none', background: '#14141F',
              cursor: 'pointer', textAlign: 'left', color: '#fff',
            }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,#2a1b4d,#12121e)', display: 'grid', placeItems: 'center' }}>
                <Icon name="sensors" size={19} style={{ color: C.purpleLight }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>nova_kill</span>
                <span style={{ display: 'block', fontSize: 11, color: C.textMuted }}>Live now · same game</span>
              </span>
              <Icon name="chevron_right" size={17} style={{ color: C.textMuted }} />
            </button>
          </div>
        )}
        <button onClick={onDone} style={{
          width: '100%', padding: 16, borderRadius: 16, cursor: 'pointer', fontWeight: 700, fontSize: 14,
          background: viewer ? FIELD : '#7B1FFF',
          border: 'none', color: '#fff',
        }}>{viewer ? 'Browse live' : 'Back Home'}</button>
      </div>
    </div>
  );
}

/**
 * Go Live setup, NATIVE.
 *
 * ⚠ NOT THE SAME SCREEN AS THE WEB ONE, which is why it gets its own copy
 * rather than a `mobile` flag on PreviewGoLive. NativeGoLiveScreen.jsx has a
 * sticky app-bar with a back arrow and a Later button, a sectioned form rather
 * than an Advanced accordion, and a fixed bottom CTA bar carrying the
 * follower-gate banner with a progress meter. Rendering the web layout in a
 * phone frame and calling it the native screen would be exactly the kind of
 * plausible-but-wrong capture this tool exists to prevent.
 *
 * Source: NativeGoLiveScreen.jsx — header ~344, body ~360, bottom bar ~596,
 * palette :26, input :694.
 */
export function PreviewNativeGoLive({ doc, gated = false, onGoLive }) {
  const followerCount = 42;
  const GATE = 100;
  const nInput = {
    width: '100%', boxSizing: 'border-box', background: FIELD,
    border: `1px solid ${C.fieldEdge}`, borderRadius: 12, padding: '13px 15px',
    color: C.text, fontSize: 16, outline: 'none',
  };
  const Section = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 800, color: C.textDim, letterSpacing: '0.06em', margin: '4px 0 2px' }}>{children}</div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.bg, color: C.text, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* sticky app bar — NativeGoLiveScreen.jsx:344 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', background: '#0E0E18',
        ...ruleBottom,
      }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: FIELD, display: 'grid', placeItems: 'center', color: C.text }}>
          <Icon name="arrow_back_ios_new" size={16} />
        </span>
        <div className="vg-syne" style={{ flex: 1, fontWeight: 800, fontSize: 20 }}>Go Live</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 999, background: FIELD, color: C.textDim, fontSize: 12, fontWeight: 700 }}>
          <Icon name="schedule" size={16} /> Later
        </span>
      </div>

      <div style={{ padding: '14px 14px 150px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          position: 'relative', aspectRatio: '16/9', width: '100%', borderRadius: 16,
          overflow: 'hidden',
          background: 'radial-gradient(circle at 50% 60%, #1a1030 0%, #0a0a14 70%)',
          display: 'grid', placeItems: 'center',
        }}>
          <div style={{ textAlign: 'center', color: C.textMuted }}>
            <Icon name="videocam" size={40} />
            <div style={{ fontSize: 12, marginTop: 6 }}>Tap to start preview</div>
          </div>
        </div>

        <Section>Basic info</Section>
        <input readOnly value={doc?.title || ''} placeholder="Give your stream a title…" style={nInput} />
        <textarea readOnly placeholder="What's this stream about?" style={{ ...nInput, height: 72, resize: 'none', fontFamily: 'inherit' }} />

        <Section>Tips &amp; goal</Section>
        <div style={{ display: 'flex', gap: 12 }}>
          <input readOnly value={doc?.goal?.targetCoins || 0} style={{ ...nInput, flex: 1 }} />
          <input readOnly value={doc?.goal?.reason || ''} placeholder="New mic fund" style={{ ...nInput, flex: 2 }} />
        </div>
      </div>

      {/* fixed CTA bar — NativeGoLiveScreen.jsx:596 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 14px',
        background: 'linear-gradient(to top, rgba(9,9,15,1) 65%, rgba(9,9,15,0))', zIndex: 40,
      }}>
        {gated && (
          <div style={{ marginBottom: 10, padding: '11px 13px', borderRadius: 12, background: '#2A1D06', border: 'none' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="lock" size={19} style={{ color: '#f59e0b' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Public live unlocks at {GATE} followers</div>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 5, lineHeight: 1.5 }}>
              You have <b style={{ color: '#fff' }}>{followerCount}</b>, {GATE - followerCount} to go. Squad streams to your crew are free anytime.
            </div>
            <div style={{ marginTop: 8, height: 5, borderRadius: 999, background: '#4A3A12', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(followerCount / GATE) * 100}%`, background: '#f59e0b' }} />
            </div>
          </div>
        )}
        {/* ⚠ DEAD ON BOTH DEVICES. The phase never advanced, so the moment a
            broadcast begins could not be captured — and that is one of the two
            screens this whole tool exists to reach without going live. */}
        <button type="button" onClick={gated ? undefined : onGoLive} style={{
          width: '100%', padding: 15, borderRadius: 16, border: 'none',
          background: gated ? '#2A2A38' : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
          color: gated ? C.textDim : '#fff', fontSize: 16, fontWeight: 800,
          cursor: gated ? 'not-allowed' : 'pointer',
        }}>{gated ? 'Locked' : 'Go Live'}</button>
      </div>
    </div>
  );
}
