// SquadInfoRail — the shared right rail for every squad-mode screen.
// Squad Info card · Members list · Squad Treasury.  Render as the `rightRail`
// prop of <SquadShell mode="squad" ...>.

import { useEffect, useState } from 'react';
import CachedImg from '../CachedImg';
import { useNavigate } from 'react-router-dom';
import { getSquadWallet } from '../../firebase/firestore';
import { roleMeta, avatarClass, initials, compact, nameOf } from './squadHelpers';
import { presenceVisible } from '../../utils/presence';
import usePresenceMap from '../../hooks/usePresenceMap';
import { applyVanguardMask } from '../../utils/vanguard';
import { useUser } from '../../context/UserContext';
import VanguardBadge from '../VanguardBadge';

export default function SquadInfoRail({ squad, members = [] }) {
  const navigate = useNavigate();
  const { profile: viewer } = useUser();
  const [wallet, setWallet] = useState(null);
  const squadId = squad?.id;

  useEffect(() => {
    let alive = true;
    if (!squadId) return;
    getSquadWallet(squadId).then(w => { if (alive) setWallet(w); }).catch(() => {});
    return () => { alive = false; };
  }, [squadId]);

  // Presence reads live from RTDB (`/status/{uid}`) for every member, then
  // honours each member's `privacy.onlineStatus` opt-out via presenceVisible.
  const presMap = usePresenceMap(members.map(m => m.id));
  const isMemberOnline = (m) => presenceVisible(m.user) && !!presMap[m.id];
  const onlineCount = members.filter(isMemberOnline).length;
  const memberCount = squad?.memberCount ?? members.length;
  const level = squad?.level || 1;
  const xp = squad?.xp || 0;
  const xpNext = squad?.xpNext || level * 500;
  const xpPct = Math.min(100, Math.round((xp / xpNext) * 100));

  return (
    <aside className="rail-r">
      {/* Squad Info */}
      <div className="rcard r-squad">
        <div className="rcard-header" style={{ justifyContent: 'center' }}>Squad Info</div>
        <div className="r-squad-av">
          {squad?.avatar ? <CachedImg src={squad.avatar} permanent alt="" /> : initials(squad?.name)}
        </div>
        <div className="r-squad-name">
          {squad?.name || 'Squad'}
          {squad?.verified && <span className="material-symbols-outlined">verified</span>}
        </div>
        <div className="r-squad-tags">
          <span>{squad?.game || 'Gaming'}</span>
          <span className="pip" />
          <span style={{ color: squad?.isPublic === false ? 'var(--t2)' : 'var(--ember)' }}>
            {squad?.isPublic === false ? 'Private' : 'Public'}
          </span>
        </div>
        <div className="r-squad-id">{memberCount} Members · ID {squadId?.slice(0, 6).toUpperCase()}</div>

        <div className="r-level">
          <div className="r-level-row">
            <span>Level {level}</span>
            <span className="v mono">{compact(xp)} / {compact(xpNext)} XP</span>
          </div>
          <div className="r-level-bar"><div style={{ width: `${xpPct}%` }} /></div>
        </div>
      </div>

      {/* Members */}
      <div className="rcard">
        <div className="rcard-header">
          <span>Members — {memberCount}</span>
          {onlineCount > 0 && <span className="cyan">{onlineCount} online</span>}
        </div>
        <div className="r-mem-list">
          {members.map(m => {
            const meta = roleMeta(m.role);
            const online = isMemberOnline(m);
            return (
              <div
                key={m.id}
                className="r-mem-row"
                onClick={() => navigate(`/user/${m.id}`)}
              >
                {(() => {
                  const masked = applyVanguardMask(m.user, viewer);
                  const vRank = m.user?.vanguard?.rank;
                  return (
                    <>
                      <div className={`r-mem-av ${avatarClass(m.id)}`}>
                        {masked?.avatar
                          ? <CachedImg src={masked.avatar} permanent alt="" />
                          : initials(masked.displayName || nameOf(m.user))}
                        {online && <span className="status on" />}
                      </div>
                      <div className="r-mem-name" style={!online ? { color: 'var(--t3)' } : undefined}>
                        {masked.displayName || nameOf(m.user)}
                      </div>
                      {vRank && <VanguardBadge rank={vRank} size={13} />}
                      <span className={`r-mem-role ${meta.mem}`}>{meta.label}</span>
                    </>
                  );
                })()}
              </div>
            );
          })}
          {members.length === 0 && (
            <div style={{ color: 'var(--t3)', fontSize: 12, padding: '8px 6px' }}>No members yet.</div>
          )}
        </div>
        <button className="invite-btn" onClick={() => navigate(`/squads/${squadId}/invite`)}>
          <span className="material-symbols-outlined">person_add</span>Invite Members
        </button>
      </div>

      {/* Treasury */}
      <div className="rcard">
        <div className="rcard-header"><span>Squad Treasury</span></div>
        <div className="r-trez-row">
          <div className="r-trez-cell gold">
            <span className="coin-ic" /><span className="v">{compact(wallet?.balance || 0)}</span>
          </div>
          <div className="r-trez-cell violet">
            <span className="gem-ic" /><span className="v">{compact(wallet?.vp || wallet?.totalWon || 0)}</span>
          </div>
        </div>
        <button className="r-trez-cta" onClick={() => navigate(`/squads/${squadId}/treasury`)}>
          View Treasury
        </button>
      </div>
    </aside>
  );
}
