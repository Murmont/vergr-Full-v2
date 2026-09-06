// The voice channel. The SIMULATOR copy.
//
// Copied layout source: src/screens/messages/VoiceChannelScreen.jsx:200-330.
//
// ⚠ A CHANNEL IS A PLACE, NOT A CALL, and every difference follows from that.
// Discord semantics: the session lives in a module singleton (voiceSession.js)
// and SURVIVES NAVIGATION, so you stay connected while you browse the app and
// the floating pill is the other view of the same session. A call, by contrast,
// ends when you leave its screen. That is why this screen has "Leave" rather
// than "End", why there is a pill at all, and why the join has no ring.
//
// ⚠ AUDIO ONLY, BY CONSTRUCTION. voiceSession.js drops every non-audio remote
// track, so a camera in a voice channel is not a thing that can happen. Do not
// add a camera control to this surface without changing that file first.
//
// ⚠ THE PER-MEMBER VOLUME SLIDER IS LOCAL PLAYBACK ONLY. It changes what YOU
// hear and nothing about what they send, which is why it is a slider and not a
// mute. It is the only place in the product with one.

import Icon from '../../../components/Icon';
import { usePreviewSim } from '../streamPreview/previewAssetsContext';
import { CallBtn, VoiceRow, QualityPill, S, C, VIOLET_LIGHT, FONT } from './callChrome';
import { PREVIEW_CHANNEL } from './callCast';

export default function PreviewVoiceChannel({ wide = false, state = 'live' }) {
  const sim = usePreviewSim();
  const {
    phase, channel, micOn, setMicOn, speakingFor, owner, channelPrivate, me, quality,
    setChannelSeat,
  } = sim;
  const speaking = speakingFor(channel);

  // ── The three states that are not the channel working ──────────────
  //
  // ⚠ ALL THREE SHIP AND NONE OF THEM COULD BE SEEN WITHOUT BUILDING ONE.
  // "Channel not found" (a deleted channel), "private channel" (not on the
  // allow list) and the loading skeleton are each a real screen a real person
  // lands on from a shared link, and each is reachable only by contriving the
  // condition on a live account.
  if (state === 'missing' || state === 'locked') {
    const locked = state === 'locked';
    return (
      <Shell title={locked ? PREVIEW_CHANNEL.name : 'Voice channel'}>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
          <div>
            <Icon name={locked ? 'lock' : 'error_outline'} size={42} style={{ color: '#5d5d78' }} />
            <p style={{ fontWeight: 700, margin: '12px 0 4px', color: C.text }}>
              {locked ? 'This is a private channel' : 'Channel not found'}
            </p>
            <p style={{ fontSize: 13, color: C.textDim, margin: 0 }}>
              {locked ? 'Only invited members can join.' : 'It may have been deleted.'}
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const connecting = phase === 'connecting';

  return (
    <Shell
      title={PREVIEW_CHANNEL.name}
      owner={owner}
      actions
    >
      <main style={{ flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Channel identity. VoiceChannelScreen.jsx:238. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, flexShrink: 0,
              background: '#251A46', display: 'grid', placeItems: 'center',
            }}>
              <Icon name={channelPrivate ? 'lock' : 'volume_up'} size={27} style={{ color: VIOLET_LIGHT }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, margin: 0, color: C.text }}>
                {PREVIEW_CHANNEL.name}
              </h1>
              <p style={{ fontSize: 13, color: C.textDim, margin: '2px 0 0' }}>
                {connecting
                  ? 'Connecting'
                  : `${channel.length + 1} in channel · ${channelPrivate ? 'Private' : 'Public'}`}
              </p>
            </div>
            {phase === 'active' && <div style={{ marginLeft: 'auto' }}><QualityPill quality={quality} compactMode /></div>}
          </div>

          {/* Roster. */}
          <div style={{ borderRadius: 16, background: '#12101E', padding: 16 }}>
            <div style={{
              fontFamily: 'DM Mono, monospace', fontSize: 10.5, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: C.textMuted, marginBottom: 12,
            }}>
              Connected ({channel.length + 1})
            </div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${wide ? 3 : 2}, minmax(0,1fr))` }}>
              {/* Self */}
              <VoiceRow
                seat={{ ...me, name: me.displayName, micOn }}
                isMe
                speaking={!!speaking.me}
                sub={speaking.me ? 'Speaking' : micOn ? 'Mic on' : 'Muted'}
              />
              {channel.map((s) => (
                // ⚠⚠ minWidth: 0 IS HALF THE FIX AND ON ITS OWN IT ONLY HIDES
                // THE PROBLEM. It stops the item widening the outer track, so
                // nothing escapes the frame, but this wrapper is ITSELF a grid
                // and an implicit column sizes to MAX-CONTENT: measured, the
                // volume row still computed 178.8px inside a 155px box and was
                // simply clipped. `minmax(0, 1fr)` is what actually makes the
                // column shrinkable. Measuring the frame edge alone would have
                // called this fixed.
                <div key={s.uid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, minWidth: 0 }}>
                  <VoiceRow
                    seat={s}
                    speaking={!!speaking[s.uid]}
                    sub={speaking[s.uid] ? 'Speaking' : s.micOn ? 'Connected' : 'Muted'}
                    onKick={owner ? () => setChannelSeat(s.uid, { micOn: !s.micOn }) : null}
                  />
                  {/* ⚠ LOCAL PLAYBACK VOLUME, PER MEMBER. Only affects what you
                      hear. VoiceChannelScreen.jsx:296.
                      ⚠⚠ `minWidth: 0` ON THE SLIDER IS LOAD-BEARING AND THE
                      SHIPPED SCREEN IS MISSING IT. Measured here at 393px:
                      `input[type=range]` resolves `min-width: auto` to an
                      INTRINSIC 129px, so `flex: 1` cannot shrink it, the row
                      computes to 193px inside a 154.5px column and the roster
                      pushes 3px past the phone. VoiceChannelScreen.jsx:298 is
                      the same markup (`flex-1 h-1`, no `min-w-0`) in the same
                      two-column grid, so the real screen overflows too. Listed
                      in the findings panel. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 4px', minWidth: 0 }}>
                    <Icon name="volume_down" size={14} style={{ color: C.textMuted, flexShrink: 0 }} />
                    <input type="range" min="0" max="100" defaultValue="80"
                      aria-label={`${s.name} volume`}
                      style={{ flex: 1, minWidth: 0, height: 3, accentColor: VIOLET_LIGHT }} />
                    <Icon name="volume_up" size={14} style={{ color: C.textMuted, flexShrink: 0 }} />
                  </div>
                </div>
              ))}
            </div>

            {phase === 'active' && channel.length === 0 && (
              <p style={{ fontSize: 12, color: C.textDim, textAlign: 'center', marginTop: 16 }}>
                You are the only one here.{owner && channelPrivate ? ' Invite someone with the people icon up top.' : ''}
              </p>
            )}
          </div>
        </div>
      </main>

      {/* Bottom bar. VoiceChannelScreen.jsx:334. */}
      <footer style={{ padding: 16, flexShrink: 0, background: '#100E1A', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <CallBtn icon={micOn ? 'mic' : 'mic_off'} label={micOn ? 'Mute' : 'Unmute'} size={48} iconSize={20}
          tone={micOn ? 'neutral' : 'alert'} onClick={() => setMicOn((v) => !v)} disabled={connecting} />
        {/* ⚠ "LEAVE", NEVER "END". You are stepping out of a room that carries on
            without you. There is no end-for-all here and there should not be:
            deleting the channel is a separate, owner-only, confirmed action up
            in the header. */}
        <button type="button" style={{
          height: 48, padding: '0 24px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: '#F04060', color: '#fff', fontSize: 13, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="call_end" size={18} /> Leave
        </button>
      </footer>
    </Shell>
  );
}

function Shell({ title, owner = false, actions = false, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0B0B14', color: '#fff', fontFamily: FONT, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexShrink: 0 }}>
        <button type="button" aria-label="Back" style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: S.chip, color: '#fff', display: 'grid', placeItems: 'center' }}>
          <Icon name="arrow_back" size={19} />
        </button>
        <p style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <HeaderBtn icon="link" label="Copy invite link" />
            {/* ⚠ INVITE AND DELETE ARE OWNER-ONLY and their absence is the
                member's view, not a broken header. Showing a control the server
                answers with permission-denied is worse than not showing it. */}
            {owner && <HeaderBtn icon="person_add" label="Invite members" />}
            {owner && <HeaderBtn icon="delete" label="Delete channel" danger />}
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

function HeaderBtn({ icon, label, danger = false }) {
  return (
    <button type="button" aria-label={label} title={label} style={{
      width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
      background: 'transparent', color: danger ? '#ff6b6b' : '#b7b7cb',
      display: 'grid', placeItems: 'center',
    }}>
      <Icon name={icon} size={18} />
    </button>
  );
}
