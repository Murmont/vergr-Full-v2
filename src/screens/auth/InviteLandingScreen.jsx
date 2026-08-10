// Invite landing — what a person sees after tapping a friend's referral link
// (vergr.app/reflink?ref=<uid>). The ref is already stashed in localStorage by
// captureReferral() at router module-load; this screen adds the missing
// "you were invited" moment: the friend's name + avatar, the reward, a one-line
// pitch, and a single Create-account CTA. Replaces the old bare redirect that
// dumped invited visitors onto the generic marketing page with zero context.
//
// Public route (works logged-out). A logged-in member who lands here is just
// sent into the app.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import { VPIcon } from '../../components/CoinIcon';
import { REFERRAL_VP_REFEREE } from '../../utils/vpSystem';

const PERKS = [
  { icon: 'emoji_events', title: 'Compete for real prizes', body: 'Join or host tournaments across your favourite games.' },
  { icon: 'live_tv',      title: 'Stream in high quality',   body: 'Go live, get tipped, and grow an audience.' },
  { icon: 'groups',       title: 'Build your squad',         body: 'Team up, chat, and climb the ranks together.' },
];

export default function InviteLandingScreen() {
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const ref = params.get('ref');

  const [inviter, setInviter] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Already a member → straight into the app.
  useEffect(() => {
    if (!authLoading && currentUser) navigate('/', { replace: true });
  }, [authLoading, currentUser, navigate]);

  // Personalise with the referrer's public profile (users/{uid} is world-read).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!ref || !/^[A-Za-z0-9_-]{6,64}$/.test(ref)) { setLoaded(true); return; }
      try {
        const snap = await getDoc(doc(db, 'users', ref));
        if (!alive) return;
        if (snap.exists()) {
          const u = snap.data();
          setInviter({
            name: u.displayName || u.username || 'A friend',
            username: u.username || null,
            avatar: u.photoURL || u.avatar || null,
          });
        }
      } catch { /* fall back to the generic invite */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [ref]);

  const goSignup = () => navigate('/signup');
  const goLogin = () => navigate('/login');

  const name = inviter?.name || 'A friend';

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center px-5 py-10 relative overflow-hidden"
      style={{ background: 'radial-gradient(120% 80% at 50% -10%, #1B1030 0%, #0B0B14 60%)' }}>
      {/* ambient glow */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[28rem] h-[28rem] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(157,78,255,0.28) 0%, rgba(123,31,255,0.08) 45%, transparent 70%)' }} />

      <div className="relative w-full max-w-md flex flex-col items-center text-center">
        <img src="/brand/logo.png" alt="VERGR" className="h-9 mb-8 opacity-95" />

        {/* Inviter avatar + name (social proof). Falls back to a generic
            invite when there is no valid ref. */}
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full blur-xl" style={{ background: 'rgba(138,18,202,0.45)' }} />
          {inviter?.avatar ? (
            <img src={inviter.avatar} alt={name}
              className="relative w-20 h-20 rounded-full object-cover border-2 border-brand-violet-light/60" />
          ) : (
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center border-2 border-brand-violet-light/60"
              style={{ background: 'linear-gradient(160deg, #7B1FFF, #C87FFF)' }}>
              <Icon name="person" size={34} className="text-white" />
            </div>
          )}
          <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-surface-1 border border-white/10 flex items-center justify-center">
            <Icon name="group_add" size={16} className="text-brand-violet-light" />
          </div>
        </div>

        <h1 className="font-syne text-[26px] leading-tight font-black text-white mb-2">
          {loaded ? (
            <>
              {name} invited you<br />to <span className="text-brand-violet-light">VERGR</span>
            </>
          ) : (
            <span className="opacity-0">Loading</span>
          )}
        </h1>
        <p className="text-text-secondary text-[14px] leading-relaxed mb-5 max-w-xs">
          The home for competitive gamers: tournaments, live streaming, squads, and rewards.
        </p>

        {/* Reward chip — honest: both sides earn VP after setup. */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-7"
          style={{ background: 'rgba(157,78,255,0.14)', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.4)' }}>
          <VPIcon size={20} />
          <span className="text-[13px] font-bold text-brand-violet-light">
            Sign up and you both earn {REFERRAL_VP_REFEREE.toLocaleString()} VP
          </span>
        </div>

        {/* Value props */}
        <div className="w-full space-y-3 mb-8 text-left">
          {PERKS.map((p) => (
            <div key={p.title} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(160deg, rgba(157,78,255,0.25), rgba(200,127,255,0.12))', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.28)' }}>
                <Icon name={p.icon} size={19} className="text-brand-violet-light" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-white leading-tight">{p.title}</p>
                <p className="text-[12.5px] text-text-muted leading-snug">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button onClick={goSignup}
          className="w-full py-4 rounded-2xl font-syne font-extrabold text-[16px] text-white mb-3 active:scale-[0.98] transition-transform"
          style={{ background: 'linear-gradient(135deg, #7B1FFF 0%, #B44FFF 55%, #C87FFF 100%)', boxShadow: '0 8px 28px rgba(123,31,255,0.45), inset 0 1px 0 rgba(255,255,255,0.25)' }}>
          Create your free account
        </button>
        <button onClick={goLogin} className="w-full py-2.5 text-[13.5px] font-semibold text-text-secondary hover:text-white transition-colors">
          I already have an account
        </button>

        <p className="text-text-muted/60 text-[11px] mt-6 max-w-xs">
          Free to join. VP unlocks once you verify a phone number.
        </p>
      </div>
    </div>
  );
}
