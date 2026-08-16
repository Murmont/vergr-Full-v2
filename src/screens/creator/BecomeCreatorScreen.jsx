// src/screens/creator/BecomeCreatorScreen.jsx
//
// Anyone can use Vergr. Only a creator can monetize. This is the door.
//
// Deliberate copy rule: NO earnings figures anywhere on this screen or the
// modal. A fan reading it must not be able to reverse-engineer what a creator
// takes home. It sells what you can DO, not what you can make.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { functions } from '../../firebase/config';
import CreatorLayout from '../../components/creator/CreatorLayout';
import Icon from '../../components/Icon';
import '../../styles/surface.css';

const GOLD = ['#FFF6D4', '#FBDA62', '#F2B721', '#DE9A0C'];
const GOLD_TEXT = {
  background: `linear-gradient(175deg, ${GOLD[0]} 0%, ${GOLD[1]} 34%, ${GOLD[2]} 74%, ${GOLD[3]} 100%)`,
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
};

export async function callCreator(name, payload = {}) {
  const { httpsCallable } = await import('firebase/functions');
  const res = await httpsCallable(functions, name)(payload);
  return res.data;
}

/** What a creator gets. Capability, never numbers. */
const PERKS = [
  { icon: 'volunteer_activism', title: 'Get tipped',        body: 'Supporters can tip your posts and your live streams.' },
  { icon: 'workspace_premium',  title: 'Sell memberships',  body: 'Offer monthly tiers with perks only your members see.' },
  { icon: 'lock',               title: 'Lock your best work', body: 'Put posts, clips and streams behind a one-off unlock.' },
  { icon: 'confirmation_number', title: 'Ticket your events', body: 'Charge for entry to a stream, a match or a season pass.' },
  { icon: 'insights',           title: 'See what works',     body: 'A revenue share dashboard with statements and payout dates.' },
];

/**
 * The nav-click popup. Shown when a non-creator opens Creator Studio, so the
 * answer to "what is this?" arrives before an empty dashboard does.
 */
export function BecomeCreatorModal({ open, onClose }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="vg-material vg-grain vg-beam rounded-2xl w-full max-w-[560px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative z-[1] p-6">
          <button onClick={onClose} aria-label="Close"
            className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-lg text-text-muted hover:text-text-primary">
            <Icon name="close" className="text-lg" />
          </button>

          <div className="text-[26px] font-bold text-text-primary leading-tight">
            Become a <span style={GOLD_TEXT}>creator</span>
          </div>
          <p className="text-sm text-text-secondary mt-2">
            Anyone can post, stream and build a squad on Vergr. Becoming a creator is
            what turns that into a living.
          </p>

          <div className="mt-5 grid gap-2.5">
            {PERKS.map((p) => (
              <div key={p.title} className="flex items-start gap-3">
                <span className="shrink-0 grid place-items-center w-9 h-9 rounded-xl"
                  style={{ background: 'rgba(240,180,50,0.10)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.24)' }}>
                  <Icon name={p.icon} className="text-base" style={{ color: '#F5C842' }} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-text-primary">{p.title}</div>
                  <div className="text-xs text-text-muted">{p.body}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted mt-5">
            Applications are reviewed by a person. It is free, and it always will be.
          </p>

          <div className="mt-5 flex gap-2.5 flex-wrap">
            <button
              onClick={() => { onClose?.(); navigate('/creator/apply'); }}
              className="flex-1 min-w-[160px] rounded-xl px-5 py-3 font-bold text-[#1A1408] transition-transform active:scale-[0.98]"
              style={{ background: `linear-gradient(180deg, ${GOLD[1]}, ${GOLD[2]})` }}
            >
              Start onboarding
            </button>
            <button
              onClick={() => { onClose?.(); navigate('/platform/help/category/creator-studio'); }}
              className="rounded-xl px-5 py-3 text-sm font-bold text-text-secondary hover:text-text-primary"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
            >
              Creator guide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Req({ met, label, detail }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon name={met ? 'check_circle' : 'radio_button_unchecked'} filled={met}
        className="text-lg shrink-0" style={{ color: met ? '#34D399' : '#4B5563' }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-text-primary">{label}</div>
        <div className="text-xs text-text-muted">{detail}</div>
      </div>
    </div>
  );
}

function PathCard({ p, id }) {
  const pct = Math.min(100, (p.progress / p.target) * 100);
  return (
    <div className="vg-wash rounded-xl p-4" style={{
      '--vg-accent': p.met ? '#3E6B35' : '#3A3D46',
      '--vg-wash': p.met ? 'rgba(26,55,24,0.95)' : 'rgba(20,22,28,0.95)',
    }}>
      <div className="relative z-[2]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-text-primary">{p.label}</span>
          {p.met && <Icon name="check_circle" filled className="text-base" style={{ color: '#34D399' }} />}
        </div>
        <div className="text-xs text-text-muted mt-1">{p.describe}</div>
        <div className="mt-3 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(2, pct)}%`, background: p.met ? '#34D399' : `linear-gradient(90deg, ${GOLD[2]}, ${GOLD[1]})` }} />
        </div>
        <div className="text-[11px] text-text-secondary mt-1.5 font-dmmono tabular-nums">
          {p.progress} / {p.target} {p.unit}
          {id === 'streamer' && p.minutes != null && ` · ${p.minutes}/${p.minutesRequired} min`}
        </div>
      </div>
    </div>
  );
}

export default function BecomeCreatorScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    callCreator('getCreatorEligibility')
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message || 'Could not load your eligibility.'));
    return () => { alive = false; };
  }, []);

  const apply = async () => {
    setBusy(true); setError('');
    try {
      await callCreator('applyForCreator', { agreedToTerms: true });
      const d = await callCreator('getCreatorEligibility');
      setData(d);
    } catch (e) { setError(e.message || 'Could not submit your application.'); }
    setBusy(false);
  };

  const status = data?.status || 'none';

  return (
    <CreatorLayout page="home" title="Become a creator" subtitle="Free, and reviewed by a person">
      <div className="max-w-[860px]">
        {status === 'active' && (
          <div className="vg-material vg-grain vg-beam rounded-2xl p-6 mb-4">
            <div className="relative z-[1] flex items-center gap-3">
              <Icon name="verified" filled className="text-2xl" style={{ color: '#34D399' }} />
              <div>
                <div className="font-bold text-text-primary">You are a creator</div>
                <button onClick={() => navigate('/creator/earnings')}
                  className="text-sm mt-1" style={GOLD_TEXT}>Go to Earnings</button>
              </div>
            </div>
          </div>
        )}

        {status === 'pending' && (
          <div className="vg-material vg-grain vg-beam rounded-2xl p-6 mb-4">
            <div className="relative z-[1] flex items-start gap-3">
              <Icon name="hourglass_top" className="text-2xl" style={{ color: '#F5C842' }} />
              <div>
                <div className="font-bold text-text-primary">Application under review</div>
                <div className="text-sm text-text-secondary mt-1">
                  A person is looking at it. You will get a notification either way.
                </div>
              </div>
            </div>
          </div>
        )}

        {data?.pendingCoins > 0 && status !== 'active' && (
          <div className="vg-wash rounded-xl p-4 mb-4"
            style={{ '--vg-accent': '#6E5222', '--vg-wash': 'rgba(35,27,11,0.95)' }}>
            <div className="relative z-[2] flex items-start gap-3">
              <Icon name="savings" className="text-xl shrink-0" style={{ color: '#F5C842' }} />
              <div className="text-sm text-text-secondary">
                <span className="font-bold" style={GOLD_TEXT}>People have already supported you.</span>{' '}
                Support you received before becoming a creator is held for you, and it is
                credited to your account the moment your application is approved.
              </div>
            </div>
          </div>
        )}

        <div className="vg-material vg-grain vg-beam rounded-2xl p-6">
          <div className="relative z-[1]">
            <div className="text-lg font-bold text-text-primary">What every creator needs</div>
            <div className="text-xs text-text-muted mb-2">All three are required.</div>
            {data ? Object.entries(data.required).map(([k, r]) => (
              <Req key={k} met={r.met} label={r.label} detail={r.detail} />
            )) : <div className="text-sm text-text-muted py-4">Checking your account…</div>}

            <div className="vg-rule-h my-5" />

            <div className="text-lg font-bold text-text-primary">Then any one of these</div>
            <div className="text-xs text-text-muted mb-3">
              You only need to complete one. Pick whichever suits how you use Vergr.
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data && Object.entries(data.paths).map(([id, p]) => <PathCard key={id} id={id} p={p} />)}
            </div>

            {status !== 'active' && status !== 'pending' && (
              <>
                <div className="vg-rule-h my-5" />
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 accent-[#F5C842]" />
                  <span className="text-xs text-text-secondary">
                    I accept the{' '}
                    <a href="/platform/creator-agreement" target="_blank" rel="noreferrer"
                       className="underline" style={{ color: '#F5C842' }}
                       onClick={(e) => e.stopPropagation()}>Creator Revenue Share Agreement</a>.
                    Vergr pays a revenue share on what I earn, on a schedule, once I meet the
                    payout requirements.
                  </span>
                </label>

                {error && <div className="text-xs text-brand-ember mt-3">{error}</div>}
                {data && !data.canApply && !error && (
                  <div className="text-xs text-text-muted mt-3">
                    {data.hardBlocked
                      ? 'This account is not eligible. Contact support.'
                      : data.inCooldown
                        ? `You can apply again after ${new Date(data.cooldownEndsMs).toLocaleDateString()}.`
                        : 'Complete the requirements above to apply.'}
                  </div>
                )}

                <button
                  disabled={!agreed || busy || !data?.canApply}
                  onClick={apply}
                  className="mt-4 rounded-xl px-6 py-3 font-bold text-[#1A1408] disabled:opacity-40 transition-transform active:scale-[0.98]"
                  style={{ background: `linear-gradient(180deg, ${GOLD[1]}, ${GOLD[2]})` }}
                >
                  {busy ? 'Submitting…' : 'Apply to become a creator'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </CreatorLayout>
  );
}
