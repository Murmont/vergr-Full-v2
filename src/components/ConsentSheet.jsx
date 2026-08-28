// src/components/ConsentSheet.jsx
// One-time GDPR consent sheet. Shown once per user (unless the consent version
// bumps). Writes versioned, timestamped consent records per purpose — required
// evidence under GDPR Articles 6(1)(a) + 7.
//
// Purposes (kept minimal to respect "specific per purpose" rule):
//   audienceAnalytics  → share aggregate demographics with creators I follow
//   personalizedAds    → allow personalized promotions inside VERGR
//
// Both default OFF — the user must explicitly flip them on. That's the only
// legally safe default for consent (recitals 32, 42).
import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { captureSignals } from '../utils/captureSignals';
import Icon from './Icon';

export const CONSENT_VERSION = 2;

export default function ConsentSheet() {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [audienceAnalytics, setAudienceAnalytics] = useState(false);
  const [personalizedAds, setPersonalizedAds] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) return;
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'consents'));
        const data = snap.exists() ? snap.data() : null;
        if (!alive) return;
        if (!data || (data._version ?? 0) < CONSENT_VERSION) {
          setOpen(true);
        }
      } catch (e) {
        console.warn('consent check failed:', e?.message);
      }
    })();
    return () => { alive = false; };
  }, [currentUser?.uid]);

  const save = async () => {
    if (!currentUser?.uid || saving) return;
    setSaving(true);
    try {
      const now = serverTimestamp();
      await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'consents'), {
        _version: CONSENT_VERSION,
        audienceAnalytics: { granted: audienceAnalytics, at: now, version: CONSENT_VERSION },
        personalizedAds:   { granted: personalizedAds,   at: now, version: CONSENT_VERSION },
        updatedAt: now,
      }, { merge: true });
      // Kick off signals capture now that consent decisions are recorded
      captureSignals(currentUser.uid).catch(() => {});
      setOpen(false);
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="w-full md:max-w-lg bg-[#0b0e15] border border-white/10 rounded-t-3xl md:rounded-3xl overflow-hidden shadow-[0_20px_80px_-10px_rgba(0,0,0,0.8)]">
        <div className="p-6 md:p-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-violet/10 border border-brand-violet/30 flex items-center justify-center mb-4">
            <Icon name="privacy_tip" size={24} filled className="text-brand-violet-light" />
          </div>
          <h2 className="font-syne font-extrabold text-white text-2xl leading-tight mb-2">Your privacy, your choice</h2>
          <p className="text-text-secondary text-sm leading-relaxed mb-5">
            VERGR works great without either of these. Turn them on only if you want to.
            You can change them any time in Settings → Privacy.
          </p>

          <ConsentToggle
            title="Share aggregate demographics"
            body="Creators you follow see anonymized stats — age bucket, country, top games, active hours. Never your name, profile, or exact location."
            value={audienceAnalytics}
            onChange={setAudienceAnalytics}
          />
          <ConsentToggle
            title="Personalized experience & promotions"
            body="We log which posts, creators, games and tags you engage with, and use that to rank your feed and tailor in-app promos (creators, events). No third-party ad networks. Raw logs auto-delete after 90 days."
            value={personalizedAds}
            onChange={setPersonalizedAds}
          />

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={save} disabled={saving}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-violet to-brand-violet text-bg-dark font-extrabold text-sm hover:brightness-110 transition disabled:opacity-50">
              {saving ? 'Saving…' : 'Save my choices'}
            </button>
            <p className="text-[11px] text-text-muted text-center">
              By continuing you acknowledge our <a href="/settings/privacy-policy" className="text-brand-violet-light underline">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsentToggle({ title, body, value, onChange }) {
  return (
    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] mb-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-[12px] text-text-secondary leading-relaxed mt-1">{body}</p>
        </div>
        <button onClick={() => onChange(!value)}
          aria-pressed={value}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5 ${value ? 'bg-brand-violet' : 'bg-white/10'}`}>
          <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow transition-[left] ${value ? 'left-[22px]' : 'left-[2px]'}`} />
        </button>
      </div>
    </div>
  );
}
