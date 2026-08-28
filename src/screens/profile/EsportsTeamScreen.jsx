import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import UserName from '../../components/UserName';

export default function EsportsTeamScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { teamId } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'teams', teamId));
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() };
          setTeam(data);
          if (data.roster) {
            const players = await Promise.all(data.roster.map(id => getUser(id)));
            setRoster(players.filter(Boolean));
          }
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [teamId]);

  if (loading) return <div className={isDesktop ? "min-h-screen" : "screen-container min-h-screen"}><TopBar showBack title="Team" /><div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet-light rounded-full animate-spin" /></div></div>;
  if (!team) return <div className={isDesktop ? "min-h-screen" : "screen-container min-h-screen"}><TopBar showBack title="Team" /><div className="text-center py-20"><p className="text-text-muted">Team not found</p></div></div>;

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar showBack title={team.name} />
      <div className="px-4 py-4">
        <div className="p-5 rounded-2xl bg-surface-1 border border-white/[0.06] mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-brand-violet-light flex items-center justify-center text-2xl font-black text-white">{team.tag || '?'}</div>
            <div>
              <h2 className="font-syne text-xl font-bold">{team.name}</h2>
              <p className="text-text-muted text-xs">{team.game} · {team.region}</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div><p className="text-[10px] text-text-muted uppercase">Wins</p><p className="font-dmmono font-bold text-green-500">{team.wins || 0}</p></div>
            <div><p className="text-[10px] text-text-muted uppercase">Losses</p><p className="font-dmmono font-bold text-brand-ember">{team.losses || 0}</p></div>
            <div><p className="text-[10px] text-text-muted uppercase">Team XP</p><p className="font-dmmono font-bold text-brand-violet-light">{team.teamXP || 0}</p></div>
          </div>
        </div>

        <h3 className="font-syne font-bold text-base mb-3">Roster ({roster.length})</h3>
        <div className="space-y-2">
          {roster.map(player => (
            <button key={player.id} onClick={() => navigate(`/user/${player.id}`)} className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left">
              <UserAvatar src={player.avatar} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate"><UserName user={player} masked /></p>
                <p className="text-xs text-text-muted"><UserName user={player} masked handle /></p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
