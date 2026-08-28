// THE typing indicator. Every surface that says somebody is typing renders
// this, so the unlockable style (docs/effects/06-typing-indicator.md) is one
// edit rather than six.
//
// ⚠ IT USED TO RENDER NOTHING. `ChatThreadScreen` mounted `<TypingIndicator />`
// with NO `users` prop, and the component opened with
// `if (users.length === 0) return null`, so the DM typing bubble never drew for
// anybody. The wrapper around it was conditioned on `typingUsers.length > 0`,
// which is why an avatar appeared beside nothing at all. `users` is now
// required in practice and the component says so.
//
// COST: zero fetches. The style comes off the typist's user doc, which every
// caller has already loaded for their name and avatar (doc 06 §4.1).
import { TypingGlyph } from './effects';
import { typingStyleFor, accentFor } from '../utils/rankUnlocks';

/**
 * @param {Array}   users    the fresh typists, [{ uid, name }]. Empty renders nothing.
 * @param {object}  typist   users/{uid} doc of users[0] — the person whose style shows.
 *                           Omit and everyone gets the default dots.
 * @param {string}  variant  'bubble' (a chat bubble) | 'inline' (one line of text)
 * @param {string}  label    override the sentence. Inline surfaces have their own
 *                           phrasing ("typing…") and their own context.
 * @param {boolean} live     announce to screen readers. Defaults on for the bubble
 *                           and off inline, because a list of conversation rows
 *                           would otherwise announce every row that starts typing.
 */
export default function TypingIndicator({
  users = [],
  typist = null,
  variant = 'bubble',
  label,
  live,
  className = '',
}) {
  if (users.length === 0) return null;

  const style = typingStyleFor(typist);
  // The accent only applies once a style is EQUIPPED. Everybody else keeps the
  // muted grey they have always had, so this unlock reads as a real change
  // rather than as the app recolouring itself for no reason.
  const ink = style === 'dots' ? undefined : accentFor(typist);

  const sentence = label ?? (
    users.length === 1
      ? `${users[0].name} is typing`
      : users.length === 2
        ? `${users[0].name} and ${users[1].name} are typing`
        : `${users[0].name} and ${users.length - 1} others are typing`
  );

  // role="status" is the correct treatment for a status message: implicit
  // aria-live="polite", announced when the reader is idle, never stealing
  // focus. WCAG 4.1.3.
  const a11y = (live ?? variant === 'bubble') ? { role: 'status' } : {};

  if (variant === 'inline') {
    return (
      <span {...a11y} className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
        <TypingGlyph style={style} ink={ink} size={4} />
        <span className="truncate">{sentence}</span>
      </span>
    );
  }

  return (
    <div {...a11y} className="flex items-end gap-2 px-1 pb-1 animate-fade-in">
      <div className="bg-surface-2 border border-white/[0.04] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
        <TypingGlyph style={style} ink={ink} size={7} />
        <span className="text-[10px] text-text-muted font-medium ml-1">{sentence}</span>
      </div>
    </div>
  );
}
