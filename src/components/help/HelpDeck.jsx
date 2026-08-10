// A column of tappable help cards that open the linked article in an in-app
// popup (HelpArticleModal) instead of navigating away. Used to fill the empty
// right rail on wide screens with relevant, context-aware help.
//   items: [{ slug, label, desc?, icon? }]  (slug = a published help article)
import { useState } from 'react';
import Icon from '../Icon';
import { HELP_ARTICLE_BY_SLUG } from '../../screens/marketing/help/helpContent';
import HelpArticleModal from './HelpArticleModal';

export default function HelpDeck({ title = 'Learn more', items = [] }) {
  const [openSlug, setOpenSlug] = useState(null);
  const cards = items.filter((it) => HELP_ARTICLE_BY_SLUG[it.slug]?.published);

  if (!cards.length) return null;

  return (
    <div>
      <p className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-3 flex items-center gap-1.5">
        <Icon name="help" size={14} /> {title}
      </p>
      <div className="space-y-2">
        {cards.map((it) => {
          const art = HELP_ARTICLE_BY_SLUG[it.slug];
          return (
            <button
              key={it.slug}
              type="button"
              onClick={() => setOpenSlug(it.slug)}
              className="w-full text-left p-3.5 rounded-2xl border border-white/[0.07] bg-surface-1 hover:bg-white/[0.03] hover:border-white/[0.12] transition-colors group"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-9 h-9 rounded-xl grid place-items-center bg-white/[0.04] text-brand-violet-light">
                  <Icon name={it.icon || 'auto_stories'} size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-snug">{it.label || art.title}</p>
                  <p className="text-text-secondary text-[12px] leading-relaxed mt-0.5 line-clamp-2">{it.desc || art.summary}</p>
                </div>
                <Icon name="chevron_right" size={18} className="text-text-muted shrink-0 mt-1 group-hover:text-text-secondary" />
              </div>
            </button>
          );
        })}
      </div>

      {openSlug && <HelpArticleModal slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </div>
  );
}
