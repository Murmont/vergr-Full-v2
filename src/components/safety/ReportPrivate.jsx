// src/components/safety/ReportPrivate.jsx
//
// A report control for the surfaces that did not have one: direct messages,
// group chats, squad chats, and 1:1 sessions.
//
// ## Why this exists
//
// Private conversations on Vergr are not scanned by automated moderation, and
// that is deliberate. The consequence is that the ONLY way anything harmful in
// a private surface reaches a human is if a participant reports it, so the
// report control is the entire safety mechanism for those surfaces rather than
// a secondary one. Before this, a private conversation had no report path at
// all: the guidance was "block them", which stops the messages reaching you and
// tells nobody at Vergr that anything happened.
//
// That gap mattered more once media could be SOLD inside a conversation. Money
// changing hands in a room nobody can see, with no way to escalate, is the
// single worst shape a platform can ship.
//
// ## What a report carries
//
// The pointer, not the content. A report on a locked message records the chat
// and message id so a moderator (whose Admin credentials can resolve the
// private object key) can retrieve it. Nothing is copied into the report, so
// filing one never duplicates the material being reported.
//
// ## The Universal Prohibitions are the point
//
// The reason list is deliberately led by the things that are prohibited on
// EVERY surface of Vergr regardless of payment (AUP section 2): content
// involving a minor, intimate imagery of someone who did not consent,
// recording without consent, coercion. Those are the reports this control
// exists to capture.
import { useState } from 'react';
import Icon from '../Icon';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';

/**
 * Led by the universal prohibitions, then the ordinary ones. Order is not
 * cosmetic: the first thing someone sees should be the thing we most need to
 * hear about.
 */
const REASONS = [
  { id: 'minor', label: 'Involves someone under 18', urgent: true },
  { id: 'nonconsensual', label: 'Intimate images shared without consent', urgent: true },
  { id: 'recording', label: 'Recorded or screenshotted me without asking', urgent: true },
  { id: 'coercion', label: 'Threats, blackmail or extortion', urgent: true },
  { id: 'solicitation', label: 'Soliciting or arranging paid sexual services', urgent: true },
  { id: 'harassment', label: 'Harassment or abuse' },
  { id: 'scam', label: 'Scam, fraud or a fake sale' },
  { id: 'notdelivered', label: 'I paid and did not get what was described' },
  { id: 'other', label: 'Something else' },
];

/**
 * @param {boolean}  open
 * @param {function} onClose
 * @param {'message'|'user'|'stream'} targetType
 * @param {string}   targetId
 * @param {object}   context   free-form pointers (chatId, messageId, streamId…)
 * @param {string}   title
 */
export default function ReportPrivate({
  open,
  onClose,
  targetType = 'user',
  targetId,
  context = {},
  title = 'Report',
}) {
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const submit = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setErr('');
    try {
      await httpsCallable(functions, 'submitReport')({
        targetType,
        targetId,
        reason: REASONS.find((r) => r.id === picked)?.label || picked,
        // The pointer travels; the content does not. A moderator resolves the
        // material from these ids with credentials the reporter does not have.
        details: JSON.stringify({
          code: picked,
          note: detail.slice(0, 1000),
          surface: context.surface || null,
          chatId: context.chatId || null,
          messageId: context.messageId || null,
          streamId: context.streamId || null,
          paid: context.paid ?? null,
        }),
      });
      setDone(true);
    } catch (e) {
      // "already reported" is not a failure the reporter needs to act on.
      if (String(e?.message || '').toLowerCase().includes('already')) setDone(true);
      else setErr(e?.message || 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-surface-1 border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="font-syne font-bold text-base text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-violet/20 flex items-center justify-center">
              <Icon name="shield" className="text-brand-violet text-[24px]" />
            </div>
            <p className="text-[14px] text-text-primary font-semibold mb-1">Report sent</p>
            <p className="text-[12.5px] text-text-secondary leading-relaxed">
              A moderator will review this. If you are in immediate danger, contact your local
              emergency services first.
            </p>
            <button onClick={onClose} className="mt-5 w-full rounded-2xl bg-surface-2 hover:bg-white/10 text-text-primary font-semibold py-2.5 transition">
              Close
            </button>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <div className="py-1">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setPicked(r.id)}
                  className={`w-full px-5 py-3 text-left text-[14px] flex items-center gap-2.5 transition ${
                    picked === r.id ? 'bg-brand-violet/15 text-text-primary' : 'text-text-secondary hover:bg-surface-2'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full border shrink-0 ${
                    picked === r.id ? 'border-brand-violet bg-brand-violet' : 'border-white/25'
                  }`} />
                  <span className="flex-1">{r.label}</span>
                  {r.urgent && <Icon name="priority_high" className="text-brand-ember text-[16px] shrink-0" />}
                </button>
              ))}
            </div>

            <div className="px-5 pb-5 pt-2">
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                placeholder="Anything that would help a moderator (optional)"
                className="w-full rounded-2xl bg-surface-2 border border-white/10 px-3 py-2.5 text-[13.5px] text-text-primary placeholder:text-text-muted outline-none focus:border-brand-violet/60 resize-none"
              />
              {err && <p className="mt-2 text-[12.5px] text-brand-ember">{err}</p>}
              <p className="mt-2 text-[11.5px] text-text-muted leading-relaxed">
                You can report this whether or not money changed hands. Reports are confidential,
                and the person you are reporting is not told who filed it.
              </p>
              <button
                onClick={submit}
                disabled={!picked || busy}
                className="mt-3 w-full rounded-2xl bg-brand-violet hover:bg-brand-violet-light disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 transition"
              >
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
