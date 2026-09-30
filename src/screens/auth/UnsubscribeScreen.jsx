// /unsubscribe, opened from the link at the bottom of every admin email campaign.
// No sign-in: it is usually opened from an inbox on another device. The link
// carries a per-email token (functions/emailCampaigns.js handleUnsubscribe),
// so it cannot be used to unsubscribe anyone else. Transactional emails
// (verification codes, receipts) are not affected.

import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';

export default function UnsubscribeScreen() {
  const [params] = useSearchParams();
  const c = params.get('c'); const u = params.get('u'); const t = params.get('t');
  const isTest = params.get('test') === '1' || (!c && !u && !t);
  const [state, setState] = useState(isTest ? 'test' : 'working');
  const [error, setError] = useState('');

  const run = async (op) => {
    setState('working');
    try {
      const r = await httpsCallable(functions, 'verifyEmailCode')({ op, c, u, t });
      setState(r.data?.optedOut ? 'out' : 'in');
    } catch (e) {
      setError(e?.message || 'This link is not valid.');
      setState('error');
    }
  };

  useEffect(() => { if (!isTest) run('unsubscribe'); }, []); // eslint-disable-line

  const copy = {
    working: { icon: 'hourglass_top', title: 'One moment…', body: '' },
    test: { icon: 'science', title: 'This was a test email', body: 'Unsubscribe links in test emails do nothing. Real emails carry a working link.' },
    out: { icon: 'unsubscribe', title: 'You are unsubscribed', body: 'You will not get news emails from Vergr any more. You will still get emails you need for your account, like verification codes and receipts.' },
    in: { icon: 'mark_email_read', title: 'You are subscribed again', body: 'You will get news emails from Vergr again.' },
    error: { icon: 'link_off', title: 'This link does not work', body: error },
  }[state];

  return (
    <AuthShell>
      <div className="w-full text-center py-6">
        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center">
          <Icon name={copy.icon} size={30} className="text-brand-violet-light" />
        </div>
        <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">{copy.title}</h1>
        {copy.body && <p className="text-text-secondary text-sm leading-relaxed mb-6">{copy.body}</p>}
        {state === 'out' && (
          <button onClick={() => run('resubscribe')} className="w-full h-12 rounded-xl bg-surface-2 text-text-primary font-bold text-sm mb-3">
            Subscribe again
          </button>
        )}
        <Link to="/" className="block w-full h-12 leading-[48px] rounded-xl bg-brand-violet text-white font-bold text-sm">Open Vergr</Link>
      </div>
    </AuthShell>
  );
}
