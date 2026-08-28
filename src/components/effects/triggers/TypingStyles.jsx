// The typing-indicator glyph. Effect 06. Doc: docs/effects/06-typing-indicator.md
//
// This file owns HOW a typing indicator looks and knows nothing about levels,
// which is the split README.md describes: `TYPING_STYLES` in rankUnlocks.js
// owns WHEN you get one, `users/{uid}.cosmetics.typingStyle` owns which is on.
//
// It is markup only. Every keyframe is in the colocated stylesheet, so an
// indicator that sits on screen for two minutes costs zero JS.
import './TypingStyles.css';

// Which elements each style needs. Anything not listed falls back to `dots`,
// so an id read off a user doc can never render nothing.
const THREE = ['dots', 'wave', 'bars', 'pixel'];

/**
 * @param {string} style  id from TYPING_STYLES
 * @param {string} ink    colour. Omit for the default muted grey.
 * @param {number} size   the base unit in px (dot diameter). Everything else
 *                        in the stylesheet is a multiple of it.
 */
export default function TypingGlyph({ style = 'dots', ink, size = 6, className = '' }) {
  const id = THREE.includes(style) || style === 'orbit' || style === 'comet' ? style : 'dots';
  const vars = { '--vg-typing-d': `${size}px` };
  // Only set the ink when there is one: leaving the property unset lets the
  // stylesheet's own default (the muted grey) apply, so the two states are not
  // fighting over the same declaration.
  if (ink) vars['--vg-typing-ink'] = ink;

  // aria-hidden on the glyph itself: the SENTENCE is the status message a
  // screen reader should read (see TypingIndicator), and three anonymous
  // decorative elements after it are noise.
  return (
    <span className={`vg-typing vg-typing--${id} ${className}`} style={vars} aria-hidden="true">
      {id === 'orbit' ? (
        <>
          <i className="vg-typing-track" />
          <i className="vg-typing-spin" />
        </>
      ) : id === 'comet' ? (
        <i />
      ) : (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}
