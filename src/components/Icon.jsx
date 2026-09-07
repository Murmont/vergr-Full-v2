// ⚠⚠ A MATERIAL LIGATURE MUST NEVER REACH THE ACCESSIBILITY TREE.
//
// This component renders the icon NAME as text — that is how a ligature font
// works — so without `aria-hidden` every icon in the app leaks its raw name into
// whatever accessible name the browser computes. Measured on the live stream
// surfaces: a screen reader announced "close", "cameraswitch", "content_cut",
// "poll", "badge", "mood" and "settings" as button names, and on the desktop
// broadcaster the icon ran INTO the visible label — "micMic",
// "videocamCamera", "dashboard_customizeLayout".
//
// `aria-hidden` fixes both shapes at once, app-wide:
//   icon + text  → "Mic"    (was "micMic")
//   icon alone   → unnamed  (was "more_horiz")
//
// ⚠ THE SECOND CASE IS THEREFORE A BUTTON YOU MUST LABEL YOURSELF. An icon-only
// control needs its own `aria-label`; the ligature was never a real name, it
// only looked like one for the handful of icons whose id happens to be an
// English word. Anything decorative is now correctly silent.
export default function Icon({ name, filled, size = 24, className = '', style }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined select-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0",
        ...style,
      }}
    >
      {name}
    </span>
  );
}
