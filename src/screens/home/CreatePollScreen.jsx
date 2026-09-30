import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { createFeedPoll } from '../../firebase/firestore';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function CreatePollScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { currentUser } = useAuth();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();
  
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState('24h');
  const [loading, setLoading] = useState(false);

  // Full‑width layout
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => {
      setRightPanel(null);
      setContentAlign('center');
    };
  }, [setRightPanel, setContentAlign]);

  const addOption = () => options.length < 6 && setOptions(prev => [...prev, '']);
  
  const updateOption = (index, value) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const removeOption = (index) => {
    setOptions(prev => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    if (!question.trim() || options.some(o => !o.trim())) {
      showToast('Please fill in the question and all options', 'error');
      return;
    }
    setLoading(true);
    try {
      await createFeedPoll(currentUser.uid, {
        question: question.trim(),
        options: options.filter(o => o.trim() !== ''),
        duration
      });
      showToast('Poll created successfully!', 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to create poll', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-bg-dark flex flex-col">
      {/* Mobile header */}
      {isMobile && (
        <header className="sticky top-0 z-40 glass-header flex items-center justify-between px-4 py-4 border-b border-white/[0.04]">
          <button onClick={() => navigate(-1)} className="text-text-muted hover:text-white">Cancel</button>
          <button 
            onClick={handlePost} 
            disabled={loading}
            className="text-brand-violet-light font-semibold text-sm disabled:opacity-50"
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </header>
      )}

      {/* Desktop header */}
      {!isMobile && (
        <div className="flex items-center justify-between px-4 lg:px-6 pt-4 pr-12 lg:pr-16">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors">
            <Icon name="arrow_back" size={24} />
          </button>
          <h1 className="text-white font-syne font-bold text-lg">Create Poll</h1>
          <button
            onClick={handlePost}
            disabled={loading}
            className="text-brand-violet-light font-semibold text-sm disabled:opacity-50"
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 px-4 lg:px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Question */}
          <div>
            <label className="block text-text-secondary text-xs font-bold uppercase mb-2">Question</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={2}
              placeholder="Ask a question..."
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 text-white outline-none focus:border-brand-violet resize-none text-lg"
            />
          </div>

          {/* Options */}
          <div>
            <label className="block text-text-secondary text-xs font-bold uppercase mb-2">Options</label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 flex items-center">
                    <span className="text-text-muted mr-2">{idx + 1}.</span>
                    <input
                      value={opt}
                      onChange={e => updateOption(idx, e.target.value)}
                      placeholder={`Option ${idx + 1}`}
                      className="flex-1 bg-transparent text-white outline-none text-sm"
                    />
                  </div>
                  {options.length > 2 && (
                    <button onClick={() => removeOption(idx)} className="text-text-muted hover:text-white">
                      <Icon name="close" size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 6 && (
              <button onClick={addOption} className="flex items-center gap-2 text-brand-violet-light text-sm font-semibold mt-3">
                <Icon name="add" size={16} /> Add Option
              </button>
            )}
          </div>

          {/* Duration */}
          <div>
            <label className="block text-text-secondary text-xs font-bold uppercase mb-2">Poll Duration</label>
            <div className="flex gap-2 flex-wrap">
              {['6h', '12h', '24h', '48h'].map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`px-4 py-2 rounded-xl border text-sm font-bold transition ${
                    duration === d
                      ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light'
                      : 'border-white/[0.06] text-text-muted hover:border-white/[0.12]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}