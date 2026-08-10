// Walks first-time crypto users through creating a stablecoin wallet so they
// can receive USDT-TRX or USDC-Polygon payouts from VERGR.
// Pure educational content — we never see their seed phrase.
//
// Used inside RequestPayoutScreen when the user clicks "I need a wallet".
import { useState } from 'react';
import Icon from '../Icon';

const STEPS = [
  {
    id: 'pick_device',
    title: 'Where will you use your wallet?',
    body: 'A wallet app holds your crypto. Pick where you want it.',
  },
  {
    id: 'install',
    title: 'Install the app',
  },
  {
    id: 'create_account',
    title: 'Create your wallet',
    body: 'In the app, tap "Create new wallet" — NOT "Import" or "Restore".',
  },
  {
    id: 'save_phrase',
    title: 'Save your recovery phrase',
    body: '12 or 24 random words. This is the ONLY way to recover your wallet if you lose your phone. Write it on paper. Store it somewhere safe. Never take a screenshot, never email it to yourself, never tell anyone — including us.',
  },
  {
    id: 'get_address',
    title: 'Find your USDT-TRX address',
  },
  {
    id: 'paste_back',
    title: 'Paste your address',
    body: 'Tap "Receive" or "Deposit" in your wallet app. Choose USDT (TRC-20). Copy the long string starting with T. Paste it below.',
  },
];

const RECOMMENDED = {
  mobile: [
    { name: 'Trust Wallet', why: 'Most popular, supports USDT-TRX + USDC + 100s more', url: 'https://trustwallet.com', logo: '🛡️' },
    { name: 'Tonkeeper', why: 'Light + fast, TON-native', url: 'https://tonkeeper.com', logo: '💎' },
  ],
  desktop: [
    { name: 'TronLink', why: 'Browser extension, native to TRX', url: 'https://www.tronlink.org', logo: '🔗' },
    { name: 'MetaMask', why: 'Standard for ETH/Polygon (USDC)', url: 'https://metamask.io', logo: '🦊' },
  ],
};

export default function WalletEducationWizard({ onAddressEntered, onClose }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [device, setDevice] = useState(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const step = STEPS[stepIdx];

  const next = () => setStepIdx(i => Math.min(STEPS.length - 1, i + 1));
  const back = () => setStepIdx(i => Math.max(0, i - 1));

  const validateTRX = (a) => /^T[a-zA-Z0-9]{33}$/.test(a.trim());

  const submit = () => {
    if (!validateTRX(address)) {
      setError('That doesn\'t look like a TRX address. Should start with T and be 34 characters.');
      return;
    }
    onAddressEntered?.(address.trim());
  };

  return (
    <div className="space-y-4">
      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-4">
        {STEPS.map((_, i) => (
          <div key={i}
            className={`h-1 flex-1 rounded-full transition-all
              ${i < stepIdx ? 'bg-brand-violet' : i === stepIdx ? 'bg-brand-violet' : 'bg-white/[0.08]'}`} />
        ))}
      </div>

      <div>
        <h3 className="font-syne font-bold text-lg text-text-primary">{step.title}</h3>
        {step.body && <p className="text-text-muted text-sm mt-1">{step.body}</p>}
      </div>

      {/* Step content */}
      {step.id === 'pick_device' && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'mobile', label: 'My phone', icon: 'smartphone' },
            { id: 'desktop', label: 'My computer', icon: 'monitor' },
          ].map(o => (
            <button key={o.id}
              onClick={() => { setDevice(o.id); next(); }}
              className="p-4 rounded-xl border border-white/[0.08] bg-surface-1 hover:border-brand-violet/40 transition-all flex flex-col items-center gap-2">
              <Icon name={o.icon} size={28} className="text-brand-violet" />
              <span className="text-text-primary text-sm font-bold">{o.label}</span>
            </button>
          ))}
        </div>
      )}

      {step.id === 'install' && device && (
        <div className="space-y-2">
          {RECOMMENDED[device].map(w => (
            <a key={w.name} href={w.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.08] bg-surface-1 hover:border-brand-violet/40 transition-all">
              <span className="text-2xl">{w.logo}</span>
              <div className="flex-1">
                <p className="font-bold text-sm text-text-primary">{w.name}</p>
                <p className="text-text-muted text-[11px]">{w.why}</p>
              </div>
              <Icon name="open_in_new" size={16} className="text-text-muted" />
            </a>
          ))}
          <p className="text-text-muted text-[11px] text-center mt-2">
            Tap one to download. Come back to this page after installing.
          </p>
        </div>
      )}

      {step.id === 'save_phrase' && (
        <div className="bg-brand-ember/10 rounded-xl p-4 border border-brand-ember/30">
          <div className="flex items-start gap-2">
            <Icon name="warning" size={20} className="text-brand-ember shrink-0" />
            <div>
              <p className="text-brand-ember font-bold text-sm mb-2">Lose this phrase = lose your money forever</p>
              <ul className="text-text-secondary text-xs space-y-1.5">
                <li>• Write all 12 or 24 words on paper</li>
                <li>• Store the paper somewhere safe (drawer, safe, lockbox)</li>
                <li>• Don't take a screenshot — phones get hacked</li>
                <li>• Don't email it or send it in any chat</li>
                <li>• Don't share it with VERGR or anyone else — we cannot help recover it</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {step.id === 'get_address' && (
        <div className="space-y-2">
          <div className="bg-surface-1 rounded-xl p-3 border border-white/[0.06]">
            <p className="text-text-secondary text-sm">
              In your wallet, tap <span className="font-bold text-brand-violet-light">Receive</span> (or <span className="font-bold text-brand-violet-light">Deposit</span>).
            </p>
          </div>
          <div className="bg-surface-1 rounded-xl p-3 border border-white/[0.06]">
            <p className="text-text-secondary text-sm">
              Choose <span className="font-bold text-brand-violet-light">USDT</span>, then network <span className="font-bold text-brand-violet-light">TRC-20</span> (NOT ERC-20 or BEP-20 — those use different addresses and have higher fees).
            </p>
          </div>
          <div className="bg-surface-1 rounded-xl p-3 border border-white/[0.06]">
            <p className="text-text-secondary text-sm">
              Tap the long string of letters/numbers to copy. It starts with <span className="font-mono font-bold text-brand-violet-light">T</span> and is 34 characters long.
            </p>
          </div>
        </div>
      )}

      {step.id === 'paste_back' && (
        <div className="space-y-2">
          <input
            type="text"
            value={address}
            onChange={e => { setAddress(e.target.value); setError(''); }}
            placeholder="T..."
            className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.08] text-text-primary text-sm font-dmmono focus:border-brand-violet/40 outline-none"
          />
          {error && <p className="text-brand-ember text-xs">{error}</p>}
          <p className="text-text-muted text-[11px]">
            Double-check the address — withdrawals are irreversible. We only support USDT (TRC-20) at launch.
          </p>
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-2 pt-2">
        <button onClick={stepIdx === 0 ? onClose : back}
          className="flex-1 py-3 rounded-xl border border-white/10 text-text-secondary text-sm font-bold">
          {stepIdx === 0 ? 'Cancel' : 'Back'}
        </button>
        {stepIdx < STEPS.length - 1 && step.id !== 'pick_device' && (
          <button onClick={next}
            className="flex-1 py-3 rounded-xl bg-brand-violet text-white text-sm font-bold">
            Next
          </button>
        )}
        {stepIdx === STEPS.length - 1 && (
          <button onClick={submit}
            disabled={!address.trim()}
            className="flex-1 py-3 rounded-xl bg-brand-violet text-white text-sm font-bold disabled:opacity-40">
            Use this address
          </button>
        )}
      </div>
    </div>
  );
}
