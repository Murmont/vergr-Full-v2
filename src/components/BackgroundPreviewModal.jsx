import { useEffect } from 'react';
import Icon from './Icon';
import { getChatBgStyle } from '../utils/chatBackgrounds';

export default function BackgroundPreviewModal({ isOpen, onClose, onApply, bgId, customImageUrl }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  // Modal renders on both mobile + desktop — use viewport width to pick
  // the right variant so the preview matches what'll actually render.
  const isDesktopPreview = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const bgStyle = getChatBgStyle(bgId, customImageUrl, { isDesktop: isDesktopPreview });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="relative w-[90vw] max-w-[400px] h-[80vh] rounded-2xl overflow-hidden border border-white/[0.06] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed background */}
        <div className="absolute inset-0" style={bgStyle} />

        {/* Chat UI overlay */}
        <div className="relative flex flex-col h-full bg-transparent">
          {/* Dummy header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] glass-header">
            <div className="w-8 h-8 rounded-full bg-surface-2 animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
              <div className="h-3 w-16 bg-surface-2/70 rounded mt-1 animate-pulse" />
            </div>
          </div>

          {/* Dummy messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex justify-start">
              <div className="max-w-[70%] bg-surface-2/90 backdrop-blur-sm rounded-2xl rounded-tl-none px-4 py-2">
                <p className="text-sm text-white/90">Hey! Check out this background</p>
                <span className="text-[9px] text-white/40 float-right mt-1">12:34</span>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[70%] bg-brand-violet rounded-2xl rounded-br-none px-4 py-2">
                <p className="text-sm text-bg-dark/90">Looks great!</p>
                <span className="text-[9px] text-bg-dark/40 float-right mt-1">12:35</span>
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[70%] bg-surface-2/90 backdrop-blur-sm rounded-2xl rounded-tl-none px-4 py-2">
                <p className="text-sm text-white/90">Try it out</p>
                <span className="text-[9px] text-white/40 float-right mt-1">12:36</span>
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="p-3 glass-header border-t border-white/[0.04]">
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-full bg-surface-2 text-text-primary text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => { onApply(); onClose(); }}
                className="flex-1 py-2 rounded-full bg-brand-violet text-white text-sm font-semibold"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}