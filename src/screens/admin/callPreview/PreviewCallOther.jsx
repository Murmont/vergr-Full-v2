// The call surfaces that are not a call screen: the incoming ring, the calls
// hub, the floating voice pill, the in-thread call row and the two channel
// modals.
//
// ⚠ THESE ARE THE HARDEST SURFACES TO SEE ON A REAL ACCOUNT and that is exactly
// why they belong in a simulator. An incoming ring needs a second person on a
// second device and vanishes after 30 seconds. A missed-call row needs somebody
// to deliberately not answer. The channel modals need a channel you are willing
// to delete afterwards.
//
// ⚠ SIMULATION ONLY. Nothing rings, nothing dials, nothing is written.

import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { useFaces, usePreviewSim } from '../streamPreview/previewAssetsContext';
import { CallBtn, EncryptedNote, S, C, EMBER, VIOLET, VIOLET_LIGHT, GREEN, FONT } from './callChrome';
import { CALL_LOG, FAVOURITES, PREVIEW_GROUP, castByUid, clock } from './callCast';

/* ══════════════════ Incoming ring ══════════════════
 *
 * Copied layout source: src/components/IncomingCallOverlay.jsx:253-330.
 *
 * ⚠ THREE SHAPES FROM ONE COMPONENT, and the differences are load-bearing:
 *   direct  the caller is the headline
 *   group   the GROUP is the headline and the starter goes underneath, because
 *           the thing you are being asked to join is the room, not the person
 *   paid    the Accept button carries the price, and the entitlement is bought
 *           BEFORE connecting. A failed payment must not connect anyway.
 *
 * ⚠ DECLINING A GROUP CALL IS NOT ENDING IT. It is you stepping out, so it is
 * dismissed on this device only and keeps ringing everyone who has not
 * answered. Writing status:'ended' there would hang up on the whole room.
 */
export function PreviewIncomingRing() {
  const { ringKind, ringVideo, ringPrice, peer } = usePreviewSim();
  const faceOf = useFaces();
  const group = ringKind === 'group';
  const paid = ringKind === 'paid';

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: FONT, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {/* The one legitimately translucent thing on a call surface: a full-bleed
          scrim over whatever the person was doing when the call arrived. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(18px)' }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 360, padding: '48px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', marginBottom: 30, display: 'grid', placeItems: 'center' }}>
          {[128, 112, 144].map((w, i) => (
            <span key={w} aria-hidden="true" style={{
              position: 'absolute', width: w, height: w, borderRadius: '50%',
              border: `${i === 1 ? 1 : 2}px solid rgba(123,31,255,${0.3 - i * 0.08})`,
              animation: `vgring-ping ${2 + i * 0.5}s cubic-bezier(0,0,0.2,1) infinite`,
              animationDelay: `${i * 0.5}s`,
            }} />
          ))}
          <UserAvatar src={faceOf(peer)} size={96} isGroup={group} />
        </div>

        <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: '#fff' }}>
          {group ? PREVIEW_GROUP.groupName : peer.displayName}
        </h2>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: VIOLET_LIGHT, margin: '0 0 4px' }}>
          {group ? `${peer.displayName} started it` : `@${peer.username}`}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
          <Icon name={group ? 'groups' : ringVideo ? 'videocam' : 'call'} size={16} style={{ color: C.textMuted }} />
          <p style={{ fontSize: 14, color: C.textDim, margin: 0 }}>
            {group
              ? `Group ${ringVideo ? 'video' : 'voice'} call`
              : paid
                ? `Paid ${ringVideo ? 'video' : 'voice'} session`
                : `Incoming ${ringVideo ? 'video' : 'audio'} call`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <CallBtn icon="call_end" label="Decline" tone="danger" size={64} iconSize={28} onClick={() => {}} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textDim }}>Decline</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <CallBtn icon={ringVideo ? 'videocam' : 'call'} label={paid ? `Join for ${ringPrice} coins` : 'Accept'}
              tone="accept" size={64} iconSize={28} onClick={() => {}} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textDim }}>
              {paid ? `Join · ${Number(ringPrice).toLocaleString()}c` : 'Accept'}
            </span>
          </div>
        </div>

        {/* ⚠⚠ THE SHIPPED FOOTER READS "VERGR · Encrypted P2P Call" ON EVERY
            RING, INCLUDING A GROUP ONE, AND THAT IS FALSE. A group call routes
            through our own SFU, which decrypts and re-encrypts each hop, so the
            server is not blind to it. A specific security claim printed under a
            call that does not meet it is the one kind of copy error worth
            treating as a bug. EncryptedNote takes p2p and tells the truth for
            both. */}
        <div style={{ marginTop: 44 }}>
          <EncryptedNote p2p={!group} />
        </div>
      </div>
      <style>{'@keyframes vgring-ping { 0% { transform: scale(1); opacity: 0.85 } 75%, 100% { transform: scale(1.75); opacity: 0 } }'}</style>
    </div>
  );
}

/* ══════════════════ Calls hub ══════════════════
 *
 * Copied layout source: src/screens/calls/CallsScreen.jsx:150-332.
 *
 * ⚠ TWO LAYOUTS FROM ONE SCREEN. On mobile it is the list under a TopBar; on
 * desktop it is a 380px list beside an actions pane. The header is DESKTOP-ONLY
 * on purpose: on mobile the TopBar already renders the title and the new-call
 * button, and rendering both gave two identical titles stacked on each other.
 */
export function PreviewCallsHub({ wide = false }) {
  const faceOf = useFaces();

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {wide && (
        <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 800, margin: 0, color: C.text }}>Calls</h2>
          <button type="button" aria-label="New call" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#251A46', display: 'grid', placeItems: 'center' }}>
            <Icon name="add_call" size={20} style={{ color: VIOLET_LIGHT }} />
          </button>
        </div>
      )}
      {!wide && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' }}>
          <button type="button" aria-label="Back" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', background: S.chip, color: '#fff', display: 'grid', placeItems: 'center' }}>
            <Icon name="arrow_back" size={18} />
          </button>
          <p style={{ margin: 0, flex: 1, fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 800, color: C.text }}>Calls</p>
          <button type="button" aria-label="New call" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'grid' }}>
            <Icon name="add_call" size={22} style={{ color: VIOLET_LIGHT }} />
          </button>
        </div>
      )}

      {/* search */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={18} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.textMuted }} />
          <input readOnly placeholder="Search by name or username"
            aria-label="Search people to call"
            style={{
              width: '100%', boxSizing: 'border-box', background: S.field,
              border: '1px solid #2E2E42', borderRadius: 12,
              padding: '10px 12px 10px 36px', color: C.text, fontSize: 13, fontFamily: FONT,
            }} />
        </div>
      </div>

      {/* favourites */}
      <div style={{ padding: '16px 16px 0' }}>
        <p style={railLabel}>Favourites</p>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {FAVOURITES.map((uid) => {
            const c = castByUid(uid);
            return (
              <button key={uid} type="button" aria-label={`Call ${c.displayName}`} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                width: 56, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}>
                <UserAvatar src={faceOf(c)} size={44} />
                <span style={{ fontSize: 10, color: C.textDim, width: '100%', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.displayName.split(/[ _]/)[0]}
                </span>
              </button>
            );
          })}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 56, flexShrink: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: S.row, display: 'grid', placeItems: 'center' }}>
              <Icon name="add" size={20} style={{ color: C.textMuted }} />
            </div>
            <span style={{ fontSize: 10, color: C.textMuted }}>Add</span>
          </div>
        </div>
      </div>

      {/* recents */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 20px' }}>
        <p style={railLabel}>Recent</p>
        <div style={{ display: 'grid', gap: 2 }}>
          {CALL_LOG.map((row, i) => {
            const c = castByUid(row.uid);
            const missed = !row.answered && !row.outgoing;
            const kind = missed ? 'missed' : row.outgoing ? 'outgoing' : 'incoming';
            const ICONS = { missed: 'call_missed', outgoing: 'call_made', incoming: 'call_received' };
            // ⚠ THIS IS A MEANING LADDER, NOT DECORATION. audio and video must
            // stay distinguishable, and so must incoming and outgoing. Violet
            // is video; gem-blue (#3D7FFF) is audio and outgoing; ember is a
            // missed call, the one row people scan for.
            const COLORS = { missed: EMBER, outgoing: '#3D7FFF', incoming: GREEN };
            return (
              <button key={`${row.uid}-${i}`} type="button" aria-label={`Call ${c.displayName} back`}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 10,
                  borderRadius: 12, border: 'none', cursor: 'pointer', background: 'transparent', textAlign: 'left',
                }}>
                <UserAvatar src={faceOf(c)} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: missed ? EMBER : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.displayName}
                  </p>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name={ICONS[kind]} size={12} style={{ color: COLORS[kind] }} />
                    <span style={{ fontSize: 10.5, color: C.textDim }}>
                      {/* ⚠ "no answer" IS NOT "missed". An unanswered call you
                          PLACED is not an alert and must not be red; an
                          unanswered call you RECEIVED is the thing you came here
                          to find. */}
                      {missed ? 'missed' : !row.answered ? 'no answer' : kind} · {row.type}
                    </span>
                  </span>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 10.5, color: C.textDim }}>{ago(row.ago)}</p>
                  {row.durationSec > 0 && (
                    <p style={{ margin: 0, fontSize: 9.5, color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>{clock(row.durationSec)}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (!wide) {
    return <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, overflow: 'hidden' }}>{list}</div>;
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'grid', placeItems: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
          <div style={{ width: 80, height: 80, borderRadius: 24, background: '#251A46', display: 'grid', placeItems: 'center', margin: '0 auto 24px' }}>
            <Icon name="call" size={40} style={{ color: VIOLET_LIGHT }} />
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <ActionCard icon="call" title="Start a call" body="Search and call someone directly" active />
            {/* ⚠⚠ BOTH OF THESE ARE HONEST DEAD ENDS TODAY, AND THE COPY IS THE
                FIX THAT ALREADY SHIPPED. "Send call link" used to mint
                /call/join/<uuid> and copy it: there is no such route and no
                join-by-link backend, so every link a user shared 404'd for
                whoever received it. It now says so instead of handing out a dead
                link. Scheduled calls has never existed. The buttons stay because
                the entry points stay; only the false promise went. */}
            <ActionCard icon="link" title="Send call link" body="Coming soon. Search for someone to call them now." />
            <ActionCard icon="event" title="Schedule a call" body="Coming soon" tone="#F0A500" />
          </div>
          <p style={{ fontSize: 10.5, color: C.textDim, marginTop: 24, lineHeight: 1.6 }}>
            One-to-one calls are peer to peer. Audio and video calls are free for everyone.
            Quality depends on your connection.
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, body, active = false, tone = VIOLET_LIGHT }) {
  return (
    <button type="button" style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 16,
      borderRadius: 16, cursor: 'pointer', textAlign: 'left', border: 'none',
      // ⚠ SELECTION IS A SOLID BAR, NOT A HAIRLINE RING. Same rule as the
      // cosmetics panel: an outline on a transparent box reads as cheap.
      background: active ? '#1E1733' : '#141322',
      boxShadow: active ? 'inset 3px 0 0 #b44fff' : 'none',
    }}>
      <Icon name={icon} size={22} style={{ color: tone, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.text }}>{title}</p>
        <p style={{ margin: 0, fontSize: 10.5, color: C.textDim }}>{body}</p>
      </div>
    </button>
  );
}

/* ══════════════════ Floating voice pill ══════════════════
 *
 * Copied layout source: src/components/VoiceSessionPill.jsx:22-51.
 *
 * ⚠ THE PILL IS THE PROOF THAT A CHANNEL IS A PLACE. It is mounted in AppRouter
 * beside IncomingCallOverlay, so it follows you across every screen while the
 * session lives in the voiceSession singleton, and it hides itself on the
 * channel's own screen. Without it, walking away from the channel screen would
 * leave you connected with nothing on screen saying so.
 */
export function PreviewVoicePill({ onDark = true }) {
  const { micOn, setMicOn, channel, speakingFor } = usePreviewSim();
  const speaking = speakingFor(channel);
  const anyone = Object.entries(speaking).some(([k, v]) => v && k !== 'me');

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: onDark ? '#0B0B14' : 'transparent', fontFamily: FONT,
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 6px 6px 12px', borderRadius: 999,
        background: '#161428', boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
      }}>
        <button type="button" aria-label="Back to the voice channel" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: anyone ? GREEN : VIOLET }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Late game</span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.textDim, flexShrink: 0 }}>{channel.length + 1}</span>
        </button>
        <button type="button" onClick={() => setMicOn((v) => !v)} aria-label={micOn ? 'Mute' : 'Unmute'}
          style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', background: micOn ? 'transparent' : '#3A1420', color: micOn ? C.textDim : EMBER }}>
          <Icon name={micOn ? 'mic' : 'mic_off'} size={16} />
        </button>
        <button type="button" aria-label="Leave the voice channel"
          style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', background: EMBER, color: '#fff' }}>
          <Icon name="call_end" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ══════════════════ In-thread call row ══════════════════
 *
 * Copied layout source: ChatThreadScreen.jsx:516-560 (CallRow).
 *
 * ⚠ CALLS LIVE IN THE THREAD, not only in the Calls tab. These are read live
 * out of `calls_history`, never written as messages, so past calls appear in a
 * conversation you have just opened and the two surfaces can never disagree.
 * Tapping one calls back with the SAME media type, which is what the icon
 * promises.
 */
export function PreviewCallRows() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', fontFamily: FONT, overflowY: 'auto', padding: '20px 16px' }}>
      <p style={{ ...railLabel, textAlign: 'center' }}>In a conversation</p>
      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        {CALL_LOG.slice(0, 5).map((row, i) => {
          const missed = !row.answered && !row.outgoing;
          const isVideo = row.type === 'video';
          const kind = isVideo ? 'video' : 'voice';
          const label = row.answered
            ? (row.outgoing ? `Outgoing ${kind} call` : `Incoming ${kind} call`)
            : (missed ? `Missed ${kind} call` : 'No answer');
          const dirIcon = missed ? 'call_missed' : row.outgoing ? 'call_made' : 'call_received';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" aria-label={`${label}. Call back.`} style={{
                display: 'flex', alignItems: 'center', gap: 12, maxWidth: '85%',
                padding: '8px 14px 8px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
                background: '#141322', textAlign: 'left',
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: missed ? '#2C1219' : '#221838',
                }}>
                  <Icon name={isVideo ? 'videocam' : 'call'} size={16} style={{ color: missed ? EMBER : VIOLET_LIGHT }} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: missed ? EMBER : C.text }}>{label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: C.textDim }}>
                    <Icon name={dirIcon} size={11} style={{ color: missed ? EMBER : C.textDim }} />
                    {ago(row.ago)}{row.durationSec ? ` · ${clock(row.durationSec)}` : ''}
                  </span>
                </span>
                <Icon name="chevron_right" size={16} style={{ color: C.textMuted, flexShrink: 0 }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════ Channel modals ══════════════════ */

export function PreviewChannelModals({ which = 'create' }) {
  const faceOf = useFaces();
  const create = which === 'create';
  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: FONT, display: 'grid', placeItems: 'center', padding: 16, overflow: 'hidden' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, borderRadius: 16, background: '#12101E', padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 19, fontWeight: 800, margin: 0, color: C.text }}>
            {create ? 'New voice channel' : 'Invite members'}
          </h2>
          <button type="button" aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'grid' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {create ? (
          <>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6 }}>NAME</span>
              <input readOnly value="Late game"
                style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: '1px solid #2E2E42', borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: FONT }} />
            </label>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 8 }}>WHO CAN JOIN</span>
            <div style={{ display: 'grid', gap: 8, marginBottom: 22 }}>
              <VisOption icon="lock" title="Private" body="Only people you invite" selected />
              <VisOption icon="public" title="Public" body="Anyone with the link can join" />
            </div>
            <button type="button" style={primaryBtn}>Create channel</button>
          </>
        ) : (
          <>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <Icon name="search" size={17} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.textMuted }} />
              <input readOnly placeholder="Search people" aria-label="Search people to invite"
                style={{ width: '100%', boxSizing: 'border-box', background: S.field, border: '1px solid #2E2E42', borderRadius: 10, padding: '10px 12px 10px 34px', color: C.text, fontSize: 13, fontFamily: FONT }} />
            </div>
            <div style={{ display: 'grid', gap: 4, marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
              {['c5', 'c3', 'c2', 'c8', 'c7'].map((uid, i) => {
                const c = castByUid(uid);
                const on = i < 2;
                return (
                  <div key={uid} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10,
                    background: on ? '#1E1733' : 'transparent',
                    boxShadow: on ? 'inset 3px 0 0 #b44fff' : 'none',
                  }}>
                    <UserAvatar src={faceOf(c)} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>{c.displayName}</p>
                      <p style={{ margin: 0, fontSize: 10.5, color: C.textDim, fontFamily: 'DM Mono, monospace' }}>@{c.username}</p>
                    </div>
                    <Icon name={on ? 'check_circle' : 'radio_button_unchecked'} size={19} style={{ color: on ? VIOLET_LIGHT : C.textMuted }} />
                  </div>
                );
              })}
            </div>
            <button type="button" style={primaryBtn}>Save members</button>
          </>
        )}
      </div>
    </div>
  );
}

function VisOption({ icon, title, body, selected = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
      background: selected ? '#1E1733' : '#141322',
      boxShadow: selected ? 'inset 3px 0 0 #b44fff' : 'none',
    }}>
      <Icon name={icon} size={19} style={{ color: selected ? VIOLET_LIGHT : C.textMuted, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</p>
        <p style={{ margin: 0, fontSize: 11, color: C.textDim }}>{body}</p>
      </div>
    </div>
  );
}

const primaryBtn = {
  width: '100%', padding: '12px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, #b44fff, #7c3aed)', color: '#fff',
  fontSize: 14, fontWeight: 700, fontFamily: FONT,
};

const railLabel = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em',
  color: '#9298ab', fontWeight: 700, margin: '0 0 8px',
};

/** Minutes back from now, as the relative label the real screens print. */
function ago(mins) {
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
