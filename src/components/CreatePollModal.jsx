import { useState } from 'react';
import Icon from './Icon';

export default function CreatePollModal({ onClose, onConfirm }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const addOption = () => setOptions([...options, '']);
  const updateOption = (index, value) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleCreate = () => {
    const validOptions = options.filter(o => o.trim());
    if (!question || validOptions.length < 2) return;
    
    // Initializing structure for Firebase voting logic
    onConfirm({ 
      question, 
      options: validOptions,
      votes: validOptions.reduce((acc, _, i) => ({ ...acc, [i]: 0 }), {}),
      totalVotes: 0,
      voters: []
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-2 border border-white/[0.06] w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <h2 className="text-lg font-bold text-text-primary mb-4">Create New Poll</h2>
        
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-brand-violet-light mb-1.5 block">Question</label>
            <input 
              value={question} 
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What are we voting on?" 
              className="w-full bg-bg-dark border border-white/[0.06] rounded-xl p-3.5 text-sm text-white focus:border-brand-violet outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-brand-violet-light mb-1.5 block">Options</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <input 
                  key={i}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="w-full bg-bg-dark border border-white/[0.06] rounded-xl p-3 text-sm text-white focus:border-brand-violet outline-none"
                />
              ))}
            </div>
            <button onClick={addOption} className="text-brand-violet-light text-xs font-bold flex items-center gap-1 mt-3 hover:opacity-80 transition-opacity">
              <Icon name="add" size={14} /> Add Option
            </button>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-surface-3 text-white font-bold text-sm hover:bg-surface-4 transition-colors">Cancel</button>
          <button 
            onClick={handleCreate} 
            disabled={!question.trim() || options.filter(o => o.trim()).length < 2}
            className="flex-1 py-3 rounded-xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 disabled:opacity-50 transition-all"
          >
            Create Poll
          </button>
        </div>
      </div>
    </div>
  );
}