import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import Icon from './Icon';
import UserAvatar from './UserAvatar';

export default function IncomingCallManager() {
  const [incomingCall, setIncomingCall] = useState(null);
  const navigate = useNavigate();
  
  // Use a ref for the audio object so we can control it across renders
  const ringtoneRef = useRef(null);
  // Group calls I've dismissed on this device — the doc stays 'ringing' for
  // others, so without this it would immediately ring me again.
  const dismissedRef = useRef(new Set());

  useEffect(() => {
    // Initialize the audio object
    ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
    ringtoneRef.current.loop = true;

    if (!auth.currentUser) return;

    // Listen for calls where I am a participant but NOT the caller
    const q = query(
      collection(db, 'calls'),
      where('participants', 'array-contains', auth.currentUser.uid),
      where('status', '==', 'ringing')
    );

    const unsub = onSnapshot(q, (snap) => {
      const callData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .find(c => c.callerId !== auth.currentUser.uid
          // A group call stays 'ringing' while it's live so late members still
          // get rung — so suppress the ring for anyone already IN it, and for
          // anyone who dismissed this one on this device.
          && !(c.activeUids || []).includes(auth.currentUser.uid)
          && !dismissedRef.current.has(c.id));

      if (callData) {
        setIncomingCall(callData);
        // Play ringtone. Note: browsers often require a user gesture first, 
        // so ensure the user has clicked anywhere on the app before a call arrives.
        ringtoneRef.current.play().catch(err => console.log("Audio play deferred: ", err));
      } else {
        setIncomingCall(null);
        if (ringtoneRef.current) {
          ringtoneRef.current.pause();
          ringtoneRef.current.currentTime = 0;
        }
      }
    });

    return () => {
      unsub();
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
      }
    };
  }, []);

  const acceptCall = async () => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }

    try {
      await updateDoc(doc(db, 'calls', incomingCall.id), {
        status: 'active'
      });
      // Group calls run on the SFU (a mesh can't scale past 2-3 peers), 1:1
      // stays raw WebRTC P2P.
      navigate(incomingCall.isGroup
        ? `/group-call/${incomingCall.id}`
        : `/call/${incomingCall.id}/${incomingCall.type}`);
    } catch (error) {
      console.error("Error accepting call:", error);
    }
  };

  const declineCall = async () => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }

    // A GROUP call keeps ringing for everyone else — declining is just me
    // stepping out, so it must NOT end the call for the group.
    if (incomingCall.isGroup) {
      dismissedRef.current.add(incomingCall.id);
      setIncomingCall(null);
      return;
    }
    // 1:1: this used to deleteDoc, which the rules DENY (`allow delete: if
    // false`) — so declining silently failed and the caller rang forever.
    // CallScreen hangs up on status 'ended', so that's the write that works.
    try {
      await updateDoc(doc(db, 'calls', incomingCall.id), { status: 'ended' });
    } catch (error) {
      console.error("Error declining call:", error);
    }
  };

  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-bg-dark/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in duration-300">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-brand-violet/20 rounded-full animate-ping" />
          <UserAvatar src={incomingCall.callerAvatar} size={120} />
        </div>
        
        <div className="text-center">
          <h2 className="text-2xl font-black text-white mb-1">
            {incomingCall.isGroup ? (incomingCall.groupName || 'Group call') : incomingCall.callerName}
          </h2>
          <p className="text-brand-violet-light font-bold tracking-[0.2em] uppercase text-xs animate-pulse">
            {incomingCall.isGroup
              ? `${incomingCall.callerName} started a ${incomingCall.type} call`
              : `Incoming ${incomingCall.type} Call...`}
          </p>
        </div>
      </div>

      <div className="flex gap-12 pb-20">
        <button 
          onClick={declineCall}
          className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
        >
          <Icon name="call_end" size={32} />
        </button>
        
        <button 
          onClick={acceptCall}
          className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
        >
          <Icon name="call" size={32} />
        </button>
      </div>
    </div>
  );
}