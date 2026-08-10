// src/screens/onboarding/ProfileIdentityScreen.jsx
// Onboarding identity step. DOB is required (13+ age-gate, COPPA/GDPR-K compliant).
// Gender is optional — VERGR character intact with "None of your business".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { updateUser } from '../../firebase/firestore';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import CountrySelect from '../../components/CountrySelect';

const GENDERS = [
  { key: 'male',   label: 'Male' },
  { key: 'female', label: 'Female' },
  { key: 'nyb',    label: 'None of your business' },
];

const MIN_AGE = 13;

function calcAge(dobStr) {
  if (!dobStr) return null;
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export default function ProfileIdentityScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [displayName, setDisplayName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [country, setCountry] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [saving, setSaving] = useState(false);

  const age = calcAge(dob);
  const dobError = dob && age != null && age < MIN_AGE ? `You must be at least ${MIN_AGE} to use VERGR.` : null;
  const canContinue = displayName.trim().length >= 2 && dob && age != null && age >= MIN_AGE;

  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(new Date().setFullYear(new Date().getFullYear() - MIN_AGE)).toISOString().slice(0, 10);

  const handleContinue = async () => {
    if (!canContinue || saving) return;
    setSaving(true);
    try {
      if (currentUser?.uid) {
        await updateUser(currentUser.uid, {
          displayName: displayName.trim(),
          pronouns: pronouns || null,
          country: country || null,
          dob,                     // YYYY-MM-DD
          ageBucket: bucketForAge(age),
          gender: gender || 'nyb', // default to NYB if skipped
        });
      }
      navigate('/onboarding/interests');
    } catch (e) {
      console.error(e);
      showToast('Could not save — try again', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="screen-container min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center text-white/80">
          <Icon name="arrow_back" size={24} />
        </button>
        {/* No Skip — DOB is required for age-gate compliance */}
      </header>

      <main className="flex-1 flex flex-col px-6 pt-4 pb-8">
        <h1 className="font-syne text-text-primary text-2xl font-bold leading-tight mb-3">Tell us about<br/>yourself</h1>
        <p className="text-text-secondary text-base mb-8">
          This helps us personalize your feed and make sure VERGR is age-appropriate.
        </p>

        <div className="flex flex-col gap-5 mb-8">
          {/* Display Name */}
          <label className="block">
            <span className="text-text-secondary text-sm font-semibold mb-2 block">Display name</span>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="How should we call you?"
              className="w-full bg-surface-2 border border-border-accent rounded-xl px-4 py-4 text-white outline-none focus:border-brand-violet placeholder:text-text-secondary/50" />
          </label>

          {/* DOB — required */}
          <label className="block">
            <span className="text-text-secondary text-sm font-semibold mb-2 flex items-center justify-between">
              <span>Date of birth <span className="text-brand-ember">*</span></span>
              {age != null && !dobError && <span className="text-[11px] text-text-muted font-dmmono tabular-nums">{age} yrs</span>}
            </span>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} max={today}
              className={`w-full bg-surface-2 border rounded-xl px-4 py-4 text-white outline-none focus:border-brand-violet ${
                dobError ? 'border-brand-ember' : 'border-border-accent'
              }`} />
            {dobError && <p className="text-brand-ember text-xs mt-1.5">{dobError}</p>}
            {!dobError && (
              <p className="text-text-muted text-[11px] mt-1.5">
                Used to verify you're 13+ and to personalize your feed. We'll never show your exact date to anyone else.
              </p>
            )}
          </label>

          {/* Gender — optional */}
          <div>
            <span className="text-text-secondary text-sm font-semibold mb-2 block">Gender (optional)</span>
            <div className="grid grid-cols-3 gap-2">
              {GENDERS.map(g => (
                <button key={g.key} type="button" onClick={() => setGender(g.key)}
                  className={`h-14 px-3 rounded-xl border text-sm font-semibold leading-tight transition-colors ${
                    gender === g.key
                      ? 'bg-brand-violet/15 border-brand-violet text-white'
                      : 'bg-surface-2 border-border-accent text-text-secondary hover:border-white/20'
                  }`}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pronouns */}
          <label className="block">
            <span className="text-text-secondary text-sm font-semibold mb-2 block">Pronouns (optional)</span>
            <select value={pronouns} onChange={e => setPronouns(e.target.value)}
              className="w-full bg-surface-2 border border-border-accent rounded-xl px-4 py-4 text-white outline-none focus:border-brand-violet [&>option]:bg-surface-2 [&>option]:text-white">
              <option value="">Select</option>
              <option>He/Him</option><option>She/Her</option><option>They/Them</option><option>Other</option>
            </select>
          </label>

          {/* Country */}
          <label className="block">
            <span className="text-text-secondary text-sm font-semibold mb-2 block">Country / region (optional)</span>
            <CountrySelect
              value={country}
              onChange={(code) => setCountry(code)}
              placeholder="Auto-detect"
              className="w-full bg-surface-2 border border-border-accent rounded-xl px-4 py-4 text-white outline-none focus:border-brand-violet"
            />
          </label>
        </div>

        <button onClick={handleContinue} disabled={!canContinue || saving}
          className="btn-primary w-full py-4 rounded-2xl text-lg font-bold mt-auto disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </main>
    </div>
  );
}

// Age bucket aligns with creator-audience analytics
function bucketForAge(age) {
  if (age == null) return null;
  if (age < 18) return '13-17';
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  return '45+';
}
