import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { SquadChampionVoteEntry } from '../../components/tournament/SquadChampionVote';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getSquadMembers, getSquadWallet, getSquadAnnouncements, leaveSquad, joinSquad, submitJoinRequest, getSquadTreasuryInflows, getSquadRivalries, getSquad } from '../../firebase/firestore';
import { SQUAD_ROLES } from '../../utils/constants';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import Modal from '../../components/Modal';
import useResponsive from '../../hooks/useResponsive';

export default function SquadDetailScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();

  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [wallet, setWallet] = useState({ balance: 0 });
  const [inflows, setInflows] = useState([]); // MP3 treasury line-items
  const [rivals, setRivals] = useState([]); // GR3 squad-vs-squad rivalries
  const [announcements, setAnnouncements] = useState([]);
  const [pendingTournaments, setPendingTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showJoinRequestModal, setShowJoinRequestModal] = useState(false);
  const [joinRequestMessage, setJoinRequestMessage] = useState('');

  useEffect(() => {
    if (!squadId) return;
    const unsub = onSnapshot(doc(db, 'squads', squadId), (snap) => {
      if (snap.exists()) setSquad({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [squadId]);

  // Active squad-tournament entries where champions aren't locked yet.
  // First query prints index deep-link in function logs — click + confirm.
  useEffect(() => {
    if (!squadId) return;
    try {
      const q = query(
        collection(db, 'tournaments'),
        where('mode', '==', 'squad'),
        where('participants', 'array-contains', squadId),
        where('status', 'in', ['open', 'in_progress']),
        limit(10),
      );
      return onSnapshot(q, (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          // Hide tournaments where champions are already finalized for this squad.
          .filter((t) => !(t.squadChampions?.[squadId]?.length > 0));
        setPendingTournaments(rows);
      }, (err) => console.warn('pending tournaments sub error', err?.message));
    } catch (e) { console.warn(e); }
  }, [squadId]);

  useEffect(() => {
    if (!squadId || !currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        const [mems, w, anns, flows] = await Promise.all([
          getSquadMembers(squadId),
          getSquadWallet(squadId),
          getSquadAnnouncements(squadId, 3),
          getSquadTreasuryInflows(squadId, 6).catch(() => []),
        ]);
        setMembers(mems);
        setWallet(w);
        setAnnouncements(anns);
        setInflows(flows);
        const me = mems.find(m => m.id === currentUser.uid);
        setMyRole(me?.role || null);
        // GR3 — resolve squad rivalries (opponent name/tag) in the background.
        getSquadRivalries(squadId).then(async (rs) => {
          const resolved = await Promise.all(rs.slice(0, 8).map(async (r) => {
            const sq = await getSquad(r.squadId).catch(() => null);
            return { ...r, name: sq?.name || 'Unknown squad', tag: sq?.tag || null, banner: sq?.banner || null };
          }));
          setRivals(resolved);
        }).catch(() => {});
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [squadId, currentUser]);

  const handleLeave = async () => {
    if (!confirm('Are you sure you want to leave this squad?')) return;
    try {
      await leaveSquad(squadId, currentUser.uid);
      showToast('Left squad', 'info');
      navigate('/squads');
    } catch (err) {
      showToast(err.message || 'Cannot leave squad', 'error');
    }
  };

  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    try {
      if (squad.isPublic) {
        await joinSquad(squadId, currentUser.uid);
        showToast('Joined squad!', 'success');
        const mems = await getSquadMembers(squadId);
        setMembers(mems);
        const me = mems.find(m => m.id === currentUser.uid);
        setMyRole(me?.role || 'member');
      } else {
        setShowJoinRequestModal(true);
        setJoining(false);
        return;
      }
    } catch (err) {
      showToast(err.message || 'Failed to join', 'error');
    }
    setJoining(false);
  };

  const handleSubmitRequest = async () => {
    try {
      await submitJoinRequest(squadId, currentUser.uid, joinRequestMessage);
      showToast('Join request sent!', 'success');
      setShowJoinRequestModal(false);
      setJoinRequestMessage('');
    } catch (err) {
      showToast('Failed to send request', 'error');
    }
  };

  const isLeader = ['president', 'vice_president', 'treasury', 'security'].includes(myRole);
  const roleInfo = SQUAD_ROLES[myRole] || SQUAD_ROLES.member;

  if (loading || !squad) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" />
    </div>
  );

  const leaders = members.filter(m => ['president', 'vice_president', 'treasury', 'security'].includes(m.role));

  return (
    <div className="pb-24">
      {isMobile && <TopBar showBack title={squad.name} actions={
        <button onClick={() => navigate(`/squads/${squadId}/settings`)} className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center">
          <Icon name="settings" size={18} />
        </button>
      } />}

      {/* Banner area */}
      <div className="relative h-32 bg-gradient-to-br from-brand-violet/30 via-brand-cyan/20 to-brand-pink/30">
        <div className="absolute bottom-4 left-4 flex items-end gap-3">
          <div className="w-16 h-16 rounded-2xl bg-surface-1 border-2 border-bg-dark flex items-center justify-center text-3xl">
            {squad.avatar || squad.name?.charAt(0) || 'S'}
          </div>
          <div className="pb-1">
            <h2 className="font-syne text-lg font-bold text-text-primary drop-shadow-lg">{squad.name}</h2>
            <p className="text-white/70 text-xs">{squad.game} · {squad.memberCount || members.length} members</p>
          </div>
        </div>
      </div>

      {/* Your role badge OR Join button */}
      {myRole ? (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06] flex items-center gap-3">
          <span className="text-lg">{roleInfo.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-muted uppercase tracking-wider">Your Role</p>
            <p className="text-sm font-bold text-brand-cyan">{roleInfo.label}</p>
          </div>
        </div>
      ) : (
        <div className="mx-4 mt-3">
          <button onClick={handleJoin} disabled={joining}
            className="w-full py-3.5 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all  disabled:opacity-50">
            {joining ? 'Joining...' : (squad.isPublic ? 'Join Squad' : 'Request to Join')}
          </button>
        </div>
      )}

      {/* Squad Wallet */}
      <div className="mx-4 mt-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon name="account_balance_wallet" filled size={18} className="text-brand-gold" />
            <span className="text-xs text-text-muted uppercase tracking-wider">Squad Wallet</span>
          </div>
          {(myRole === 'treasury' || myRole === 'president') && (
            <button onClick={() => navigate(`/squads/${squadId}/leaderboard`)} className="text-brand-cyan text-xs font-semibold">View Details</button>
          )}
        </div>
        <p className="font-dmmono text-xl font-bold text-brand-gold">{(wallet.balance || 0).toLocaleString()}</p>

        {/* MP3 — treasury inflow line-items: which tournament added what. */}
        {inflows.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Recent inflows</p>
            <div className="space-y-1.5">
              {inflows.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      name={tx.type === 'squad_tournament_prize' || tx.type === 'squad_treasury_credit' ? 'emoji_events' : 'add_circle'}
                      size={14}
                      className={tx.type?.includes('tournament') || tx.type?.includes('treasury') ? 'text-brand-gold' : 'text-brand-cyan'}
                    />
                    <span className="text-xs text-text-secondary truncate">
                      {tx.description || (tx.type === 'squad_contribution' ? 'Member contribution' : 'Treasury credit')}
                    </span>
                  </div>
                  <span className="font-dmmono text-xs font-bold text-brand-gold shrink-0">+{(tx.amount || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GR3 — squad-vs-squad rivalries (faced 3+ times). Head-to-head. */}
        {rivals.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Rivalries</p>
            <div className="space-y-1.5">
              {rivals.map((r) => (
                <button key={r.squadId}
                  onClick={() => navigate(`/squads/${r.squadId}`)}
                  className="w-full flex items-center justify-between gap-2 hover:opacity-80 transition-opacity">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name="compare_arrows" size={14} className="text-brand-ember shrink-0" />
                    <span className="text-xs text-text-secondary truncate">
                      {r.tag ? `${r.tag} · ` : ''}{r.name}
                    </span>
                  </div>
                  <span className="font-dmmono text-xs font-bold shrink-0">
                    <span className={r.myWins >= r.theirWins ? 'text-brand-cyan' : 'text-text-muted'}>{r.myWins}</span>
                    <span className="text-text-muted">–</span>
                    <span className={r.theirWins > r.myWins ? 'text-brand-ember' : 'text-text-muted'}>{r.theirWins}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => navigate(`/team-contribute`, { state: { squadId, squadName: squad.name } })}
          className="mt-3 w-full py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-bold hover:bg-brand-gold/20 transition-colors">
          Contribute Coins
        </button>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2 px-4 mt-4 overflow-x-auto no-scrollbar">
        {myRole && (
          <button
            onClick={() => navigate(`/squads/${squadId}/stream`)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-sm font-semibold whitespace-nowrap hover:bg-brand-cyan/15"
          >
            <Icon name="headset_mic" size={16} /> Hangout
          </button>
        )}
        <button onClick={() => navigate(`/squads/${squadId}/chat`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-semibold whitespace-nowrap">
          <Icon name="chat" size={16} /> Chat
        </button>
        <button onClick={() => navigate(`/squads/${squadId}/members`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-semibold whitespace-nowrap">
          <Icon name="group" size={16} /> Members
        </button>
        <button onClick={() => navigate(`/squads/${squadId}/leaderboard`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-semibold whitespace-nowrap">
          <Icon name="leaderboard" size={16} /> Leaderboard
        </button>
        <button onClick={() => navigate(`/squads/${squadId}/tournaments`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-semibold whitespace-nowrap">
          <Icon name="emoji_events" size={16} /> Tournaments
        </button>
        {isLeader && (
          <button onClick={() => navigate(`/squads/${squadId}/requests`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2/60 border border-white/[0.06] text-text-primary text-sm font-semibold whitespace-nowrap">
            <Icon name="person_add" size={16} /> Requests
          </button>
        )}
      </div>

      {/* Active tournament entries — champion voting per entry. Only shown
          when the squad is entered in a tournament and champions aren't
          finalized yet. */}
      {pendingTournaments.length > 0 && (
        <div className="px-4 mt-6">
          <h3 className="font-syne font-bold text-base mb-3">Pending Tournaments</h3>
          <div className="space-y-2">
            {pendingTournaments.map((t) => (
              <div key={t.id} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => navigate(`/tournaments/${t.id}`)}
                      className="text-sm font-bold text-text-primary truncate hover:text-brand-cyan text-left w-full"
                    >{t.name}</button>
                    <div className="font-dmmono text-[10px] text-text-muted mt-0.5">
                      {t.game || '—'} · {t.squadSize || t.teamSize || 5}v{t.squadSize || t.teamSize || 5} · {t.status === 'open' ? 'Open' : 'Starting'}
                    </div>
                  </div>
                </div>
                <SquadChampionVoteEntry
                  tournamentId={t.id}
                  squadId={squadId}
                  tournamentName={t.name}
                  slotsNeeded={t.squadSize || t.teamSize}
                  currentUid={currentUser?.uid}
                  isOwner={myRole === 'president'}
                  members={members}
                  onToast={showToast}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squad Management — President/VP only */}
      {(myRole === 'president' || myRole === 'vice_president') && (
        <div className="px-4 mt-6">
          <h3 className="font-syne font-bold text-base mb-3">Management</h3>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => navigate(`/squads/${squadId}/roles`)} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left">
              <Icon name="admin_panel_settings" size={20} className="text-brand-cyan mb-1" />
              <p className="text-xs font-bold text-text-primary">Assign Roles</p>
              <p className="text-[10px] text-text-muted">Manage leadership</p>
            </button>
            <button onClick={() => navigate(`/squads/${squadId}/members`)} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left">
              <Icon name="group" size={20} className="text-brand-violet mb-1" />
              <p className="text-xs font-bold text-text-primary">Members</p>
              <p className="text-[10px] text-text-muted">{members.length} members</p>
            </button>
            <button onClick={() => navigate(`/squads/${squadId}/settings`)} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-brand-gold/20 transition-colors text-left">
              <Icon name="settings" size={20} className="text-brand-gold mb-1" />
              <p className="text-xs font-bold text-text-primary">Settings</p>
              <p className="text-[10px] text-text-muted">Privacy, name, etc</p>
            </button>
            <button onClick={() => navigate(`/squads/${squadId}/announcements`)} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-brand-pink/20 transition-colors text-left">
              <Icon name="campaign" size={20} className="text-brand-pink mb-1" />
              <p className="text-xs font-bold text-text-primary">Announce</p>
              <p className="text-[10px] text-text-muted">Post to squad</p>
            </button>
          </div>
        </div>
      )}

      {/* Governance - Leadership */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-syne font-bold text-base">Leadership</h3>
          <button onClick={() => navigate(`/squads/${squadId}/roles`)} className="text-brand-cyan text-xs font-semibold">View Roles</button>
        </div>
        <div className="space-y-2">
          {leaders.length === 0 ? (
            <p className="text-text-muted text-sm py-4 text-center">No leadership positions filled yet</p>
          ) : (
            leaders.map(leader => (
              <div key={leader.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
                <UserAvatar src={leader.user?.avatar} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{leader.user?.displayName || leader.user?.username}</p>
                  <p className="text-xs text-text-muted">@{leader.user?.username}</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-brand-cyan/10 border border-brand-cyan/20">
                  <span className="text-xs">{SQUAD_ROLES[leader.role]?.icon}</span>
                  <span className="text-[10px] font-bold text-brand-cyan uppercase">{SQUAD_ROLES[leader.role]?.label}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Announcements */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-syne font-bold text-base">Announcements</h3>
          <button onClick={() => navigate(`/squads/${squadId}/announcements`)} className="text-brand-cyan text-xs font-semibold">See All</button>
        </div>
        {announcements.length === 0 ? (
          <div className="p-4 rounded-xl bg-surface-1 border border-white/[0.06] text-center">
            <p className="text-text-muted text-sm">No announcements yet</p>
          </div>
        ) : (
          announcements.map(ann => (
            <div key={ann.id} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] mb-2">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="campaign" size={14} className="text-brand-cyan" />
                <span className="text-xs text-text-muted">{ann.createdAt?.toDate ? ann.createdAt.toDate().toLocaleDateString() : ''}</span>
              </div>
              <p className="text-sm text-text-primary">{ann.content}</p>
            </div>
          ))
        )}
      </div>

      {/* Description */}
      {squad.description && (
        <div className="px-4 mt-6">
          <h3 className="font-syne font-bold text-base mb-2">About</h3>
          <p className="text-text-secondary text-sm leading-relaxed">{squad.description}</p>
        </div>
      )}

      {/* Leave squad */}
      {myRole && myRole !== 'president' && (
        <div className="px-4 mt-8">
          <button onClick={handleLeave} className="w-full py-3 rounded-xl border border-brand-ember/30 text-brand-ember text-sm font-semibold hover:bg-brand-ember/5 transition-colors">
            Leave Squad
          </button>
        </div>
      )}

      {/* Join Request Modal */}
      <Modal isOpen={showJoinRequestModal} onClose={() => setShowJoinRequestModal(false)} title="Request to Join">
        <textarea
          value={joinRequestMessage}
          onChange={(e) => setJoinRequestMessage(e.target.value)}
          placeholder="Optional: Add a message for the squad president..."
          className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-cyan focus:outline-none mb-4"
          rows={3}
        />
        <button
          onClick={handleSubmitRequest}
          className="w-full py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm hover:brightness-110 transition-all"
        >
          Send Request
        </button>
      </Modal>
    </div>
  );
}