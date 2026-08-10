import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { voteOnPoll } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';

export default function PollCard({ post }) {
  const { currentUser } = useAuth();
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localVotes, setLocalVotes] = useState(post.votes || {});
  const [totalVotes, setTotalVotes] = useState(post.totalVotes || 0);

  const handleVote = async (index) => {
    if (hasVoted || loading) return;
    setLoading(true);
    try {
      await voteOnPoll(post.id, index, currentUser.uid);
      setLocalVotes(prev => ({ ...prev, [index]: (prev[index] || 0) + 1 }));
      setTotalVotes(prev => prev + 1);
      setHasVoted(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getPercentage = (count) => {
    if (totalVotes === 0) return 0;
    return Math.round((count / totalVotes) * 100);
  };

  return (
    <div className="mt-4 space-y-3">
      {(post.options || []).map((option, index) => {
        const voteCount = localVotes[index] || 0;
        const percentage = getPercentage(voteCount);
        
        return (
          <motion.button
            key={index}
            onClick={() => handleVote(index)}
            disabled={hasVoted || loading}
            whileTap={!hasVoted ? { scale: 0.97 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="w-full relative overflow-hidden bg-surface-2 border border-white/[0.06] rounded-xl p-4 text-left transition-colors hover:border-white/[0.12]"
          >
            {hasVoted && (
              <motion.div 
                className="absolute left-0 top-0 bottom-0 bg-brand-violet/15"
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 1 }}
              />
            )}
            <div className="relative flex justify-between items-center z-10">
              <span className="text-text-primary font-medium text-sm">{option}</span>
              {hasVoted && (
                <motion.span
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-brand-violet-light font-bold text-sm font-dmmono">{percentage}%</motion.span>
              )}
            </div>
          </motion.button>
        );
      })}
      <p className="text-xs text-text-muted mt-2">{totalVotes} votes</p>
    </div>
  );
}