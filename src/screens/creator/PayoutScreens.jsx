// src/screens/creator/PayoutScreens.jsx
// Payout setup + statement detail. See docs/REVENUE_SHARE_MOCKUP_BRIEF.md §4-5.
//
// Both are reached from CreatorEarningsScreen. Same copy rules apply: never
// "withdraw", never "fee", never a raw gem figure.
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { PayoutSetupSkeleton, StatementSkeleton } from '../../components/creator/StudioSkeletons';
import { getPayoutAccount, enrollForPayouts, getMyPayoutStatements } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, SectionHeader } from '../../components/creator/Widgets';
import Icon from '../../components/Icon';
// A payout statement names the paying entity, so it reads from the one source
// of truth. No extra bundle weight: AppRouter already pulls legalContent into
// the main chunk via TosVersionGate.
import { OPERATOR } from '../marketing/legal/legalContent';
import UserName from '../../components/UserName';

const NUM = 'font-dmmono font-bold tabular-nums';
const usd = (micro) => `$${((Number(micro) || 0) / 1e6).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

// ── Payout setup ──────────────────────────────────────────────────────

function StepRow({ done, pending, title, body, cta, onCta }) {
  return (
    <div className="flex items-start gap-3 px-4 py-4 border-b border-white/5 last:border-0">
      <Icon
        name={done ? 'check_circle' : pending ? 'schedule' : 'radio_button_unchecked'}
        className={`text-xl mt-0.5 shrink-0 ${
          done ? 'text-brand-gold' : pending ? 'text-brand-violet-light' : 'text-text-muted'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className={`font-bold text-sm ${done ? 'text-text-secondary' : 'text-text-primary'}`}>{title}</div>
        <div className="text-xs text-text-muted mt-0.5">{body}</div>
      </div>
      {!done && cta && (
        <button
          onClick={onCta}
          className="px-3 py-1.5 rounded-lg bg-brand-violet text-white text-xs font-bold hover:brightness-110 shrink-0"
        >
          {cta}
        </button>
      )}
    </div>
  );
}

export function PayoutSetupScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const load = async () => {
    try { setAccount(await getPayoutAccount()); }
    catch (e) { console.error('getPayoutAccount', e); }
    setLoading(false);
  };

  useEffect(() => { if (currentUser) load(); }, [currentUser]);

  const enroll = async () => {
    setEnrolling(true);
    try { await enrollForPayouts(); await load(); }
    catch (e) { console.error('enrollForPayouts', e); }
    setEnrolling(false);
  };

  const kyc = Number(account?.kycLevel || 0);
  const taxOnFile = account?.taxFormStatus === 'on_file';
  const taxSubmitted = account?.taxFormStatus === 'submitted';

  return (
    <CreatorLayout page="earnings" title="Payout setup" subtitle="Four steps, once">
      {loading ? <PayoutSetupSkeleton /> : (
        <div className="space-y-4 pb-10">
          {(account?.availableMicroUsd || 0) > 0 && (
            <Card className="p-4 border border-brand-gold/30">
              <div className="flex items-center gap-3">
                <Icon name="savings" className="text-brand-gold text-2xl" />
                <div>
                  <span className={`${NUM} text-xl text-brand-gold`}>{usd(account.availableMicroUsd)}</span>
                  <span className="text-sm text-text-secondary ml-2">is ready once setup is complete</span>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="px-4 pt-4">
              <SectionHeader title="Getting paid" subtitle="All four must be done before a payout is sent" />
            </div>
            <div className="mt-2">
              <StepRow
                done={!!account?.enrolled}
                title="Start payout setup"
                body="Tells us you want to be paid. Nothing is shared yet."
                cta={enrolling ? 'Working...' : 'Start'}
                onCta={enroll}
              />
              <StepRow
                done={kyc >= 1}
                title="Verify your identity"
                body={
                  kyc >= 2 ? 'Level 2 verified. You qualify for faster payouts.'
                    : kyc === 1 ? 'Level 1 verified. Level 2 unlocks faster payouts and higher limits.'
                      : 'A government ID and a selfie. Required before any payment.'
                }
                cta="Verify"
                onCta={() => navigate('/wallet/kyc')}
              />
              <StepRow
                done={taxOnFile}
                pending={taxSubmitted}
                title="Tax form"
                body={
                  taxOnFile ? `${account?.taxFormType || 'Form'} on file.`
                    : taxSubmitted ? 'Submitted, waiting on validation.'
                      : 'A W-9 or W-8BEN, depending on where you live. Collected by our payments partner.'
                }
                cta="Complete"
                onCta={() => navigate('/help')}
              />
              <StepRow
                done={!!account?.payoutAccountConnected}
                title="Payout account"
                body={
                  account?.payoutAccountConnected
                    ? 'Connected. Payments go here on your schedule.'
                    : 'Where your money is sent. Details must match your verified identity.'
                }
                cta="Connect"
                onCta={() => navigate('/help')}
              />
            </div>
          </Card>

          {/* Honest about what is not wired yet. A step that silently does
              nothing is worse than one that says it is coming. */}
          {!account?.payoutAccountConnected && (
            <Card className="p-4">
              <p className="text-xs text-text-muted">
                Tax forms and payout accounts are handled by our payments partner. That connection
                is being finalised, so those two steps are not yet available to complete. Your
                earnings keep accruing in the meantime and nothing is lost.
              </p>
            </Card>
          )}

          <button
            onClick={() => navigate('/creator/earnings')}
            className="text-sm font-bold text-brand-violet-light hover:underline"
          >
            Back to Earnings
          </button>
        </div>
      )}
    </CreatorLayout>
  );
}

// ── Statement detail ──────────────────────────────────────────────────

/**
 * Sample statement for /creator/earnings/statement/preview.
 *
 * Exists so the finished layout can be seen and designed against before any
 * real payout run has happened. Clearly labelled as a sample on screen: an
 * unlabelled mock that looks like a real financial document is exactly the kind
 * of thing that ends up screenshotted as if it were real.
 */
const PREVIEW_STATEMENT = {
  runId: 'preview',
  status: 'paid',
  cadence: 'standard',
  amountMicroUsd: 143_980_000,
  partnerReference: 'TRL-88213-A',
  createdAt: { seconds: Math.floor(Date.now() / 1000) },
  periodFromMs: Date.now() - 30 * 86400000,
  sources: [
    { key: 'Tips',           shareMicroUsd: 78_000_000, grossMicroUsd: 120_000_000 },
    { key: 'Memberships',    shareMicroUsd: 52_000_000, grossMicroUsd: 80_000_000 },
    { key: 'Locked content', shareMicroUsd: 13_980_000, grossMicroUsd: 21_500_000 },
  ],
};

/**
 * Reads like a remittance advice, not a receipt. This is the creator's tax
 * record and the document that evidences a supplier payment rather than a
 * balance withdrawal, so it is deliberately plain and formal.
 */
export function PayoutStatementScreen() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      if (runId === 'preview') { if (alive) { setRow(PREVIEW_STATEMENT); setLoading(false); } return; }
      try {
        const all = await getMyPayoutStatements(currentUser.uid, 50);
        if (alive) setRow(all.find((r) => r.runId === runId) || null);
      } catch (e) { console.error('getMyPayoutStatements', e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser, runId]);

  return (
    <CreatorLayout page="earnings" title="Statement" subtitle={runId}>
      {loading ? <StatementSkeleton /> : !row ? (
        <Card className="p-8 text-center">
          <Icon name="search_off" className="text-3xl text-text-muted" />
          <p className="text-sm text-text-secondary mt-2">Statement not found.</p>
          <button
            onClick={() => navigate('/creator/earnings')}
            className="mt-3 text-sm font-bold text-brand-violet-light hover:underline"
          >
            Back to Earnings
          </button>
        </Card>
      ) : (
        <div className="space-y-4 pb-10">
          {runId === 'preview' && (
            <Card className="p-3 border border-brand-violet/40">
              <p className="text-xs text-brand-violet-light font-bold">
                Sample statement — layout preview only. Every figure below is made up.
              </p>
            </Card>
          )}
          <Card className="p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap border-b border-white/10 pb-4">
              <div>
                <div className="font-syne font-bold text-lg text-text-primary">VERGR</div>
                <div className="text-xs text-text-muted">{OPERATOR.legalName}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text-muted uppercase tracking-wide font-bold">Statement</div>
                <div className={`${NUM} text-sm text-text-primary`}>
                  {new Date(tsMs(row.createdAt)).toLocaleDateString(undefined, {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 py-4 border-b border-white/10 text-sm">
              <div>
                <div className="text-xs text-text-muted uppercase tracking-wide font-bold">Paid to</div>
                <div className="text-text-primary mt-1"><UserName user={profile} masked fallback={'—'} /></div>
              </div>
              <div>
                <div className="text-xs text-text-muted uppercase tracking-wide font-bold">Status</div>
                <div className="text-text-primary mt-1 capitalize">{row.status}</div>
              </div>
            </div>

            <div className="py-4 border-b border-white/10">
              {Array.isArray(row.sources) && row.sources.length ? (
                <>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide font-bold text-text-muted pb-2">
                    <span>Source</span>
                    <span className="flex gap-6">
                      <span>Gross</span>
                      <span className="w-24 text-right">Your share</span>
                    </span>
                  </div>
                  {row.sources.map((s) => (
                    <div key={s.key} className="flex items-center justify-between text-sm py-1.5">
                      <span className="text-text-secondary">{s.key}</span>
                      <span className="flex gap-6 items-center">
                        <span className={`${NUM} text-text-muted`}>
                          {s.grossMicroUsd != null ? usd(s.grossMicroUsd) : '—'}
                        </span>
                        <span className={`${NUM} text-text-primary w-24 text-right`}>
                          {usd(s.shareMicroUsd)}
                        </span>
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Revenue share for this period</span>
                  <span className={`${NUM} text-text-primary`}>{usd(row.amountMicroUsd)}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4">
              <span className="font-bold text-text-primary">Amount paid</span>
              <span className={`${NUM} text-2xl text-brand-gold`}>{usd(row.amountMicroUsd)}</span>
            </div>

            {row.partnerReference && (
              <div className="mt-4 pt-4 border-t border-white/10 text-xs text-text-muted">
                Reference <span className={`${NUM} text-text-secondary`}>{row.partnerReference}</span>
              </div>
            )}

            <p className="mt-6 text-xs text-text-muted">
              Paid under the Vergr Creator Revenue Share Agreement.
            </p>
          </Card>

          <button
            onClick={() => navigate('/creator/earnings')}
            className="text-sm font-bold text-brand-violet-light hover:underline"
          >
            Back to Earnings
          </button>
        </div>
      )}
    </CreatorLayout>
  );
}
