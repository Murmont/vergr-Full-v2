// EventShareSheet — share/sell-tickets control for ticketed events.
// Exports:
//   <EventShareSheet tournament onClose onSendDm /> — full modal (desktop
//     popover / mobile bottom sheet): copyable URL, social targets, QR.
//   <EventShareRow tournament onSendDm />            — inline row (Copy / Share
//     / social icons) for the landing page + lobby; opens the sheet.
//
// The share link is always `${origin}/e/${tournamentId}` — the public landing
// page. QR encodes the same URL ("scan to open / watch on stream overlay").
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../Icon';
import { useUI } from '../../context/UIContext';

function shareUrlFor(tid) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://vergr.app';
  return `${origin}/e/${tid}`;
}

const SOCIALS = [
  { id: 'x', label: 'X', icon: 'tag', href: (u, t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}` },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'chat', href: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
  { id: 'reddit', label: 'Reddit', icon: 'forum', href: (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}` },
  { id: 'telegram', label: 'Telegram', icon: 'send', href: (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}` },
];

export function EventShareSheet({ tournament, onClose, onSendDm }) {
  const { showToast } = useUI();
  const tid = tournament?.id;
  const url = shareUrlFor(tid);
  const text = `Watch ${tournament?.name || 'this event'} on VERGR`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Link copied', 'success'); }
    catch { showToast('Could not copy', 'error'); }
  };
  const nativeShare = async () => {
    if (navigator.share) { try { await navigator.share({ title: tournament?.name, text, url }); } catch { /* cancelled */ } }
    else copy();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-1 border border-white/[0.08] rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-syne text-lg font-bold text-white">Share this event</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={20} /></button>
        </div>
        <p className="text-text-muted text-xs -mt-2">Invite fans to buy a ticket and support the host.</p>

        {/* URL + copy */}
        <div className="flex items-center gap-2 p-2 rounded-xl bg-bg-dark/60 border border-white/[0.06]">
          <span className="flex-1 truncate text-text-secondary text-xs font-dmmono px-1">{url}</span>
          <button onClick={copy} className="px-3 py-1.5 rounded-lg bg-brand-violet text-white text-xs font-bold hover:brightness-110">Copy</button>
        </div>

        {/* Targets */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={nativeShare} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/15">
            <Icon name="ios_share" size={20} className="text-brand-violet-light" />
            <span className="text-[10px] text-text-secondary">Share</span>
          </button>
          {SOCIALS.map(s => (
            <a key={s.id} href={s.href(url, text)} target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/15">
              <Icon name={s.icon} size={20} className="text-text-secondary" />
              <span className="text-[10px] text-text-secondary">{s.label}</span>
            </a>
          ))}
          {onSendDm && (
            <button onClick={() => { onSendDm(); onClose?.(); }} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/15">
              <Icon name="forum" size={20} className="text-brand-violet-light" />
              <span className="text-[10px] text-text-secondary">Send in DM</span>
            </button>
          )}
        </div>

        {/* QR */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-dark/60 border border-white/[0.06]">
          <div className="bg-white p-1.5 rounded-lg">
            <QRCodeSVG value={url} size={72} bgColor="#ffffff" fgColor="#0B0B14" />
          </div>
          <div className="flex-1">
            <p className="text-text-primary text-sm font-bold">Scan to open</p>
            <p className="text-text-muted text-[11px]">Great for a stream overlay or in-person promo.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EventShareRow({ tournament, onSendDm, className = '' }) {
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);
  const url = shareUrlFor(tournament?.id);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Link copied', 'success'); }
    catch { showToast('Could not copy', 'error'); }
  };
  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-text-primary text-xs font-semibold">
          <Icon name="link" size={15} /> Copy link
        </button>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-violet text-white text-xs font-bold hover:brightness-110">
          <Icon name="ios_share" size={15} /> Share
        </button>
      </div>
      {open && <EventShareSheet tournament={tournament} onSendDm={onSendDm} onClose={() => setOpen(false)} />}
    </>
  );
}

export default EventShareSheet;
