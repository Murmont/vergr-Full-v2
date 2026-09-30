// Appeal: how a person asks Vergr to look again at a decision about THEM.
//
// ⚠ Until 2026-09-21 the admin side of appeals was built (queue, drawer,
// overturn) and users had almost no way to file one: only a live-stream chat
// ban had a button. A hidden post, a mute, a ban and an ended stream all left
// the person with nothing to press, and the AI-hide notice told them to appeal
// "in your post settings", which did not exist.
//
// ONE form for every kind, so the rules cannot drift between surfaces. The
// limits are the server's (functions/adminModeration.js submitAppeal): 20 to
// 1500 characters, one pending appeal per thing, only your own content or
// account, and only inside the appeal window set in Admin → Moderation.

import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Modal from '../Modal';

const MIN = 20;

export const APPEAL_COPY = {
  post:    { title: 'Appeal this hidden post', body: 'Tell us why this post should be visible again. A moderator reads every appeal.' },
  stream:  { title: 'Appeal this ended stream', body: 'Tell us why this stream should not have been ended. A moderator reads every appeal.' },
  account: { title: 'Appeal this ban', body: 'Tell us why you think this ban is a mistake. A moderator reads every appeal.' },
  mute:    { title: 'Appeal this mute', body: 'Tell us why you think this mute is a mistake. A mute also ends by itself at the time shown.' },
};

function errorText(err) {
  const code = String(err?.code || '');
  if (code.includes('already-exists')) return 'You already have an appeal about this being looked at.';
  if (code.includes('failed-precondition') || code.includes('permission-denied') || code.includes('not-found')) {
    return err?.message || 'This cannot be appealed.';
  }
  return 'Could not send that appeal. Check your connection and try again.';
}

export function AppealForm({ targetType, targetId, onDone, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const copy = APPEAL_COPY[targetType] || APPEAL_COPY.post;
  const left = MIN - text.trim().length;

  const send = async () => {
    if (busy || left > 0) return;
    setBusy(true);
    setError('');
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'submitAppeal')({
        targetType, targetId, appealText: text.trim(),
      });
      setSent(true);
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-2">
        <div className="font-syne text-lg font-bold mb-2">Appeal sent</div>
        <p className="text-text-secondary text-sm leading-relaxed">
          A moderator will look at it. You will get a notification with the outcome.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="font-syne text-lg font-bold mb-1">{copy.title}</div>
      <p className="text-text-secondary text-sm leading-relaxed mb-3">{copy.body}</p>
      <textarea
        value={text}
        maxLength={1500}
        rows={5}
        onChange={(e) => setText(e.target.value)}
        placeholder="What happened, in your own words?"
        className="w-full rounded-xl bg-surface-2 text-text-primary text-sm p-3 outline-none resize-y"
      />
      <div className="text-xs text-text-muted mt-1.5 mb-3">
        {left > 0 ? `${left} more character${left === 1 ? '' : 's'} needed.` : `${text.trim().length} / 1500`}
      </div>
      {error && <div className="text-sm text-brand-ember mb-3">{error}</div>}
      <div className="flex gap-2.5">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-surface-2 text-text-primary text-sm font-semibold">
            Cancel
          </button>
        )}
        <button type="button" onClick={send} disabled={busy || left > 0}
          className={`flex-[2] py-3 rounded-xl text-sm font-semibold ${busy || left > 0 ? 'bg-surface-2 text-text-muted' : 'bg-brand-violet text-white'}`}>
          {busy ? 'Sending…' : 'Send appeal'}
        </button>
      </div>
    </div>
  );
}

// Why a post was hidden, in words its author can act on. Keys are the
// `hiddenReason` values the server writes (functions/postModeration.js,
// functions/contentAi.js).
const HIDDEN_WHY = {
  ai_moderation: 'Our automatic review flagged it as possibly breaking the rules.',
  auto_mod_reports: 'Several people reported it, so it is hidden while a moderator reviews it.',
  admin_approved_report: 'A moderator reviewed a report about it and hid it.',
  vanguard_approved_report: 'A moderator reviewed a report about it and hid it.',
};

// Shown to a hidden post's AUTHOR only (nobody else can open it).
export function HiddenPostNotice({ post, onAppeal }) {
  return (
    <div className="mx-4 mt-3 rounded-2xl bg-surface-2 p-4 flex items-start gap-3">
      <span className="material-symbols-outlined text-brand-ember text-[22px] shrink-0" aria-hidden="true">visibility_off</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary">Only you can see this post</div>
        <p className="text-sm text-text-secondary leading-relaxed mt-0.5">
          {HIDDEN_WHY[post?.hiddenReason] || 'It was hidden by moderation.'}
        </p>
      </div>
      <button type="button" onClick={onAppeal}
        className="shrink-0 px-3.5 py-2 rounded-xl bg-brand-violet text-white text-xs font-semibold">
        Appeal
      </button>
    </div>
  );
}

export function AppealSheet({ targetType, targetId, onClose }) {
  return (
    <Modal isOpen onClose={onClose} title="">
      <div className="p-1">
        <AppealForm targetType={targetType} targetId={targetId} onCancel={onClose} />
      </div>
    </Modal>
  );
}
