// In-app help article popup. Renders a published help article (from
// helpContent's HELP_ARTICLE_BY_SLUG) inside a dark modal so the user can read
// it WITHOUT leaving the screen they are on. cta links that point at another
// known help article open that article in-place (a small back stack); anything
// else falls back to a normal route navigation.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { HELP_ARTICLE_BY_SLUG } from '../../screens/marketing/help/helpContent';

// One body block → app-dark JSX. Mirrors the marketing HelpBlock shapes
// (p / h2 / note / list / steps / cta / faq) in the app token palette.
function Block({ block, onOpenSlug }) {
  if (block.h2 != null) {
    return <h3 className="font-syne font-bold text-white text-lg mt-6 mb-2 leading-snug">{block.h2}</h3>;
  }
  if (block.p != null) {
    return <p className="text-text-secondary text-sm leading-relaxed mb-3">{block.p}</p>;
  }
  if (block.note != null) {
    return (
      <div className="my-4 p-3 rounded-xl flex gap-3 items-start" style={{ background: 'linear-gradient(90deg, rgba(180,79,255,0.10), transparent)', borderLeft: '3px solid #B44FFF' }}>
        <span className="text-brand-violet-light shrink-0 mt-0.5"><Icon name="lightbulb" size={16} /></span>
        <span className="text-text-secondary text-[13px] leading-relaxed">{block.note}</span>
      </div>
    );
  }
  if (Array.isArray(block.list)) {
    return (
      <ul className="my-3 space-y-2">
        {block.list.map((it, i) => (
          <li key={i} className="flex gap-2.5 items-start text-text-secondary text-sm leading-relaxed">
            <span className="text-brand-violet-light shrink-0 mt-0.5"><Icon name="check_circle" size={15} /></span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(block.steps)) {
    return (
      <ol className="my-3 space-y-0">
        {block.steps.map((it, i) => (
          <li key={i} className="flex gap-3 items-start py-2.5 border-t border-white/[0.05] first:border-t-0">
            <span className="shrink-0 w-7 h-7 rounded-lg grid place-items-center text-xs font-bold font-dmmono" style={{ background: 'rgba(123,31,255,0.18)', color: 'var(--brand-pink, #C87FFF)' }}>{i + 1}</span>
            <span className="text-text-secondary text-sm leading-relaxed pt-0.5">{typeof it === 'string' ? it : it.text}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.cta) {
    const links = Array.isArray(block.cta) ? block.cta : [block.cta];
    return (
      <div className="flex flex-wrap gap-2 my-4">
        {links.map((l) => {
          const m = /\/platform\/help\/([\w-]+)/.exec(l.to || '');
          const target = m && m[1];
          const known = target && HELP_ARTICLE_BY_SLUG[target]?.published;
          return (
            <button
              key={l.to}
              type="button"
              onClick={() => known ? onOpenSlug(target) : onOpenSlug(null, l.to)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white px-3.5 py-2 rounded-full border border-white/[0.10] bg-white/[0.02] hover:bg-white/[0.06] transition-colors"
            >
              {l.label} <Icon name="arrow_forward" size={14} />
            </button>
          );
        })}
      </div>
    );
  }
  if (Array.isArray(block.faq)) {
    return (
      <div className="flex flex-col gap-2.5 my-4">
        {block.faq.map(([qq, aa]) => (
          <details key={qq} className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <summary className="cursor-pointer font-syne font-bold text-sm text-white list-none flex justify-between items-center gap-3">
              <span>{qq}</span>
              <Icon name="expand_more" size={18} className="text-text-secondary" />
            </summary>
            <p className="mt-2.5 text-[13px] text-text-secondary leading-relaxed">{aa}</p>
          </details>
        ))}
      </div>
    );
  }
  return null;
}

export default function HelpArticleModal({ slug, onClose }) {
  const navigate = useNavigate();
  const [stack, setStack] = useState([slug]);
  const scrollRef = useRef(null);
  const cur = stack[stack.length - 1];
  const article = cur ? HELP_ARTICLE_BY_SLUG[cur] : null;

  useEffect(() => { setStack([slug]); }, [slug]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [cur]);

  if (!slug) return null;

  const openSlug = (nextSlug, route) => {
    if (nextSlug) { setStack((s) => [...s, nextSlug]); return; }
    if (route) { onClose(); navigate(route); }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.62)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-2xl bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 max-h-[88vh] sm:max-h-[82vh] flex flex-col overflow-hidden sheet-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-white/[0.06] shrink-0">
          {stack.length > 1 && (
            <button onClick={() => setStack((s) => s.slice(0, -1))} className="text-text-secondary hover:text-white -ml-1" aria-label="Back">
              <Icon name="arrow_back" size={20} />
            </button>
          )}
          <span className="flex-1 min-w-0 text-text-muted text-[11px] uppercase tracking-wider font-bold truncate">Help</span>
          <button onClick={onClose} className="text-text-secondary hover:text-white" aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div ref={scrollRef} className="px-4 sm:px-6 py-5 overflow-y-auto">
          {article ? (
            <>
              <h2 className="font-syne font-bold text-white text-xl sm:text-2xl leading-tight mb-2">{article.title}</h2>
              {article.summary && <p className="text-text-secondary text-[15px] leading-relaxed mb-4">{article.summary}</p>}
              <div className="border-t border-white/[0.06] pt-4">
                {(article.body || []).map((b, i) => <Block key={i} block={b} onOpenSlug={openSlug} />)}
              </div>
              <div className="mt-5 pt-4 border-t border-white/[0.06]">
                <button
                  onClick={() => { onClose(); navigate(`/platform/help/${cur}`); }}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-violet-light hover:underline"
                >
                  Open full article <Icon name="open_in_new" size={14} />
                </button>
              </div>
            </>
          ) : (
            <p className="text-text-secondary text-sm py-8 text-center">Article not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
