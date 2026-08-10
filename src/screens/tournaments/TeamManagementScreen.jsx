import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser, addPlayerToRoster, searchUsers } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function TeamManagementScreen() {
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
      const snap = await getDoc(doc(db, 'teams', teamId));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        setTeam(data);
        const players = await Promise.all((data.roster||[]).map(id => getUser(id)));
        setRoster(players.filter(Boolean));
      }
      setLoading(false);
    };
    load();
  }, [teamId]);

  if (loading) return <div className={isDesktop ? "min-h-screen" : "screen-container min-h-screen"}><TopBar showBack title="Team" /><div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div></div>;

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar showBack title="Manage Team" />
      <div className="px-4 py-4">
        {team && (
          <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] mb-4">
            <h2 className="font-bold text-lg">{team.name} [{team.tag}]</h2>
            <p className="text-text-muted text-xs">{team.game} · {team.region}</p>
          </div>
        )}
        <h3 className="font-syne font-bold text-base mb-3">Roster ({roster.length})</h3>
        <div className="space-y-2">
          {roster.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <UserAvatar src={p.avatar} size="md" />
              <div className="flex-1"><p className="text-sm font-semibold">{p.displayName||p.username}</p><p className="text-xs text-text-muted">@{p.username}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
