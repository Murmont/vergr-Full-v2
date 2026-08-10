// VoiceSessionPill — Discord-style floating pill shown anywhere in the app
// while a voice-channel session is live (the session itself lives in
// utils/voiceSession.js and survives navigation). Hidden on the channel's
// own screen. Tap = back to the channel; mic + leave inline.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { subscribeVoiceSession, toggleVoiceMic, leaveVoiceChannel } from '../utils/voiceSession';
import Icon from './Icon';

export default function VoiceSessionPill() {
  const [vs, setVs] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => subscribeVoiceSession(setVs), []);

  if (!vs || (vs.phase !== 'live' && vs.phase !== 'connecting')) return null;
  if (location.pathname === `/messages/voice/${vs.channelId}`) return null;

  const anyoneSpeaking = Object.entries(vs.speaking || {}).some(([k, v]) => v && k !== 'me');
  const count = Object.keys(vs.peers || {}).length + 1;

  return (
    <div
      className="fixed z-[70] left-1/2 -translate-x-1/2 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-surface-1/95 backdrop-blur-xl border border-brand-violet/30 shadow-2xl shadow-black/50"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
    >
      <button
        onClick={() => navigate(`/messages/voice/${vs.channelId}`)}
        className="flex items-center gap-2 min-w-0"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${vs.phase === 'live' ? (anyoneSpeaking ? 'bg-green-400 animate-pulse' : 'bg-brand-violet') : 'bg-yellow-400 animate-pulse'}`} />
        <span className="text-[12px] font-bold text-text-primary truncate max-w-[140px]">{vs.channelName}</span>
        <span className="text-[10px] font-dmmono text-text-muted shrink-0">{count}</span>
      </button>
      <button
        onClick={() => toggleVoiceMic()}
        className={`w-8 h-8 rounded-full flex items-center justify-center ${vs.micOn ? 'text-text-secondary hover:text-text-primary' : 'bg-brand-ember/20 text-brand-ember'}`}
        title={vs.micOn ? 'Mute' : 'Unmute'}
      >
        <Icon name={vs.micOn ? 'mic' : 'mic_off'} size={16} />
      </button>
      <button
        onClick={() => leaveVoiceChannel()}
        className="w-8 h-8 rounded-full bg-brand-ember/90 text-white flex items-center justify-center hover:brightness-110"
        title="Leave voice channel"
      >
        <Icon name="call_end" size={15} />
      </button>
    </div>
  );
}
