import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { getOneTimeQuestClaims } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';

// "Complete your profile" checklist (own profile only). Pays the
// founder-approved profile-completion VP (server-verified + server-locked in
// claimQuestReward) and gives every existing empty account a reason to stop
// being empty. Claim state is remembered locally after a successful (or
// already-claimed) response so we never burn reads polling quest_claims.

// The six one-time profile quests, matching PROFILE_QUEST_REWARDS in
// functions/index.js. Their claim docs are `${uid}_${id}` with no date.
const PROFILE_QUEST_IDS = [
  'profile_avatar', 'profile_banner', 'profile_bio',
  'profile_interests', 'first_follow_5', 'profile_gaming_link',
];

const CLAIMS_KEY = 'vergr_profile_claims_v1';
const readClaims = () => { try { return JSON.parse(localStorage.getItem(CLAIMS_KEY)) || {}; } catch { return {}; } };
const markClaim = (id) => { try { localStorage.setItem(CLAIMS_KEY, JSON.stringify({ ...readClaims(), [id]: 1 })); } catch {} };

export default function ProfileCompletionCard() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [claims, setClaims] = useState(readClaims);
  const [busy, setBusy] = useState(null);
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem('vergr_pcc_hide') === '1'; } catch { return false; } });

  // Claim state comes from the SERVER. localStorage stays only as a first-paint
  // cache so the card does not flash; `quest_claims` is the truth. Without this
  // the card asked a user to claim VP they were granted months ago, on any new
  // device or after clearing site data (audit A11).
  useEffect(() => {
    const uid = profile?.uid || profile?.id;
    if (!uid) return undefined;
    let alive = true;
    getOneTimeQuestClaims(uid, PROFILE_QUEST_IDS)
      .then((claimed) => {
        if (!alive || !claimed.length) return;
        claimed.forEach(markClaim);
        setClaims(readClaims());
      })
      .catch(() => { /* offline: the localStorage cache still applies */ });
    return () => { alive = false; };
  }, [profile?.uid, profile?.id]);

  const items = useMemo(() => {
    if (!profile) return [];
    return [
      { id: 'profile_avatar', label: 'Profile picture', vp: 500, done: !!profile.avatar, cta: () => navigate('/edit-profile') },
      { id: 'profile_banner', label: 'Profile banner', vp: 300, done: !!profile.banner, cta: () => navigate('/edit-profile') },
      { id: 'profile_bio', label: 'Bio (20+ characters)', vp: 200, done: String(profile.bio || '').trim().length >= 20, cta: () => navigate('/edit-profile') },
      { id: 'profile_interests', label: 'Pick 3+ interests', vp: 200, done: (profile.gameTags || []).length >= 3, cta: () => navigate('/edit-profile') },
      { id: 'first_follow_5', label: 'Follow 5 gamers', vp: 300, done: (profile.followingCount || 0) >= 5, cta: () => navigate('/explore') },
      { id: 'profile_gaming_link', label: 'Connect a gaming account', vp: 500, done: !!(profile.linkedAccounts && Object.keys(profile.linkedAccounts).length > 0), cta: () => navigate('/settings/linked-accounts') },
    ];
  }, [profile, navigate]);

  const remaining = items.filter((i) => !i.done || !claims[i.id]);
  if (!profile || dismissed || remaining.length === 0) return null;

  // THE RING MEASURES COMPLETENESS, not "buttons pressed in this browser".
  // It used to derive from `remaining`, which folds in the claim state, so a
  // profile with a picture and a banner both ticked showed 0% — the ticks come
  // from `i.done` (real profile data) while the ring came from localStorage
  // (empty on a new device). The heading says "Complete your profile", so it
  // follows `i.done`. Unclaimed VP is already communicated by the Claim buttons
  // and the "VP left" line (audit A11).
  const completed = items.filter((i) => i.done).length;
  const pct = Math.round((completed / items.length) * 100);

  const claim = async (item) => {
    if (busy) return;
    setBusy(item.id);
    try {
      await httpsCallable(functions, 'claimQuestReward')({ questId: item.id, reward: item.vp, title: item.label });
      markClaim(item.id); setClaims(readClaims());
      showToast(`+${item.vp} VP — ${item.label}`, 'success');
    } catch (e) {
      const code = String(e?.code || '');
      // Do not swallow this. The row silently vanished and a user who had just
      // pressed a button offering 500 VP was told nothing at all (audit A11).
      if (code.includes('already-exists')) {
        markClaim(item.id); setClaims(readClaims());
        showToast(`Already added to your VP — ${item.label}`, 'info');
      }
      else showToast(e?.message || 'Could not claim yet', 'error');
    }
    setBusy(null);
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface-1 p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        {/* Completion ring */}
        <div className="relative w-11 h-11 shrink-0">
          <svg viewBox="0 0 40 40" className="w-11 h-11 -rotate-90">
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
            <circle cx="20" cy="20" r="16" fill="none" stroke="#B44FFF" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 100.5} 100.5`} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-text-primary">{pct}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-syne font-bold text-sm text-text-primary">Complete your profile</p>
          <p className="text-[11px] text-text-muted">Earn VP for each step — {remaining.reduce((s, i) => s + (i.done && claims[i.id] ? 0 : i.vp), 0).toLocaleString()} VP left</p>
        </div>
        <button onClick={() => { setDismissed(true); try { sessionStorage.setItem('vergr_pcc_hide', '1'); } catch {} }}
          className="text-text-muted hover:text-white shrink-0" title="Hide for now">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="space-y-1.5">
        {remaining.slice(0, 4).map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 py-1">
            <Icon name={item.done ? 'check_circle' : 'radio_button_unchecked'} size={16}
              className={item.done ? 'text-brand-violet-light' : 'text-text-muted/50'} />
            <span className="flex-1 text-[13px] text-text-secondary truncate">{item.label}</span>
            {item.done ? (
              <button onClick={() => claim(item)} disabled={busy === item.id}
                className="px-3 py-1 rounded-full text-[11px] font-bold text-white bg-gradient-to-r from-brand-violet to-brand-pink hover:brightness-110 active:scale-95 disabled:opacity-50">
                {busy === item.id ? '…' : `Claim +${item.vp} VP`}
              </button>
            ) : (
              <button onClick={item.cta}
                className="px-3 py-1 rounded-full text-[11px] font-bold text-brand-violet-light border border-brand-violet/40 hover:bg-brand-violet/10">
                +{item.vp} VP
              </button>
            )}
          </div>
        ))}
        {remaining.length > 4 && (
          <p className="text-[11px] text-text-muted pl-6">+{remaining.length - 4} more in Earn → Special</p>
        )}
      </div>
    </div>
  );
}
