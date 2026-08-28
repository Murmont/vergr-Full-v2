// Form controls for the Channels tab.
//
// These exist because the native controls are wrong here. `<input type="color">`
// renders the OS/browser picker: a white panel dropped into a dark admin, RGB
// spinners, and no hex field at all. `<input type="checkbox">` is the same story.
// Both look like nobody looked at the screen.
//
// So: a brand swatch grid plus a real hex field, a proper switch, and a preview
// that renders the ACTUAL inbox row rather than an approximation of it, because
// the row is the thing being designed and guessing at it is how you end up with
// four channels that look nothing like each other.

import { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { ADMIN_COLORS as C } from './AdminShell';

// Brand palette only. Cyan is deliberately absent: it is aliased away in
// tailwind.config.js and is not a Vergr colour.
export const CHANNEL_SWATCHES = [
  { hex: '#7B1FFF', name: 'Violet' },
  { hex: '#B44FFF', name: 'Violet light' },
  { hex: '#C87FFF', name: 'Pink' },
  { hex: '#F0A500', name: 'Gold' },
  { hex: '#F5C842', name: 'Gold light' },
  { hex: '#F04060', name: 'Ember' },
  { hex: '#3D7FFF', name: 'Gem blue' },
  { hex: '#22C55E', name: 'Green' },
];

const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Accent picker: swatches for the fast path, a hex field for anything else.
 *
 * The hex field keeps its own draft string so a half-typed value like "#7B1" is
 * not pushed upstream and does not fight the user's cursor.
 */
export function ColorField({ value, onChange }) {
  const current = isHex(value) ? value : '#7B1FFF';
  const [draft, setDraft] = useState(current);

  // Follow external changes (picking a swatch) without clobbering typing.
  useEffect(() => { setDraft(current); }, [current]);

  const commit = (raw) => {
    let v = String(raw || '').trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    // Accept the 3-digit shorthand people actually type.
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    }
    if (isHex(v)) onChange(v.toUpperCase());
    else setDraft(current); // invalid: snap back rather than silently keeping it
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {CHANNEL_SWATCHES.map((s) => {
          const active = current.toUpperCase() === s.hex.toUpperCase();
          return (
            <button
              key={s.hex}
              type="button"
              title={`${s.name} ${s.hex}`}
              onClick={() => onChange(s.hex)}
              style={{
                width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
                background: s.hex,
                border: active ? '2px solid #fff' : '2px solid transparent',
                boxShadow: active ? `0 0 0 2px ${s.hex}` : 'inset 0 0 0 1px rgba(255,255,255,0.14)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'box-shadow .12s, border-color .12s',
              }}
            >
              {active && <Icon name="check" size={16} style={{ color: '#fff' }} />}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: current,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)', flexShrink: 0,
        }} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); } }}
          spellCheck={false}
          placeholder="#7B1FFF"
          style={{
            width: 128, padding: '9px 11px', background: '#0a0a14',
            border: `1px solid ${isHex(draft) ? C.border : '#f04060'}`,
            borderRadius: 8, color: C.text, fontSize: 13,
            fontFamily: 'ui-monospace, monospace', letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        />
        <span style={{ fontSize: 11, color: C.textDim }}>
          Pick a brand colour, or type any hex.
        </span>
      </div>
    </div>
  );
}

/** A switch. Replaces a raw checkbox, which renders as an OS control on a dark UI. */
export function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%',
        padding: '9px 0', background: 'transparent', border: 0,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{
        width: 38, height: 22, borderRadius: 999, flexShrink: 0, marginTop: 1,
        background: checked ? C.accent : '#25253a',
        border: `1px solid ${checked ? C.accent : C.border}`,
        position: 'relative', transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left .15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, color: C.text, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: C.textDim, marginTop: 2, lineHeight: 1.45 }}>{hint}</span>}
      </span>
    </button>
  );
}

/** A pill in a multi-select row. Used for tiers. */
export function PillToggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
        background: checked ? `${C.accent}28` : 'transparent',
        border: `1px solid ${checked ? C.accent : C.border}`,
        color: checked ? C.text : C.textDim,
        fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
        transition: 'background .12s, border-color .12s, color .12s',
      }}
    >
      {label}
    </button>
  );
}

/**
 * How the channel will actually look in a user's message list.
 *
 * Mirrors the real InboxRow: 52px avatar, accent-coloured verified pip, name,
 * preview line, timestamp. The point is to stop the accent colour being an
 * abstract hex and show it doing its job at the size it will be seen.
 */
export function ChannelRowPreview({ name, handle, avatarUrl, accentColor, lastMessage, unread = true }) {
  const accent = isHex(accentColor) ? accentColor : '#7B1FFF';
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        In the message list
      </div>
      {/* #0B0B14 is the real app background, not the admin's. The row has to be
          judged against where it will live. */}
      <div style={{ background: '#0B0B14', padding: '4px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
          background: unread ? 'rgba(123,31,255,0.02)' : 'transparent',
        }}>
          <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
            <UserAvatar src={avatarUrl} size={52} />
            {/* zIndex 20 is REQUIRED, not decoration. UserAvatar renders its img
                as `relative z-10`, so an overlay left at z-auto is PAINTED OVER
                by the avatar and only the sliver past the corner stays visible.
                See reference-avatar-overlay-zindex; this has bitten the online
                dot and the Status "+" badge before. `bottom/right: 0` rather
                than -2 tucks it onto the rim instead of leaving it detached. */}
            <div style={{
              position: 'absolute', bottom: 0, right: 0, zIndex: 20, width: 18, height: 18,
              borderRadius: '50%', background: accent, border: '2px solid #0B0B14',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="verified" size={10} style={{ color: '#fff' }} />
            </div>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                {name || 'Channel name'}
              </span>
            </div>
            <div style={{
              fontSize: 13.5, color: unread ? '#e5e7eb' : '#9CA3AF', marginTop: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 260,
            }}>
              {lastMessage || 'Your message preview appears here'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#6B7280' }}>now</div>
            {unread && (
              <div style={{
                marginTop: 6, minWidth: 20, height: 20, borderRadius: 999,
                background: accent, color: '#fff', fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px',
              }}>1</div>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: '9px 14px', fontSize: 11, color: C.textDim, borderTop: `1px solid ${C.border}` }}>
        {handle ? `@${handle}` : 'Set a handle'} · shown against the real app background
      </div>
    </div>
  );
}
