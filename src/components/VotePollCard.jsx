// src/components/VotePollCard.jsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { doc, onSnapshot, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';

export default function VotePollCard({ squadId, voteId, isMe }) {
  const { currentUser } = useAuth();
  const [vote, setVote] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!voteId) return;
    const unsub = onSnapshot(doc(db, 'squads', squadId, 'votes', voteId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setVote(data);
      setHasVoted(data.voterIds?.includes(currentUser?.uid) || false);
      const expires = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
      setExpired(expires < new Date());
    });
    return () => unsub();
  }, [squadId, voteId, currentUser?.uid]);

  const handleVote = async (optionIndex) => {
    if (hasVoted || expired) return;
    try {
      const voteRef = doc(db, 'squads', squadId, 'votes', voteId);
      await updateDoc(voteRef, {
        [`voteCounts.${optionIndex}`]: increment(1),
        voterIds: arrayUnion(currentUser.uid),
        totalVotes: increment(1),
      });
    } catch (err) {
      console.error('Vote error:', err);
    }
  };

  if (!vote) return null;

  const totalVotes = vote.totalVotes || 0;
  const options = vote.options || ['Yes', 'No'];
  const isKickVote = vote.type === 'kick_member';

  return (
    <div className={`w-full rounded-2xl border overflow-hidden ${
      isKickVote
        ? 'bg-gradient-to-br from-red-950/60 to-red-900/40 border-red-500/30 '
        : 'bg-surface-2/90 border-white/10'
    }`}>
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name={isKickVote ? 'gavel' : 'how_to_vote'} size={18} className={isKickVote ? 'text-red-400' : 'text-brand-violet'} />
          <span className={`text-xs font-bold uppercase tracking-wider ${isKickVote ? 'text-red-300' : 'text-text-muted'}`}>
            {isKickVote ? 'Kick Vote' : 'Election'}
          </span>
          {expired && <span className="text-xs font-bold text-brand-ember ml-auto">EXPIRED</span>}
        </div>
        <p className="text-white text-sm font-semibold mb-2">{vote.title}</p>
        {vote.reason && (
          <div className="bg-black/30 backdrop-blur-sm rounded-lg p-2 mb-4 text-xs text-white/80 border-l-2 border-brand-violet">
            <span className="font-semibold">Reason: </span>{vote.reason}
          </div>
        )}
        <div className="space-y-2">
          {options.map((option, i) => {
            const count = vote.voteCounts?.[i] || 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isWinner = !expired && i === vote.winnerIndex;

            return (
              <motion.button
                key={i}
                onClick={() => handleVote(i)}
                disabled={hasVoted || expired}
                whileTap={!(hasVoted || expired) ? { scale: 0.97 } : {}}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`w-full p-3 rounded-xl text-left transition-colors relative overflow-hidden ${
                  hasVoted || expired
                    ? 'bg-surface-3/50'
                    : `hover:border-white/[0.12] border ${isKickVote ? 'border-red-500/30 bg-red-950/30' : 'border-white/[0.06] bg-surface-2'}`
                }`}
              >
                {(hasVoted || expired || isWinner) && (
                  <motion.div
                    className="absolute inset-y-0 left-0"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 1 }}
                    style={{ backgroundColor: isKickVote ? 'rgba(239,68,68,0.2)' : 'rgba(180,79,255,0.1)' }}
                  />
                )}
                <div className="relative flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{option}</span>
                  {(hasVoted || expired) && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="text-xs font-dmmono text-white/70">{pct}% ({count})</motion.span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
        <p className="text-white/60 text-[10px] mt-3 font-dmmono">
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''} cast
        </p>
      </div>
    </div>
  );
}