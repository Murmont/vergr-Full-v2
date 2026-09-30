// PermissionDisclosure — the "prominent disclosure" screen Google Play requires
// before an app requests access to sensitive data.
//
// WHY THIS EXISTS
// Play's User Data policy requires that, for sensitive permissions (contacts,
// location, and friends), the app shows an in-app disclosure BEFORE the runtime
// permission dialog, stating what is accessed, why, and what happens to it. A
// privacy-policy link is explicitly NOT sufficient, and the disclosure may not
// be buried in settings or a terms screen. Apps get rejected for this routinely.
//
// It also has to be honest. Do not soften the copy for a permission we then use
// more broadly than described — the disclosure is what we are held to.
//
// USAGE
//   const [ask, setAsk] = useState(false);
//   ...
//   <button onClick={() => setAsk(true)}>Find friends</button>
//   {ask && (
//     <PermissionDisclosure
//       {...DISCLOSURES.contacts}
//       onAllow={() => { setAsk(false); reallyDoTheThing(); }}
//       onCancel={() => setAsk(false)}
//     />
//   )}
//
// onAllow must be what triggers the OS prompt. Requesting the permission before
// this dialog is dismissed defeats the entire point.

import { createPortal } from 'react-dom';
import Icon from '../Icon';

// Copy lives here so the disclosure, the Play Console data-safety form and the
// privacy policy can be kept saying the same thing. If you change how a
// permission is used, change it here first.
export const DISCLOSURES = {
  contacts: {
    icon: 'contacts',
    title: 'Find friends from your contacts',
    lead: 'VERGR needs permission to read your contacts to show you which of them are already on VERGR.',
    points: [
      'We read the names and phone numbers in your contact list.',
      'Phone numbers are scrambled into an unreadable code on your device before anything is sent. Your actual numbers never leave your phone.',
      'We use this only to match contacts to VERGR accounts and to let you invite the ones who are not here yet.',
      'Your contacts are not stored on our servers, not shared, and never used for advertising.',
    ],
    allowLabel: 'Continue',
    cancelLabel: 'Not now',
  },
  location: {
    icon: 'location_on',
    title: 'Share your location',
    lead: 'VERGR needs permission to use your device location so you can send it in this chat.',
    points: [
      'We read your location only at the moment you tap Send location.',
      'It is sent as a message to the people in this chat, exactly like any other message you send.',
      'We do not track your location in the background or while the app is closed.',
      'It is never used for advertising or sold to anyone.',
    ],
    allowLabel: 'Continue',
    cancelLabel: 'Not now',
  },
};

export default function PermissionDisclosure({
  icon, title, lead, points = [], allowLabel = 'Continue', cancelLabel = 'Not now',
  onAllow, onCancel,
}) {
  // Portalled to body: these are triggered from inside chat composers and
  // sheets whose ancestors carry backdrop-filter/overflow-hidden, which would
  // otherwise clip or trap a fixed child.
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={title}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 10050,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      className="sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md"
        style={{
          background: '#14141F', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 22, color: '#FFF',
          marginBottom: 'var(--vg-safe-b, 0px)',
        }}
      >
        <div style={{
          width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center',
          background: 'rgba(123,31,255,0.15)', border: '1px solid rgba(123,31,255,0.35)',
          color: '#B44FFF', marginBottom: 14,
        }}>
          <Icon name={icon} size={24} />
        </div>

        <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: '#9CA3AF', marginBottom: 14 }}>{lead}</p>

        <ul style={{ display: 'grid', gap: 10, marginBottom: 20, padding: 0, listStyle: 'none' }}>
          {points.map((p) => (
            <li key={p} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, color: '#D1D5DB' }}>
              <Icon name="check_circle" size={16} style={{ color: '#B44FFF', flexShrink: 0, marginTop: 1 }} />
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '13px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700,
              background: '#1A1A2A', border: '1px solid rgba(255,255,255,0.08)', color: '#9CA3AF',
              cursor: 'pointer',
            }}
          >{cancelLabel}</button>
          <button
            onClick={onAllow}
            style={{
              flex: 1, padding: '13px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700,
              background: 'linear-gradient(90deg,#7B1FFF,#C87FFF)', border: 'none', color: '#FFF',
              cursor: 'pointer',
            }}
          >{allowLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
