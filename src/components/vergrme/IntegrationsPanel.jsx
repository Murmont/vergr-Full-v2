import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { newBlock } from '../../hooks/useVergrMe';
import { SOCIAL_META } from '../../utils/vergrMeThemes';
import { Card } from './EditorUI';

// Social handles + VERGR account connections. Social handles are stored on a
// `socials` block (created on first edit) so they render on the page.
export default function IntegrationsPanel({ blocks, setBlocks }) {
  const navigate = useNavigate();
  const socialBlock = blocks.find((b) => b.type === 'socials');
  const handles = socialBlock?.socials || {};

  const setHandle = (key, val) => {
    if (socialBlock) {
      setBlocks(blocks.map((b) => (b.id === socialBlock.id ? { ...b, socials: { ...b.socials, [key]: val } } : b)));
    } else {
      setBlocks([...blocks, { ...newBlock('socials', { socials: { [key]: val } }), order: blocks.length }]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Social handles" subtitle="Adds a row of icons to your page that link to your profiles">
        <div className="flex flex-col gap-2">
          {Object.entries(SOCIAL_META).map(([key, meta]) => (
            <div key={key} className="flex items-center gap-2 px-3 py-2 bg-surface-2/60 rounded-xl border border-white/5">
              <span className="w-8 h-8 rounded-lg bg-surface-1 flex items-center justify-center text-xs font-bold">{meta.label}</span>
              <span className="text-[11px] text-text-muted w-16 capitalize">{key}</span>
              <span className="text-[11px] text-text-muted/40">@</span>
              <input value={handles[key] || ''} onChange={(e) => setHandle(key, e.target.value)} placeholder={`your${key}`} className="flex-1 bg-transparent text-sm outline-none" />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Connected accounts" subtitle="Link your game & streaming accounts to power Vergr blocks">
        <button onClick={() => navigate('/settings')} className="w-full flex items-center justify-between p-3 bg-surface-2/60 rounded-xl border border-white/5 hover:border-brand-violet/30">
          <span className="text-sm flex items-center gap-2"><Icon name="link" size={18} className="text-brand-violet-light" /> Steam, Twitch, YouTube, Discord…</span>
          <Icon name="chevron_right" size={18} className="text-text-muted" />
        </button>
        <p className="text-[11px] text-text-muted mt-2">Add a <b>My live stream</b>, <b>tournament</b>, <b>event</b> or <b>squad</b> block from the Links tab to feature your Vergr activity.</p>
      </Card>
    </div>
  );
}
