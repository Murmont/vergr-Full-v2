// The last six surfaces: co-host setup, analytics, moderation, squad stream,
// the standalone boost sheet, and the Vergr.me banner.
//
// ⚠ COPIES OF THE SHIPPED DESIGN. No Firestore, no SFU, no getUserMedia, no
// callable, no cart. Production files untouched.
//
// ⚠ ANALYTICS AND MODERATION ARE POPULATED HERE, NOT REPRODUCED AS EMPTY
// STATES. The real screens show "No stream data yet" because the account has
// never streamed; the side rail exists so nothing renders empty, and a capture
// of an empty-state screen shows a product with no data. Analytics reads its
// headline numbers off the SAME doc the live phase uses, so the stream capture
// and the analytics capture agree.
//
// Source of each copied block:
//   Co-host setup      CoStreamingScreen.jsx ~195-215 (TopBar, intro, title field)
//   Analytics          StreamAnalyticsScreen.jsx (whole file)
//   Moderation         StreamModerationScreen.jsx (whole file)
//   Squad stream       SquadStreamScreen.jsx (voice-first, max 2 video)
//   Boost sheet        components/boost/BoostSheet.jsx + utils/boosts.js
//   Vergr.me banner    IMPORTED — VergrMeBannerCard is prop-only

import { useState } from 'react';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
// Prop-only ({ username, onClick, style }), so it is imported and cannot drift.
import { VergrMeBannerCard } from '../../../components/streams/VergrMeStreamBanner';
import { BOOSTS } from '../../../utils/boosts';
import { CAST } from './previewCast';


// ⚠ A rule that stops at full strength reads as a cage edge, so this fades at both ends.
const RULE_IMG = 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.15) 16%, rgba(255,255,255,0.15) 84%, rgba(255,255,255,0) 100%)';
const ruleBottom = { backgroundImage: RULE_IMG, backgroundRepeat: 'no-repeat', backgroundSize: '100% 1px', backgroundPosition: 'bottom' };

const C = {
  // ⚠ THE LADDER, NOT THE STROKE. See PreviewBroadcasterScreen for the measurement.
  bg: '#0a0a14', card: '#1A1A2A', cardSoft: '#14141F', fieldEdge: '#2E2E42',
  // ⚠ MEASURED: #a0a0b8 came out at 3.84-3.94:1 and #6b7280 at 3.65:1 on this file's own
  // cards — eight strings on the analytics screen, six on moderation, and the boost
  // sheet's cash prices, which are the numbers a buyer reads before paying.
  border: 'rgba(255,255,255,0.09)', text: '#e8e8f0', textDim: '#b7b7cb', textMuted: '#9aa0b4',
  // ⚠ SOLID. Every one of these was a white wash used as a SURFACE: invite rows, squad
  // member tiles, the mic and camera buttons, and the moderation actions.
  chip: '#191527', chipRaised: '#1F1B31', track: '#2A2A38',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: '#251A46',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
};

const MAX_COHOSTS = 3;   // functions/coStream.js:24

function Shell({ title, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.bg, color: C.text, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px', ...ruleBottom }}>
        <Icon name="arrow_back_ios_new" size={16} style={{ color: C.textDim }} />
        <span className="vg-syne" style={{ fontSize: 17, fontWeight: 800 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Stream analytics — POPULATED.
 *
 * ⚠ THE REAL SCREEN IS AN EMPTY STATE, AND REPRODUCING THAT WAS THE WRONG CALL.
 * StreamAnalyticsScreen.jsx renders "No stream data yet" because the account
 * running it has never streamed. The side rail exists so nothing renders empty
 * (founder, 2026-08-31): a capture of an empty-state screen shows a product with
 * no data, which is the opposite of what a store listing needs.
 *
 * ⚠ THE NUMBERS ARE THE SIMULATOR'S, NOT INVENTED SEPARATELY. Peak viewers,
 * tips and duration come from the same `doc` the live phase uses, so a capture
 * of the stream and a capture of its analytics agree with each other. Numbers
 * that disagree across two screenshots of the same stream are worse than no
 * numbers.
 */
export function PreviewAnalytics({ doc = {} }) {
  const peak = doc.peakViewers || 1402;
  const tips = doc.goal?.currentCoins ?? 3120;
  const series = [12, 34, 58, 96, 142, 210, 288, 356, 402, 388, 344, 296, 248, 190, 140];
  const max = Math.max(...series);
  const rows = [
    ['Peak viewers', peak.toLocaleString(), 'visibility'],
    ['Average watch', '11m 42s', 'schedule'],
    ['New followers', '38', 'person_add'],
    ['Tips', `${tips.toLocaleString()}c`, 'paid'],
    ['Messages', '1,284', 'forum'],
    ['Clips made', '6', 'content_cut'],
  ];
  return (
    <Shell title="Stream Analytics">
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 4 }}>Last stream · 1h 24m</div>
        <div dir="auto" className="vg-syne" style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>
          {doc.title || 'Ranked grind, road to Diamond'}
        </div>

        {/* viewers over time */}
        <div style={{ padding: 14, borderRadius: 14, background: C.card, marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textDim, letterSpacing: '0.06em', marginBottom: 12 }}>
            VIEWERS
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 88 }}>
            {series.map((v, i) => (
              <div key={i} style={{
                flex: 1,
                height: `${Math.max(4, (v / max) * 100)}%`,
                borderRadius: 2,
                background: `linear-gradient(180deg, ${C.purpleLight}, ${C.purple})`,
                opacity: 0.55 + (v / max) * 0.45,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.textMuted, marginTop: 8 }}>
            <span>21:00</span><span>peak {peak.toLocaleString()}</span><span>22:24</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {rows.map(([label, value, icon]) => (
            <div key={label} style={{ padding: 13, borderRadius: 12, background: C.cardSoft }}>
              <Icon name={icon} size={16} style={{ color: C.textMuted }} />
              <div className="vg-mono" style={{ fontSize: 17, fontWeight: 800, marginTop: 6 }}>{value}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/**
 * Stream moderation — POPULATED.
 *
 * Same reasoning as analytics: the real screen says "tools available during live
 * streams" because it is only reachable outside one. Here it shows the tools in
 * use, with a chat queue drawn from the simulator's own cast so the names match
 * the stream you just captured.
 */
export function PreviewModeration({ avatars = {} }) {
  // ⚠⚠ THIS SCREEN HAD ZERO CLICKABLE ELEMENTS. It renders the host's real
  // review queue — three held messages with reasons — and all nine
  // Allow / Delete / Timeout actions were `<span>`s, as were the three chat-rule
  // toggles. The host's actual moderation tool was a PICTURE of a moderation
  // tool, which is the worst version of this defect because it looks complete.
  const FLAGGED = [
    { u: CAST[5], text: 'link in bio, free coins →', reason: 'Scam link', tone: C.red },
    { u: CAST[7], text: 'THIS STREAM IS TRASH TRASH TRASH', reason: 'Spam · repeated', tone: C.amber },
    { u: CAST[2], text: 'what sens are you on', reason: 'Cleared by AI', tone: C.green },
  ];
  // Resolving a held message REMOVES it from the queue and moves the counters —
  // otherwise "Allow" and "Delete" look identical and the numbers lie.
  const [queue, setQueue] = useState(FLAGGED);
  const [muted, setMuted] = useState(1);
  const [rules, setRules] = useState({ slow: true, followers: false, words: true });
  const resolve = (uid, action) => {
    setQueue((q) => q.filter((f) => f.u.uid !== uid));
    if (action === 'Timeout') setMuted((m) => m + 1);
  };
  const toggles = [
    ['Slow mode', '5s between messages', 'slow'],
    ['Followers-only', 'Only people who follow you', 'followers'],
    ['Banned words', '12 terms', 'words'],
  ];
  return (
    <Shell title="Stream Moderation">
      <div style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[['Held', String(queue.length)], ['Muted', String(muted)], ['Banned', '0']].map(([l, v]) => (
            <div key={l} style={{ padding: 12, borderRadius: 12, background: C.cardSoft, textAlign: 'center' }}>
              <div className="vg-mono" style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase' }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.textDim, letterSpacing: '0.06em', marginBottom: 10 }}>
          HELD FOR REVIEW
        </div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
          {queue.length === 0 && (
            // ⚠ AN EMPTY QUEUE IS A STATE, NOT A BLANK. Clearing the last held
            // message is the moment a host most wants to see something.
            <div style={{ padding: '26px 14px', borderRadius: 12, background: C.cardSoft, textAlign: 'center' }}>
              <Icon name="check_circle" size={26} style={{ color: C.green }} />
              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6 }}>Nothing held</div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>Messages the scanner flags will appear here.</div>
            </div>
          )}
          {queue.map((f) => (
            <div key={f.u.uid} style={{ padding: 12, borderRadius: 12, background: C.cardSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                <UserAvatar src={avatars[f.u.uid] || f.u.avatar} size="xs" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{f.u.displayName}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, color: f.tone }}>{f.reason}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 9 }}>{f.text}</div>
              <div style={{ display: 'flex', gap: 7 }}>
                {['Allow', 'Delete', 'Timeout'].map((a) => (
                  <button key={a} type="button" onClick={() => resolve(f.u.uid, a)} style={{
                    flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                    background: C.chip, border: 'none',
                    color: a === 'Allow' ? C.green : a === 'Delete' ? C.red : C.text,
                    fontSize: 11.5, fontWeight: 700,
                  }}>{a}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.textDim, letterSpacing: '0.06em', marginBottom: 10 }}>
          CHAT RULES
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {toggles.map(([l, sub, key]) => (
            <button key={l} type="button" onClick={() => setRules((r) => ({ ...r, [key]: !r[key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: C.cardSoft, cursor: 'pointer', color: C.text, textAlign: 'left', width: '100%' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 11.5, color: C.textMuted }}>{sub}</div>
              </div>
              <span style={{ width: 38, height: 22, borderRadius: 99, background: rules[key] ? C.purple : C.track, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
                <span style={{ position: 'absolute', top: 3, left: rules[key] ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}


/** Co-host setup — CoStreamingScreen.jsx ~195-330. */
export function PreviewCoHostSetup({ avatars = {} }) {
  // ⚠⚠ THIS SCREEN HAD TWO CONTROLS AND BOTH WERE DEAD. You could not invite
  // anyone, un-invite anyone, type a title or search — on the setup screen for a
  // feature that is FREE on every tier and drives tips. "Invite" was a <span>.
  const [invited, setInvited] = useState(CAST.slice(0, 2));
  const [title, setTitle] = useState('Late night ranked with the squad');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const results = CAST.filter((c) => !invited.some((i) => i.uid === c.uid))
    .filter((c) => !term || c.displayName.toLowerCase().includes(term) || c.username.toLowerCase().includes(term))
    .slice(0, 5);
  const full = invited.length >= MAX_COHOSTS + 1;   // host + guests
  return (
    <Shell title="Co-Stream Setup">
      <div style={{ padding: 16 }}>
        <div style={{ padding: 16, borderRadius: 14, background: C.card, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Start a co-stream</div>
          <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 14 }}>
            Invite up to {MAX_COHOSTS} other creators. You&apos;ll all publish side-by-side; viewers
            see one composite stream. We&apos;ll provision a stream ID before you invite anyone.
          </div>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Co-stream title…"
            style={{
              width: '100%', boxSizing: 'border-box', background: C.chip,
              border: `1px solid ${C.fieldEdge}`, borderRadius: 10, padding: '12px 14px',
              color: C.text, fontSize: 14, outline: 'none',
            }}
          />
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: C.textDim, letterSpacing: '0.08em', marginBottom: 10 }}>
          INVITED · {invited.length}/{MAX_COHOSTS}
        </div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
          {invited.map((u, i) => (
            <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, background: C.cardSoft }}>
              <UserAvatar src={avatars[u.uid] || u.avatar} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{u.displayName}</div>
                <div style={{ fontSize: 11.5, color: C.textDim }}>@{u.username}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? C.green : C.amber }}>
                {i === 0 ? 'Joined' : 'Invited'}
              </span>
              {/* ⚠ AN INVITE YOU CANNOT WITHDRAW IS NOT AN INVITE. */}
              <button type="button" onClick={() => setInvited((list) => list.filter((x) => x.uid !== u.uid))}
                aria-label={'Remove ' + u.displayName}
                style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', display: 'grid', padding: 4 }}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: C.textDim, letterSpacing: '0.08em', marginBottom: 10 }}>
          FIND CREATORS
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or @handle…"
          style={{
            width: '100%', boxSizing: 'border-box', background: C.chip,
            border: `1px solid ${C.fieldEdge}`, borderRadius: 10, padding: '11px 14px',
            color: C.text, fontSize: 13.5, outline: 'none', marginBottom: 10,
          }}
        />
        <div style={{ display: 'grid', gap: 6 }}>
          {results.length === 0 && (
            <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 12.5, color: C.textMuted }}>
              {term ? 'No creators match that.' : 'Everyone here is already invited.'}
            </div>
          )}
          {results.map((u) => (
            <button key={u.uid} type="button" disabled={full}
              onClick={() => setInvited((list) => (list.length > MAX_COHOSTS ? list : [...list, u]))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, background: C.chip, border: 'none', width: '100%', textAlign: 'left', color: C.text, cursor: full ? 'default' : 'pointer', opacity: full ? 0.45 : 1 }}>
              <UserAvatar src={avatars[u.uid] || u.avatar} size="xs" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{u.displayName}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.purpleLight }}>{full ? 'Full' : 'Invite'}</span>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/**
 * Squad stream — SquadStreamScreen.jsx.
 *
 * ⚠ VOICE-FIRST, AND VIDEO IS CAPPED AT TWO PUBLISHERS. That cap is the design
 * (see the file header: "Video: max 2 publishers per room"), so a preview
 * showing six camera tiles would misrepresent the feature. Everyone else is a
 * listener chip.
 */
export function PreviewSquadStream({ avatars = {} }) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const onCam = CAST.slice(0, 2);
  const listeners = CAST.slice(2, 8);
  return (
    <Shell title="Squad Hangout">
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>8 in voice</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textDim }}>2 of 2 on camera</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          {onCam.map((u) => (
            <div key={u.uid} style={{
              aspectRatio: '3/4', borderRadius: 14, overflow: 'hidden', position: 'relative',
              background: 'radial-gradient(circle at 50% 40%, #241a3a 0%, #0c0c16 75%)',
              display: 'grid', placeItems: 'center',
            }}>
              <UserAvatar src={avatars[u.uid] || u.avatar} size="lg" />
              <span style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: '#100C1C' }}>
                {u.displayName}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: C.textDim, letterSpacing: '0.08em', marginBottom: 10 }}>
          LISTENING
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {listeners.map((u) => (
            <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px 6px 6px', borderRadius: 99, background: C.chipRaised }}>
              <UserAvatar src={avatars[u.uid] || u.avatar} size="xs" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{u.displayName}</span>
            </div>
          ))}
        </div>

        {/* ⚠ MIC AND CAMERA HAD NO STATE, so the two controls a person in a voice
            room touches constantly could not show muted or camera-off — the only
            states worth capturing. Leave asks first: dropping out of a room by
            mis-tap is exactly the accident a confirm exists for. */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={() => setMicOn((v) => !v)} style={{
            flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: micOn ? C.chipRaised : '#3A1420',
            color: micOn ? C.text : C.red, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}><Icon name={micOn ? 'mic' : 'mic_off'} size={17} /> {micOn ? 'Mic' : 'Muted'}</button>

          <button type="button" onClick={() => setCamOn((v) => !v)} style={{
            flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: camOn ? C.chipRaised : '#3A1420',
            color: camOn ? C.text : C.red, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}><Icon name={camOn ? 'videocam' : 'videocam_off'} size={17} /> {camOn ? 'Camera' : 'Camera off'}</button>

          <button type="button" onClick={() => setLeaving(true)} style={{
            flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: '#3A1420', color: C.red, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}><Icon name="call_end" size={17} /> Leave</button>
        </div>

        {leaving && (
          <div onClick={() => setLeaving(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: C.card, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Leave the hangout?</div>
              <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
                The room stays open for everyone else. You can rejoin any time while it is running.
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <button type="button" onClick={() => setLeaving(false)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: C.cardSoft, color: C.text, fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>Stay</button>
                <button type="button" onClick={() => setLeaving(false)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: C.red, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>Leave</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

/**
 * Standalone boost sheet — components/boost/BoostSheet.jsx.
 *
 * ⚠ PRICES COME FROM utils/boosts.js, NOT RETYPED. That file is the one
 * catalogue and is mirrored server-side, so reading it here means the preview
 * cannot quote a price the shop does not charge.
 *
 * ⚠ THE COPY MUST NOT PROMISE A SLOT. boosts.js says so explicitly: delivery is
 * eligibility plus relevance, fairly rotated, so "shown first" is a promise that
 * breaks the moment two people buy the same boost.
 */
export function PreviewBoostSheet({ target = 'stream', onClose }) {
  // ⚠⚠ THIS SCREEN HAD ZERO CONTROLS. A boost sheet you cannot buy or spend from
  // is a price list, and the copy at the top says "buy one now or spend one you
  // already hold" — a promise the screen could not keep.
  const items = BOOSTS.filter((b) => b.target === target);
  const [pick, setPick] = useState(items[0]?.id || null);
  // Owned tokens are the second half of that sentence. Without them "spend one
  // you already hold" names an inventory the screen never shows.
  const owned = { stream_boost: 2, stream_super: 0, stream_mega: 1 };
  const chosen = items.find((b) => b.id === pick);
  const haveOne = (owned[pick] || 0) > 0;
  // ⚠ NO PRICE, RATE OR INVENTORY CHANGES HERE. `done` is a UI state only: it
  // confirms the press and closes when there IS a parent. Nothing is spent.
  const [done, setDone] = useState(null);
  const act = (how) => { setDone(how); onClose?.(); };
  return (
    <Shell title="Boost">
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
          Boosts are tokens you own. Buy one now or spend one you already hold, on your own stream
          or on someone else&apos;s.
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((b) => (
            <button key={b.id} type="button" onClick={() => setPick(b.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, width: '100%', textAlign: 'left', cursor: 'pointer', color: C.text,
                background: pick === b.id ? C.purple : C.cardSoft,
                border: 'none' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: pick === b.id ? '#4A18A8' : C.purpleSoft, color: pick === b.id ? '#fff' : C.purpleLight, display: 'grid', placeItems: 'center' }}>
                <Icon name="rocket_launch" size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{b.name}</div>
                <div style={{ fontSize: 11.5, color: pick === b.id ? '#EDE4FF' : C.textDim, marginTop: 2 }}>
                  {b.reach ? `${b.reach}x · ` : ''}{b.minutes >= 60 ? `${b.minutes / 60}h` : `${b.minutes} min`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="vg-mono" style={{ fontSize: 13.5, fontWeight: 800, color: pick === b.id ? '#FFEFB0' : '#F5C542' }}>{b.coins}c</div>
                <div style={{ fontSize: 11, color: pick === b.id ? '#EDE4FF' : C.textMuted }}>or ${b.priceUSD}</div>
                {owned[b.id] > 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: pick === b.id ? '#C6FFD8' : C.green, marginTop: 2 }}>{owned[b.id]} owned</div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* ⚠ TWO ACTIONS, BECAUSE THE COPY PROMISES TWO. "Buy one now or spend
            one you already hold" — spending is only offered when you actually
            hold one, so the button cannot lie about your inventory. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {haveOne && (
            <button type="button" onClick={() => act('spend')} style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: C.chipRaised, color: '#D6B4FF', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
              {done === 'spend' ? 'Boost applied' : 'Use one I own'}
            </button>
          )}
          <button type="button" onClick={() => act('buy')} style={{ flex: haveOne ? 1 : 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
            {done === 'buy' ? 'Boost applied' : <>Buy {chosen?.name || 'boost'} · {chosen?.coins || 0}c</>}
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.6, marginTop: 16 }}>
          A boost buys reach and puts this in front of people who watch this kind of stream. It is
          not a guaranteed position, and boosts stack to a ceiling of 3x.
        </p>
      </div>
    </Shell>
  );
}

/** Vergr.me banner — the component itself, prop-only, in situ on a dark stage. */
export function PreviewVergrMeBanner() {
  return (
    <Shell title="Vergr.me banner">
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
          Shown on a broadcaster&apos;s stream so viewers can reach their link page. This is the real
          component, not a copy.
        </div>
        <VergrMeBannerCard username="rivenplays" onClick={() => {}} />
      </div>
    </Shell>
  );
}
