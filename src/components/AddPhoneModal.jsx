import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import Icon from './Icon';
import { COUNTRIES, DEFAULT_COUNTRY, toE164 } from '../utils/countries';

const savePhoneNumber = httpsCallable(functions, 'savePhoneNumber');

/**
 * Reusable phone-number prompt. Used during signup (skippable) and from the
 * 3-dot menu on the New Chat screen (to unlock contact matching + VP).
 *
 * The user picks a country from the dropdown (dial code auto-applied) and
 * types only their local number — no need to know the +XX prefix. We
 * combine locally via `toE164`, then the callable revalidates server-side.
 *
 * Props:
 *   onSaved({ phone, awarded })  — called after the save succeeds
 *   onClose()                    — close without saving
 *   rewardAmount                 — shown in copy (must match functions/index.js)
 */
export default function AddPhoneModal({ onSaved, onClose, rewardAmount = 1000 }) {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [localNumber, setLocalNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const filteredCountries = useMemo(() => {
    if (!pickerQuery.trim()) return COUNTRIES;
    const q = pickerQuery.toLowerCase();
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [pickerQuery]);

  const submit = async () => {
    setError('');
    const e164 = toE164(country.dial, localNumber);
    if (!e164) {
      setError('Enter a valid phone number for the selected country.');
      return;
    }
    setBusy(true);
    try {
      const res = await savePhoneNumber({ phone: e164 });
      onSaved?.(res.data || { phone: e164 });
    } catch (err) {
      setError(err?.message || 'Could not save phone number.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-surface-1 border border-white/[0.06] rounded-t-3xl sm:rounded-3xl shadow-2xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center shrink-0">
            <Icon name="phone" size={20} />
          </div>
          <div className="flex-1">
            <h2 className="text-white font-bold text-base">Add your phone number</h2>
            <p className="text-text-muted text-xs mt-0.5">
              Lets you invite your contacts and match them to their VERGR accounts.
              First save earns <span className="text-brand-violet-light font-bold">+{rewardAmount} VP</span>.
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white p-1 -mr-1 -mt-1">
            <Icon name="close" size={18} />
          </button>
        </div>

        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-1.5 block">
          Phone number
        </label>

        <div className="flex gap-2">
          {/* Country selector — opens a searchable list below */}
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 bg-surface-2 border border-white/[0.06] rounded-xl px-3 text-sm text-white hover:border-brand-violet/40 transition-colors"
            aria-haspopup="listbox"
          >
            <span className="text-base leading-none">{country.flag}</span>
            <span className="font-dmmono">{country.dial}</span>
            <Icon name={pickerOpen ? 'expand_less' : 'expand_more'} size={16} className="text-text-muted" />
          </button>

          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="Your local number"
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value)}
            className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand-violet font-dmmono"
          />
        </div>

        {pickerOpen && (
          <div className="mt-2 bg-surface-2 border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
              <Icon name="search" size={16} className="text-text-muted" />
              <input
                type="text"
                placeholder="Search country or code..."
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                className="flex-1 bg-transparent text-white text-sm outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filteredCountries.length === 0 && (
                <p className="px-4 py-3 text-xs text-text-muted">No matches.</p>
              )}
              {filteredCountries.map((c) => (
                <button
                  type="button"
                  key={c.code}
                  onClick={() => { setCountry(c); setPickerOpen(false); setPickerQuery(''); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-3 transition-colors ${
                    country.code === c.code ? 'bg-brand-violet/10 text-brand-violet-light' : 'text-white'
                  }`}
                >
                  <span className="text-base leading-none w-6">{c.flag}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="font-dmmono text-xs text-text-muted">{c.dial}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-brand-ember text-xs mt-2">{error}</p>}

        <p className="text-[10px] text-text-muted mt-3 leading-relaxed">
          Stored privately. We keep a one-way hash of your number for
          contact matching — you control who can see the full number in
          Privacy Settings.
        </p>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-surface-2 text-text-secondary text-sm font-bold hover:bg-surface-3 transition-all">
            Not now
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-brand-violet text-white text-sm font-bold hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busy ? 'Saving...' : `Save & earn ${rewardAmount} VP`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
