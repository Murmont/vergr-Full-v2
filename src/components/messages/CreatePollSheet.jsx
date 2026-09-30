import { useState } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';

// Poll composer sheet (bottom sheet on mobile, centered card on desktop).
// Pure UI — the caller creates the chat_polls doc + sends the message.
export default function CreatePollSheet({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2;

  const setOpt = (i, v) => setOptions((p) => p.map((o, j) => (j === i ? v : o)));
  const addOpt = () => setOptions((p) => (p.length < 6 ? [...p, ''] : p));
  const removeOpt = (i) => setOptions((p) => (p.length > 2 ? p.filter((_, j) => j !== i) : p));

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onCreate({ question: question.trim(), options: filled, multi });
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}>
      <motion.div
        initial={{ y: 48, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl p-5 pb-[calc(var(--vg-safe-b,0px)+1.25rem)] sm:pb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-syne font-bold text-lg text-text-primary flex items-center gap-2">
            <Icon name="bar_chart" size={20} className="text-brand-violet-light" /> New Poll
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 text-text-muted hover:text-white flex items-center justify-center">
            <Icon name="close" size={16} />
          </button>
        </div>

        <input autoFocus value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 200))}
          placeholder="Ask a question…"
          className="w-full bg-surface-2 border border-white/[0.08] rounded-xl px-3.5 py-3 text-text-primary text-sm outline-none focus:border-brand-violet mb-3" />

        <div className="space-y-2 mb-3">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={opt} onChange={(e) => setOpt(i, e.target.value.slice(0, 80))}
                placeholder={`Option ${i + 1}`}
                onKeyDown={(e) => { if (e.key === 'Enter' && i === options.length - 1 && options.length < 6) addOpt(); }}
                className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-text-primary text-sm outline-none focus:border-brand-violet" />
              {options.length > 2 && (
                <button onClick={() => removeOpt(i)} className="w-8 h-8 rounded-full text-text-muted hover:text-brand-ember flex items-center justify-center shrink-0">
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button onClick={addOpt} className="flex items-center gap-1.5 text-brand-violet-light text-[13px] font-bold px-1 py-1">
              <Icon name="add" size={15} /> Add option
            </button>
          )}
        </div>

        <button onClick={() => setMulti((m) => !m)}
          className="w-full flex items-center justify-between px-1 py-2 mb-4">
          <span className="text-sm text-text-secondary">Allow multiple answers</span>
          <span className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${multi ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`}>
            <span className="w-5 h-5 bg-white rounded-full shadow" />
          </span>
        </button>

        <button onClick={create} disabled={!valid || busy}
          className={`w-full py-3 rounded-xl text-sm font-bold text-white transition-all ${
            valid && !busy ? 'bg-gradient-to-r from-brand-violet to-brand-pink hover:brightness-110 active:scale-[0.99]' : 'bg-surface-2 text-text-muted cursor-not-allowed'
          }`}>
          {busy ? 'Creating…' : 'Send poll'}
        </button>
      </motion.div>
    </div>
  );
}
