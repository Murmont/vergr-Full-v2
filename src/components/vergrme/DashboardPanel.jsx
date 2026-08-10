import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import { VERGRME_DISPLAY_PREFIX } from '../../utils/vergrMeUrl';
import { Card, StatTile } from './EditorUI';
import { VERGRME_TEMPLATES } from '../../utils/vergrMeThemes';

export default function DashboardPanel({ form, username, uid, isPro, onSelect, onCopy, copied, onOpen, onShare, onApplyTemplate }) {
  const [stats, setStats] = useState(null);
  // A near-empty page (just the 2 default blocks) gets the friendly first-run
  // template prompt up top; established pages get a quieter "start over" entry.
  const blockCount = (form.blocks || []).length;
  const isFresh = blockCount <= 2;

  useEffect(() => {
    if (!uid) return;
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10);
    });
    Promise.all(days.map(async (day) => {
      const s = await getDoc(doc(db, 'users', uid, 'vergrMeViews', day));
      return s.exists() ? s.data() : null;
    })).then((rows) => {
      const valid = rows.filter(Boolean);
      const clicks = valid.reduce((sum, d) => sum + Object.values(d.blockClicks || d.linkClicks || {}).reduce((a, b) => a + b, 0), 0);
      setStats({ views: valid.reduce((s, d) => s + (d.views || 0), 0), clicks });
    }).catch(() => setStats({ views: 0, clicks: 0 }));
  }, [uid]);

  const liveBlocks = (form.blocks || []).filter((b) => b.enabled !== false).length;

  const Templates = onApplyTemplate && (
    <Card title={isFresh ? "Let's build your page in 60 seconds" : 'Start from a template'}>
      {isFresh && <p className="text-xs text-text-muted -mt-1 mb-3">Pick a starting point, then make it yours. You can change everything.</p>}
      <div className="grid grid-cols-2 gap-2">
        {VERGRME_TEMPLATES.map((tpl) => (
          <button key={tpl.id} onClick={() => onApplyTemplate(tpl)}
            className="flex items-start gap-3 p-3 bg-surface-2/60 rounded-xl border border-white/5 hover:border-brand-violet/40 text-left transition-colors">
            <div className="w-9 h-9 rounded-lg bg-brand-violet/15 flex items-center justify-center shrink-0"><Icon name={tpl.icon} size={18} className="text-brand-violet-light" /></div>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{tpl.label}</p>
              <p className="text-[11px] text-text-muted leading-snug">{tpl.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {isFresh && Templates}

      {/* Status / URL hero */}
      <Card className="!p-0 overflow-hidden">
        <div className="p-5" style={{ background: 'linear-gradient(135deg, rgba(123,31,255,0.25), rgba(180,79,255,0.12))' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full ${form.isPublic !== false ? 'bg-brand-violet' : 'bg-text-muted'}`} />
            <span className="text-xs font-semibold">{form.isPublic !== false ? 'Your page is live' : 'Your page is private'}</span>
          </div>
          <p className="text-lg font-mono text-brand-violet-light">{VERGRME_DISPLAY_PREFIX}{username}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Action icon={copied ? 'check' : 'content_copy'} label={copied ? 'Copied' : 'Copy'} onClick={onCopy} />
            <Action icon="open_in_new" label="Open" onClick={onOpen} />
            <Action icon="ios_share" label="Share" onClick={onShare} />
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile value={stats ? stats.views.toLocaleString() : '—'} label="Views · 30d" accent="var(--brand-violet)" />
        <StatTile value={stats ? stats.clicks.toLocaleString() : '—'} label="Clicks · 30d" />
        <StatTile value={liveBlocks} label="Live blocks" />
      </div>
      {!isPro && (
        <button onClick={() => onSelect('analytics')} className="text-[11px] text-brand-violet-light self-start">Unlock full analytics with Pro →</button>
      )}

      {/* Quick actions */}
      <Card title="Quick actions">
        <div className="grid grid-cols-2 gap-2">
          <Quick icon="add_link" label="Add a link" onClick={() => onSelect('links')} />
          <Quick icon="palette" label="Customize design" onClick={() => onSelect('appearance')} />
          <Quick icon="bolt" label="Connect socials" onClick={() => onSelect('integrations')} />
          <Quick icon="bar_chart" label="View analytics" onClick={() => onSelect('analytics')} />
        </div>
      </Card>

      {!isFresh && Templates}
    </div>
  );
}

function Action({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium border border-white/15">
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

function Quick({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 p-3 bg-surface-2/60 rounded-xl border border-white/5 hover:border-brand-violet/30 text-left">
      <div className="w-9 h-9 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0"><Icon name={icon} size={18} className="text-brand-violet-light" /></div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
