// Withdraw (v2). VERGR pays out USDC on the Base network to a crypto address
// you whitelist (Circle signs + broadcasts). There is NO direct bank payout —
// PayRam has no fiat off-ramp (confirmed 2026-05-21). To get cash in a bank,
// the user withdraws USDC to an exchange that supports Base + bank withdrawal
// (e.g. Coinbase) and cashes out there themselves. The "Bank" tab is guidance
// that points at that path, not a separate payout rail.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, Pill, SectionLabel, Callout, FeeBreakdown,
  LimitProgressBar, Modal, GemGlyph, WALLET_TOKENS, fmtNum, fmtEUR,
} from '../../../components/wallet/primitives';
import {
  getMyWalletSecurityStatus,
  requestWithdrawal as requestWithdrawalCallable,
} from '../../../firebase/walletCallables';
import Icon from '../../../components/Icon';
import { IS_STORE_BUILD } from '../../../utils/platform';
import { openExternalUrl } from '../../../utils/externalBrowser';

// On the Play build the payout is AUTHORISED ON THE WEB, not in the app. The
// screen still shows balance, limits, KYC state, fees and addresses — the user
// should understand exactly what they are about to do — but the final step
// hands off to vergr.app in the device browser, so the money movement itself
// never happens inside the store app. Same precedent as tournament entry being
// desktop-only. Do not "simplify" this back into an in-app submit.
const WEB_WITHDRAW_URL = 'https://vergr.app/wallet/withdraw';

// Source of truth lives in src/utils/vpSystem.js (GEM_TO_EUR = 0.01) and
// functions/withdrawals.js (GEM_TO_MICRO_USDC = 10_000). Keep in sync.
const GEM_TO_EUR = 0.01;

// Destinations that can turn Base USDC into bank cash. Coinbase is verified —
// Base is Coinbase's own L2, so it natively supports USDC-on-Base deposits +
// bank withdrawal (US/EU + more). Others CAN work but the user must confirm
// their account supports USDC on the Base network AND fiat withdrawal in their
// country, because sending Base USDC to a non-Base destination loses the funds.
const FIAT_OFFRAMP_DESTINATIONS = [
  { name: 'Coinbase', note: 'Recommended — native Base support + bank withdrawal', verified: true },
  { name: 'Kraken',   note: 'Confirm it accepts USDC on Base in your region', verified: false },
  { name: 'Binance',  note: 'Confirm Base-network USDC deposits + fiat payout', verified: false },
];

// KYC limit table (LOCKED in CLAUDE.md):
//   L0: blocked / L1: €0 daily + €50/mo crypto only
//   L2: €500 daily / €2,500 monthly
//   L3: €2,500 daily / €15,000 monthly
function limitsForLevel(level) {
  if (level >= 3) return { daily: 2500, monthly: 15000 };
  if (level >= 2) return { daily: 500,  monthly: 2500 };
  if (level >= 1) return { daily: 0,    monthly: 50 };
  return { daily: 0, monthly: 0 };
}

export default function WithdrawScreen() {
  const { profile, wallet } = useUser();
  const { requirePin } = useWalletUnlock();
  const navigate = useNavigate();

  const [tab, setTab] = useState('crypto');
  const [amount, setAmount] = useState(0);
  const [addrId, setAddrId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [secStatus, setSecStatus] = useState(null);

  useEffect(() => {
    getMyWalletSecurityStatus().then(setSecStatus).catch(() => {});
  }, []);

  const gems = wallet?.gems || 0;
  const kycLevel = secStatus?.kycLevel ?? 0;
  const frozen = !!secStatus?.walletFrozen;
  const addrs = (wallet?.whitelistedAddresses || []);
  // Admin bypass — matches the server-side bypass in functions/withdrawals.js.
  const isAdmin = profile?.role === 'admin';

  const limits = limitsForLevel(kycLevel);
  const cryptoKYCBlocked = !isAdmin && kycLevel < 1;
  const blocked = cryptoKYCBlocked || frozen;

  const gemsEUR = amount * GEM_TO_EUR;
  const platformSpread = gemsEUR * 0.02;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);

  // Play build: hand the authorisation to the browser instead of calling the
  // withdrawal callable. If the bridge is missing (older APK, or somehow a
  // store bundle off-device) fall back to showing the URL rather than leaving
  // the user on a button that does nothing.
  const [handoffFallback, setHandoffFallback] = useState(false);
  const handoff = () => {
    if (!openExternalUrl(WEB_WITHDRAW_URL)) setHandoffFallback(true);
  };

  const submit = () => {
    requirePin(async (unlockToken) => {
      const addr = addrs.find(a => a.address === addrId);
      if (!addr) { setSubmitError('Select a destination address.'); return; }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await requestWithdrawalCallable({
          gemsRequested: amount,
          destinationType: 'crypto',
          destinationAddress: addr.address,
          unlockToken,
        });
        setSubmitSuccess(res);
        setAmount(0);
      } catch (err) {
        setSubmitError(err?.message || 'Withdrawal request failed.');
      } finally {
        setSubmitting(false);
      }
    });
  };

  // Auto-select first non-cooldown address when crypto tab loads
  useEffect(() => {
    if (tab === 'crypto' && !addrId && addrs.length) {
      const first = addrs.find(a => !a.usableAfter || a.usableAfter < Date.now()) || addrs[0];
      setAddrId(first?.address || null);
    }
  }, [tab, addrId, addrs]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 8,
        }}>Withdraw</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>
          Cash out your gems.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Paid out as USDC on Base to your crypto wallet. Processing takes 3 days, cancellable in the first hour.
        </p>
      </div>

      {/* Tab switcher */}
      <div style={{
        display: 'inline-flex', gap: 4, padding: 4, marginBottom: 20,
        background: WALLET_TOKENS.surface2, borderRadius: 12,
      }}>
        <TabBtn active={tab === 'crypto'} onClick={() => setTab('crypto')} icon="account_balance_wallet">Crypto wallet</TabBtn>
        <TabBtn active={tab === 'bank'}   onClick={() => setTab('bank')}   icon="account_balance">To my bank</TabBtn>
      </div>

      {/* Available */}
      <WalletCard style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <SectionLabel>Available to withdraw</SectionLabel>
            <div className="font-dmmono tabular-nums" style={{
              fontSize: 36, fontWeight: 700, color: '#7CA3FF', lineHeight: 1,
            }}>
              {fmtNum(gems)}<span style={{ fontSize: 18, color: WALLET_TOKENS.textSecondary, marginLeft: 8 }}>gems</span>
            </div>
            <div className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted, marginTop: 4 }}>
              ≈ {fmtEUR(gems * GEM_TO_EUR)}
            </div>
          </div>
          <GemGlyph size={48} />
        </div>
      </WalletCard>

      {tab === 'bank' ? (
        <BankInfoTab onUseCrypto={() => setTab('crypto')} />
      ) : (
        <>
          {/* KYC block */}
          {cryptoKYCBlocked && (
            <div style={{ marginBottom: 20 }}>
              <Callout tone="warning" icon="lock" title="Crypto withdrawals require KYC Level 1."
                       action={
                         <WalletButton variant="primary" size="sm" onClick={() => navigate('/wallet/kyc')}>
                           Verify identity
                         </WalletButton>
                       }>
                Confirm your identity to unlock withdrawals.
              </Callout>
            </div>
          )}

          {/* Amount + limits */}
          <WalletCard style={{
            marginBottom: 20,
            opacity: blocked ? 0.55 : 1, pointerEvents: blocked ? 'none' : 'auto',
          }}>
            <SectionLabel>Amount to withdraw</SectionLabel>
            <div style={{ display: 'flex', gap: 12 }}>
              <input value={amount}
                onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
                inputMode="numeric"
                style={{
                  flex: 1, height: 56, padding: '0 18px',
                  fontSize: 26, fontWeight: 700,
                  fontFamily: 'DM Mono, monospace',
                  color: '#7CA3FF',
                  background: WALLET_TOKENS.surface2,
                  border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                  borderRadius: 12, outline: 'none',
                }} />
              <WalletButton variant="secondary" size="lg" onClick={() => setAmount(gems)}>Max</WalletButton>
            </div>
            <div className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted, marginTop: 10 }}>
              ≈ {fmtEUR(gemsEUR)}
            </div>
            <div style={{ height: 1, background: WALLET_TOKENS.hairline, margin: '18px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <LimitProgressBar used={0} max={limits.daily}   label="Today's limit" money />
              <LimitProgressBar used={0} max={limits.monthly} label="This month" money />
            </div>
          </WalletCard>

          <CryptoTab amount={amount} addrs={addrs} addrId={addrId} setAddrId={setAddrId}
                     gemsEUR={gemsEUR} platformSpread={platformSpread} blocked={blocked}
                     navigate={navigate} />

          {IS_STORE_BUILD && (
            <div style={{ marginTop: 20 }}>
              <Callout tone="info" icon="open_in_new" title="Withdrawals are completed in your browser">
                For your security, payouts are authorised on vergr.app rather than
                inside the app. You'll be signed in already — confirm the amount and
                address there, then come back.
              </Callout>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <WalletButton variant="secondary" onClick={() => navigate('/wallet')}>Cancel</WalletButton>
            {IS_STORE_BUILD ? (
              <WalletButton variant="primary" size="lg"
                            disabled={blocked}
                            onClick={handoff} iconRight="open_in_new">
                Continue in browser
              </WalletButton>
            ) : (
              <WalletButton variant="primary" size="lg"
                            disabled={blocked || amount === 0 || !addrId}
                            onClick={() => setConfirmOpen(true)} iconRight="arrow_forward">
                Review withdrawal
              </WalletButton>
            )}
          </div>
        </>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} width={560} title="Review carefully">
        <ConfirmContent
          amount={amount}
          gemsEUR={gemsEUR}
          platformSpread={platformSpread}
          addr={addrs.find(a => a.address === addrId)}
          onCancel={() => setConfirmOpen(false)}
          onSubmit={() => { setConfirmOpen(false); submit(); }}
        />
      </Modal>

      <Modal open={!!submitSuccess} onClose={() => setSubmitSuccess(null)} width={480} title="Withdrawal submitted">
        {submitSuccess && (
          <div style={{ fontSize: 14, color: WALLET_TOKENS.textSecondary, lineHeight: 1.6 }}>
            <p style={{ marginBottom: 14 }}>
              Your withdrawal is queued. You'll receive ≈ <strong style={{ color: WALLET_TOKENS.text }}>{submitSuccess.netUSDC} USDC on Base</strong> at the selected address.
            </p>
            <p style={{ marginBottom: 14, fontSize: 13 }}>
              Funds release on {new Date(submitSuccess.releasesAt).toLocaleString()}. Cancel anytime before {new Date(submitSuccess.cancelDeadline).toLocaleString()} from <em>History</em>.
            </p>
            <WalletButton variant="primary" onClick={() => { setSubmitSuccess(null); navigate('/wallet/history'); }}>
              View history
            </WalletButton>
          </div>
        )}
      </Modal>

      <Modal open={!!submitError} onClose={() => setSubmitError(null)} width={460} title="Withdrawal failed">
        <div style={{ fontSize: 14, color: '#FCA5A5', lineHeight: 1.6, marginBottom: 16 }}>
          {submitError}
        </div>
        <WalletButton variant="secondary" onClick={() => setSubmitError(null)}>Close</WalletButton>
      </Modal>

      <Modal open={handoffFallback} onClose={() => setHandoffFallback(false)} width={460} title="Open vergr.app to withdraw">
        <div style={{ fontSize: 14, color: WALLET_TOKENS.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
          <p style={{ marginBottom: 12 }}>
            We couldn't open your browser automatically. Go to this address on any
            device and sign in to finish your withdrawal:
          </p>
          <code style={{
            display: 'block', padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.06)', color: WALLET_TOKENS.text,
            wordBreak: 'break-all', fontSize: 13,
          }}>{WEB_WITHDRAW_URL}</code>
        </div>
        <WalletButton variant="secondary" onClick={() => setHandoffFallback(false)}>Close</WalletButton>
      </Modal>

      {submitting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'grid', placeItems: 'center', zIndex: 90,
        }}>
          <div style={{
            padding: '14px 22px', borderRadius: 10,
            background: WALLET_TOKENS.surface1,
            border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            color: WALLET_TOKENS.text,
          }}>Submitting withdrawal…</div>
        </div>
      )}
    </div>
  );
}

// Recommended fiat-offramp destinations + the hard Base-network warning.
function FiatCashoutHelper() {
  return (
    <WalletCard>
      <SectionLabel>Want cash in your bank?</SectionLabel>
      <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        We pay out <strong style={{ color: WALLET_TOKENS.text }}>USDC on the Base network</strong>. To turn it into
        money in your bank, withdraw to an exchange account that supports <strong style={{ color: WALLET_TOKENS.text }}>USDC
        on Base</strong> and offers bank withdrawal in your country, then cash out there.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {FIAT_OFFRAMP_DESTINATIONS.map(d => (
          <div key={d.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairline}`,
          }}>
            <span style={{ fontWeight: 600, minWidth: 78 }}>{d.name}</span>
            {d.verified
              ? <Pill tone="gold" size="sm">Base ready</Pill>
              : <Pill tone="warning" size="sm">Verify Base</Pill>}
            <span style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>{d.note}</span>
          </div>
        ))}
      </div>
      <Callout tone="warning" icon="warning" title="Always confirm Base-network support">
        Sending Base USDC to an account that doesn't support the Base network can permanently lose the funds.
        Check the deposit network shows <strong style={{ color: WALLET_TOKENS.text }}>Base</strong> before withdrawing.
      </Callout>
    </WalletCard>
  );
}

function BankInfoTab({ onUseCrypto }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WalletCard>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: WALLET_TOKENS.surface2, display: 'grid', placeItems: 'center',
            color: '#7CA3FF', flexShrink: 0,
          }}>
            <Icon name="account_balance" size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Getting your gems into a bank account</div>
            <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
              VERGR doesn't deposit to banks directly. You withdraw your earnings as USDC on Base to a
              crypto exchange that supports bank withdrawal, then cash out to your bank there — usually
              within a day. It's the same withdrawal, just sent to an exchange instead of a personal wallet.
            </div>
          </div>
        </div>
      </WalletCard>

      <FiatCashoutHelper />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <WalletButton variant="primary" size="lg" icon="account_balance_wallet" onClick={onUseCrypto}>
          Withdraw USDC to my exchange
        </WalletButton>
      </div>
    </div>
  );
}

function CryptoTab({ amount, addrs, addrId, setAddrId, gemsEUR, platformSpread, blocked, navigate }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 16,
      opacity: blocked ? 0.55 : 1, pointerEvents: blocked ? 'none' : 'auto',
    }}>
      <WalletCard>
        <SectionLabel>Destination address</SectionLabel>
        {addrs.length === 0 ? (
          <div style={{
            padding: 24, textAlign: 'center', borderRadius: 12,
            background: WALLET_TOKENS.surface2,
            border: `1px dashed ${WALLET_TOKENS.hairlineStrong}`,
            color: WALLET_TOKENS.textSecondary, fontSize: 13,
          }}>
            No whitelisted addresses yet. Add one with a 24-hour cooldown protection.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {addrs.map(a => {
              const onCooldown = a.usableAfter && a.usableAfter > Date.now();
              return (
                <label key={a.address} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 14, borderRadius: 10,
                  background: addrId === a.address ? WALLET_TOKENS.surface2 : 'transparent',
                  border: `1px solid ${WALLET_TOKENS.hairline}`,
                  cursor: onCooldown ? 'not-allowed' : 'pointer',
                  opacity: onCooldown ? 0.6 : 1,
                }}>
                  <input type="radio" checked={addrId === a.address}
                         onChange={() => !onCooldown && setAddrId(a.address)}
                         disabled={onCooldown}
                         style={{ accentColor: WALLET_TOKENS.violetLight }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontWeight: 500 }}>{a.label}</span>
                      <Pill tone="neutral" size="sm">Base</Pill>
                      {onCooldown && <Pill tone="warning" size="sm">24h cooldown</Pill>}
                    </div>
                    <div className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.address}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <WalletButton variant="ghost" size="sm" icon="add"
                        onClick={() => navigate('/wallet/withdraw/new-address')}>
            Add new address
          </WalletButton>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: WALLET_TOKENS.textMuted }}>
          New here? Send a <strong style={{ color: WALLET_TOKENS.text }}>1-gem test</strong> first to confirm the address is reachable.
        </div>
      </WalletCard>

      <FiatCashoutHelper />

      <FeeBreakdown
        items={[
          { label: 'You withdraw',          value: `${fmtNum(amount)} gems · ${fmtEUR(gemsEUR)}` },
          { label: 'Platform spread (2%)',  value: `-${fmtEUR(platformSpread)}` },
          { label: 'Network gas (Base)',    value: fmtEUR(0.01), tone: 'muted' },
        ]}
        total={`${fmtEUR(Math.max(0, gemsEUR - platformSpread - 0.01))} USDC on Base`}
      />

      <Callout tone="info" icon="schedule" title="3-day hold">
        Cancellable from History in the first hour. Funds release to your address on day 3.
      </Callout>
    </div>
  );
}

function ConfirmContent({ amount, gemsEUR, platformSpread, addr, onCancel, onSubmit }) {
  const needTotp = gemsEUR >= 100;
  const [totp, setTotp] = useState('');
  const totpOK = !needTotp || /^\d{6}$/.test(totp);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
        <Icon name="warning" size={22} className="text-rose-300" />
        <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, lineHeight: 1.55 }}>
          This action is irreversible after the 1-hour cancel window. You're sending USDC on the Base network.
        </div>
      </div>
      <div style={{
        padding: 18, borderRadius: 12,
        background: WALLET_TOKENS.surface2,
        border: `1px solid ${WALLET_TOKENS.hairline}`,
      }}>
        <Row label="Destination">
          {addr ? (<><span>{addr.label}</span> <span className="font-dmmono" style={{ color: WALLET_TOKENS.textMuted, fontSize: 12 }}>
            {addr.address.slice(0, 8)}…{addr.address.slice(-6)}
          </span></>) : '—'}
        </Row>
        <Row label="Amount"><span className="font-dmmono">{fmtNum(amount)} gems</span></Row>
        <Row label="Platform spread"><span className="font-dmmono">-{fmtEUR(platformSpread)}</span></Row>
        <Row label="You receive">
          <span className="font-dmmono" style={{ fontWeight: 600, color: '#86EFAC' }}>
            {fmtEUR(Math.max(0, gemsEUR - platformSpread))} USDC on Base
          </span>
        </Row>
        <Row label="Processing" last>3 days · cancellable for 1 hour</Row>
      </div>

      {needTotp && (
        <div style={{ marginTop: 22 }}>
          <SectionLabel>2FA code (required for withdrawals over {fmtEUR(100)})</SectionLabel>
          <input value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            style={{
              width: '100%', height: 56, padding: '0 18px',
              fontSize: 22, letterSpacing: '0.4em', textAlign: 'center',
              fontFamily: 'DM Mono, monospace',
              background: WALLET_TOKENS.surface2,
              border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
              borderRadius: 12, color: WALLET_TOKENS.text, outline: 'none',
            }}/>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
        <WalletButton variant="secondary" onClick={onCancel}>Back</WalletButton>
        <WalletButton variant="primary" disabled={!totpOK} onClick={onSubmit}>
          Submit withdrawal
        </WalletButton>
      </div>
    </div>
  );
}

function Row({ label, children, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '10px 0', fontSize: 14,
      borderBottom: last ? '0' : `1px solid ${WALLET_TOKENS.hairline}`,
    }}>
      <span style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function TabBtn({ active, children, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, height: 36,
      background: active ? WALLET_TOKENS.surface1 : 'transparent',
      color: active ? WALLET_TOKENS.text : WALLET_TOKENS.textSecondary,
      border: `1px solid ${active ? WALLET_TOKENS.hairlineStrong : 'transparent'}`,
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}
