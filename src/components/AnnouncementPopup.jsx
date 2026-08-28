// The entrance popup: one campaign, once per user, ever.
//
// Founder decision D6: it fires per announcement, once, on app entrance. No
// recurrence, no fatigue timer.
//
// Two rules that matter more than the visuals:
//
// 1. It must never FLASH. The localStorage check is synchronous and runs before
//    anything renders, so a popup the user already dismissed on this device is
//    never painted at all (reference-first-frame-needs-sync-data). The Firestore
//    read is the cross-device truth and arrives after.
//
// 2. It must never interrupt something that matters. A popup over a live stream,
//    an active call or a checkout is worse than no popup, so it holds until the
//    user is somewhere ordinary.

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase/config';
import { useUser } from '../context/UserContext';
import Icon from './Icon';
import {
  subscribeCampaigns, alreadySeen, recordCampaignEvent, seenLocally,
} from '../firebase/campaigns';

// Routes where an announcement would be an interruption rather than a message.
const SUPPRESS_ON = [
  '/watch/', '/broadcast/', '/stream/', '/call/', '/go-live',
  '/wallet/buy', '/checkout', '/overlay/',
];

export default function AnnouncementPopup() {
  const { profile } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const me = auth.currentUser?.uid;
  const [campaign, setCampaign] = useState(null);
  const [closing, setClosing] = useState(false);

  const suppressed = SUPPRESS_ON.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (!me || suppressed) return undefined;
    let alive = true;
    const unsub = subscribeCampaigns('popup', profile, async (rows) => {
      if (!alive || !rows.length) return;
      // Newest first; the first one this user has not already engaged with wins.
      for (const c of rows) {
        if (seenLocally(c.campaignId)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await alreadySeen(c.campaignId, me)) continue;
        if (!alive) return;
        setCampaign(c);
        recordCampaignEvent(c.campaignId, 'impression');
        return;
      }
    });
    return () => { alive = false; unsub(); };
  }, [me, profile, suppressed]);

  if (!campaign || suppressed) return null;

  const close = (event) => {
    recordCampaignEvent(campaign.campaignId, event);
    setClosing(true);
    setTimeout(() => setCampaign(null), 160);
  };

  const act = () => {
    const url = campaign.ctaUrl;
    recordCampaignEvent(campaign.campaignId, 'click');
    setCampaign(null);
    if (!url) return;
    if (url.startsWith('/')) navigate(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-5"
      style={{
        background: 'rgba(4,4,10,0.72)',
        backdropFilter: 'blur(6px)',
        opacity: closing ? 0 : 1,
        transition: 'opacity .16s ease',
      }}
      onClick={() => close('dismiss')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] rounded-2xl overflow-hidden border border-white/10"
        style={{
          background: 'linear-gradient(180deg,#171725,#101019)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          transform: closing ? 'scale(0.97)' : 'scale(1)',
          transition: 'transform .16s ease',
        }}
      >
        {campaign.imageUrl && (
          <img src={campaign.imageUrl} alt="" className="w-full max-h-52 object-cover" />
        )}
        {campaign.videoUrl && !campaign.imageUrl && (
          <video
            src={campaign.videoUrl}
            poster={campaign.videoPosterUrl || undefined}
            autoPlay muted loop playsInline
            className="w-full max-h-52 object-cover bg-black"
          />
        )}

        <div className="p-5">
          {campaign.heading && (
            <h2 className="font-syne font-bold text-white text-[19px] leading-snug mb-2">
              {campaign.heading}
            </h2>
          )}
          {campaign.body && (
            <p className="text-text-secondary text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {campaign.body}
            </p>
          )}

          <div className="flex flex-col gap-2 mt-5">
            {campaign.ctaLabel && campaign.ctaUrl && (
              <button
                onClick={act}
                className="w-full py-3 rounded-xl bg-brand-violet text-white font-bold text-sm"
              >
                {campaign.ctaLabel}
              </button>
            )}
            <button
              onClick={() => close('dismiss')}
              className="w-full py-2.5 rounded-xl text-text-secondary font-semibold text-[13px] hover:text-white"
            >
              {campaign.ctaLabel ? 'Not now' : 'Got it'}
            </button>
          </div>
        </div>

        <button
          onClick={() => close('dismiss')}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/80"
          style={{ background: 'rgba(0,0,0,0.45)', position: 'absolute' }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
