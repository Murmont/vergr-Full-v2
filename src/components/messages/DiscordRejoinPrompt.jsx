// Auto-rejoin net (14_GROWTH_MIGRATION §3.3): every cloned Discord server is a
// standing net that catches its members whenever they arrive on Vergr. When a
// user has Discord linked, ask the backend which cloned communities they were
// a member of (bot verifies via the guild member API, negatives cached
// server-side per day) and offer one-tap rejoin — which also reattaches their
// imported message history to their account.
//
// Self-gating: renders nothing unless there are offers. Mount it on the
// messages inboxes; pass `force` right after a fresh Discord link.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { checkDiscordRejoin, claimDiscordRejoin } from '../../firebase/firestore';

const THROTTLE_KEY = 'vergr_discord_rejoin_at';
const DISMISS_KEY = 'vergr_discord_rejoin_dismissed';
const DAY = 24 * 3600 * 1000;

export default function DiscordRejoinPrompt({ force = false }) {
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [offers, setOffers] = useState([]);
  const [claiming, setClaiming] = useState('');
  const [joinedGuilds, setJoinedGuilds] = useState(new Set());

  const discordId = profile?.linkedAccounts?.discord?.id;

  useEffect(() => {
    if (!discordId) return;
    // Client throttle mirrors the server's daily cache — don't even call the
    // CF more than daily unless a fresh link forces it.
    const last = Number(localStorage.getItem(THROTTLE_KEY) || 0);
    if (!force && Date.now() - last < DAY) return;
    let cancelled = false;
    checkDiscordRejoin(force).then((res) => {
      localStorage.setItem(THROTTLE_KEY, String(Date.now()));
      if (cancelled) return;
      const dismissed = new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
      setOffers((res?.offers || []).filter((o) => !dismissed.has(o.guildId)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [discordId, force]);

  if (!offers.length) return null;

  const dismiss = (guildId) => {
    const dismissed = new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
    dismissed.add(guildId);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(dismissed)));
    setOffers((prev) => prev.filter((o) => o.guildId !== guildId));
  };

  const join = async (offer) => {
    setClaiming(offer.guildId);
    try {
      const res = await claimDiscordRejoin(offer.guildId);
      setJoinedGuilds((prev) => new Set(prev).add(offer.guildId));
      showToast(`Joined ${res?.joined || offer.groups.length} group${(res?.joined || offer.groups.length) === 1 ? '' : 's'} — your Discord messages are being reattached`, 'success');
      setTimeout(() => setOffers((prev) => prev.filter((o) => o.guildId !== offer.guildId)), 1500);
      if (offer.groups[0]) navigate(`/messages/${offer.groups[0].id}`);
    } catch (err) {
      showToast(err?.message === 'not_a_member' ? 'Discord says you\'re not in that server anymore' : (err?.message || 'Join failed'), 'error');
    } finally { setClaiming(''); }
  };

  return (
    <div className="mx-3 my-2 space-y-2">
      {offers.map((o) => (
        <div key={o.guildId} className="rounded-2xl border border-[#5865F2]/35 bg-[#5865F2]/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-[#5865F2]/20 flex items-center justify-center">
              <Icon name="forum" size={19} className="text-[#A8B0FF]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold leading-snug">
                You were in {o.guildName} on Discord
              </p>
              <p className="text-text-secondary text-[11px] leading-relaxed">
                Its community is here — join {o.groups.length} group{o.groups.length === 1 ? '' : 's'} in one tap.
                Your imported messages come with you.
              </p>
            </div>
            <button onClick={() => dismiss(o.guildId)} aria-label="Dismiss" className="text-text-muted hover:text-text-primary shrink-0">
              <Icon name="close" size={17} />
            </button>
          </div>
          <button onClick={() => join(o)} disabled={!!claiming || joinedGuilds.has(o.guildId)}
            className="mt-2.5 w-full py-2 rounded-xl bg-[#5865F2] text-white text-xs font-bold hover:brightness-110 disabled:opacity-60">
            {joinedGuilds.has(o.guildId) ? 'Joined ✓' : claiming === o.guildId ? 'Joining…' : 'Join the community'}
          </button>
        </div>
      ))}
    </div>
  );
}
