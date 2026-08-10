import { useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import Icon from '../Icon';
import BlockForm from './BlockForm';
import { newBlock } from '../../hooks/useVergrMe';
import { BLOCK_REGISTRY, BLOCK_CATEGORIES } from '../../utils/vergrMeThemes';

export default function ContentTab({ blocks, setBlocks, isPro, onProGate }) {
  const [expanded, setExpanded] = useState(null);
  const [adding, setAdding] = useState(false);

  const patchBlock = (id, obj) =>
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...obj } : b)));
  const removeBlock = (id) => setBlocks(blocks.filter((b) => b.id !== id));
  const addBlock = (type) => {
    const reg = BLOCK_REGISTRY[type];
    if (reg?.tier === 'pro' && !isPro) {
      onProGate(`The ${reg.label} block is a Pro feature.`);
      return;
    }
    const b = { ...newBlock(type), order: blocks.length };
    setBlocks([...blocks, b]);
    setAdding(false);
    setExpanded(b.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{blocks.length} blocks · drag to reorder</p>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-violet/10 text-brand-violet-light text-xs font-semibold rounded-full border border-brand-violet/20">
          <Icon name="add" size={14} /> Add block
        </button>
      </div>

      <Reorder.Group axis="y" values={blocks} onReorder={setBlocks} className="flex flex-col gap-2">
        {blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            expanded={expanded === block.id}
            onExpand={() => setExpanded(expanded === block.id ? null : block.id)}
            onToggle={() => patchBlock(block.id, { enabled: block.enabled === false })}
            onDelete={() => { removeBlock(block.id); if (expanded === block.id) setExpanded(null); }}
            patch={(obj) => patchBlock(block.id, obj)}
          />
        ))}
      </Reorder.Group>

      {blocks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <Icon name="widgets" size={32} className="text-text-muted/30" />
          <p className="text-sm text-text-muted">No blocks yet</p>
          <button onClick={() => setAdding(true)} className="text-brand-violet-light text-xs font-semibold">Add your first block</button>
        </div>
      )}

      {adding && <AddBlockSheet isPro={isPro} onPick={addBlock} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BlockCard({ block, expanded, onExpand, onToggle, onDelete, patch }) {
  const controls = useDragControls();
  const reg = BLOCK_REGISTRY[block.type] || { label: block.type, icon: 'drag_indicator' };
  const disabled = block.enabled === false;

  return (
    <Reorder.Item value={block} dragListener={false} dragControls={controls} className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
      <div className="flex items-center gap-2 p-2.5">
        <button onPointerDown={(e) => controls.start(e)} className="cursor-grab active:cursor-grabbing touch-none text-text-muted px-0.5" aria-label="Drag">
          <Icon name="drag_indicator" size={18} />
        </button>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${disabled ? 'bg-surface-2 opacity-50' : 'bg-brand-violet/10'}`}>
          <Icon name={reg.icon} size={16} className={disabled ? 'text-text-muted' : 'text-brand-violet-light'} />
        </div>
        <button onClick={onExpand} className="flex-1 min-w-0 text-left">
          <p className={`text-sm font-medium truncate ${disabled ? 'text-text-muted line-through' : ''}`}>
            {summary(block) || reg.label}
            {block.ageGate && <span className="ml-1.5 text-[9px] font-extrabold text-brand-ember align-middle">18+</span>}
            {block.passcode && <span className="ml-1 text-[10px] align-middle" title="Passcode locked">🔒</span>}
            {(block.startAt || block.endAt) && <span className="ml-1 text-[10px] align-middle" title="Scheduled">🕑</span>}
            {block.sensitive && <span className="ml-1 text-[10px] align-middle" title="Sensitive content">🔞</span>}
          </p>
          <p className="text-[10px] text-text-muted">{reg.label}</p>
        </button>
        <button onClick={onToggle} className={`w-8 h-8 flex items-center justify-center rounded-full ${disabled ? 'text-text-muted' : 'text-brand-violet-light'}`} aria-label="Toggle visibility">
          <Icon name={disabled ? 'visibility_off' : 'visibility'} size={16} />
        </button>
        <button onClick={onExpand} className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted" aria-label="Edit">
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 flex flex-col gap-2">
          <BlockForm block={block} patch={patch} />
          <button onClick={onDelete} className="self-start flex items-center gap-1 text-[11px] text-red-400 mt-1">
            <Icon name="delete" size={13} /> Delete block
          </button>
        </div>
      )}
    </Reorder.Item>
  );
}

// One-line "what it does" so the picker reads like a gallery, not a menu.
const BLOCK_DESC = {
  link: 'A tappable button to any URL',
  collection: 'A set of links as a grid or carousel',
  header: 'A section title to group blocks',
  text: 'A paragraph, with clickable URLs',
  faq: 'Expandable question & answer list',
  countdown: 'A live countdown to a date',
  divider: 'A line, dots or spacer',
  map: 'Show a location on a map',
  membership: 'Your paid membership tiers',
  digital_product: 'Sell a product (digital or physical) — keep 92%, paid in gems',
  shop_catalog: 'Link out to your Shopify/Woo store (no coin checkout)',
  socials: 'Row of social icons',
  image: 'A single image, optionally linked',
  gallery: 'Multiple images in a grid or carousel',
  video: 'Embed YouTube, TikTok, Twitch or your upload',
  music: 'Embed Spotify, Apple Music or SoundCloud',
  product: 'Show a product with price + buy button',
  embed: 'Embed any iframe',
  email: 'A mailto contact button',
  message: 'Let visitors DM you on Vergr',
  tip: 'Accept coin tips (keep 90%)',
  vergr_stream: 'Auto-shows when you go live',
  vergr_tournament: 'Promote one of your tournaments',
  vergr_event: 'Sell tickets to your event',
  vergr_squad: 'Invite people to your squad',
  vergr_group: 'Link to a public group chat',
  invite: 'Earn VP when friends join Vergr',
  support: 'Buy Me a Coffee, Ko-fi, PayPal & more',
  services: 'List services with pricing',
  contact: 'A form that collects leads',
  booking: 'Embed Calendly or other booking',
};

function AddBlockSheet({ isPro, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-md max-h-[80vh] overflow-y-auto bg-surface-1 border-t sm:border border-white/10 rounded-t-2xl sm:rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Add a block</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-surface-2"><Icon name="close" size={16} /></button>
        </div>
        {BLOCK_CATEGORIES.map((cat) => {
          const types = Object.entries(BLOCK_REGISTRY).filter(([, r]) => r.cat === cat.id);
          if (!types.length) return null;
          return (
            <div key={cat.id} className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2">{cat.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {types.map(([type, r]) => {
                  const locked = r.tier === 'pro' && !isPro;
                  return (
                    <button key={type} onClick={() => onPick(type)} className="flex items-start gap-2.5 p-2.5 bg-surface-2 rounded-xl border border-white/5 hover:border-brand-violet/30 text-left relative">
                      <div className="w-8 h-8 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0">
                        <Icon name={r.icon} size={16} className="text-brand-violet-light" />
                      </div>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium">{r.label}{locked && <Icon name="lock" size={11} className="text-brand-gold-light ml-1 align-middle" />}</span>
                        {BLOCK_DESC[type] && <span className="block text-[10px] text-text-muted leading-snug mt-0.5">{BLOCK_DESC[type]}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function summary(b) {
  switch (b.type) {
    case 'link': return b.title || b.url;
    case 'header': return b.text;
    case 'text': return b.text;
    case 'faq': return b.title || `${(b.items || []).length} questions`;
    case 'countdown': return b.title || (b.target ? 'Countdown' : 'Countdown (set a date)');
    case 'divider': return b.label || `Divider · ${b.variant || 'line'}`;
    case 'map': return b.address || 'Map (add an address)';
    case 'membership': return b.title || 'Membership';
    case 'digital_product': return b.productId ? 'Product for sale' : 'Product (pick one)';
    case 'shop_catalog': return b.items?.length ? `${b.title || 'Shop'} · ${b.items.length} products` : 'Shop catalog (import your store)';
    case 'socials': return Object.values(b.socials || {}).filter(Boolean).length + ' socials';
    case 'image': return b.caption || 'Image';
    case 'gallery': return `${(b.images || []).length} images`;
    case 'video': return b.title || b.url || 'Video';
    case 'music': return b.url || 'Music';
    case 'product': return b.title || 'Product';
    case 'embed': return b.url || 'Embed';
    case 'email': return b.email || b.label;
    case 'message': return b.label;
    case 'tip': return b.label;
    case 'vergr_tournament': return b.tournamentId ? 'Tournament' : '';
    case 'vergr_event': return b.eventId ? 'Event' : '';
    case 'vergr_squad': return b.squadId ? 'Squad' : '';
    default: return '';
  }
}
