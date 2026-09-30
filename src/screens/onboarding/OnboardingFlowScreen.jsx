import { useState, useEffect, useRef, useMemo } from 'react';
import { getBoostedUsers } from '../../firebase/firestore';
import { mergeBoostedFirst } from '../../utils/promoBoost';
import { boostSlotsFor } from '../../utils/boostDelivery';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, limit, query, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { followUser, uploadBanner } from '../../firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { hiddenFromDiscovery } from '../../utils/privacy';
import { CONTENT_TOPICS } from '../../utils/constants';
import { FIRST_BOOT_EVENT } from '../../components/FirstBootIntro';
import AddPhoneModal from '../../components/AddPhoneModal';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { getPendingReferrerId, clearReferral } from '../../utils/referral';

// Setup-first onboarding (rebuilt 2026-07-09; founder-approved). The old
// slide-carousel + interests/profile/follow chain navigated to routes that
// never existed AND dropped every piece of data it collected — see
// docs/handover/15_ONBOARDING_AUTH.md P0. This flow SAVES each step the
// moment it completes and pays the founder-approved VP reward on the spot
// via claimQuestReward (server verifies the data exists; amounts are
// server-locked in functions/index.js PROFILE_QUEST_REWARDS).

const REWARDS = {
  profile_avatar:    { vp: 500,  title: 'Added a profile picture' },
  profile_banner:    { vp: 300,  title: 'Added a profile banner' },
  profile_bio:       { vp: 200,  title: 'Wrote a bio' },
  profile_interests: { vp: 200,  title: 'Picked your interests' },
  first_follow_5:    { vp: 300,  title: 'Followed 5 people' },
};

const INTEREST_ICONS = {
  Gaming: '🎮', Esports: '🏆', 'Just Chatting': '💬', IRL: '🤳', Music: '🎵',
  'Art & Creative': '🎨', Tech: '💻', 'Memes & Comedy': '😂', Sports: '⚽',
  'Anime & Manga': '🌸', 'Movies & TV': '🎬', Lifestyle: '✨',
  'Food & Cooking': '🍜', 'Fitness & Health': '💪', 'Fashion & Beauty': '💄',
  'Science & Education': '🔬', News: '📰', 'Cars & Motors': '🏎️',
  Travel: '✈️', 'Crypto & Finance': '📈',
};

const STEPS = ['yours', 'about', 'people', 'done'];

// 3:1 banner resize (same output shape as EditProfileScreen's banner tab).
async function resizeToBanner(file, targetW = 1500, targetH = 500) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = reject;
    el.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(targetW / img.width, targetH / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}

const isBotLike = (u) => String(u?.accountType || '').toLowerCase().includes('bot');

export default function OnboardingFlowScreen() {
  const { profile, updateProfile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [earnedVp, setEarnedVp] = useState(0);
  const [vpPop, setVpPop] = useState(false);
  const claimedRef = useRef(new Set());

  // ── Step state ──
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const avatarInput = useRef(null);
  const bannerInput = useRef(null);

  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState([]);

  const [suggestions, setSuggestions] = useState([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [followedIds, setFollowedIds] = useState(new Set());

  const [phoneModal, setPhoneModal] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);

  useEffect(() => { if (profile?.bio && !bio) setBio(profile.bio); /* eslint-disable-next-line */ }, [profile?.bio]);

  // ⚠ REFERRAL ATTRIBUTION FOR EVERY SIGNUP PATH, NOT JUST EMAIL. Only the email
  // flow (SignUpStep2) wrote `referredBy`, so anyone who signed up with Google
  // lost their referral, on the web and in the app. Every new account passes
  // through here, so the pending ref (the link, a stashed value, or the Play
  // install referrer) is applied once. The rules make `referredBy` write-once
  // and forbid self-referral, so this can never overwrite an existing one.
  useEffect(() => {
    const u = auth.currentUser;
    if (!u || u.isAnonymous || !profile || profile.referredBy) return;
    const ref = getPendingReferrerId();
    if (!ref || ref === u.uid) return;
    updateDoc(doc(db, 'users', u.uid), { referredBy: ref, referredAt: new Date() })
      .then(() => clearReferral())
      .catch(() => { /* a later visit retries; the ref stays stashed */ });
  }, [profile?.uid, profile?.referredBy]); // eslint-disable-line

  // Fire-and-forget reward claim. Server verifies the data + locks the amount;
  // 'already-exists' just means a previous run claimed it — treat as done.
  const claim = async (questId) => {
    if (claimedRef.current.has(questId)) return;
    claimedRef.current.add(questId);
    const def = REWARDS[questId];
    try {
      await httpsCallable(functions, 'claimQuestReward')({ questId, reward: def.vp, title: def.title });
      setEarnedVp((v) => v + def.vp);
      setVpPop(true); setTimeout(() => setVpPop(false), 600);
      showToast(`+${def.vp} VP — ${def.title}`, 'success');
    } catch (e) {
      const code = String(e?.code || '');
      if (!code.includes('already-exists')) claimedRef.current.delete(questId);
    }
  };

  // ── Step 1: avatar + banner ──
  const onAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    setAvatarUploading(true);
    try {
      const compressed = await compressMedia(file, 'free', 'avatar');
      const { url } = await uploadToR2(compressed, 'avatar');
      await updateProfile({ avatar: url });
      claim('profile_avatar');
    } catch {
      showToast('Avatar upload failed — try another photo', 'error');
    } finally { setAvatarUploading(false); e.target.value = ''; }
  };

  const onBannerFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    setBannerUploading(true);
    try {
      const resized = await resizeToBanner(file);
      const url = await uploadBanner(auth.currentUser.uid, resized);
      await updateProfile({ banner: url });
      claim('profile_banner');
    } catch {
      showToast('Banner upload failed — try another image', 'error');
    } finally { setBannerUploading(false); e.target.value = ''; }
  };

  // ── Step 2: bio + interests (saved on advance) ──
  const saveAbout = async () => {
    const trimmed = bio.trim();
    const patch = {};
    if (trimmed) patch.bio = trimmed;
    if (interests.length > 0) patch.gameTags = interests;
    if (Object.keys(patch).length > 0) {
      try { await updateProfile(patch); } catch { showToast('Could not save — you can finish this in Edit Profile', 'error'); }
    }
    if (trimmed.length >= 20) claim('profile_bio');
    if (interests.length >= 3) claim('profile_interests');
  };

  // ── Step 3: follow suggestions (real follows) ──
  useEffect(() => {
    if (step !== 2 || suggestions.length > 0 || sugLoading) return;
    setSugLoading(true);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), limit(150)));
        const me = auth.currentUser?.uid;
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.id !== me && u.username && !u.isGuest && !u.deleted &&
            u.hideFromEnumeration !== true && !hiddenFromDiscovery(u, 'suggested'));
        const withAvatar = all.filter((u) => u.avatar);
        const pool = withAvatar.length >= 8 ? withAvatar : all;
        const humans = pool.filter((u) => !isBotLike(u));
        const bots = pool.filter(isBotLike);
        const vergr = humans.find((u) => (u.username || '').toLowerCase() === 'vergr');
        const rest = humans.filter((u) => u !== vergr)
          .sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0));
        // ⚠ A brand-new user IS looking for people to follow, so this is the
        // highest-intent slot in the whole product. One boosted profile leads.
        let boosted = [];
        try { boosted = await getBoostedUsers({ viewerUid: me, want: boostSlotsFor(12) }); }
        catch { /* never block onboarding on a boost */ }
        const organic = [...(vergr ? [vergr] : []), ...rest, ...bots];
        setSuggestions(mergeBoostedFirst(boosted, organic, 12));
      } catch { setSuggestions([]); }
      setSugLoading(false);
    })();
  }, [step, suggestions.length, sugLoading]);

  const toggleFollow = async (uid) => {
    const me = auth.currentUser?.uid;
    if (!me || followedIds.has(uid)) return; // v1: follow only (no unfollow churn mid-onboarding)
    setFollowedIds((prev) => new Set([...prev, uid]));
    try { await followUser(me, uid); } catch {
      setFollowedIds((prev) => { const n = new Set(prev); n.delete(uid); return n; });
    }
  };

  useEffect(() => {
    if (followedIds.size >= 5) claim('first_follow_5');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIds.size]);

  // ── Finish ──
  // Completes onboarding, then lands on `target` (default = feed). The "connect
  // a gaming account" booster passes the Linked Accounts screen so the button
  // actually goes where its copy promises (in-flow OAuth is a later step).
  const finish = async (target = '/') => {
    try {
      if (auth.currentUser) await updateDoc(doc(db, 'users', auth.currentUser.uid), { isOnboarded: true });
    } catch {}
    try { localStorage.setItem('vergr.firstBoot.pending', '1'); } catch {}
    window.dispatchEvent(new Event(FIRST_BOOT_EVENT));
    navigate(target, { replace: true });
  };

  const advance = async () => {
    if (step === 1) await saveAbout();
    if (step >= STEPS.length - 1) { finish(); return; }
    setStep((s) => s + 1);
  };

  const stepTitle = ['Make it yours', 'About you', 'Find your people', "You're set"][step];
  const stepSub = [
    'Your profile is the first thing people see. Give it a face.',
    'A line about you and what you are into. This tunes your feed.',
    'Follow a few people so your feed starts alive.',
    earnedVp > 0 ? `You earned ${earnedVp.toLocaleString()} VP setting up.` : 'Your account is ready.',
  ][step];

  return (
    <div className="screen-container min-h-screen relative overflow-hidden flex flex-col items-center p-5">
      {/* Ambient violet vignette (same treatment as Login). */}
      <div aria-hidden="true" className="pointer-events-none absolute" style={{
        left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(1100px, 160vw)', height: 'min(900px, 120vh)',
        background: 'radial-gradient(ellipse at center, rgba(123,31,255,0.22) 0%, rgba(123,31,255,0.14) 22%, rgba(123,31,255,0.07) 45%, rgba(123,31,255,0.03) 62%, transparent 78%)',
        filter: 'blur(20px)', zIndex: 0,
      }} />

      <div className="w-full max-w-[440px] relative z-10 flex flex-col flex-1" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        {/* Header: progress + running VP total + skip */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-brand-violet' : i < step ? 'w-4 bg-brand-violet/50' : 'w-2 bg-surface-3'}`} />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums transition-transform ${vpPop ? 'scale-125' : 'scale-100'}`}
              style={{ background: 'rgba(123,31,255,0.18)', border: '1px solid rgba(180,79,255,0.4)', color: '#B44FFF' }}>
              +{earnedVp.toLocaleString()} VP
            </div>
            {step < STEPS.length - 1 && (
              <button onClick={advance} className="text-text-muted text-sm hover:text-text-secondary">Skip</button>
            )}
          </div>
        </div>

        <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-1">{stepTitle}</h1>
        <p className="text-text-muted text-sm mb-6">{stepSub}</p>

        {/* ── STEP 0: avatar + banner on a LIVE profile-header preview ── */}
        {step === 0 && (
          <div className="flex-1">
            <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-surface-1">
              <input type="file" ref={bannerInput} onChange={onBannerFile} accept="image/*" className="hidden" />
              <input type="file" ref={avatarInput} onChange={onAvatarFile} accept="image/*" className="hidden" />
              <button onClick={() => bannerInput.current?.click()} className="relative block w-full" style={{ aspectRatio: '3 / 1' }}>
                {profile?.banner
                  ? <img src={profile.banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)' }} />}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/25">
                  {bannerUploading
                    ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold text-white" style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.25)' }}>
                        <Icon name="image" size={13} /> {profile?.banner ? 'Change banner' : `Add banner · +${REWARDS.profile_banner.vp} VP`}
                      </span>}
                </div>
              </button>
              <div className="px-4 pb-4">
                <div className="flex items-end justify-between -mt-9">
                  <button onClick={() => avatarInput.current?.click()} className="relative">
                    <div className="rounded-full border-4 border-surface-1" style={{ filter: 'drop-shadow(0 0 9px rgba(138,18,202,0.55))' }}>
                      <UserAvatar src={profile?.avatar} size="xl" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-brand-violet flex items-center justify-center border-2 border-surface-1">
                      {avatarUploading
                        ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        : <Icon name="add_a_photo" size={14} className="text-white" />}
                    </span>
                  </button>
                  {!profile?.avatar && (
                    <span className="text-[11px] font-bold mb-2" style={{ color: '#B44FFF' }}>Add photo · +{REWARDS.profile_avatar.vp} VP</span>
                  )}
                </div>
                <p className="font-syne font-bold text-text-primary text-lg mt-2 leading-tight">{profile?.displayName || 'Your name'}</p>
                <p className="text-text-muted text-xs">@{profile?.username || 'handle'}</p>
              </div>
            </div>
            <p className="text-text-muted text-xs mt-4 leading-relaxed">
              This is exactly how your profile header looks to everyone else. Both uploads pay VP instantly.
            </p>
          </div>
        )}

        {/* ── STEP 1: bio + interests ── */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 pb-4">
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={150}
              placeholder="One line about you. What do you play? What are you grinding?"
              className="w-full bg-surface-2 border border-white/[0.08] rounded-2xl p-4 text-text-primary placeholder:text-text-muted focus:border-brand-violet/60 focus:outline-none transition-all h-24 resize-none text-sm" />
            <div className="flex items-center justify-between mt-1 mb-5">
              <span className="text-[11px] font-bold" style={{ color: bio.trim().length >= 20 ? '#B44FFF' : 'var(--text-muted, #6B7280)' }}>
                {bio.trim().length >= 20 ? `Bio ready · +${REWARDS.profile_bio.vp} VP` : `${Math.max(0, 20 - bio.trim().length)} more characters for +${REWARDS.profile_bio.vp} VP`}
              </span>
              <span className="text-text-muted text-xs">{bio.length}/150</span>
            </div>

            <div className="flex items-center justify-between mb-3">
              <p className="text-text-secondary text-sm font-semibold">What do you play?</p>
              <span className="text-[11px] font-bold" style={{ color: interests.length >= 3 ? '#B44FFF' : '#6B7280' }}>
                {interests.length >= 3 ? `+${REWARDS.profile_interests.vp} VP` : `pick ${Math.max(0, 3 - interests.length)} more · +${REWARDS.profile_interests.vp} VP`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {CONTENT_TOPICS.map((interest) => {
                const on = interests.includes(interest);
                return (
                  <button key={interest}
                    onClick={() => setInterests((p) => on ? p.filter((i) => i !== interest) : [...p, interest])}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border transition-all duration-200 ${
                      on ? 'border-brand-violet bg-brand-violet/15 shadow-[0_0_12px_rgba(123,31,255,0.25)]'
                         : 'border-white/[0.07] bg-surface-2 hover:border-white/20'
                    }`}>
                    {/* Neutral fallback. A game controller as the default icon
                        made any topic without an explicit emoji read as a gaming
                        topic, which is exactly backwards now that gaming is one
                        category of twenty. */}
                    <span className="text-lg">{INTEREST_ICONS[interest] || '✨'}</span>
                    <span className={`text-[13px] font-medium ${on ? 'text-brand-violet-light' : 'text-text-primary'}`}>{interest}</span>
                    {on && <Icon name="check_circle" filled size={15} className="text-brand-violet-light ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 2: follow suggestions (REAL follows) ── */}
        {step === 2 && (
          <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 pb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-text-secondary text-sm font-semibold">Suggested for you</p>
              <span className="text-[11px] font-bold" style={{ color: followedIds.size >= 5 ? '#B44FFF' : '#6B7280' }}>
                {followedIds.size >= 5 ? `+${REWARDS.first_follow_5.vp} VP earned` : `follow ${Math.max(0, 5 - followedIds.size)} more · +${REWARDS.first_follow_5.vp} VP`}
              </span>
            </div>
            {sugLoading ? (
              <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand-violet border-t-transparent rounded-full animate-spin" /></div>
            ) : suggestions.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-10">No suggestions right now. Find people in Explore.</p>
            ) : (
              <div className="space-y-2.5">
                {suggestions.map((u) => {
                  const on = followedIds.has(u.id);
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-2xl border border-white/[0.07] bg-surface-1">
                      <UserAvatar src={u.avatar} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate">{u.displayName || u.username}</p>
                        <p className="text-text-muted text-xs truncate">@{u.username}{u.followerCount ? ` · ${u.followerCount.toLocaleString()} followers` : ''}</p>
                      </div>
                      <button onClick={() => toggleFollow(u.id)} disabled={on}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                          on ? 'bg-surface-2 border border-white/[0.08] text-text-secondary'
                             : 'text-white bg-gradient-to-r from-brand-violet to-brand-pink hover:brightness-110 active:scale-95'
                        }`}>
                        {on ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: done + boosters ── */}
        {step === 3 && (
          <div className="flex-1">
            <div className="rounded-2xl border border-white/[0.08] bg-surface-1 p-5 mb-4 text-center">
              <div className="text-4xl font-syne font-extrabold tabular-nums" style={{ color: '#B44FFF' }}>+{earnedVp.toLocaleString()} VP</div>
              <p className="text-text-muted text-xs mt-1">VP raises your rank and unlocks badges across 100 levels.</p>
            </div>
            <p className="text-text-secondary text-sm font-semibold mb-2.5">Boosters (more VP, optional)</p>
            <div className="space-y-2.5">
              {phoneSaved ? (
                <div className="flex items-center gap-2 rounded-2xl px-4 py-3 border" style={{ background: 'rgba(123,31,255,0.10)', borderColor: 'rgba(180,79,255,0.4)' }}>
                  <Icon name="check_circle" size={18} className="text-brand-violet-light" />
                  <p className="text-sm font-bold text-brand-violet-light">Phone saved — +1000 VP added.</p>
                </div>
              ) : (
                <button onClick={() => setPhoneModal(true)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-2 border border-white/[0.07] hover:border-brand-violet/40 transition-all">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(123,31,255,0.15)', color: '#B44FFF' }}>
                    <Icon name="phone" size={18} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-bold text-white">Add phone number</p>
                    <p className="text-[11px] text-text-muted">Unlocks contact invites · +1000 VP</p>
                  </div>
                  <Icon name="chevron_right" size={20} className="text-text-muted" />
                </button>
              )}
              <button onClick={() => finish('/settings/linked-accounts')}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-2 border border-white/[0.07] hover:border-brand-violet/40 transition-all"
                title="Finish setup and open Linked accounts">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(123,31,255,0.15)', color: '#B44FFF' }}>
                  <Icon name="stadia_controller" size={18} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-white">Connect Twitch, Discord or Steam</p>
                  <p className="text-[11px] text-text-muted">Opens Linked accounts · +{500} VP on your first link</p>
                </div>
                <Icon name="chevron_right" size={20} className="text-text-muted" />
              </button>
            </div>
          </div>
        )}

        {phoneModal && (
          <AddPhoneModal rewardAmount={1000}
            onClose={() => setPhoneModal(false)}
            onSaved={() => { setPhoneModal(false); setPhoneSaved(true); setEarnedVp((v) => v + 1000); }} />
        )}

        <div className="py-5">
          <button onClick={advance} className="btn-primary w-full">
            {step === STEPS.length - 1 ? 'Enter Vergr' : 'Continue'}
            {step < STEPS.length - 1 && <Icon name="arrow_forward" size={18} className="ml-2" />}
          </button>
        </div>
      </div>
    </div>
  );
}
