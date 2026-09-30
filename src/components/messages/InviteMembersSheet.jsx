// Post-import "Invite your members" sheet (14_GROWTH_MIGRATION §3.1).
// The import gives the owner a furnished house; this gets the residents in.
// Every share carries the owner's ?ref= so the referral VP + coin revenue
// share pay the OWNER for each member who joins — said plainly on the sheet.
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { useUI } from '../../context/UIContext';
import { withRef } from '../../utils/shareRef';
import { postDiscordMigrationNotice } from '../../firebase/firestore';

export default function InviteMembersSheet({ groups = [], source, guildId, onClose }) {
  const { showToast } = useUI();
  const [selected, setSelected] = useState(groups[0]?.id || '');
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticePosted, setNoticePosted] = useState(false);

  const linkFor = (id) => withRef(`https://vergr.app/messages/g/${id}`);
  const current = groups.find((g) => g.id === selected) || groups[0];
  const shareText = useMemo(() => {
    if (!current) return '';
    return `Our community is moving to Vergr — join ${current.name} here: ${linkFor(current.id)}`;
  }, [current]);

  const announcement = useMemo(() => {
    const lines = ['**We\'re moving to Vergr!** Same channels, same people, new home:', ''];
    for (const g of groups.slice(0, 20)) lines.push(`${g.name}: ${linkFor(g.id)}`);
    if (groups.length > 20) lines.push(`…and ${groups.length - 20} more.`);
    return lines.join('\n');
  }, [groups]);

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); showToast(`${label} copied`, 'success'); }
    catch { showToast('Copy failed', 'error'); }
  };

  const systemShare = async () => {
    try {
      if (navigator.share) await navigator.share({ text: shareText });
      else await copy(shareText, 'Invite');
    } catch { /* user dismissed the sheet */ }
  };

  const postNotice = async () => {
    setNoticeBusy(true);
    try {
      await postDiscordMigrationNotice(guildId);
      setNoticePosted(true);
      showToast('Migration notice posted in your Discord', 'success');
    } catch (err) {
      const msg = err?.message || '';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.reason === 'bot_needs_reinstall') {
          showToast('Re-add the Vergr bot (it needs the updated permissions to post)', 'error');
          if (parsed.botInstallUrl) window.open(parsed.botInstallUrl, '_blank', 'noopener');
          return;
        }
      } catch { /* not a structured error */ }
      showToast(msg.includes('already_posted') ? 'Notice was already posted' : (msg || 'Could not post'), 'error');
      if (msg.includes('already_posted')) setNoticePosted(true);
    } finally { setNoticeBusy(false); }
  };

  if (!groups.length) return null;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
      <div className="w-full sm:max-w-md bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl overflow-hidden pb-[var(--vg-safe-b,0px)]">
        <div className="px-6 pt-5 pb-4 border-b border-white/[0.05] flex items-center justify-between">
          <h2 className="font-syne text-lg font-extrabold text-text-primary">Invite your members</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><Icon name="close" size={22} /></button>
        </div>

        <div className="px-6 py-5">
          {/* The incentive, stated plainly */}
          <div className="rounded-xl bg-brand-violet/10 border border-brand-violet/25 px-4 py-3 mb-4">
            <p className="text-white text-sm font-bold mb-0.5">You earn from every member who joins</p>
            <p className="text-text-secondary text-[11px] leading-relaxed">
              These links carry your referral code: each member who signs up pays you the referral bonus,
              plus a share of their coin purchases for 2 years.
            </p>
          </div>

          {groups.length > 1 && (
            <>
              <label className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-1.5 block">Share which group?</label>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}
                className="w-full mb-3 bg-surface-2 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm outline-none [&>option]:bg-surface-2 [&>option]:text-white">
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </>
          )}

          <div className="space-y-2">
            <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')}
              className="w-full py-3 rounded-xl bg-[#25D366] text-white text-sm font-bold hover:brightness-110 flex items-center justify-center gap-2">
              <Icon name="chat" size={18} /> Share to WhatsApp
            </button>
            <button onClick={() => copy(announcement, 'Announcement')}
              className="w-full py-3 rounded-xl bg-[#5865F2] text-white text-sm font-bold hover:brightness-110 flex items-center justify-center gap-2">
              <Icon name="content_copy" size={18} /> Copy Discord announcement
            </button>
            {source === 'discord' && guildId && (
              <button onClick={postNotice} disabled={noticeBusy || noticePosted}
                className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-bold hover:bg-white/[0.1] disabled:opacity-50 flex items-center justify-center gap-2">
                <Icon name="campaign" size={18} className="text-brand-violet-light" />
                {noticePosted ? 'Notice posted ✓' : noticeBusy ? 'Posting…' : 'Post migration notice in your Discord'}
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={() => copy(linkFor(current.id), 'Link')}
                className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-bold hover:bg-white/[0.1] flex items-center justify-center gap-2">
                <Icon name="link" size={18} /> Copy link
              </button>
              <button onClick={systemShare}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 flex items-center justify-center gap-2">
                <Icon name="ios_share" size={18} /> Share…
              </button>
            </div>
          </div>
          {source === 'discord' && (
            <p className="text-text-muted text-[10px] leading-relaxed mt-3">
              The migration notice is ONE embed posted by the bot in your server — members are never DM'd.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
