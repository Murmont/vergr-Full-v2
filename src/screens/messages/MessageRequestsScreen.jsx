import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  deleteDoc 
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { acceptMessageRequest } from '../../firebase/firestore';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { getTier } from '../../utils/helpers';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function MessageRequestsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useUI();

  useEffect(() => {
    if (!auth.currentUser) return;
    
    // Listen for chats that are pending AND where the current user is NOT the requester
    const q = query(
      collection(db, 'conversations'), 
      where('status', '==', 'pending'),
      where('participants', 'array-contains', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allPending = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Filter out the ones the current user started so we only show INCOMING requests
      const incoming = allPending.filter(r => r.requestedBy !== auth.currentUser.uid);
      setRequests(incoming);
      setLoading(false);
    }, (error) => {
      console.error("Error listening for requests:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAction = async (convoId, action) => {
    try {
      if (action === 'accept') {
        // Uses your centralized firestore.js logic
        await acceptMessageRequest(convoId);
        showToast("Request accepted", "success");
        navigate(`/messages/${convoId}`);
      } else {
        if (window.confirm("Ignore this request?")) {
          await deleteDoc(doc(db, 'conversations', convoId));
          showToast("Request removed", "info");
        }
      }
    } catch (err) {
      console.error("Action error:", err);
      showToast("Operation failed", "error");
    }
  };

  return (
    <div className={isDesktop ? "min-h-screen bg-bg-dark flex flex-col" : "screen-container min-h-screen bg-bg-dark flex flex-col"}>
      <TopBar 
        title={`Requests (${requests.length})`} 
        showBack={true} 
      />
      
      <main className="flex-1 p-4 space-y-3">
        {loading ? (
           <div className="py-20 text-center text-text-muted text-sm italic animate-pulse">
             Checking secure channels...
           </div>
        ) : requests.length === 0 ? (
          <div className="py-40 text-center opacity-40">
             <Icon name="mail_lock" size={64} className="mx-auto mb-4 text-white" />
             <p className="text-[10px] font-bold uppercase tracking-[0.2em]">No Incoming Requests</p>
          </div>
        ) : (
          requests.map(r => {
            const senderId = r.requestedBy;
            // Assuming metadata stores participant info, fallback to {} if missing
            const senderData = r.metadata?.[senderId] || {};
            const tier = getTier(senderData?.coinsSpent || 0);

            return (
              <div 
                key={r.id} 
                className="p-4 bg-surface-1 rounded-2xl border border-white/[0.06] shadow-xl"
              >
                <div className="flex items-center gap-4 mb-4">
                  <UserAvatar src={senderData?.avatar} size={52} tier={tier} />
                  <div className="flex-1 min-w-0">
                    <p className={`font-black text-sm truncate ${tier.holographic ? 'text-brand-violet-light' : 'text-white'}`}>
                        {senderData?.name || 'Anonymous Pilot'}
                    </p>
                    <p className="text-xs text-text-muted italic">wants to connect</p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleAction(r.id, 'accept')}
                    className="flex-1 py-3 bg-brand-violet text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    Accept
                  </button>
                  <button 
                    onClick={() => handleAction(r.id, 'decline')}
                    className="flex-1 py-3 bg-surface-2 text-white font-black text-[10px] uppercase tracking-widest rounded-xl border border-white/[0.06] hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/50 transition-all"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}