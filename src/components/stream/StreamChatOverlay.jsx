import { useState } from 'react';
import Icon from '../Icon';

export default function StreamChatOverlay({ messages = [], onSend, onTip, onClose }) {
  const [msg, setMsg] = useState('');
  const chatMessages = messages;

  const handleSend = () => {
    if (!msg.trim()) return;
    onSend?.(msg);
    setMsg('');
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/90 via-black/50 to-transparent">
      <div className="px-4 pb-2 pt-16 max-h-[250px] overflow-y-auto flex flex-col justify-end">
        {chatMessages.map((m, i) => (
          <div key={i} className="py-1">
            <span className="font-bold text-sm mr-1" style={{ color: m.color }}>@{m.user}</span>
            <span className="text-white/90 text-sm">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2.5 border border-white/10">
          <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Send a message..." className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40" />
          <button onClick={handleSend} className="text-primary"><Icon name="send" size={18} /></button>
          <button onClick={onTip} className="text-yellow-400"><Icon name="paid" size={18} /></button>
        </div>
      </div>
    </div>
  );
}
